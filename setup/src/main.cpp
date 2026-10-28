// Exo Browser Setup: the window that installs, updates and uninstalls Exo Browser, as Exo Launcher's Setup does.
//
// The screens are Exo's look (its tokens, Inter and motion) drawn by WebView2, the engine Exo Browser
// itself runs on, from a page packed into this exe. The work is an NSIS engine appended to this exe,
// run silently: it writes each step to a status file this window shows, and the staging folder it
// fills gives the real progress. /S shows no window at all. Without WebView2 the engine's own plain
// screens run instead (and it installs WebView2 for Exo Browser too).
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <dwmapi.h>
#include <wrl.h>
#include <atomic>
#include <cstdint>
#include <fstream>
#include <map>
#include <string>
#include <thread>
#include <vector>
#include "WebView2.h"
#include "WebView2EnvironmentOptions.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

#ifndef PRODUCT_VERSION
#define PRODUCT_VERSION L"0.0.0"
#endif

namespace {
constexpr wchar_t kHost[] = L"setup.exo-browser.local";
constexpr char kMagic[8] = {'E', 'X', 'O', 'S', 'E', 'T', 'U', 'P'};
constexpr UINT WM_APP_POST = WM_APP + 1; // a JSON message for the page, posted from a worker thread

HWND g_window = nullptr;
ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_view;
std::map<std::wstring, std::string> g_files; // the page, from the packed resource
std::atomic<bool> g_busy{false};
bool g_uninstall = false;
uint64_t g_engineOffset = 0, g_engineSize = 0, g_appBytes = 0;
std::wstring g_self, g_temp, g_root, g_app;

std::wstring Known(REFKNOWNFOLDERID id) {
    PWSTR path = nullptr;
    std::wstring out;
    if (SUCCEEDED(SHGetKnownFolderPath(id, 0, nullptr, &path))) out = path;
    CoTaskMemFree(path);
    return out;
}

bool Exists(const std::wstring& path) { return GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES; }

std::string Utf8(const std::wstring& text) {
    if (text.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, text.data(), (int)text.size(), nullptr, 0, nullptr, nullptr);
    std::string out(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), (int)text.size(), out.data(), n, nullptr, nullptr);
    return out;
}

std::wstring Wide(const std::string& text) {
    if (text.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, text.data(), (int)text.size(), nullptr, 0);
    std::wstring out(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), (int)text.size(), out.data(), n);
    return out;
}

// A JSON string literal: quotes, backslashes and control characters escaped.
std::string Json(const std::wstring& text) {
    std::string in = Utf8(text), out = "\"";
    for (unsigned char c : in) {
        if (c == '"' || c == '\\') { out += '\\'; out += (char)c; }
        else if (c < 0x20) { char buf[8]; sprintf_s(buf, "\\u%04x", c); out += buf; }
        else out += (char)c;
    }
    return out + "\"";
}

// Posts to the page from any thread (WebView2 calls belong to the window's thread).
void Post(const std::string& json) {
    auto copy = new std::wstring(Wide(json));
    if (!PostMessageW(g_window, WM_APP_POST, 0, reinterpret_cast<LPARAM>(copy))) delete copy;
}

// The NSIS engine and its sizes, appended after this exe: [engine][u64 engine size][u64 app bytes]["EXOSETUP"].
bool ReadTrailer() {
    std::ifstream file(g_self, std::ios::binary | std::ios::ate);
    if (!file) return false;
    auto total = (uint64_t)file.tellg();
    if (total < 24) return false;
    char magic[8];
    file.seekg(total - 8);
    file.read(magic, 8);
    if (memcmp(magic, kMagic, 8) != 0) return false;
    file.seekg(total - 24);
    file.read(reinterpret_cast<char*>(&g_engineSize), 8);
    file.read(reinterpret_cast<char*>(&g_appBytes), 8);
    if (g_engineSize == 0 || g_engineSize > total - 24) return false;
    g_engineOffset = total - 24 - g_engineSize;
    return true;
}

std::wstring ExtractEngine() {
    std::wstring path = g_temp + L"\\engine.exe";
    std::ifstream in(g_self, std::ios::binary);
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!in || !out) return {};
    in.seekg((std::streamoff)g_engineOffset);
    std::vector<char> buffer(1 << 20);
    for (uint64_t left = g_engineSize; left > 0;) {
        auto chunk = (std::streamsize)std::min<uint64_t>(left, buffer.size());
        in.read(buffer.data(), chunk);
        if (in.gcount() != chunk) return {};
        out.write(buffer.data(), chunk);
        left -= (uint64_t)chunk;
    }
    return out.good() ? path : std::wstring{};
}

DWORD Run(const std::wstring& exe, const std::wstring& args, HANDLE* process = nullptr, DWORD* pid = nullptr) {
    std::wstring line = L"\"" + exe + L"\" " + args;
    STARTUPINFOW si{sizeof(si)};
    PROCESS_INFORMATION pi{};
    if (!CreateProcessW(exe.c_str(), line.data(), nullptr, nullptr, FALSE, 0, nullptr, g_temp.c_str(), &si, &pi)) return GetLastError();
    CloseHandle(pi.hThread);
    if (pid) *pid = pi.dwProcessId;
    if (process) { *process = pi.hProcess; return 0; }
    WaitForSingleObject(pi.hProcess, INFINITE);
    DWORD code = 1;
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hProcess);
    return code;
}

uint64_t FolderBytes(const std::wstring& dir) {
    uint64_t total = 0;
    WIN32_FIND_DATAW data;
    HANDLE find = FindFirstFileExW((dir + L"\\*").c_str(), FindExInfoBasic, &data, FindExSearchNameMatch, nullptr, FIND_FIRST_EX_LARGE_FETCH);
    if (find == INVALID_HANDLE_VALUE) return 0;
    do {
        if (!wcscmp(data.cFileName, L".") || !wcscmp(data.cFileName, L"..")) continue;
        if (data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) continue;
        if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) total += FolderBytes(dir + L"\\" + data.cFileName);
        else total += ((uint64_t)data.nFileSizeHigh << 32) | data.nFileSizeLow;
    } while (FindNextFileW(find, &data));
    FindClose(find);
    return total;
}

std::wstring LastLine(const std::wstring& path) {
    std::ifstream in(path, std::ios::binary);
    std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
    auto at = text.find_last_of('\n');
    return Wide(at == std::string::npos ? text : text.substr(at + 1));
}

void DeleteTree(const std::wstring& dir) {
    std::wstring from = dir + L'\0';
    SHFILEOPSTRUCTW op{};
    op.wFunc = FO_DELETE;
    op.pFrom = from.c_str();
    op.fFlags = FOF_NO_UI;
    SHFileOperationW(&op);
}

std::wstring DesktopLink() { return Known(FOLDERID_Desktop) + L"\\Exo Browser.lnk"; }

// Install or update: the engine silently, its staging folder's growth as the progress, its status file as the step.
void Install(bool desktop) {
    std::wstring engine = ExtractEngine();
    if (engine.empty()) { Post(R"({"type":"failed","message":"Setup could not unpack itself. Download it again and retry."})"); g_busy = false; return; }
    std::wstring status = g_temp + L"\\status.txt";
    DeleteFileW(status.c_str());
    DeleteFileW((g_root + L"\\update-error.log").c_str());
    HANDLE process = nullptr;
    DWORD pid = 0;
    std::wstring args = L"/S /NOLAUNCH /DESKTOP=" + std::wstring(desktop ? L"1" : L"0") + L" /STATUSFILE=" + status;
    if (Run(engine, args, &process, &pid) != 0) { Post(R"({"type":"failed","message":"Setup could not start its installer."})"); g_busy = false; return; }
    std::wstring incoming = g_root + L"\\app.incoming-" + std::to_wstring(pid);
    std::wstring shown;
    double last = -1, copied = 0;
    while (WaitForSingleObject(process, 120) == WAIT_TIMEOUT) {
        double value = copied;
        if (Exists(incoming)) value = copied = g_appBytes ? std::min(0.88, 0.88 * (double)FolderBytes(incoming) / (double)g_appBytes) : 0.5;
        else if (copied > 0) value = std::max(copied, 0.9);
        std::wstring step = LastLine(status);
        if (step != shown || value - last > 0.004) {
            shown = step;
            last = value;
            char buf[48];
            sprintf_s(buf, "%.4f", value);
            Post(std::string(R"({"type":"progress","value":)") + buf + R"(,"status":)" + Json(step) + "}");
        }
    }
    DWORD code = 1;
    GetExitCodeProcess(process, &code);
    CloseHandle(process);
    if (code == 0 && Exists(g_app + L"\\ExoBrowser.exe")) Post(R"({"type":"done"})");
    else {
        std::wstring why = LastLine(g_root + L"\\update-error.log");
        if (why.empty()) why = L"Setup stopped before it finished. Your existing installation was not changed.";
        Post(std::string(R"({"type":"failed","message":)") + Json(why) + "}");
    }
    g_busy = false;
}

// Uninstall: NSIS's uninstaller silently, in place (it waits), then what it couldn't remove while running.
// With "Also remove my data", the whole Exo Browser folder goes: history, sign-ins, bookmarks and Exo Vault.
void Uninstall(bool removeData) {
    std::wstring engine = g_app + L"\\Uninstall.exe";
    Post(R"({"type":"progress","value":0.3,"status":"Closing Exo Browser"})");
    DWORD code = Exists(engine) ? Run(engine, L"/S _?=" + g_app) : 0;
    Post(R"({"type":"progress","value":0.8,"status":"Removing files"})");
    if (code == 0) {
        DeleteFileW(engine.c_str());
        DeleteFileW((g_app + L"\\ExoSetup.exe").c_str());
        if (!Exists(g_app + L"\\ExoBrowser.exe")) DeleteTree(g_app);
        DeleteFileW(DesktopLink().c_str());
        if (removeData) {
            Post(R"({"type":"progress","value":0.9,"status":"Removing your data"})");
            // Exo Vault's file first: the keeper holding its key across the browser's close then lets go (its copy in
            // Keeper is in use until it does).
            for (const wchar_t* f : {L"\\vault.exovault", L"\\vault.exovault.bak", L"\\vault.exovault.tmp"}) DeleteFileW((g_root + f).c_str());
            // WebView2's own processes let go of the profile a moment after the browser closes.
            for (int i = 0; i < 50 && Exists(g_root); i++) { DeleteTree(g_root); if (Exists(g_root)) Sleep(200); }
        }
        if (removeData && Exists(g_root)) Post(R"({"type":"failed","message":"Exo Browser was removed, but some of its data is still in use. Restart Windows, then delete the ExoBrowser folder in %LOCALAPPDATA%."})");
        else Post(R"({"type":"done"})");
    } else Post(R"({"type":"failed","message":"Exo Browser is still running. Close it and try again."})");
    g_busy = false;
}

void SendState() {
    bool updating = Exists(g_app + L"\\ExoBrowser.exe");
    bool desktop = updating ? Exists(DesktopLink()) : true;
    std::string json = std::string(R"({"type":"state","mode":)") + (g_uninstall ? "\"uninstall\"" : "\"install\"") +
        R"(,"updating":)" + (updating ? "true" : "false") + R"(,"desktop":)" + (desktop ? "true" : "false") +
        R"(,"version":)" + Json(PRODUCT_VERSION) + R"(,"path":)" + Json(g_app) + "}";
    g_view->PostWebMessageAsJson(Wide(json).c_str());
}

bool Has(const std::wstring& message, const wchar_t* needle) { return message.find(needle) != std::wstring::npos; }

void OnMessage(const std::wstring& message) {
    if (Has(message, L"\"hello\"")) SendState();
    else if (Has(message, L"\"install\"") && !g_busy.exchange(true)) {
        bool desktop = Has(message, L"\"desktop\":true");
        std::thread([desktop] { Install(desktop); }).detach();
    } else if (Has(message, L"\"uninstall\"") && !g_busy.exchange(true)) {
        bool removeData = Has(message, L"\"removeData\":true");
        std::thread([removeData] { Uninstall(removeData); }).detach();
    }
    else if (Has(message, L"\"launch\"")) {
        std::wstring exe = g_app + L"\\ExoBrowser.exe";
        STARTUPINFOW si{sizeof(si)};
        PROCESS_INFORMATION pi{};
        std::wstring line = L"\"" + exe + L"\"";
        // Started in Exo Browser's own folder, not the app folder: the next update renames that one.
        if (CreateProcessW(exe.c_str(), line.data(), nullptr, nullptr, FALSE, 0, nullptr, g_root.c_str(), &si, &pi)) { CloseHandle(pi.hThread); CloseHandle(pi.hProcess); }
        PostMessageW(g_window, WM_CLOSE, 0, 0);
    } else if (Has(message, L"\"close\"") && !g_busy) PostMessageW(g_window, WM_CLOSE, 0, 0);
    else if (Has(message, L"\"minimize\"")) ShowWindow(g_window, SW_MINIMIZE);
    else if (Has(message, L"\"drag\"")) { ReleaseCapture(); SendMessageW(g_window, WM_NCLBUTTONDOWN, HTCAPTION, 0); }
    else if (Has(message, L"\"shown\"")) ShowWindow(g_window, SW_SHOW);
}

const wchar_t* TypeOf(const std::wstring& path) {
    auto ext = PathFindExtensionW(path.c_str());
    if (!_wcsicmp(ext, L".html")) return L"text/html; charset=utf-8";
    if (!_wcsicmp(ext, L".js")) return L"text/javascript; charset=utf-8";
    if (!_wcsicmp(ext, L".css")) return L"text/css; charset=utf-8";
    if (!_wcsicmp(ext, L".svg")) return L"image/svg+xml";
    if (!_wcsicmp(ext, L".png")) return L"image/png";
    if (!_wcsicmp(ext, L".woff2")) return L"font/woff2";
    if (!_wcsicmp(ext, L".ttf")) return L"font/ttf";
    return L"application/octet-stream";
}

// The packed page: [u32 count] then per file [u16 name length][name, UTF-8][u32 size][bytes].
void LoadPage() {
    HRSRC res = FindResourceW(nullptr, MAKEINTRESOURCEW(101), RT_RCDATA);
    if (!res) return;
    auto data = static_cast<const uint8_t*>(LockResource(LoadResource(nullptr, res)));
    DWORD size = SizeofResource(nullptr, res), at = 4;
    if (!data || size < 4) return;
    uint32_t count = *reinterpret_cast<const uint32_t*>(data);
    for (uint32_t i = 0; i < count && at + 6 <= size; i++) {
        uint16_t nameLength = *reinterpret_cast<const uint16_t*>(data + at); at += 2;
        std::string name(reinterpret_cast<const char*>(data + at), nameLength); at += nameLength;
        uint32_t length = *reinterpret_cast<const uint32_t*>(data + at); at += 4;
        if (at + length > size) break;
        g_files[L"/" + Wide(name)] = std::string(reinterpret_cast<const char*>(data + at), length);
        at += length;
    }
}

void Serve(ICoreWebView2Environment* env, ICoreWebView2WebResourceRequestedEventArgs* args) {
    ComPtr<ICoreWebView2WebResourceRequest> request;
    args->get_Request(&request);
    LPWSTR raw = nullptr;
    request->get_Uri(&raw);
    std::wstring uri = raw ? raw : L"";
    CoTaskMemFree(raw);
    auto start = uri.find(kHost);
    std::wstring path = start == std::wstring::npos ? L"" : uri.substr(start + wcslen(kHost));
    if (auto q = path.find_first_of(L"?#"); q != std::wstring::npos) path.resize(q);
    if (path.empty() || path == L"/") path = L"/index.html";
    ComPtr<ICoreWebView2WebResourceResponse> response;
    auto found = g_files.find(path);
    if (found == g_files.end()) {
        env->CreateWebResourceResponse(nullptr, 404, L"Not Found", L"", &response);
    } else {
        ComPtr<IStream> stream;
        stream.Attach(SHCreateMemStream(reinterpret_cast<const BYTE*>(found->second.data()), (UINT)found->second.size()));
        std::wstring headers = std::wstring(L"Content-Type: ") + TypeOf(path) + L"\r\nCache-Control: no-store";
        env->CreateWebResourceResponse(stream.Get(), 200, L"OK", headers.c_str(), &response);
    }
    args->put_Response(response.Get());
}

void Resize() {
    if (!g_controller) return;
    RECT r;
    GetClientRect(g_window, &r);
    g_controller->put_Bounds(r);
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_SIZE:
        Resize();
        // WebView2 doesn't follow its window being shown or minimized by itself: the page would stay hidden (no drawing, no motion).
        if (g_controller) g_controller->put_IsVisible(wp != SIZE_MINIMIZED && IsWindowVisible(hwnd));
        return 0;
    case WM_SHOWWINDOW:
        if (g_controller) g_controller->put_IsVisible(wp ? TRUE : FALSE);
        break;
    case WM_APP_POST: {
        auto json = reinterpret_cast<std::wstring*>(lp);
        if (g_view) g_view->PostWebMessageAsJson(json->c_str());
        delete json;
        return 0;
    }
    case WM_CLOSE:
        if (g_busy) return 0; // never in the middle of an install
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY:
        if (g_controller) g_controller->Close();
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

// No WebView2: the engine's own screens (they install WebView2 for Exo Browser too).
int Fallback() {
    if (g_uninstall) return (int)Run(g_app + L"\\Uninstall.exe", L"");
    std::wstring engine = ExtractEngine();
    return engine.empty() ? 1 : (int)Run(engine, L"");
}

bool Arg(int argc, wchar_t** argv, const wchar_t* name) {
    for (int i = 1; i < argc; i++) if (!_wcsicmp(argv[i], name)) return true;
    return false;
}
} // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    // Not in the folder it was started from: an update from Settings starts Setup from inside the app folder, and a
    // process's current folder can't be renamed, so the install engine's swap of it always failed ("in use").
    {
        wchar_t temp[MAX_PATH];
        if (GetTempPathW(MAX_PATH, temp)) SetCurrentDirectoryW(temp);
    }
    wchar_t self[MAX_PATH * 4];
    GetModuleFileNameW(nullptr, self, ARRAYSIZE(self));
    g_self = self;
    g_root = Known(FOLDERID_LocalAppData) + L"\\ExoBrowser";
    // A walk-through build's engine (/DEXO_TEST_ROOT) installs under its own folder: the window follows it there.
    wchar_t testRoot[MAX_PATH];
    if (GetEnvironmentVariableW(L"EXO_SETUP_TEST_ROOT", testRoot, MAX_PATH) > 0) g_root = testRoot;
    g_app = g_root + L"\\app";
    int argc = 0;
    wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    g_uninstall = Arg(argc, argv, L"--uninstall");
    bool hasEngine = ReadTrailer();

    // Uninstalling from inside the app folder: run from a temporary copy, so the folder can go.
    if (g_uninstall && !Arg(argc, argv, L"--from-temp")) {
        wchar_t tempDir[MAX_PATH];
        GetTempPathW(MAX_PATH, tempDir);
        std::wstring copy = std::wstring(tempDir) + L"ExoBrowserSetup-uninstall-" + std::to_wstring(GetCurrentProcessId()) + L".exe";
        if (CopyFileW(g_self.c_str(), copy.c_str(), FALSE)) {
            STARTUPINFOW si{sizeof(si)};
            PROCESS_INFORMATION pi{};
            std::wstring line = L"\"" + copy + L"\" --uninstall --from-temp";
            if (CreateProcessW(copy.c_str(), line.data(), nullptr, nullptr, FALSE, 0, nullptr, tempDir, &si, &pi)) { CloseHandle(pi.hThread); CloseHandle(pi.hProcess); return 0; }
        }
    }
    if (!g_uninstall && !hasEngine) {
        MessageBoxW(nullptr, L"This copy of Exo Browser Setup is incomplete. Download it again.", L"Exo Browser Setup", MB_ICONSTOP);
        return 1;
    }

    wchar_t tempDir[MAX_PATH];
    GetTempPathW(MAX_PATH, tempDir);
    g_temp = std::wstring(tempDir) + L"ExoBrowserSetup-" + std::to_wstring(GetCurrentProcessId());
    CreateDirectoryW(g_temp.c_str(), nullptr);

    int result = 0;
    // /S: no window, the engine's own silent install, its exit code.
    if (!g_uninstall && (Arg(argc, argv, L"/S") || GetEnvironmentVariableW(L"EXO_SILENT_INSTALL", nullptr, 0) > 0)) {
        std::wstring engine = ExtractEngine();
        result = engine.empty() ? 1 : (int)Run(engine, L"/S");
        DeleteTree(g_temp);
        return result;
    }
    LocalFree(argv);

    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    LoadPage();
    WNDCLASSEXW wc{sizeof(wc)};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = instance;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    wc.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
    wc.lpszClassName = L"ExoBrowserSetup";
    RegisterClassExW(&wc);
    UINT dpi = GetDpiForSystem();
    int w = MulDiv(460, dpi, 96), h = MulDiv(520, dpi, 96);
    RECT work;
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
    g_window = CreateWindowExW(WS_EX_APPWINDOW, wc.lpszClassName, g_uninstall ? L"Uninstall Exo Browser" : L"Exo Browser Setup",
        WS_POPUP | WS_MINIMIZEBOX | WS_SYSMENU | WS_CLIPCHILDREN, work.left + (work.right - work.left - w) / 2,
        work.top + (work.bottom - work.top - h) / 2, w, h, nullptr, nullptr, instance, nullptr);
    // Windows 11's rounded corners, a dark frame and Exo's hairline border.
    DWORD round = 2, dark = 1, border = 0x001F1F1F;
    DwmSetWindowAttribute(g_window, 33, &round, sizeof(round));
    DwmSetWindowAttribute(g_window, 20, &dark, sizeof(dark));
    DwmSetWindowAttribute(g_window, 34, &border, sizeof(border));

    std::wstring data = g_temp + L"\\webview";
    // EXO_SETUP_DEVTOOLS: a debugging port (9556) to inspect the page while working on it.
    auto options = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
    if (GetEnvironmentVariableW(L"EXO_SETUP_DEVTOOLS", nullptr, 0) > 0) options->put_AdditionalBrowserArguments(L"--remote-debugging-port=9556");
    HRESULT created = CreateCoreWebView2EnvironmentWithOptions(nullptr, data.c_str(), options.Get(),
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>([](HRESULT hr, ICoreWebView2Environment* env) -> HRESULT {
            if (FAILED(hr) || !env) { DestroyWindow(g_window); return S_OK; }
            ComPtr<ICoreWebView2Environment> keep(env);
            env->CreateCoreWebView2Controller(g_window, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                [keep](HRESULT hr, ICoreWebView2Controller* controller) -> HRESULT {
                    if (FAILED(hr) || !controller) { DestroyWindow(g_window); return S_OK; }
                    g_controller = controller;
                    g_controller->get_CoreWebView2(&g_view);
                    ComPtr<ICoreWebView2Controller2> c2;
                    if (SUCCEEDED(g_controller.As(&c2))) c2->put_DefaultBackgroundColor({255, 0, 0, 0});
                    ComPtr<ICoreWebView2Settings> settings;
                    g_view->get_Settings(&settings);
                    settings->put_AreDefaultContextMenusEnabled(FALSE);
                    settings->put_IsStatusBarEnabled(FALSE);
                    settings->put_IsZoomControlEnabled(FALSE);
                    settings->put_AreDevToolsEnabled(GetEnvironmentVariableW(L"EXO_SETUP_DEVTOOLS", nullptr, 0) > 0);
                    ComPtr<ICoreWebView2Settings3> s3;
                    if (SUCCEEDED(settings.As(&s3))) s3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
                    g_view->AddWebResourceRequestedFilter((std::wstring(L"https://") + kHost + L"/*").c_str(), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
                    g_view->add_WebResourceRequested(Callback<ICoreWebView2WebResourceRequestedEventHandler>(
                        [keep](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT { Serve(keep.Get(), args); return S_OK; }).Get(), nullptr);
                    g_view->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                        [](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                            LPWSTR text = nullptr;
                            if (SUCCEEDED(args->TryGetWebMessageAsString(&text)) && text) OnMessage(text);
                            CoTaskMemFree(text);
                            return S_OK;
                        }).Get(), nullptr);
                    // Only Setup's own page: anything else opens nowhere.
                    g_view->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
                        [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                            LPWSTR uri = nullptr;
                            args->get_Uri(&uri);
                            if (!uri || wcsncmp(uri, L"https://setup.exo-browser.local/", 32) != 0) args->put_Cancel(TRUE);
                            CoTaskMemFree(uri);
                            return S_OK;
                        }).Get(), nullptr);
                    g_view->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                        [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT { args->put_Handled(TRUE); return S_OK; }).Get(), nullptr);
                    Resize();
                    g_view->Navigate((std::wstring(L"https://") + kHost + L"/index.html").c_str());
                    // Shown once the page has drawn ("shown"), or after a moment at the latest.
                    SetTimer(g_window, 1, 1500, [](HWND hwnd, UINT, UINT_PTR id, DWORD) { KillTimer(hwnd, id); ShowWindow(hwnd, SW_SHOW); });
                    return S_OK;
                }).Get());
            return S_OK;
        }).Get());
    if (FAILED(created)) {
        DestroyWindow(g_window);
        result = Fallback();
    } else {
        MSG msg;
        while (GetMessageW(&msg, nullptr, 0, 0)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
        if (!g_view) result = Fallback(); // WebView2 present but would not start
    }
    g_controller.Reset();
    g_view.Reset();
    // Setup leaves nothing behind: its unpacked engine, status file and browser data (once WebView2 lets go).
    for (int i = 0; i < 30 && Exists(g_temp); i++) { DeleteTree(g_temp); if (Exists(g_temp)) Sleep(100); }
    // The uninstaller's temporary copy of itself goes a moment after it exits.
    if (g_uninstall && g_self.find(L"ExoBrowserSetup-uninstall-") != std::wstring::npos) {
        wchar_t cmd[MAX_PATH];
        GetEnvironmentVariableW(L"ComSpec", cmd, MAX_PATH);
        std::wstring line = L"\"" + std::wstring(cmd) + L"\" /d /c ping -n 3 127.0.0.1 >nul & del /f /q \"" + g_self + L"\"";
        STARTUPINFOW si{sizeof(si)};
        si.dwFlags = STARTF_USESHOWWINDOW;
        si.wShowWindow = SW_HIDE;
        PROCESS_INFORMATION pi{};
        if (CreateProcessW(cmd, line.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) { CloseHandle(pi.hThread); CloseHandle(pi.hProcess); }
    }
    CoUninitialize();
    return result;
}
