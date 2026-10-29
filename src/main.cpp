// Exo Browser: a native Win32 host around one WebView2 environment (Edge's official,
// PGO-built Chromium). The window is one DirectComposition tree: the active tab's content,
// clipped to a rounded card and blurred under overlays, with Exo's chrome page composited
// on top. The host routes mouse input itself and owns tab lifetime (sleep, discard, restore).

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <windowsx.h>
#include <shellapi.h>
#include <shlobj.h>
#include <dwmapi.h>
#include <d2d1effects.h>
#include <DispatcherQueue.h>
#include <windows.ui.composition.interop.h>
#include <windows.graphics.effects.interop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Foundation.Numerics.h>
#include <winrt/Windows.System.h>
#include <winrt/Windows.UI.Composition.h>
#include <winrt/Windows.UI.Composition.Desktop.h>
#include <winrt/Windows.Graphics.Effects.h>
#include <array>
#include <chrono>
#include <shlwapi.h>
#include <shobjidl.h>
#include <urlmon.h>
#include <thread>
#include <unordered_set>
#include <wincrypt.h>
#include <bcrypt.h>
#include <wrl.h>
#include <algorithm>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>
#include <wtsapi32.h>
#include <sddl.h>
#include <wincodec.h>
#include <winhttp.h>
#include <deque>
#include <mutex>
#include "WebView2.h"
#include "WebView2EnvironmentOptions.h"
#include "vault.h"
#include "version.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::Make;

// ---------------------------------------------------------------------------------------
// Layout, in DIPs. The Bar is Exo's: 8px above 36px capsules; the page fills everything below.
static const int kBarDip = 52;
static const int kResizeDip = 6;
static const size_t kHistoryLimit = 20000;
static const size_t kHistoryToUi = 4000;
static const UINT kTimerSleep = 1, kTimerSave = 2;
static const UINT WM_APP_STATE = WM_APP + 1;
static const UINT WM_APP_EXT_READY = WM_APP + 2;  // lParam: new std::wstring* (folder, or "!" + error)
static const wchar_t kClassName[] = L"ExoBrowserWindow";
static const int kUi = -1;  // input target id of the chrome page; tabs are 1..n
// The new tab page is ui/newtab.html, served to tabs from this host only.
static const wchar_t kNewTabHost[] = L"newtab.exo";
static const wchar_t kNewTab[] = L"https://newtab.exo/newtab.html";

struct Tab {
    int id = 0;
    ComPtr<ICoreWebView2CompositionController> comp;
    ComPtr<ICoreWebView2Controller> ctl;
    ComPtr<ICoreWebView2> core;
    winrt::Windows::UI::Composition::ContainerVisual visual{nullptr};
    ComPtr<ICoreWebView2Find> find;
    std::wstring url, title, favicon, pendingNav;
    std::vector<std::function<void(Tab*)>> whenReady;
    HCURSOR cursor = nullptr;
    ULONGLONG lastActive = 0;
    UINT64 left = 0;  // when it was last left, as a count (two left in the same instant still differ): Ctrl+Tab's order
    bool creating = false, loading = false, audible = false, muted = false;
    bool suspended = false, lowMemory = false, pinned = false;
    UINT64 navId = 0;  // the navigation the tab is loading: a late "done" from one it replaced doesn't end it
    int space = 0;     // the space it belongs to; 0 is a favorite, in every space
    std::wstring home; // a pinned tab's own page: it goes back there, and closing it only puts it to sleep there
    long long seen = 0;  // when it was last on screen (Unix seconds), for the archive
    bool peek = false;   // Peek's card: a tab off the strip, floating over the page until opened or closed
    int split = 0;         // split view: the tabs sharing it show side by side (2 to 4)
    bool under = false;    // scrolled down with nothing pinned to its top: the page runs up under the Bar (edge-page.js)
    std::wstring navFrom;  // where the navigation under way started, before any redirect
    ULONGLONG navAt = 0;
    std::wstring cleanedFrom;  // the last address it opened without its trackers (CleanNavigation), and when
    ULONGLONG cleanedAt = 0;
    std::wstring boostScript;  // the id of its Boosts script (run on every page it opens), once added
    int folder = 0;            // the folder it sits in among its space's pinned tabs (0: none)
    bool priv = false;         // private: its own profile, kept in memory only; no history, never in the session
    bool kept = false;         // Keep this tab: never archived, and never asleep (frozen or closed) to save memory
    bool crashed = false;      // its page's process went while it was off screen: loaded again when it's shown
    bool pipped = false;       // AutoPip floated its video as it was left: put back as it comes on screen
    int blocked = 0;           // what Exo Shield blocked on the page it shows (its exo-count.js), beside the address
};

// A space: a set of tabs of its own (its pinned tabs and the one last on screen too), with a name, an icon, a color
// that becomes the Bar's accent while it is on screen, and optionally its own appearance. There is always at least
// one; with only one, nothing about spaces shows.
struct Space { int id = 0; std::wstring name, icon, color, theme; int last = 0; };

// A folder among a space's pinned tabs, as Arc's: a name, open or closed, perhaps inside another folder. Its tabs are
// pinned and sit together, folders first in the order they were made, then the space's other pinned tabs. A live folder
// follows a site's feed instead (RSS or Atom): its newest posts show in it.
struct TabFolder { int id = 0, space = 0, parent = 0; std::wstring name; bool open = true; std::wstring feed; };

struct ClosedTab { std::wstring url, title; size_t index; int space = 0; };
struct Archived { std::wstring url, title; long long at = 0; int space = 0; };
struct Visit { std::wstring url, title; int visits = 0; long long last = 0; };
struct Bookmark { std::wstring url, title; };

struct App {
    HWND hwnd = nullptr;
    UINT dpi = 96;
    std::wstring exeDir, dataDir;
    ComPtr<ICoreWebView2Environment10> env;
    winrt::Windows::System::DispatcherQueueController queue{nullptr};
    winrt::Windows::UI::Composition::Compositor compositor{nullptr};
    winrt::Windows::UI::Composition::Desktop::DesktopWindowTarget target{nullptr};
    winrt::Windows::UI::Composition::ContainerVisual root{nullptr}, chromeLayer{nullptr}, glassLayer{nullptr}, chromeVisual{nullptr};
    winrt::Windows::UI::Composition::ContainerVisual glassTop{nullptr}, glassSide{nullptr}, glassFree{nullptr};
    bool revealedTop = true, revealedSide = true;
    bool glassTopIn = true, glassSideIn = true;  // the Bar's and sidebar's frost, as the page last showed them
    winrt::Windows::UI::Composition::LayerVisual content{nullptr};
    winrt::Windows::UI::Composition::ContainerVisual peekLayer{nullptr};  // Peek's card, over the blurred page
    // What the glass frosts: the page and Peek's card over it.
    winrt::Windows::UI::Composition::ContainerVisual scene{nullptr};
    int peekId = 0;
    RECT peekRect{};
    int nextSplit = 1;
    winrt::Windows::UI::Composition::CompositionEffectBrush blur{nullptr};
    bool revealed = true, pinned = false;
    ComPtr<ICoreWebView2CompositionController> uiComp;
    ComPtr<ICoreWebView2Controller> uiCtl;
    ComPtr<ICoreWebView2> ui;
    HCURSOR uiCursor = nullptr;
    bool uiReady = false, profileReady = false;
    std::vector<std::unique_ptr<Tab>> tabs;
    std::vector<ClosedTab> closed;
    std::unordered_map<std::wstring, Visit> history;
    std::unordered_map<std::wstring, std::wstring> settings;
    std::unordered_map<std::wstring, std::wstring> favicons;  // site -> data: URL
    std::vector<Bookmark> bookmarks;
    bool faviconsDirty = false;
    int sidebarDip = 0;           // vertical tabs: the sidebar's width; 0 with tabs on top
    int chromeTopDip = 52;        // the Bar's height (with the tab row when tabs are on top)
    bool autohide = false;        // the Bar and sidebar hide until the pointer reaches their edge
    int revealTop = 0, revealLeft = 0;  // px of chrome shown over the page while revealed
    COLORREF page = RGB(0, 0, 0);  // the Appearance's page color, under the Bar and sidebar
    std::wstring theme = L"void";  // resolved: void, dark or light
    HWND popup = nullptr;          // an extension's popup
    ComPtr<ICoreWebView2Controller> popupCtl;
    int activeId = 0, nextId = 1;
    std::vector<Space> spaces;
    int space = 0, nextSpace = 1;  // the space on screen
    std::vector<TabFolder> folders;
    int nextFolder = 1;
    std::vector<Archived> archive;  // tabs the archive closed, newest last (archive.tsv)
    bool overlay = false, fullscreen = false, elementFullscreen = false, minimized = false;
    bool modal = false;  // What's New or the update sheet is up: nothing behind it, the Bar's keys included, works
    bool statePending = false, sessionDirty = false, historyDirty = false, tracking = false;
    int capture = 0, hover = 0, focus = 0;
    RECT contentRect{};
    WINDOWPLACEMENT placement{sizeof(WINDOWPLACEMENT)};
    LONG_PTR savedStyle = 0;
    std::vector<std::wstring> startupUrls;
} g;

// ---------------------------------------------------------------------------------------
// Small helpers

static int Px(int dip) { return MulDiv(dip, (int)g.dpi, 96); }

static std::wstring Take(LPWSTR s) {
    std::wstring r = s ? s : L"";
    if (s) CoTaskMemFree(s);
    return r;
}

static std::string Utf8(const std::wstring& w) {
    if (w.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
    std::string s(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), s.data(), n, nullptr, nullptr);
    return s;
}

static std::wstring Wide(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}

static std::wstring Json(const std::wstring& s) {
    std::wstring o;
    o.reserve(s.size() + 2);
    o += L'"';
    for (wchar_t c : s) {
        switch (c) {
        case L'"': o += L"\\\""; break;
        case L'\\': o += L"\\\\"; break;
        case L'\n': o += L"\\n"; break;
        case L'\r': o += L"\\r"; break;
        case L'\t': o += L"\\t"; break;
        default:
            if (c < 0x20) {
                wchar_t buf[8];
                swprintf_s(buf, L"\\u%04x", (unsigned)c);
                o += buf;
            } else {
                o += c;
            }
        }
    }
    o += L'"';
    return o;
}

static const wchar_t* Bool(bool b) { return b ? L"true" : L"false"; }

static std::vector<std::wstring> Split(const std::wstring& s, wchar_t sep) {
    std::vector<std::wstring> parts;
    size_t start = 0;
    for (;;) {
        size_t at = s.find(sep, start);
        if (at == std::wstring::npos) { parts.push_back(s.substr(start)); break; }
        parts.push_back(s.substr(start, at - start));
        start = at + 1;
    }
    return parts;
}

static std::wstring Field(std::wstring s) {
    for (auto& c : s) if (c == L'\t' || c == L'\r' || c == L'\n') c = L' ';
    return s;
}

static std::string ReadFileUtf8(const std::wstring& path) {
    HANDLE f = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    if (f == INVALID_HANDLE_VALUE) return {};
    LARGE_INTEGER size{};
    GetFileSizeEx(f, &size);
    std::string data((size_t)size.QuadPart, '\0');
    DWORD read = 0;
    if (!data.empty()) ReadFile(f, data.data(), (DWORD)data.size(), &read, nullptr);
    CloseHandle(f);
    data.resize(read);
    return data;
}

// Written beside, then swapped in, so a crash mid-write never leaves half a file.
static void WriteFileUtf8(const std::wstring& path, const std::string& data) {
    // The browser's own tables (*.tsv) aren't written again with the same bytes as their last write: a save with nothing
    // new in it flushed the disk all the same. Anything else (an export you asked for, an extension's files) always is.
    static std::mutex lock;
    static std::unordered_map<std::wstring, size_t> lastWrite;
    bool table = path.size() > 4 && _wcsicmp(path.c_str() + path.size() - 4, L".tsv") == 0;
    size_t hash = std::hash<std::string>{}(data);
    if (table) {
        std::lock_guard<std::mutex> hold(lock);
        if (auto it = lastWrite.find(path); it != lastWrite.end() && it->second == hash) return;
    }
    std::wstring tmp = path + L".tmp";
    HANDLE f = CreateFileW(tmp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, 0, nullptr);
    if (f == INVALID_HANDLE_VALUE) return;
    DWORD written = 0;
    // Only a complete copy replaces the file (a full disk writes short).
    bool whole = WriteFile(f, data.data(), (DWORD)data.size(), &written, nullptr) && written == data.size();
    CloseHandle(f);
    if (whole && MoveFileExW(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        std::lock_guard<std::mutex> hold(lock);
        if (table) lastWrite[path] = hash;
    } else {
        DeleteFileW(tmp.c_str());
    }
}

// exo.log, beside your data: a line for what went wrong and where, never a page's address or a path on this PC, so
// Copy logs can hand it on as it is. It keeps its last 64 KB.
static void LogLine(const std::wstring& line) {
    SYSTEMTIME t;
    GetLocalTime(&t);
    wchar_t at[24];
    swprintf_s(at, L"%04u-%02u-%02u %02u:%02u:%02u ", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond);
    std::wstring path = g.dataDir + L"\\exo.log";
    std::string text = Utf8(at + line + L"\n");
    HANDLE f = CreateFileW(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, nullptr, OPEN_ALWAYS, 0, nullptr);
    if (f == INVALID_HANDLE_VALUE) return;
    DWORD written;
    WriteFile(f, text.data(), (DWORD)text.size(), &written, nullptr);
    LARGE_INTEGER size{};
    GetFileSizeEx(f, &size);
    CloseHandle(f);
    if (size.QuadPart > 128 * 1024) {
        std::string all = ReadFileUtf8(path);
        size_t from = all.size() > 64 * 1024 ? all.find('\n', all.size() - 64 * 1024) : std::string::npos;
        if (from != std::string::npos) WriteFileUtf8(path, all.substr(from + 1));
    }
}

static std::vector<std::vector<std::wstring>> ReadTable(const wchar_t* name) {
    std::vector<std::vector<std::wstring>> rows;
    for (auto& line : Split(Wide(ReadFileUtf8(g.dataDir + L"\\" + name)), L'\n')) {
        if (!line.empty() && line.back() == L'\r') line.pop_back();
        if (!line.empty()) rows.push_back(Split(line, L'\t'));
    }
    return rows;
}

static std::wstring Base64(const BYTE* data, DWORD size) {
    DWORD chars = 0;
    CryptBinaryToStringW(data, size, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &chars);
    std::wstring out(chars, L'\0');
    CryptBinaryToStringW(data, size, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, out.data(), &chars);
    out.resize(chars);
    return out;
}

static long long NowSeconds() {
    FILETIME ft;
    GetSystemTimeAsFileTime(&ft);
    ULARGE_INTEGER u{ft.dwLowDateTime, ft.dwHighDateTime};
    return (long long)(u.QuadPart / 10000000ULL - 11644473600ULL);
}

static Tab* FindTab(int id) {
    for (auto& t : g.tabs) if (t->id == id) return t.get();
    return nullptr;
}

static Tab* Active() { return FindTab(g.activeId); }

static Space* FindSpace(int id) {
    for (auto& s : g.spaces) if (s.id == id) return &s;
    return nullptr;
}

// The tabs of a space, in the strip's order.
static TabFolder* FindFolder(int id) {
    for (auto& f : g.folders) if (f.id == id) return &f;
    return nullptr;
}

static std::vector<Tab*> SpaceTabs(int space) {
    std::vector<Tab*> out;
    for (auto& t : g.tabs) if ((t->space == space || t->space == 0) && !t->peek) out.push_back(t.get());
    return out;
}

static size_t IndexOf(int id) {
    for (size_t i = 0; i < g.tabs.size(); i++) if (g.tabs[i]->id == id) return i;
    return g.tabs.size();
}

// "news.example.com" from "https://www.news.example.com/a?b": the key for icons and top sites.
static std::wstring SiteOf(const std::wstring& url) {
    size_t start = url.find(L"://");
    if (start == std::wstring::npos) return L"";
    start += 3;
    size_t end = url.find_first_of(L"/?#:", start);
    std::wstring site = url.substr(start, end == std::wstring::npos ? std::wstring::npos : end - start);
    if (site.rfind(L"www.", 0) == 0) site = site.substr(4);
    return site;
}

static bool IsNewTab(const std::wstring& url) { return SiteOf(url) == kNewTabHost; }

static std::wstring Setting(const wchar_t* key, const wchar_t* fallback) {
    auto it = g.settings.find(key);
    return it == g.settings.end() || it->second.empty() ? fallback : it->second;
}

// ---------------------------------------------------------------------------------------
// Persistence: settings, session and history are tab-separated UTF-8 under %LOCALAPPDATA%.

static void SaveSettings() {
    std::string out;
    for (auto& [k, v] : g.settings) out += Utf8(Field(k) + L"\t" + Field(v)) + "\n";
    WriteFileUtf8(g.dataDir + L"\\settings.tsv", out);
}

static void SaveSession() {
    g.sessionDirty = false;
    // The active tab's place among the tabs written (a tab with no address yet isn't), and each space's last one.
    size_t active = 0, n = 0;
    std::string tabs, last;
    for (auto& t : g.tabs) {
        if (t->url.empty() || t->peek || t->priv) continue;
        if (t->id == g.activeId) active = n;
        Space* s = FindSpace(t->space);
        if (s && t->id == (s->id == g.space ? g.activeId : s->last)) last += "last\t" + std::to_string(s->id) + "\t" + std::to_string(n) + "\n";
        n++;
        tabs += Utf8(L"tab\t" + Field(t->url) + L"\t" + Field(t->title) + L"\t" + (t->pinned ? L"1" : L"0") + L"\t" +
                     std::to_wstring(t->space) + L"\t" + Field(t->home) + L"\t" + std::to_wstring(t->seen) + L"\t" + std::to_wstring(t->split) + L"\t" +
                     std::to_wstring(t->folder) + L"\t" + (t->kept ? L"1" : L"0")) + "\n";
    }
    WriteFileUtf8(g.dataDir + L"\\session.tsv", "active\t" + std::to_string(active) + "\n" + last + tabs);
}

// Spaces are saved the moment they change, apart from the tabs: one made a second before a crash is still there, and
// they stay when Reopen tabs is off.
static void SaveSpaces() {
    std::string out = "current\t" + std::to_string(g.space) + "\n";
    for (auto& s : g.spaces)
        out += Utf8(L"space\t" + std::to_wstring(s.id) + L"\t" + Field(s.name) + L"\t" + Field(s.icon) + L"\t" + Field(s.color) +
                    L"\t" + Field(s.theme)) + "\n";
    for (auto& f : g.folders)
        out += Utf8(L"folder\t" + std::to_wstring(f.id) + L"\t" + std::to_wstring(f.space) + L"\t" + std::to_wstring(f.parent) + L"\t" +
                    (f.open ? L"1" : L"0") + L"\t" + Field(f.name) + L"\t" + Field(f.feed)) + "\n";
    WriteFileUtf8(g.dataDir + L"\\spaces.tsv", out);
}

static void LoadSpaces() {
    int current = 0;
    for (auto& row : ReadTable(L"spaces.tsv")) {
        if (row[0] == L"current" && row.size() > 1) current = _wtoi(row[1].c_str());
        if (row[0] != L"space" || row.size() < 3) continue;
        Space s;
        s.id = _wtoi(row[1].c_str());
        if (s.id <= 0 || FindSpace(s.id) || row[2].empty()) continue;
        s.name = row[2];
        if (row.size() > 3) s.icon = row[3];
        if (row.size() > 4) s.color = row[4];
        if (row.size() > 5) s.theme = row[5];
        g.spaces.push_back(s);
        g.nextSpace = std::max(g.nextSpace, s.id + 1);
    }
    if (g.spaces.empty()) g.spaces.push_back({g.nextSpace++, L"Home", L"home"});
    g.space = FindSpace(current) ? current : g.spaces[0].id;
    for (auto& row : ReadTable(L"spaces.tsv")) {
        if (row[0] != L"folder" || row.size() < 6) continue;
        TabFolder f{_wtoi(row[1].c_str()), _wtoi(row[2].c_str()), _wtoi(row[3].c_str()), row[5], row[4] != L"0", row.size() > 6 ? row[6] : L""};
        if (f.id <= 0 || FindFolder(f.id) || !FindSpace(f.space)) continue;
        g.folders.push_back(f);
        g.nextFolder = std::max(g.nextFolder, f.id + 1);
    }
    // One whose parent is gone (or in another space) sits at the top of its space.
    for (auto& f : g.folders)
        if (TabFolder* up = FindFolder(f.parent); f.parent && (!up || up->space != f.space)) f.parent = 0;
}

static void SaveHistory() {
    g.historyDirty = false;
    std::vector<const Visit*> all;
    all.reserve(g.history.size());
    for (auto& [_, v] : g.history) all.push_back(&v);
    std::sort(all.begin(), all.end(), [](auto a, auto b) { return a->last > b->last; });
    if (all.size() > kHistoryLimit) all.resize(kHistoryLimit);
    std::string out;
    for (auto v : all)
        out += Utf8(Field(v->url) + L"\t" + Field(v->title) + L"\t" + std::to_wstring(v->visits) + L"\t" +
                    std::to_wstring(v->last)) + "\n";
    WriteFileUtf8(g.dataDir + L"\\history.tsv", out);
}

static void LoadHistory() {
    for (auto& row : ReadTable(L"history.tsv")) {
        if (row.size() < 4) continue;
        Visit v{row[0], row[1], _wtoi(row[2].c_str()), _wtoi64(row[3].c_str())};
        g.history[v.url] = v;
    }
}

static void SaveBookmarks() {
    std::string out;
    for (auto& b : g.bookmarks) out += Utf8(Field(b.url) + L"\t" + Field(b.title)) + "\n";
    WriteFileUtf8(g.dataDir + L"\\bookmarks.tsv", out);
}

static void SaveFavicons() {
    g.faviconsDirty = false;
    std::string out;
    for (auto& [site, fav] : g.favicons) out += Utf8(site + L"\t" + fav) + "\n";
    WriteFileUtf8(g.dataDir + L"\\favicons.tsv", out);
}

static void MarkSessionDirty() {
    // Saved 1.5 s after the first change, not the last: a page that retitles itself every second (a ticker, an
    // unread count) would otherwise push the save back forever.
    if (g.sessionDirty) return;
    g.sessionDirty = true;
    SetTimer(g.hwnd, kTimerSave, 1500, nullptr);
}

// ---------------------------------------------------------------------------------------
// Talking to the chrome page

static void UiPost(const std::wstring& json) {
    if (g.ui && g.uiReady) g.ui->PostWebMessageAsJson(json.c_str());
}

static std::wstring TabJson(const Tab* t) {
    return L"{\"id\":" + std::to_wstring(t->id) + L",\"title\":" + Json(t->title) + L",\"url\":" + Json(t->url) +
           L",\"loading\":" + Bool(t->loading) + L",\"audible\":" + Bool(t->audible) + L",\"muted\":" +
           Bool(t->muted) + L",\"sleeping\":" + Bool(t->suspended || (!t->ctl && !t->creating)) +
           L",\"pinned\":" + Bool(t->pinned) + L",\"space\":" + std::to_wstring(t->space) +
           (t->home.empty() ? L"" : L",\"home\":" + Json(t->home)) + (t->split ? L",\"split\":" + std::to_wstring(t->split) : L"") +
           (t->folder ? L",\"folder\":" + std::to_wstring(t->folder) : L"") + (t->priv ? L",\"priv\":true" : L"") +
           (t->kept ? L",\"kept\":true" : L"") + (t->blocked ? L",\"blocked\":" + std::to_wstring(t->blocked) : L"") + L"}";
}

static void ArmSleep();

// Many events land at once (a navigation fires source, title, history and favicon), so the
// page hears one state message per turn of the message loop.
static void QueueState() {
    ArmSleep();
    if (g.statePending || !g.hwnd) return;
    g.statePending = true;
    PostMessageW(g.hwnd, WM_APP_STATE, 0, 0);
}

static void SendState() {
    g.statePending = false;
    std::wstring tabs;
    for (auto& t : g.tabs) {
        if (t->peek) continue;
        if (!tabs.empty()) tabs += L",";
        tabs += TabJson(t.get());
    }
    BOOL back = FALSE, fwd = FALSE;
    if (Tab* a = Active(); a && a->core) {
        a->core->get_CanGoBack(&back);
        a->core->get_CanGoForward(&fwd);
    }
    std::wstring spaces;
    for (auto& s : g.spaces) {
        if (!spaces.empty()) spaces += L",";
        spaces += L"{\"id\":" + std::to_wstring(s.id) + L",\"name\":" + Json(s.name) + L",\"icon\":" + Json(s.icon) + L",\"color\":" +
                  Json(s.color) + L",\"theme\":" + Json(s.theme) + L"}";
    }
    std::wstring folders;
    for (auto& f : g.folders) {
        if (!folders.empty()) folders += L",";
        folders += L"{\"id\":" + std::to_wstring(f.id) + L",\"space\":" + std::to_wstring(f.space) + L",\"parent\":" + std::to_wstring(f.parent) +
                   L",\"name\":" + Json(f.name) + L",\"open\":" + Bool(f.open) + (f.feed.empty() ? L"" : L",\"live\":true") + L"}";
    }
    UiPost(L"{\"t\":\"state\",\"active\":" + std::to_wstring(g.activeId) + L",\"tabs\":[" + tabs + L"],\"back\":" +
           Bool(back) + L",\"fwd\":" + Bool(fwd) + L",\"max\":" + Bool(IsZoomed(g.hwnd)) + L",\"full\":" +
           Bool(g.fullscreen) + L",\"space\":" + std::to_wstring(g.space) + L",\"spaces\":[" + spaces + L"],\"folders\":[" + folders + L"]}");
}

static void SendFavicon(const Tab* t) {
    UiPost(L"{\"t\":\"fav\",\"id\":" + std::to_wstring(t->id) + L",\"fav\":" + Json(t->favicon) + L"}");
}

static void SendSettings() {
    std::wstring body;
    for (auto& [k, v] : g.settings) {
        if (!body.empty()) body += L",";
        body += Json(k) + L":" + Json(v);
    }
    UiPost(L"{\"t\":\"settings\",\"theme\":" + Json(g.theme) + L",\"values\":{" + body + L"}}");
}

static void SendHistory() {
    std::vector<const Visit*> all;
    for (auto& [_, v] : g.history) all.push_back(&v);
    std::sort(all.begin(), all.end(), [](auto a, auto b) { return a->last > b->last; });
    if (all.size() > kHistoryToUi) all.resize(kHistoryToUi);
    std::wstring items;
    for (auto v : all) {
        if (!items.empty()) items += L",";
        items += L"[" + Json(v->url) + L"," + Json(v->title) + L"," + std::to_wstring(v->visits) + L"," +
                 std::to_wstring(v->last) + L"]";
    }
    UiPost(L"{\"t\":\"history\",\"items\":[" + items + L"]}");
}

// Sharp icons, for the new tab page's cards: a site's largest declared icon (or the
// apple-touch-icon most sites keep at their root), fetched once and kept in icons.tsv. The tab
// strip's small favicons stay in g.favicons.
static const UINT WM_APP_ICON = WM_APP + 4;  // lParam: new std::pair<site, data: URL or "">*
static const UINT kTimerIcons = 11;           // new icons: saved and shown together, a moment after the last
static std::unordered_map<std::wstring, std::wstring> g_icons;
static std::unordered_set<std::wstring> g_iconTried;
static std::unordered_map<std::wstring, long long> g_iconMiss;  // site -> when none was found; asked again a week later
static bool g_iconsDirty = false;
// One fetch at a time, in order: an import can bring hundreds of bookmarks at once.
static std::mutex g_iconLock;
static std::deque<std::pair<std::wstring, std::vector<std::wstring>>> g_iconQueue;
static bool g_iconWorking = false;

// A site's icon as the cards draw it: the largest picture in the file (an .ico holds several), at most 96 px (cards
// show it at 30 to 48), as PNG. A 512 px touch icon would otherwise ride along in every new tab page's data.
static std::string ShrinkIcon(const std::string& bytes) {
    ComPtr<IWICImagingFactory> wic;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&wic)))) return {};
    ComPtr<IStream> in;
    in.Attach(SHCreateMemStream((const BYTE*)bytes.data(), (UINT)bytes.size()));
    ComPtr<IWICBitmapDecoder> decoder;
    if (!in || FAILED(wic->CreateDecoderFromStream(in.Get(), nullptr, WICDecodeMetadataCacheOnDemand, &decoder))) return {};
    UINT frames = 0, bw = 0, bh = 0;
    decoder->GetFrameCount(&frames);
    ComPtr<IWICBitmapFrameDecode> best;
    for (UINT i = 0; i < frames; i++) {
        ComPtr<IWICBitmapFrameDecode> f;
        UINT w = 0, h = 0;
        if (SUCCEEDED(decoder->GetFrame(i, &f)) && SUCCEEDED(f->GetSize(&w, &h)) && w * h > bw * bh) { best = f; bw = w; bh = h; }
    }
    if (!best || bw < 32 || bh < 32) return {};
    ComPtr<IWICFormatConverter> converter;
    if (FAILED(wic->CreateFormatConverter(&converter)) ||
        FAILED(converter->Initialize(best.Get(), GUID_WICPixelFormat32bppPBGRA, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom)))
        return {};
    ComPtr<IWICBitmapSource> source = converter;
    UINT side = std::min<UINT>(96, std::max(bw, bh));
    UINT w = bw >= bh ? side : std::max<UINT>(1, bw * side / bh), h = bh >= bw ? side : std::max<UINT>(1, bh * side / bw);
    if (w != bw || h != bh) {
        ComPtr<IWICBitmapScaler> scaler;
        if (FAILED(wic->CreateBitmapScaler(&scaler)) ||
            FAILED(scaler->Initialize(converter.Get(), w, h, WICBitmapInterpolationModeHighQualityCubic)))
            return {};
        source = scaler;
    }
    ComPtr<IStream> out;
    out.Attach(SHCreateMemStream(nullptr, 0));
    ComPtr<IWICBitmapEncoder> encoder;
    ComPtr<IWICBitmapFrameEncode> frame;
    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    if (!out || FAILED(wic->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder)) ||
        FAILED(encoder->Initialize(out.Get(), WICBitmapEncoderNoCache)) || FAILED(encoder->CreateNewFrame(&frame, nullptr)) ||
        FAILED(frame->Initialize(nullptr)) || FAILED(frame->SetSize(w, h)) || FAILED(frame->SetPixelFormat(&format)) ||
        FAILED(frame->WriteSource(source.Get(), nullptr)) || FAILED(frame->Commit()) || FAILED(encoder->Commit()))
        return {};
    ULARGE_INTEGER size{};
    if (FAILED(IStream_Size(out.Get(), &size)) || FAILED(IStream_Reset(out.Get()))) return {};
    std::string png((size_t)size.QuadPart, '\0');
    if (FAILED(IStream_Read(out.Get(), png.data(), (ULONG)png.size()))) return {};
    return png;
}

static std::wstring IconDataUrl(const std::string& b) {
    if (b.size() < 16 || b.size() > 512 * 1024) return L"";
    auto u = [&](size_t i) { return (unsigned char)b[i]; };
    const wchar_t* type = nullptr;
    if (b.compare(0, 4, "\x89PNG") == 0 && b.size() > 24) {
        unsigned w = (u(16) << 24) | (u(17) << 16) | (u(18) << 8) | u(19);
        if (w >= 32) type = L"image/png";  // cards draw icons at 30px
    } else if (u(0) == 0xFF && u(1) == 0xD8) type = L"image/jpeg";
    else if (b.compare(0, 4, "RIFF") == 0 && b.compare(8, 4, "WEBP") == 0) type = L"image/webp";
    else if (u(0) == 0 && u(1) == 0 && u(2) == 1 && u(3) == 0) {
        int count = u(4) | (u(5) << 8);
        for (int i = 0; i < count && 6 + i * 16 < (int)b.size(); i++)
            if (u(6 + i * 16) == 0 || u(6 + i * 16) >= 32) { type = L"image/x-icon"; break; }
    } else if (b.substr(0, 512).find("<svg") != std::string::npos) type = L"image/svg+xml";
    return type ? std::wstring(L"data:") + type + L";base64," + Base64((const BYTE*)b.data(), (DWORD)b.size()) : L"";
}

static void IconWorker();

// ---------------------------------------------------------------------------------------
// Where Exo Browser connects of its own accord (never a page's requests): every such request asks here first, by what
// it is for, and goes only where PRIVACY.md says it goes. A fixed purpose has a fixed host; a site's icon goes to that
// site, or to the icon address its own page names, and a live folder's feed to the feed you followed, over HTTPS only.
// tools/privacy-check.mjs, run by each release build, fails when PRIVACY.md and this list part, or when a request
// skips this check.
enum class Egress { Update, Extension, Icon, Feed };
static const struct { Egress why; const wchar_t* host; } kDestinations[] = {
    {Egress::Update, L"updates.getexo.app"},  // Exo's update address: the newest release, its files
    {Egress::Update, L"github.com"},              // Settings > About, when Exo's address doesn't answer: the same from GitHub
    {Egress::Extension, L"clients2.google.com"},  // an extension added from the Chrome Web Store
};

static bool EgressAllowed(Egress why, const std::wstring& url) {
    if (url.rfind(L"https://", 0) != 0) return false;
    wchar_t host[256] = {};
    URL_COMPONENTS u{sizeof u};
    u.lpszHostName = host;
    u.dwHostNameLength = ARRAYSIZE(host);
    if (!WinHttpCrackUrl(url.c_str(), 0, 0, &u)) return false;
    std::wstring h = host;
    for (auto& c : h) c = towlower(c);
    for (auto& d : kDestinations)
        if (d.why == why) return h == d.host;
    return why == Egress::Icon || why == Egress::Feed;
}

static void FetchIcon(const std::wstring& site, const std::wstring& declared) {
    // Tried once per session each way: from the page's own choice, and by guessing the address. A site with
    // none to guess is left alone for a week.
    if (site.empty() || g_icons.count(site) || !g_iconTried.insert(site + (declared.empty() ? L"" : L"#page")).second) return;
    if (declared.empty())
        if (auto miss = g_iconMiss.find(site); miss != g_iconMiss.end() && NowSeconds() - miss->second < 7 * 86400) return;
    std::vector<std::wstring> urls;
    if (declared.rfind(L"https://", 0) == 0) urls.push_back(declared);
    urls.push_back(L"https://" + site + L"/apple-touch-icon.png");
    if (site.rfind(L"www.", 0) != 0) urls.push_back(L"https://www." + site + L"/apple-touch-icon.png");
    // Last, the site's favicon.ico: often 32 or 48 px inside, enough for a card when nothing larger exists.
    urls.push_back(L"https://" + (site.rfind(L"www.", 0) == 0 ? site : L"www." + site) + L"/favicon.ico");
    std::lock_guard<std::mutex> lock(g_iconLock);
    g_iconQueue.push_back({site, urls});
    if (!g_iconWorking) {
        g_iconWorking = true;
        std::thread(IconWorker).detach();
    }
}

static void IconWorker() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    HWND hwnd = g.hwnd;
    for (;;) {
        std::pair<std::wstring, std::vector<std::wstring>> next;
        {
            std::lock_guard<std::mutex> lock(g_iconLock);
            if (g_iconQueue.empty()) { g_iconWorking = false; break; }
            next = std::move(g_iconQueue.front());
            g_iconQueue.pop_front();
        }
        std::wstring data;
        for (auto& u : next.second) {
            wchar_t file[MAX_PATH];
            if (!EgressAllowed(Egress::Icon, u) || FAILED(URLDownloadToCacheFileW(nullptr, u.c_str(), file, MAX_PATH, 0, nullptr))) continue;
            std::string bytes = ReadFileUtf8(file);
            std::string png = ShrinkIcon(bytes);
            data = png.empty() ? IconDataUrl(bytes) : L"data:image/png;base64," + Base64((const BYTE*)png.data(), (DWORD)png.size());
            if (!data.empty()) break;
        }
        PostMessageW(hwnd, WM_APP_ICON, 0, (LPARAM)new std::pair<std::wstring, std::wstring>(next.first, data));
    }
    CoUninitialize();
}

// The page's own choice: its largest icon, an SVG one first.
static const wchar_t kIconScript[] =
    L"(() => { const score = (l) => /svg/.test(l.type) || /\\.svg(\\?|$)/.test(l.href) ? 1e4 :"
    L" Math.max(/apple/.test(l.rel) ? 180 : 0, ...String(l.sizes && l.sizes.value || '').split(/\\s+/).map((x) => parseInt(x) || 0));"
    L" const all = [...document.querySelectorAll('link[rel~=icon], link[rel~=apple-touch-icon], link[rel~=apple-touch-icon-precomposed]')]"
    L"  .filter((l) => l.href.startsWith('https://')).sort((a, b) => score(b) - score(a));"
    L" return all.length && score(all[0]) >= 32 ? all[0].href : ''; })()";

static void SaveIcons() {
    g_iconsDirty = false;
    std::string out, miss;
    for (auto& [site, data] : g_icons) out += Utf8(site + L"\t" + data) + "\n";
    for (auto& [site, when] : g_iconMiss) miss += Utf8(site) + "\t" + std::to_string(when) + "\n";
    WriteFileUtf8(g.dataDir + L"\\iconmiss.tsv", miss);
    WriteFileUtf8(g.dataDir + L"\\icons.tsv", out);
}

// History cleared (or visits removed): the icons kept for sites nothing points to any more go too, so favicons.tsv and
// icons.tsv stop being a list of every site you ever visited. Bookmarks, open tabs and the archive keep theirs.
static void PruneSiteIcons() {
    std::unordered_set<std::wstring> keep;
    for (auto& [url, _] : g.history) keep.insert(SiteOf(url));
    for (auto& b : g.bookmarks) keep.insert(SiteOf(b.url));
    for (auto& t : g.tabs) if (!t->priv) keep.insert(SiteOf(t->url));
    for (auto& a : g.archive) keep.insert(SiteOf(a.url));
    size_t before = g.favicons.size() + g_icons.size() + g_iconMiss.size();
    std::erase_if(g.favicons, [&](auto& x) { return !keep.count(x.first); });
    std::erase_if(g_icons, [&](auto& x) { return !keep.count(x.first); });
    std::erase_if(g_iconMiss, [&](auto& x) { return !keep.count(x.first); });
    std::erase_if(g_iconTried, [&](auto& s) { return !keep.count(s.substr(0, s.find(L'#'))); });
    if (g.favicons.size() + g_icons.size() + g_iconMiss.size() == before) return;
    SaveFavicons();
    SaveIcons();
}

static std::wstring FavFor(const std::wstring& url) {
    if (auto it = g_icons.find(SiteOf(url)); it != g_icons.end()) return it->second;
    auto it = g.favicons.find(SiteOf(url));
    return it == g.favicons.end() ? L"" : it->second;
}

// [url, title, icon, sharp]: sharp when the icon is a large one.
static std::wstring BookmarksJson() {
    std::wstring items;
    for (auto& b : g.bookmarks) {
        if (!items.empty()) items += L",";
        bool sharp = g_icons.count(SiteOf(b.url)) > 0;
        if (!sharp) FetchIcon(SiteOf(b.url), L"");
        items += L"[" + Json(b.url) + L"," + Json(b.title) + L"," + Json(FavFor(b.url)) + L"," + (sharp ? L"true" : L"false") + L"]";
    }
    return L"[" + items + L"]";
}

// The most visited sites, one address each, by visits weighted for how recent they are; a site already among your
// bookmarks (the row above them on a new tab) isn't shown twice.
static std::wstring TopSitesJson() {
    long long now = NowSeconds();
    struct Site { double score = 0; const Visit* best = nullptr; };
    std::unordered_map<std::wstring, Site> sites;
    std::unordered_set<std::wstring> marked;
    for (auto& b : g.bookmarks) marked.insert(SiteOf(b.url));
    for (auto& [_, v] : g.history) {
        if (marked.count(SiteOf(v.url))) continue;
        double days = (double)(now - v.last) / 86400.0;
        double recency = days < 1 ? 100 : days < 4 ? 70 : days < 14 ? 50 : days < 31 ? 30 : days < 90 ? 10 : 2;
        Site& s = sites[SiteOf(v.url)];
        s.score += v.visits * recency;
        if (!s.best || v.visits > s.best->visits) s.best = &v;
    }
    std::vector<std::pair<double, const Visit*>> ranked;
    for (auto& [site, s] : sites) if (!site.empty() && s.best) ranked.push_back({s.score, s.best});
    std::sort(ranked.begin(), ranked.end(), [](auto& a, auto& b) { return a.first > b.first; });
    std::wstring items;
    for (size_t i = 0; i < ranked.size() && i < 8; i++) {
        const Visit* v = ranked[i].second;
        if (!items.empty()) items += L",";
        // [url, title, icon, sharp], as bookmarks are: a site's large icon once it is found.
        bool sharp = g_icons.count(SiteOf(v->url)) > 0;
        if (!sharp) FetchIcon(SiteOf(v->url), L"");
        items += L"[" + Json(v->url) + L"," + Json(v->title) + L"," + Json(FavFor(v->url)) + L"," + (sharp ? L"true" : L"false") + L"]";
    }
    return L"[" + items + L"]";
}

// New tab pages read their data from https://api.newtab.exo/ntp.json, which only their own
// origin may read (CORS), and hear "refresh" when it changes.
static void RefreshNewTabs() {
    UiPost(L"{\"t\":\"refresh\"}");
    for (auto& t : g.tabs)
        if (t->core && IsNewTab(t->url)) t->core->PostWebMessageAsString(L"refresh");
}

static void SendBookmarks() {
    UiPost(L"{\"t\":\"bookmarks\",\"items\":" + BookmarksJson() + L"}");
    RefreshNewTabs();
}

static void RemoveBookmark(const std::wstring& url) {
    auto it = std::find_if(g.bookmarks.begin(), g.bookmarks.end(), [&](auto& b) { return b.url == url; });
    if (it == g.bookmarks.end()) return;
    g.bookmarks.erase(it);
    SaveBookmarks();
    SendBookmarks();
}

static void ToggleBookmark(const std::wstring& url, const std::wstring& title) {
    if (url.empty() || IsNewTab(url)) return;
    auto it = std::find_if(g.bookmarks.begin(), g.bookmarks.end(), [&](auto& b) { return b.url == url; });
    if (it != g.bookmarks.end()) g.bookmarks.erase(it);
    else g.bookmarks.push_back({url, title.empty() ? SiteOf(url) : title});
    SaveBookmarks();
    SendBookmarks();
}

// ---------------------------------------------------------------------------------------
// Appearance: Exo's Light, Dark and Void (Match Windows picks Light or Dark), Glass or Solid.

static bool WindowsUsesLight() {
    DWORD light = 0, size = sizeof light;
    RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                 L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &light, &size);
    return light != 0;
}

// The window's own colors under the Bar and sidebar, and its frame, in a theme.
static void ApplyBackdrop();
static void LittlesTheme();
static void PaintTheme(const std::wstring& theme) {
    g.page = theme == L"light" ? RGB(245, 245, 245) : theme == L"dark" ? RGB(18, 18, 18) : RGB(0, 0, 0);
    if (g.hwnd) {
        BOOL dark = theme != L"light";
        DwmSetWindowAttribute(g.hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof dark);
        COLORREF caption = g.page;
        DwmSetWindowAttribute(g.hwnd, DWMWA_CAPTION_COLOR, &caption, sizeof caption);
        InvalidateRect(g.hwnd, nullptr, TRUE);
    }
    LittlesTheme();
    ApplyBackdrop();
}

// Once the chrome page is up, the window takes a new theme's colors when the page shows it (SetGlass): taken at once,
// the band under the Bar turned light about 30 ms before the Bar did.
static void ApplyTheme() {
    // A space can have its own appearance; the rest follow Settings'.
    Space* s = FindSpace(g.space);
    std::wstring a = s && !s->theme.empty() ? s->theme : Setting(L"appearance", L"void");
    g.theme = a == L"match" ? (WindowsUsesLight() ? L"light" : L"dark") : (a == L"light" || a == L"dark") ? a : L"void";
    if (!g.uiReady) PaintTheme(g.theme);
}

// The appearance on screen may have changed (another space, or its own appearance): pages hear it as their color
// scheme, the chrome and new tab pages as their theme.
static void ThemeChanged() {
    std::wstring was = g.theme;
    ApplyTheme();
    if (g.theme == was) return;
    // Once for your profile and once for the private one: one tab of each is enough (a private tab first left your own
    // tabs in the old scheme).
    bool own = false, priv = false;
    for (auto& t : g.tabs) {
        if ((t->priv ? priv : own)) continue;
        ComPtr<ICoreWebView2_13> c13;
        ComPtr<ICoreWebView2Profile> profile;
        if (!t->core || FAILED(t->core.As(&c13)) || FAILED(c13->get_Profile(&profile))) continue;
        profile->put_PreferredColorScheme(g.theme == L"light" ? COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT : COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK);
        (t->priv ? priv : own) = true;
    }
    SendSettings();
    RefreshNewTabs();
}

static std::wstring NewTabJson() {
    return L"{\"bookmarks\":" + BookmarksJson() + L",\"top\":" + TopSitesJson() + L",\"engine\":" +
           Json(Setting(L"engine", L"brave")) + L",\"theme\":" + Json(g.theme) + L",\"material\":" +
           Json(Setting(L"material", L"glass")) + L",\"bookmarkStyle\":" + Json(Setting(L"bookmarkStyle", L"cards")) +
           L",\"tiles\":" + Json(Setting(L"tiles", L"on")) + L",\"motion\":" + Json(Setting(L"reduceMotion", L"off")) +
           // How far the Bar and side tabs push the page in, so it can center itself in the window.
           L",\"insetTop\":" + std::to_wstring(g.autohide || g.fullscreen ? 0 : g.chromeTopDip) +
           L",\"insetLeft\":" + std::to_wstring(g.autohide || g.fullscreen ? 0 : g.sidebarDip) + L"}";
}

// ---------------------------------------------------------------------------------------
// Import from other browsers, as much as each allows: bookmarks (Chromium's JSON, read by the
// page), history, site icons, sign-ins (cookies), search engine and Chrome Web Store extensions
// from any Chromium browser on this PC; bookmarks, history and sign-ins from Firefox. Databases
// are read through Windows' own winsqlite3.dll from a copy, since the browser may hold them.

static void Toast(const std::wstring& text);

struct Sql {
    HMODULE dll = nullptr;
    int (*open)(const char*, void**, int, const char*) = nullptr;
    int (*prepare)(void*, const char*, int, void**, const char**) = nullptr;
    int (*step)(void*) = nullptr;
    const void* (*text16)(void*, int) = nullptr;
    const void* (*blob)(void*, int) = nullptr;
    int (*bytes)(void*, int) = nullptr;
    long long (*int64)(void*, int) = nullptr;
    int (*finalize)(void*) = nullptr;
    int (*close)(void*) = nullptr;
    Sql() {
        dll = LoadLibraryExW(L"winsqlite3.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
        if (!dll) return;
        open = (decltype(open))GetProcAddress(dll, "sqlite3_open_v2");
        prepare = (decltype(prepare))GetProcAddress(dll, "sqlite3_prepare_v2");
        step = (decltype(step))GetProcAddress(dll, "sqlite3_step");
        text16 = (decltype(text16))GetProcAddress(dll, "sqlite3_column_text16");
        blob = (decltype(blob))GetProcAddress(dll, "sqlite3_column_blob");
        bytes = (decltype(bytes))GetProcAddress(dll, "sqlite3_column_bytes");
        int64 = (decltype(int64))GetProcAddress(dll, "sqlite3_column_int64");
        finalize = (decltype(finalize))GetProcAddress(dll, "sqlite3_finalize");
        close = (decltype(close))GetProcAddress(dll, "sqlite3_close");
    }
    ~Sql() { if (dll) FreeLibrary(dll); }
    std::wstring Text(void* st, int col) { auto t = (const wchar_t*)text16(st, col); return t ? t : L""; }
    // Runs a query on a copy of the database; false when it could not be copied (held open).
    bool Query(const std::wstring& file, const char* sql, const std::function<void(void*)>& row) {
        if (!open || !prepare || !step || !finalize || !close) return false;
        if (GetFileAttributesW(file.c_str()) == INVALID_FILE_ATTRIBUTES) return false;
        std::wstring copy = g.dataDir + L"\\import.tmp";
        if (!CopyFileW(file.c_str(), copy.c_str(), FALSE)) return false;
        void* db = nullptr;
        if (open(Utf8(copy).c_str(), &db, 1, nullptr) == 0) {
            void* st = nullptr;
            if (prepare(db, sql, -1, &st, nullptr) == 0) {
                while (step(st) == 100) row(st);
                finalize(st);
            }
        }
        if (db) close(db);
        DeleteFileW(copy.c_str());
        return true;
    }
};

// arc: an Arc (or Dia) StorableSidebar.json beside the profile, holding its spaces, favorites and pinned tabs.
struct Browser { std::wstring key, name, dir; bool firefox = false; std::wstring arc; };

static bool Exists(const std::wstring& path) { return GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES; }

static std::wstring KnownFolder(REFKNOWNFOLDERID id) {
    PWSTR p = nullptr;
    SHGetKnownFolderPath(id, 0, nullptr, &p);
    return Take(p);
}

// The Firefox-engine profile used last under %APPDATA%\<rel>\Profiles (Firefox, Zen, Floorp, LibreWolf, Waterfox).
static std::wstring FirefoxProfile(const wchar_t* rel) {
    std::wstring base = KnownFolder(FOLDERID_RoamingAppData) + L"\\" + rel + L"\\Profiles\\";
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileW((base + L"*").c_str(), &fd);
    std::wstring best;
    FILETIME newest{};
    if (h == INVALID_HANDLE_VALUE) return best;
    do {
        if (!(fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || fd.cFileName[0] == L'.') continue;
        WIN32_FILE_ATTRIBUTE_DATA info;
        std::wstring places = base + fd.cFileName + L"\\places.sqlite";
        if (!GetFileAttributesExW(places.c_str(), GetFileExInfoStandard, &info)) continue;
        if (CompareFileTime(&info.ftLastWriteTime, &newest) > 0) { newest = info.ftLastWriteTime; best = base + fd.cFileName; }
    } while (FindNextFileW(h, &fd));
    FindClose(h);
    return best;
}

// Every Chromium browser on this PC: the well-known ones by name, then any folder one or two levels
// under %LOCALAPPDATA% holding "User Data\Default" with bookmarks or history (Aside, Arc, Comet,
// Thorium and whatever comes next), and Firefox.
static std::vector<Browser> ScanBrowsers();

// Password managers' extensions, by Chrome Web Store id or name: Exo Vault does their job.
static bool IsPasswordManager(const std::wstring& id, const std::wstring& name) {
    static const wchar_t* ids[] = {
        L"ghmbeldphafepmbegfdlkpapadhbakde", L"nngceckbapebfimnlniiiahkandclblb", L"aeblfdkhhhdcdjpifhhbdiojplfjncoa",
        L"hdokiejnpimakedhajhdlcegeplioahd", L"fdjamakpfbbddfjaooikfcpapjohcfmg", L"bfogiafebfohielmmehodmfbbebbbpei",
        L"eiaeiblijfjekdanodkjadfinkhbfgcd", L"pnlccmojcmeohlpggmfnbbiapkmbliob", L"kmcfomidfpdkfieipokbalgegidffkal",
        L"oboonakemofpalcgghocfoadofidjkkk"};
    for (auto known : ids) if (id == known) return true;
    static const wchar_t* names[] = {L"Proton Pass", L"Bitwarden", L"1Password", L"LastPass", L"Dashlane", L"Keeper", L"NordPass",
                                     L"RoboForm", L"Enpass", L"KeePassXC"};
    for (auto known : names) if (name.rfind(known, 0) == 0) return true;
    return false;
}

// Settings asks for the list every time it opens; the scan reads two levels of %LOCALAPPDATA% and the registry (120 ms
// on a PC with 3,800 folders there), so its answer is kept for half a minute, and Settings' question waits for a fresh
// one on a thread of its own: the window kept no mouse or keys for the page while it searched.
static std::vector<Browser> g_browsers;
static ULONGLONG g_browsersAt = 0;
static std::vector<std::function<void()>> g_scanWaiters;
static const UINT WM_APP_SCANNED = WM_APP + 7;  // lParam: new std::vector<Browser>*
static bool BrowsersFresh() { return g_browsersAt && GetTickCount64() - g_browsersAt <= 30000; }

static std::vector<Browser> DetectBrowsers() {
    if (!BrowsersFresh()) { g_browsers = ScanBrowsers(); g_browsersAt = GetTickCount64(); }
    return g_browsers;
}

static void WhenBrowsersKnown(std::function<void()> then) {
    if (BrowsersFresh()) { then(); return; }
    g_scanWaiters.push_back(std::move(then));
    if (g_scanWaiters.size() > 1) return;  // a scan is already on its way
    HWND hwnd = g.hwnd;
    std::thread([hwnd] {
        auto* found = new std::vector<Browser>(ScanBrowsers());
        if (!PostMessageW(hwnd, WM_APP_SCANNED, 0, (LPARAM)found)) delete found;
    }).detach();
}

static std::vector<Browser> ScanBrowsers() {
    static const std::pair<const wchar_t*, const wchar_t*> known[] = {
        {L"Google\\Chrome", L"Chrome"}, {L"Google\\Chrome Beta", L"Chrome Beta"}, {L"Google\\Chrome SxS", L"Chrome Canary"},
        {L"Microsoft\\Edge", L"Edge"}, {L"Microsoft\\Edge Beta", L"Edge Beta"}, {L"BraveSoftware\\Brave-Browser", L"Brave"},
        {L"imput\\Helium", L"Helium"}, {L"Vivaldi", L"Vivaldi"}, {L"Aside", L"Aside"}, {L"Chromium", L"Chromium"},
        {L"Thorium", L"Thorium"}, {L"Perplexity\\Comet", L"Comet"}, {L"Yandex\\YandexBrowser", L"Yandex"}};
    std::wstring local = KnownFolder(FOLDERID_LocalAppData);
    std::vector<Browser> out;
    auto consider = [&](const std::wstring& base, const std::wstring& name) {
        std::wstring dir = base + L"\\User Data\\Default";
        if (!Exists(dir + L"\\Bookmarks") && !Exists(dir + L"\\History")) return false;
        for (auto& b : out) if (_wcsicmp(b.dir.c_str(), dir.c_str()) == 0) return false;
        out.push_back({dir, name, dir});
        return true;
    };
    for (auto& [rel, name] : known) consider(local + L"\\" + rel, name);
    auto scan = [&](const std::wstring& base, int depth, auto&& self) -> void {
        WIN32_FIND_DATAW fd;
        HANDLE h = FindFirstFileW((base + L"\\*").c_str(), &fd);
        if (h == INVALID_HANDLE_VALUE) return;
        do {
            if (!(fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) || fd.cFileName[0] == L'.' ||
                (fd.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) || _wcsicmp(fd.cFileName, L"Packages") == 0 ||
                _wcsicmp(fd.cFileName, L"ExoBrowser") == 0) continue;
            std::wstring path = base + L"\\" + fd.cFileName;
            consider(path, fd.cFileName);
            if (depth > 1) self(path, depth - 1, self);
        } while (FindNextFileW(h, &fd));
        FindClose(h);
    };
    scan(local, 2, scan);
    // The Browser Company's apps come from the Store (MSIX): Arc keeps its profile under
    // Packages\TheBrowserCompany.Arc_*\LocalCache\Local\Arc, with its sidebar in StorableSidebar.json beside it. The
    // files stay after Arc stops opening (2026-12-22), so this still imports them then.
    auto each = [](const std::wstring& pattern, auto&& fn) {
        WIN32_FIND_DATAW fd;
        HANDLE h = FindFirstFileW(pattern.c_str(), &fd);
        if (h == INVALID_HANDLE_VALUE) return;
        do {
            if ((fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && fd.cFileName[0] != L'.' && !(fd.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT))
                fn(std::wstring(fd.cFileName));
        } while (FindNextFileW(h, &fd));
        FindClose(h);
    };
    each(local + L"\\Packages\\TheBrowserCompany.*", [&](const std::wstring& pkg) {
        std::wstring cache = local + L"\\Packages\\" + pkg + L"\\LocalCache\\Local";
        each(cache + L"\\*", [&](const std::wstring& app) {
            std::wstring root = cache + L"\\" + app;
            if (consider(root, app) && Exists(root + L"\\StorableSidebar.json")) out.back().arc = root + L"\\StorableSidebar.json";
        });
    });
    std::wstring opera = KnownFolder(FOLDERID_RoamingAppData) + L"\\Opera Software\\Opera Stable";
    if (Exists(opera + L"\\Bookmarks") || Exists(opera + L"\\History")) out.push_back({opera, L"Opera", opera});
    static const std::pair<const wchar_t*, const wchar_t*> gecko[] = {
        {L"Mozilla\\Firefox", L"Firefox"}, {L"zen", L"Zen"}, {L"Floorp", L"Floorp"}, {L"librewolf", L"LibreWolf"}, {L"Waterfox", L"Waterfox"}};
    for (auto& [rel, name] : gecko)
        if (std::wstring ff = FirefoxProfile(rel); !ff.empty()) out.push_back({ff, name, ff, true});
    return out;
}

static bool Imported(const std::wstring& key) {
    return (L"|" + Setting(L"imported", L"") + L"|").find(L"|" + key + L"|") != std::wstring::npos;
}

static std::wstring SourcesJson() {
    std::wstring items;
    for (auto& b : DetectBrowsers()) {
        if (Imported(b.key)) continue;
        if (!items.empty()) items += L",";
        items += L"[" + Json(b.key) + L"," + Json(b.name) + L"," + Bool(b.firefox) + L"]";
    }
    return L"[" + items + L"]";
}

static void SendImportSources() { UiPost(L"{\"t\":\"importSources\",\"items\":" + SourcesJson() + L"}"); }

static int ImportHistory(const std::wstring& dir) {
    Sql sql;
    int count = 0;
    sql.Query(dir + L"\\History",
              "SELECT url, title, visit_count, last_visit_time FROM urls WHERE url LIKE 'http%' ORDER BY last_visit_time DESC LIMIT 20000",
              [&](void* st) {
                  std::wstring u = sql.Text(st, 0), t = sql.Text(st, 1);
                  if (u.empty()) return;
                  Visit& v = g.history[u];
                  long long last = sql.int64(st, 3) / 1000000 - 11644473600LL;
                  if (v.url.empty()) { v.url = u; count++; }
                  if (!t.empty() && (v.title.empty() || last > v.last)) v.title = t;
                  v.visits = std::max(v.visits, (int)sql.int64(st, 2));
                  v.last = std::max(v.last, last);
              });
    if (count) { g.historyDirty = true; SaveHistory(); }
    return count;
}

static int ImportFavicons(const std::wstring& dir) {
    Sql sql;
    int added = 0;
    bool sharp = false;
    sql.Query(dir + L"\\Favicons",
              "SELECT m.page_url, b.image_data FROM icon_mapping m JOIN favicon_bitmaps b ON b.icon_id = m.icon_id "
              "WHERE b.width <= 256 ORDER BY b.width DESC",
              [&](void* st) {
                  std::wstring u = sql.Text(st, 0);
                  int n = sql.bytes(st, 1);
                  auto data = (const BYTE*)sql.blob(st, 1);
                  if (u.empty() || !data || n <= 0 || n > 256 * 1024 || g.favicons.size() > 4000) return;
                  std::wstring site = SiteOf(u);
                  if (site.empty()) return;
                  std::wstring icon = IconDataUrl(std::string((const char*)data, n));
                  if (!icon.empty() && !g_icons.count(site)) { g_icons[site] = icon; sharp = true; }
                  if (g.favicons.count(site)) return;
                  g.favicons[site] = L"data:image/png;base64," + Base64(data, (DWORD)n);
                  added++;
              });
    if (added) g.faviconsDirty = true;
    if (sharp) SaveIcons();
    return added;
}

// Sign-ins: cookies go into Exo's profile through WebView2's cookie manager.
static ComPtr<ICoreWebView2CookieManager> CookieManager() {
    for (auto& t : g.tabs) {
        ComPtr<ICoreWebView2_2> c2;
        ComPtr<ICoreWebView2CookieManager> cm;
        if (t->core && !t->priv && SUCCEEDED(t->core.As(&c2)) && SUCCEEDED(c2->get_CookieManager(&cm))) return cm;
    }
    return nullptr;
}

static bool AddCookie(ICoreWebView2CookieManager* cm, const std::wstring& name, const std::wstring& value, const std::wstring& domain,
                      const std::wstring& path, double expires, bool secure, bool httpOnly, int sameSite) {
    ComPtr<ICoreWebView2Cookie> c;
    if (name.empty() || domain.empty() || FAILED(cm->CreateCookie(name.c_str(), value.c_str(), domain.c_str(), path.empty() ? L"/" : path.c_str(), &c)))
        return false;
    if (expires > 0) c->put_Expires(expires);
    c->put_IsSecure(secure);
    c->put_IsHttpOnly(httpOnly);
    c->put_SameSite(sameSite == 0 && secure ? COREWEBVIEW2_COOKIE_SAME_SITE_KIND_NONE
                    : sameSite == 2 ? COREWEBVIEW2_COOKIE_SAME_SITE_KIND_STRICT : COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX);
    return SUCCEEDED(cm->AddOrUpdateCookie(c.Get()));
}

// Chromium encrypts cookies with an AES key kept in "Local State", itself encrypted for this
// Windows user ("v10"). Chrome's newer app-bound keys ("v20") can only be opened by Chrome itself.
static std::string ChromiumKey(const std::wstring& profileDir) {
    std::string state = ReadFileUtf8(profileDir + L"\\..\\Local State");
    if (state.empty()) state = ReadFileUtf8(profileDir + L"\\Local State");
    size_t at = state.find("\"encrypted_key\"");
    if (at == std::string::npos) return "";
    size_t open = state.find('"', state.find(':', at) + 1), close = state.find('"', open + 1);
    std::string b64 = state.substr(open + 1, close - open - 1);
    DWORD n = 0;
    if (!CryptStringToBinaryA(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, nullptr, &n, nullptr, nullptr) || n <= 5) return "";
    std::string blob(n, 0);
    CryptStringToBinaryA(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, (BYTE*)blob.data(), &n, nullptr, nullptr);
    if (blob.compare(0, 5, "DPAPI") != 0) return "";
    DATA_BLOB in{(DWORD)(n - 5), (BYTE*)blob.data() + 5}, out{};
    if (!CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr, 0, &out)) return "";
    std::string key((char*)out.pbData, out.cbData);
    LocalFree(out.pbData);
    return key;
}

static bool AesGcm(const std::string& key, const BYTE* nonce, const BYTE* data, size_t size, std::string& plain) {
    if (key.size() != 32 || size < 16) return false;
    BCRYPT_KEY_HANDLE k = nullptr;
    if (BCryptGenerateSymmetricKey(BCRYPT_AES_GCM_ALG_HANDLE, &k, nullptr, 0, (PUCHAR)key.data(), 32, 0) != 0) return false;
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
    BCRYPT_INIT_AUTH_MODE_INFO(info);
    info.pbNonce = (PUCHAR)nonce;
    info.cbNonce = 12;
    info.pbTag = (PUCHAR)(data + size - 16);
    info.cbTag = 16;
    plain.assign(size - 16, 0);
    ULONG got = 0;
    NTSTATUS st = BCryptDecrypt(k, (PUCHAR)data, (ULONG)(size - 16), &info, nullptr, 0, (PUCHAR)plain.data(), (ULONG)plain.size(), &got, 0);
    BCryptDestroyKey(k);
    plain.resize(got);
    return st == 0;
}

struct CookieResult { int added = 0, locked = 0, appBound = 0; };

static CookieResult ImportChromiumCookies(const std::wstring& dir) {
    CookieResult r;
    ComPtr<ICoreWebView2CookieManager> cm = CookieManager();
    if (!cm) return r;
    std::string key = ChromiumKey(dir);
    std::wstring db = Exists(dir + L"\\Network\\Cookies") ? dir + L"\\Network\\Cookies" : dir + L"\\Cookies";
    Sql sql;
    int version = 0;
    if (!sql.Query(db, "SELECT value FROM meta WHERE key = 'version'", [&](void* st) { version = _wtoi(sql.Text(st, 0).c_str()); })) {
        r.locked = 1;
        return r;
    }
    sql.Query(db, "SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies",
        [&](void* st) {
            std::wstring host = sql.Text(st, 0), name = sql.Text(st, 1), value = sql.Text(st, 2);
            int n = sql.bytes(st, 3);
            auto enc = (const BYTE*)sql.blob(st, 3);
            if (value.empty() && enc && n > 3) {
                if (memcmp(enc, "v20", 3) == 0) { r.appBound++; return; }
                if (memcmp(enc, "v10", 3) != 0 && memcmp(enc, "v11", 3) != 0) return;
                std::string plain;
                if (n < 3 + 12 + 16 || !AesGcm(key, enc + 3, enc + 15, (size_t)n - 15, plain)) return;
                // From database version 24 the value is prefixed with the SHA-256 of its domain.
                if (version >= 24 && plain.size() >= 32) plain = plain.substr(32);
                value = Wide(plain);
            }
            long long expires = sql.int64(st, 5);
            double unix = expires > 0 ? (double)(expires / 1000000 - 11644473600LL) : 0;
            if (unix > 0 && unix < (double)NowSeconds()) return;
            if (AddCookie(cm.Get(), name, value, host, sql.Text(st, 4), unix, sql.int64(st, 6) != 0, sql.int64(st, 7) != 0, (int)sql.int64(st, 8)))
                r.added++;
        });
    return r;
}

static CookieResult ImportFirefoxCookies(const std::wstring& dir) {
    CookieResult r;
    ComPtr<ICoreWebView2CookieManager> cm = CookieManager();
    if (!cm) return r;
    Sql sql;
    bool ok = sql.Query(dir + L"\\cookies.sqlite", "SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies",
        [&](void* st) {
            long long expiry = sql.int64(st, 4);
            if (expiry > 100000000000LL) expiry /= 1000;
            if (expiry > 0 && expiry < NowSeconds()) return;
            if (AddCookie(cm.Get(), sql.Text(st, 1), sql.Text(st, 2), sql.Text(st, 0), sql.Text(st, 3), (double)expiry,
                          sql.int64(st, 5) != 0, sql.int64(st, 6) != 0, (int)sql.int64(st, 7)))
                r.added++;
        });
    if (!ok) r.locked = 1;
    return r;
}

static std::wstring CookieNote(const CookieResult& c, const std::wstring& name) {
    if (c.locked) return L"Close " + name + L" and import again to bring over your sign-ins.";
    if (c.appBound && !c.added) return name + L" locks its sign-ins to itself, so sites will ask you to sign in once.";
    return L"";
}

static void ImportFirefox(const Browser& b) {
    Sql sql;
    int visits = 0, marks = 0;
    sql.Query(b.dir + L"\\places.sqlite",
              "SELECT url, title, visit_count, last_visit_date FROM moz_places WHERE visit_count > 0 AND url LIKE 'http%' "
              "ORDER BY last_visit_date DESC LIMIT 20000",
              [&](void* st) {
                  std::wstring u = sql.Text(st, 0), t = sql.Text(st, 1);
                  if (u.empty()) return;
                  Visit& v = g.history[u];
                  long long last = sql.int64(st, 3) / 1000000;
                  if (v.url.empty()) { v.url = u; visits++; }
                  if (!t.empty()) v.title = t;
                  v.visits = std::max(v.visits, (int)sql.int64(st, 2));
                  v.last = std::max(v.last, last);
              });
    sql.Query(b.dir + L"\\places.sqlite",
              "SELECT p.url, b.title FROM moz_bookmarks b JOIN moz_places p ON b.fk = p.id WHERE b.type = 1 AND p.url LIKE 'http%' ORDER BY b.position",
              [&](void* st) {
                  std::wstring u = sql.Text(st, 0), t = sql.Text(st, 1);
                  if (u.empty() || std::any_of(g.bookmarks.begin(), g.bookmarks.end(), [&](auto& x) { return x.url == u; })) return;
                  g.bookmarks.push_back({u, t.empty() ? SiteOf(u) : t});
                  marks++;
              });
    CookieResult c = ImportFirefoxCookies(b.dir);
    SaveHistory();
    SaveBookmarks();
    SendHistory();
    SendBookmarks();
    std::wstring note = CookieNote(c, b.name);
    Toast(L"Imported " + std::to_wstring(marks) + L" bookmarks, " + std::to_wstring(visits) + L" pages and " +
          std::to_wstring(c.added) + L" sign-ins from " + b.name + (note.empty() ? L"" : L". " + note));
}

static void SaveSettings();

static void Import(const std::wstring& key) {
    for (auto& b : DetectBrowsers()) {
        if (b.key != key) continue;
        if (!Imported(key)) {
            std::wstring list = Setting(L"imported", L"");
            g.settings[L"imported"] = list.empty() ? key : list + L"|" + key;
            SaveSettings();
        }
        if (b.firefox) { ImportFirefox(b); return; }
        int visits = ImportHistory(b.dir);
        ImportFavicons(b.dir);
        CookieResult c = ImportChromiumCookies(b.dir);
        // Bookmarks, settings and extensions are JSON (Bookmarks, Preferences, and Secure Preferences,
        // where Chrome keeps its extension list); the page reads them and reports the total.
        UiPost(L"{\"t\":\"importData\",\"name\":" + Json(b.name) + L",\"visits\":" + std::to_wstring(visits) +
               L",\"cookies\":" + std::to_wstring(c.added) + L",\"note\":" + Json(CookieNote(c, b.name)) +
               L",\"bookmarks\":" + Json(Wide(ReadFileUtf8(b.dir + L"\\Bookmarks"))) +
               L",\"prefs\":" + Json(Wide(ReadFileUtf8(b.dir + L"\\Preferences"))) +
               L",\"secure\":" + Json(Wide(ReadFileUtf8(b.dir + L"\\Secure Preferences"))) +
               (b.arc.empty() ? L"" : L",\"arc\":" + Json(Wide(ReadFileUtf8(b.arc)))) + L"}");
        SendHistory();
        RefreshNewTabs();
        return;
    }
}

// Bookmarks as a file: the HTML every browser imports and exports ("Netscape bookmark file").
static std::wstring Unescape(std::wstring s) {
    const std::pair<const wchar_t*, const wchar_t*> map[] = {{L"&quot;", L"\""}, {L"&#39;", L"'"}, {L"&lt;", L"<"}, {L"&gt;", L">"}, {L"&amp;", L"&"}};
    for (auto& [from, to] : map)
        for (size_t at; (at = s.find(from)) != std::wstring::npos;) s.replace(at, wcslen(from), to);
    return s;
}

static std::wstring HtmlEscape(const std::wstring& s) {
    std::wstring o;
    for (wchar_t c : s) o += c == L'&' ? L"&amp;" : c == L'<' ? L"&lt;" : c == L'>' ? L"&gt;" : c == L'"' ? L"&quot;" : std::wstring(1, c);
    return o;
}

static std::wstring PickFile(bool save, const wchar_t* label = L"Bookmarks (HTML)", const wchar_t* spec = L"*.html;*.htm",
                             const wchar_t* ext = L"html", const wchar_t* name = L"Exo Browser bookmarks.html") {
    ComPtr<IFileDialog> dlg;
    if (FAILED(CoCreateInstance(save ? CLSID_FileSaveDialog : CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dlg))))
        return L"";
    COMDLG_FILTERSPEC types[] = {{label, spec}};
    dlg->SetFileTypes(1, types);
    dlg->SetDefaultExtension(ext);
    if (save) dlg->SetFileName(name);
    ComPtr<IShellItem> item;
    PWSTR path = nullptr;
    if (FAILED(dlg->Show(g.hwnd)) || FAILED(dlg->GetResult(&item)) || FAILED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) return L"";
    return Take(path);
}

static void ExportBookmarks() {
    std::wstring file = PickFile(true);
    if (file.empty()) return;
    std::wstring html = L"<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n"
                        L"<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n    <DT><H3 PERSONAL_TOOLBAR_FOLDER=\"true\">Exo Browser</H3>\n    <DL><p>\n";
    for (auto& b : g.bookmarks)
        html += L"        <DT><A HREF=\"" + HtmlEscape(b.url) + L"\">" + HtmlEscape(b.title) + L"</A>\n";
    html += L"    </DL><p>\n</DL><p>\n";
    WriteFileUtf8(file, Utf8(html));
    Toast(L"Exported " + std::to_wstring(g.bookmarks.size()) + L" bookmarks");
}

static void ImportBookmarksFile() {
    std::wstring file = PickFile(false);
    if (file.empty()) return;
    std::wstring html = Wide(ReadFileUtf8(file)), lower = html;
    for (auto& c : lower) c = towlower(c);
    int added = 0;
    for (size_t at = 0; (at = lower.find(L"<a ", at)) != std::wstring::npos; at++) {
        size_t href = lower.find(L"href=\"", at), end = lower.find(L'>', at);
        if (href == std::wstring::npos || href > end) continue;
        size_t q = html.find(L'"', href + 6);
        size_t close = lower.find(L"</a>", end);
        if (q == std::wstring::npos || close == std::wstring::npos) continue;
        std::wstring url = Unescape(html.substr(href + 6, q - href - 6));
        std::wstring title = Unescape(html.substr(end + 1, close - end - 1));
        if (url.rfind(L"http", 0) != 0 || std::any_of(g.bookmarks.begin(), g.bookmarks.end(), [&](auto& b) { return b.url == url; }))
            continue;
        g.bookmarks.push_back({url, Field(title.empty() ? SiteOf(url) : title)});
        added++;
    }
    SaveBookmarks();
    SendBookmarks();
    Toast(L"Imported " + std::to_wstring(added) + L" bookmarks");
}

// ---------------------------------------------------------------------------------------
// Extensions: any Chrome Web Store extension (downloaded as a CRX from Google's update service,
// unpacked here), or an unpacked folder. WebView2 has no toolbar for them, so the Bar lists them
// and opens each one's popup in a small window of its own.

static std::wstring ExtensionsDir() {
    std::wstring dir = g.dataDir + L"\\Extensions";
    CreateDirectoryW(dir.c_str(), nullptr);
    return dir;
}

// The folder each installed extension came from, by the id WebView2 gave it.
static std::unordered_map<std::wstring, std::wstring> g_extFolders;

static void SaveExtFolders() {
    std::string out;
    for (auto& [id, folder] : g_extFolders) out += Utf8(id + L"\t" + folder) + "\n";
    WriteFileUtf8(g.dataDir + L"\\extensions.tsv", out);
}

// Your own profile, from any tab of it: a private tab's (its throwaway profile) would take extensions and sign-ins away.
static ComPtr<ICoreWebView2Profile7> TabProfile() {
    for (auto& t : g.tabs) {
        if (!t->core || t->priv) continue;
        ComPtr<ICoreWebView2_13> c13;
        ComPtr<ICoreWebView2Profile> profile;
        ComPtr<ICoreWebView2Profile7> p7;
        if (SUCCEEDED(t->core.As(&c13)) && SUCCEEDED(c13->get_Profile(&profile)) && SUCCEEDED(profile.As(&p7))) return p7;
    }
    return nullptr;
}

static std::wstring FileDataUrl(const std::wstring& path) {
    std::string bytes = ReadFileUtf8(path);
    if (bytes.empty() || bytes.size() > 512 * 1024) return L"";
    std::wstring ext = path.substr(path.find_last_of(L'.') + 1);
    std::wstring mime = ext == L"svg" ? L"image/svg+xml" : ext == L"jpg" || ext == L"jpeg" ? L"image/jpeg" : L"image/png";
    return L"data:" + mime + L";base64," + Base64((const BYTE*)bytes.data(), (DWORD)bytes.size());
}

// The shipped blockers, copied out of the app folder to a short path under the data folder:
// Chromium writes each ruleset's index inside the extension's folder, and past Windows' 260
// characters that write fails ("Internal error while parsing rules"). Copied again when the
// app ships a different manifest (InitBrowser does it before the engine loads them).
static std::wstring BuiltinFolder(const std::wstring& name) {
    std::wstring source = g.exeDir + L"\\extensions\\" + name;
    std::wstring dest = g.dataDir + L"\\Builtin\\" + name;
    std::string shipped = ReadFileUtf8(source + L"\\manifest.json");
    if (shipped.empty()) return dest;
    // Setup refreshes it as it installs (ExoBrowser.nsi); this is for a copy it couldn't, or one run from elsewhere.
    if (ReadFileUtf8(dest + L"\\manifest.json") != shipped) {
        SHCreateDirectoryExW(nullptr, (g.dataDir + L"\\Builtin").c_str(), nullptr);
        auto remove = [](const std::wstring& dir) {
            std::wstring from = dir;
            from.push_back(L'\0');
            SHFILEOPSTRUCTW del{nullptr, FO_DELETE, from.c_str(), nullptr, FOF_NO_UI, FALSE, nullptr, nullptr};
            SHFileOperationW(&del);
        };
        // Copied beside and swapped in whole: a copy cut short (its manifest already there) was never redone.
        std::wstring incoming = dest + L".incoming";
        remove(incoming);
        std::wstring src = source + L"\\*";
        src.push_back(L'\0');
        std::wstring to = incoming;
        to.push_back(L'\0');
        SHCreateDirectoryExW(nullptr, incoming.c_str(), nullptr);
        SHFILEOPSTRUCTW copy{nullptr, FO_COPY, src.c_str(), to.c_str(), FOF_NO_UI, FALSE, nullptr, nullptr};
        if (SHFileOperationW(&copy) == 0 && !copy.fAnyOperationsAborted) {
            remove(dest);
            if (!MoveFileExW(incoming.c_str(), dest.c_str(), 0)) remove(incoming);
        } else {
            remove(incoming);
        }
    }
    return dest;
}

static std::wstring ExtensionFolder(const std::wstring& id, const std::wstring& name) {
    if (auto it = g_extFolders.find(id); it != g_extFolders.end()) return it->second;
    if (name.find(L"uBlock") != std::wstring::npos) return g.dataDir + L"\\Builtin\\ublock-origin-lite";
    if (name == L"Exo Shield") return g.dataDir + L"\\Builtin\\exo-shield";
    return L"";
}

// Exo Shield is part of the browser, not an extension you manage: it is never listed, always on, can't be
// removed, and its own pages don't open (it has nothing to set).
static std::wstring g_shieldId;

static bool IsShieldPage(const std::wstring& url) {
    return !g_shieldId.empty() && url.rfind(L"chrome-extension://" + g_shieldId + L"/", 0) == 0;
}

// Every extension you manage, each with its manifest (the page reads its name, icon and popup from it), as a
// JSON array. Exo Shield is left out, and switched back on if anything turned it off.
static std::wstring ExtensionsJson(HRESULT hr, ICoreWebView2BrowserExtensionList* list) {
    UINT count = 0;
    std::wstring items;
    if (FAILED(hr) || !list || FAILED(list->get_Count(&count))) return L"[]";
    for (UINT i = 0; i < count; i++) {
        ComPtr<ICoreWebView2BrowserExtension> ext;
        if (FAILED(list->GetValueAtIndex(i, &ext))) continue;
        LPWSTR id = nullptr, name = nullptr;
        BOOL enabled = FALSE;
        ext->get_Id(&id);
        ext->get_Name(&name);
        ext->get_IsEnabled(&enabled);
        std::wstring sid = Take(id), sname = Take(name);
        if (sname.rfind(L"Microsoft", 0) == 0) continue;
        if (sname == L"Exo Shield") {
            g_shieldId = sid;
            bool on = true;
#ifdef EXO_MEDIA
            // A build for the pictures (never released) can show a page as it is without Exo Shield, for a before and after.
            on = GetEnvironmentVariableW(L"EXO_MEDIA_SHIELD_OFF", nullptr, 0) == 0;
#endif
            if (!enabled != !on) ext->Enable(on, Callback<ICoreWebView2BrowserExtensionEnableCompletedHandler>([](HRESULT) { return S_OK; }).Get());
            continue;
        }
        std::wstring folder = ExtensionFolder(sid, sname);
        if (!folder.empty() && !g_extFolders.count(sid)) g_extFolders[sid] = folder;
        bool builtIn = folder.rfind(g.dataDir + L"\\Builtin", 0) == 0 || folder.rfind(g.exeDir + L"\\extensions", 0) == 0;
        std::wstring manifest = folder.empty() ? L"" : Wide(ReadFileUtf8(folder + L"\\manifest.json"));
        if (!items.empty()) items += L",";
        items += L"{\"id\":" + Json(sid) + L",\"name\":" + Json(sname) + L",\"enabled\":" + Bool(enabled) +
                 L",\"builtIn\":" + Bool(builtIn) + L",\"manifest\":" + Json(manifest) + L"}";
    }
    return L"[" + items + L"]";
}

static void SendExtensions() {
    ComPtr<ICoreWebView2Profile7> p7 = TabProfile();
    if (!p7) return;
    p7->GetBrowserExtensions(Callback<ICoreWebView2ProfileGetBrowserExtensionsCompletedHandler>(
        [](HRESULT hr, ICoreWebView2BrowserExtensionList* list) -> HRESULT {
            UiPost(L"{\"t\":\"extensions\",\"items\":" + ExtensionsJson(hr, list) + L"}");
            return S_OK;
        }).Get());
}

static void SendExtensionIcon(const std::wstring& id, const std::wstring& rel) {
    auto it = g_extFolders.find(id);
    if (it == g_extFolders.end() || rel.find(L"..") != std::wstring::npos) return;
    std::wstring path = it->second + L"\\" + rel;
    for (auto& c : path) if (c == L'/') c = L'\\';
    UiPost(L"{\"t\":\"extIcon\",\"id\":" + Json(id) + L",\"icon\":" + Json(FileDataUrl(path)) + L"}");
}

// Said as soon as the chrome page can show it: one from startup waits until the page is ready.
static std::vector<std::wstring> g_pendingToasts;
static void Toast(const std::wstring& text) {
    std::wstring json = L"{\"t\":\"toast\",\"text\":" + Json(text) + L"}";
    if (g.uiReady) UiPost(json);
    else g_pendingToasts.push_back(json);
}

static void AddExtensionFolder(const std::wstring& folder) {
    ComPtr<ICoreWebView2Profile7> p7 = TabProfile();
    if (!p7) { Toast(L"Open a page first, then add the extension."); return; }
    p7->AddBrowserExtension(folder.c_str(), Callback<ICoreWebView2ProfileAddBrowserExtensionCompletedHandler>(
        [folder](HRESULT hr, ICoreWebView2BrowserExtension* ext) -> HRESULT {
            if (FAILED(hr) || !ext) {
                Toast(L"That extension could not be added.");
                return S_OK;
            }
            LPWSTR id = nullptr, name = nullptr;
            ext->get_Id(&id);
            ext->get_Name(&name);
            g_extFolders[Take(id)] = folder;
            SaveExtFolders();
            Toast(L"Added " + Take(name));
            SendExtensions();
            return S_OK;
        }).Get());
}

// An extension's ID is the first 16 bytes of SHA-256 of its public key, as the letters a to p.
static std::wstring IdOfKey(const std::string& key) {
    BYTE hash[32];
    if (BCryptHash(BCRYPT_SHA256_ALG_HANDLE, nullptr, 0, (PUCHAR)key.data(), (ULONG)key.size(), hash, 32) != 0) return L"";
    std::wstring id;
    for (int i = 0; i < 16; i++) { id += (wchar_t)(L'a' + (hash[i] >> 4)); id += (wchar_t)(L'a' + (hash[i] & 15)); }
    return id;
}

// The public key in a CRX3 header (a protobuf: proofs in fields 2 and 3, each with its key in field 1)
// whose ID is the store ID; CRX2 carries it directly.
static std::string StoreKey(const std::string& data, uint32_t version, size_t zipAt, const std::wstring& storeId) {
    auto u32 = [&](size_t at) { return (uint32_t)(uint8_t)data[at] | (uint32_t)(uint8_t)data[at + 1] << 8 |
                                      (uint32_t)(uint8_t)data[at + 2] << 16 | (uint32_t)(uint8_t)data[at + 3] << 24; };
    if (version == 2) return data.substr(16, u32(8));
    auto fields = [](const std::string& buf, const std::function<void(uint64_t, const std::string&)>& on) {
        size_t i = 0;
        auto varint = [&]() { uint64_t v = 0; int s = 0; uint8_t b; do { if (i >= buf.size()) return v; b = (uint8_t)buf[i++]; v |= (uint64_t)(b & 0x7f) << s; s += 7; } while (b & 0x80); return v; };
        while (i < buf.size()) {
            uint64_t tag = varint(), type = tag & 7;
            if (type == 2) { uint64_t n = varint(); if (i + n > buf.size()) return; on(tag >> 3, buf.substr(i, (size_t)n)); i += (size_t)n; }
            else if (type == 0) varint();
            else if (type == 5) i += 4;
            else if (type == 1) i += 8;
            else return;
        }
    };
    std::string key;
    fields(data.substr(12, zipAt - 12), [&](uint64_t field, const std::string& proof) {
        if (field != 2 && field != 3) return;
        fields(proof, [&](uint64_t f, const std::string& value) { if (f == 1 && IdOfKey(value) == storeId) key = value; });
    });
    return key;
}

// A CRX is a header and then a zip: CRX3 is "Cr24", 3, a header length; CRX2 has a key and a
// signature length instead.
static bool UnpackCrx(const std::wstring& crx, const std::wstring& folder, std::wstring& error) {
    std::string data = ReadFileUtf8(crx);
    if (data.size() < 16 || data.compare(0, 4, "Cr24") != 0) { error = L"The download was not an extension."; return false; }
    auto u32 = [&](size_t at) { return (uint32_t)(uint8_t)data[at] | (uint32_t)(uint8_t)data[at + 1] << 8 |
                                      (uint32_t)(uint8_t)data[at + 2] << 16 | (uint32_t)(uint8_t)data[at + 3] << 24; };
    uint32_t version = u32(4);
    size_t zipAt = version == 3 ? 12 + (size_t)u32(8) : 16 + (size_t)u32(8) + (size_t)u32(12);
    if (zipAt >= data.size()) { error = L"The extension file is damaged."; return false; }
    std::wstring zip = crx + L".zip";
    WriteFileUtf8(zip, data.substr(zipAt));
    SHCreateDirectoryExW(nullptr, folder.c_str(), nullptr);
    // Windows' own tar reads zip.
    wchar_t system[MAX_PATH];
    GetSystemDirectoryW(system, MAX_PATH);
    std::wstring cmd = L"\"" + std::wstring(system) + L"\\tar.exe\" -xf \"" + zip + L"\" -C \"" + folder + L"\"";
    STARTUPINFOW si{sizeof si};
    PROCESS_INFORMATION pi{};
    bool ok = CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);
    DWORD code = 1;
    if (ok) {
        WaitForSingleObject(pi.hProcess, 60000);
        GetExitCodeProcess(pi.hProcess, &code);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    }
    DeleteFileW(zip.c_str());
    DeleteFileW(crx.c_str());
    if (code != 0 || GetFileAttributesW((folder + L"\\manifest.json").c_str()) == INVALID_FILE_ATTRIBUTES) {
        error = L"The extension could not be unpacked.";
        return false;
    }
    // The store's key goes into the manifest, so the extension keeps its store ID (sites such as
    // account.proton.me talk to their extension by that ID).
    std::wstring storeId = folder.substr(folder.find_last_of(L'\\') + 1);
    std::string key = StoreKey(data, version, zipAt, storeId);
    std::string manifest = ReadFileUtf8(folder + L"\\manifest.json");
    if (!key.empty() && manifest.find("\"key\"") == std::string::npos) {
        size_t brace = manifest.find('{');
        if (brace != std::string::npos) {
            std::wstring b64 = Base64((const BYTE*)key.data(), (DWORD)key.size());
            manifest.insert(brace + 1, "\n  \"key\": \"" + Utf8(b64) + "\",");
            WriteFileUtf8(folder + L"\\manifest.json", manifest);
        }
    }
    // Chromium refuses unpacked folders holding "_metadata" (the store's signature files).
    std::wstring meta = folder + L"\\_metadata";
    meta.push_back(L'\0');
    SHFILEOPSTRUCTW op{nullptr, FO_DELETE, meta.c_str(), nullptr, FOF_NO_UI, FALSE, nullptr, nullptr};
    SHFileOperationW(&op);
    return true;
}

static bool IsStoreId(const std::wstring& id) {
    return id.size() == 32 && std::all_of(id.begin(), id.end(), [](wchar_t c) { return c >= L'a' && c <= L'p'; });
}

static void InstallFromStore(const std::wstring& storeId) {
    if (!IsStoreId(storeId)) { Toast(L"That is not a Chrome Web Store extension."); return; }
    LPWSTR version = nullptr;
    GetAvailableCoreWebView2BrowserVersionString(nullptr, &version);
    std::wstring v = Take(version);
    std::wstring major = v.substr(0, v.find(L'.'));
    if (major.empty()) major = L"150";
    std::wstring url = L"https://clients2.google.com/service/update2/crx?response=redirect&prodversion=" + major +
                       L".0.0.0&acceptformat=crx2,crx3&x=id%3D" + storeId + L"%26installsource%3Dondemand%26uc";
    std::wstring folder = ExtensionsDir() + L"\\" + storeId;
    std::wstring crx = ExtensionsDir() + L"\\" + storeId + L".crx";
    Toast(L"Adding extension");
    HWND hwnd = g.hwnd;
    std::thread([hwnd, url, folder, crx] {
        CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        std::wstring* result;
        if (!EgressAllowed(Egress::Extension, url) || FAILED(URLDownloadToFileW(nullptr, url.c_str(), crx.c_str(), 0, nullptr))) {
            result = new std::wstring(L"!The extension could not be downloaded.");
        } else {
            std::wstring error;
            result = UnpackCrx(crx, folder, error) ? new std::wstring(folder) : new std::wstring(L"!" + error);
        }
        CoUninitialize();
        PostMessageW(hwnd, WM_APP_EXT_READY, 0, (LPARAM)result);
    }).detach();
}

static void InstallStoreExtension(const std::wstring& id);

static void PickExtensionFolder() {
    ComPtr<IFileOpenDialog> dlg;
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dlg)))) return;
    DWORD opts = 0;
    dlg->GetOptions(&opts);
    dlg->SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
    dlg->SetTitle(L"Choose an unpacked extension folder");
    ComPtr<IShellItem> item;
    PWSTR path = nullptr;
    if (SUCCEEDED(dlg->Show(g.hwnd)) && SUCCEEDED(dlg->GetResult(&item)) && SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)))
        AddExtensionFolder(Take(path));
}

static void WithExtension(const std::wstring& id, std::function<void(ICoreWebView2BrowserExtension*)> f) {
    ComPtr<ICoreWebView2Profile7> p7 = TabProfile();
    if (!p7) return;
    p7->GetBrowserExtensions(Callback<ICoreWebView2ProfileGetBrowserExtensionsCompletedHandler>(
        [id, f](HRESULT hr, ICoreWebView2BrowserExtensionList* list) -> HRESULT {
            UINT count = 0;
            if (FAILED(hr) || !list || FAILED(list->get_Count(&count))) return S_OK;
            for (UINT i = 0; i < count; i++) {
                ComPtr<ICoreWebView2BrowserExtension> ext;
                LPWSTR eid = nullptr;
                if (SUCCEEDED(list->GetValueAtIndex(i, &ext)) && SUCCEEDED(ext->get_Id(&eid)) && Take(eid) == id) f(ext.Get());
            }
            return S_OK;
        }).Get());
}

static LRESULT CALLBACK PopupProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_ACTIVATE:
        if (LOWORD(wp) == WA_INACTIVE) PostMessageW(hwnd, WM_CLOSE, 0, 0);
        return 0;
    case WM_SIZE:
        if (g.popupCtl && g.popup == hwnd) {
            RECT r;
            GetClientRect(hwnd, &r);
            g.popupCtl->put_Bounds(r);
        }
        return 0;
    case WM_CLOSE:
        if (g.popup == hwnd) {
            if (g.popupCtl) { g.popupCtl->Close(); g.popupCtl.Reset(); }
            g.popup = nullptr;
        }
        DestroyWindow(hwnd);
        return 0;
    case WM_ERASEBKGND: {
        RECT r;
        GetClientRect(hwnd, &r);
        HBRUSH b = CreateSolidBrush(g.page);
        FillRect((HDC)wp, &r, b);
        DeleteObject(b);
        return 1;
    }
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

// x, y: the popup's top-right corner, in the chrome page's CSS pixels.
static void OpenExtensionPopup(const std::wstring& id, const std::wstring& page, int x, int y) {
    if (g.popup) SendMessageW(g.popup, WM_CLOSE, 0, 0);
    static bool registered = false;
    if (!registered) {
        WNDCLASSEXW wc{sizeof wc};
        wc.lpfnWndProc = PopupProc;
        wc.hInstance = GetModuleHandleW(nullptr);
        wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        wc.lpszClassName = L"ExoBrowserPopup";
        RegisterClassExW(&wc);
        registered = true;
    }
    POINT anchor{Px(x), Px(y)};
    ClientToScreen(g.hwnd, &anchor);
    int w = Px(25), h = Px(25);
    g.popup = CreateWindowExW(WS_EX_TOOLWINDOW, L"ExoBrowserPopup", L"", WS_POPUP | WS_BORDER, anchor.x - w, anchor.y, w, h,
                              g.hwnd, nullptr, GetModuleHandleW(nullptr), nullptr);
    BOOL dark = g.theme != L"light";
    DwmSetWindowAttribute(g.popup, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof dark);
    DWM_WINDOW_CORNER_PREFERENCE round = DWMWCP_ROUND;
    DwmSetWindowAttribute(g.popup, DWMWA_WINDOW_CORNER_PREFERENCE, &round, sizeof round);
    ShowWindow(g.popup, SW_SHOW);
    SetForegroundWindow(g.popup);
    HWND popup = g.popup;
    std::wstring url = L"chrome-extension://" + id + L"/" + page;
    ComPtr<ICoreWebView2ControllerOptions> opts;
    g.env->CreateCoreWebView2ControllerOptions(&opts);
    opts->put_ProfileName(L"Default");
    g.env->CreateCoreWebView2ControllerWithOptions(popup, opts.Get(),
        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [popup, url](HRESULT hr, ICoreWebView2Controller* ctl) -> HRESULT {
                if (FAILED(hr) || !ctl) return S_OK;
                if (g.popup != popup) { ctl->Close(); return S_OK; }
                g.popupCtl = ctl;
                RECT r;
                GetClientRect(popup, &r);
                ctl->put_Bounds(r);
                ComPtr<ICoreWebView2> core;
                ctl->get_CoreWebView2(&core);
                EventRegistrationToken tok;
                core->add_WindowCloseRequested(Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
                    [popup](ICoreWebView2*, IUnknown*) -> HRESULT { PostMessageW(popup, WM_CLOSE, 0, 0); return S_OK; }).Get(), &tok);
                // A popup sizes to its page, as in Chrome (25 to 800 by 600): it starts small, and the
                // page reports what it needs whenever its layout changes.
                core->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                    [popup](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* a) -> HRESULT {
                        LPWSTR m = nullptr;
                        int w = 0, h = 0;
                        if (g.popup != popup || FAILED(a->TryGetWebMessageAsString(&m))) return S_OK;
                        if (swscanf_s(Take(m).c_str(), L"exo-size:%d,%d", &w, &h) != 2 || w <= 0 || h <= 0) return S_OK;
                        w = std::clamp(w, 25, 800);
                        h = std::clamp(h, 25, 600);
                        RECT r;
                        GetWindowRect(popup, &r);
                        SetWindowPos(popup, nullptr, r.right - Px(w) - 2, r.top, Px(w) + 2, Px(h) + 2, SWP_NOZORDER | SWP_NOACTIVATE);
                        return S_OK;
                    }).Get(), &tok);
                core->AddScriptToExecuteOnDocumentCreated(
                    L"addEventListener('DOMContentLoaded', () => { const d = document.documentElement; let last = '';"
                    L" const report = () => { const s = Math.ceil(d.scrollWidth) + ',' + Math.ceil(d.scrollHeight);"
                    L"  if (s !== last) { last = s; window.chrome.webview.postMessage('exo-size:' + s); } };"
                    L" new ResizeObserver(report).observe(document.body || d); report(); });",
                    nullptr);
                // In Chrome a popup belongs to the window it opened from; here it is a window of its
                // own, so "the active tab in this window" is answered with the tab on screen.
                Tab* a = Active();
                std::wstring target = a ? a->url : L"";
                std::wstring patch =
                    L"(() => { const target = " + Json(target) + L"; const tabs = globalThis.chrome && chrome.tabs;"
                    L" if (!tabs || !tabs.query) return; const query = tabs.query.bind(tabs);"
                    L" const all = () => new Promise((resolve) => query({}, resolve));"
                    L" tabs.query = function (info, callback) {"
                    L"  const mine = info && info.active && (info.currentWindow || info.lastFocusedWindow || info.windowId !== undefined);"
                    L"  if (!mine) return query.apply(tabs, arguments);"
                    L"  const p = all().then((list) => { const t = list.find((x) => x.url === target || x.pendingUrl === target); return t ? [t] : []; });"
                    L"  if (typeof callback === 'function') { p.then(callback); return; } return p; }; })();";
                core->AddScriptToExecuteOnDocumentCreated(patch.c_str(), nullptr);
                core->Navigate(url.c_str());
                ctl->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
                return S_OK;
            }).Get());
}

// ---------------------------------------------------------------------------------------
// Composition and layout

// ---------------------------------------------------------------------------------------
// Composition. The window is one Windows.UI.Composition tree:
//   root ── content (the active tab; a layer that blurs under Search and sheets)
//        └─ chrome ── glass (live backdrop glass under each capsule of the Bar and sidebar)
//                  └─ the chrome page
// Exo's Liquid Glass blurs and tones what is behind it; in one web page CSS does that, but a tab is
// another process, so here the compositor samples the tab itself, with Exo's own numbers.

namespace wuc = winrt::Windows::UI::Composition;
namespace wge = winrt::Windows::Graphics::Effects;
namespace wf = winrt::Windows::Foundation;

// A Direct2D effect described for the compositor (what Win2D's effect classes do).
struct Effect : winrt::implements<Effect, wge::IGraphicsEffect, wge::IGraphicsEffectSource, ABI::Windows::Graphics::Effects::IGraphicsEffectD2D1Interop> {
    GUID clsid{};
    winrt::hstring name;
    std::vector<wge::IGraphicsEffectSource> sources;
    std::vector<wf::IPropertyValue> props;
    std::vector<std::pair<std::wstring, UINT>> named;
    winrt::hstring Name() { return name; }
    void Name(winrt::hstring const& n) { name = n; }
    HRESULT __stdcall GetEffectId(GUID* id) noexcept override { *id = clsid; return S_OK; }
    HRESULT __stdcall GetNamedPropertyMapping(LPCWSTR n, UINT* index, ABI::Windows::Graphics::Effects::GRAPHICS_EFFECT_PROPERTY_MAPPING* mapping) noexcept override {
        for (auto& [k, i] : named)
            if (_wcsicmp(k.c_str(), n) == 0) { *index = i; *mapping = ABI::Windows::Graphics::Effects::GRAPHICS_EFFECT_PROPERTY_MAPPING_DIRECT; return S_OK; }
        return E_INVALIDARG;
    }
    HRESULT __stdcall GetPropertyCount(UINT* c) noexcept override { *c = (UINT)props.size(); return S_OK; }
    HRESULT __stdcall GetProperty(UINT i, ABI::Windows::Foundation::IPropertyValue** v) noexcept override {
        if (i >= props.size()) return E_INVALIDARG;
        winrt::copy_to_abi(props[i], *reinterpret_cast<void**>(v));
        return S_OK;
    }
    HRESULT __stdcall GetSource(UINT i, ABI::Windows::Graphics::Effects::IGraphicsEffectSource** s) noexcept override {
        if (i >= sources.size()) return E_INVALIDARG;
        winrt::copy_to_abi(sources[i], *reinterpret_cast<void**>(s));
        return S_OK;
    }
    HRESULT __stdcall GetSourceCount(UINT* c) noexcept override { *c = (UINT)sources.size(); return S_OK; }
};

static wge::IGraphicsEffectSource MakeEffect(const GUID& clsid, const wchar_t* name, wge::IGraphicsEffectSource source,
                                             std::vector<wf::IPropertyValue> props, std::vector<std::pair<std::wstring, UINT>> named = {}) {
    auto e = winrt::make_self<Effect>();
    e->clsid = clsid;
    e->name = name;
    e->sources = {source};
    e->props = std::move(props);
    e->named = std::move(named);
    return e.as<wge::IGraphicsEffectSource>();
}
static wf::IPropertyValue Single(float v) { return wf::PropertyValue::CreateSingle(v).as<wf::IPropertyValue>(); }
static wf::IPropertyValue UInt(uint32_t v) { return wf::PropertyValue::CreateUInt32(v).as<wf::IPropertyValue>(); }

static wge::IGraphicsEffectSource Blur(wge::IGraphicsEffectSource s, float amount, const wchar_t* name = L"Blur") {
    return MakeEffect(CLSID_D2D1GaussianBlur, name, s, {Single(amount), UInt(D2D1_GAUSSIANBLUR_OPTIMIZATION_BALANCED), UInt(D2D1_BORDER_MODE_HARD)},
                      {{L"BlurAmount", 0}});
}
static wge::IGraphicsEffectSource Saturate(wge::IGraphicsEffectSource s, float amount) {
    return MakeEffect(CLSID_D2D1Saturation, L"Saturation", s, {Single(amount)});
}
// CSS brightness(k) then contrast(c) as one color matrix: x*k*c + 0.5*(1-c) on each channel, alpha kept.
static wge::IGraphicsEffectSource Tone(wge::IGraphicsEffectSource s, float k, float c = 1.f) {
    float o = 0.5f * (1.f - c);
    std::array<float, 20> m{k * c, 0, 0, 0, 0, k * c, 0, 0, 0, 0, k * c, 0, 0, 0, 0, 1, o, o, o, 0};
    return MakeEffect(CLSID_D2D1ColorMatrix, L"Tone", s,
                      {wf::PropertyValue::CreateSingleArray(m).as<wf::IPropertyValue>(), UInt(D2D1_COLORMATRIX_ALPHA_MODE_PREMULTIPLIED),
                       wf::PropertyValue::CreateBoolean(false).as<wf::IPropertyValue>()});
}

static float Scale() { return g.dpi / 96.f; }

// A build for the pictures (cl /DEXO_MEDIA, never released) can draw the whole window at a scale of its own
// (EXO_MEDIA_SCALE=2: twice the pixels, the same layout), so a shot stays sharp where the website zooms into it.
static float MediaScale() {
#ifdef EXO_MEDIA
    static float scale = [] {
        wchar_t v[8] = L"";
        GetEnvironmentVariableW(L"EXO_MEDIA_SCALE", v, 8);
        float f = (float)_wtof(v);
        return f >= 1.f && f <= 4.f ? f : 0.f;
    }();
    return scale;
#else
    return 0.f;
#endif
}
static void MediaRaster(ICoreWebView2Controller* c) {
    if (!c || !MediaScale()) return;
    if (ComPtr<ICoreWebView2Controller3> c3; SUCCEEDED(c->QueryInterface(IID_PPV_ARGS(&c3)))) {
        c3->put_ShouldDetectMonitorScaleChanges(FALSE);
        c3->put_RasterizationScale(MediaScale());
    }
}

// Exo's glass, its filters in its order (Exo Launcher's styles/glass.css and tokens.css, in ui/src):
//   small: --exo-control-glass, blur(10px) then Void brightness(0.46) saturate(1.8); Dark brightness(0.46) contrast(0.9)
//          saturate(1.8); Light brightness(1.06) saturate(1.6). Exo's own is 0.62, for controls over its black rooms:
//          the Bar and side tabs here lie over web pages, mostly white, where 0.62 left their white words at 2.7:1;
//          0.46 keeps them at 4.5:1 over a white page, Exo's rule for words on glass.
//   large (liquid): blur(16px) saturate(1.8) then --glassy-overlay-tone: Void brightness(0.66), Dark 0.64, Light 1;
//          a sheet (.exo-glass.is-panel) frosts deeper, blur(20px)
// `dim` is a scrim the page lays over the content under this glass (Settings' room), which in Exo the glass sees.
static float GlassBlur(wchar_t kind) { return kind == L'p' ? 20.f : kind == L'l' ? 16.f : 10.f; }

static wuc::CompositionEffectBrush GlassBrush(wchar_t kind, float dim, const std::wstring& theme, const wuc::CompositionBrush& backdrop) {
    static std::unordered_map<std::wstring, wuc::CompositionEffectFactory> factories;
    float k = Scale();
    std::wstring key = std::wstring(1, kind) + theme + std::to_wstring((int)(dim * 100)) + L"@" + std::to_wstring((int)(k * 100));
    auto it = factories.find(key);
    if (it == factories.end()) {
        auto source = wuc::CompositionEffectSourceParameter(L"backdrop");
        float keep = 1.f - dim;
        wge::IGraphicsEffectSource effect{nullptr};
        if (kind != L's')
            effect = Tone(Saturate(Blur(source, GlassBlur(kind) * k), 1.8f), (theme == L"light" ? 1.f : theme == L"dark" ? 0.64f : 0.66f) * keep);
        else if (theme == L"light") effect = Saturate(Tone(Blur(source, GlassBlur(kind) * k), 1.06f * keep), 1.6f);
        else effect = Saturate(Tone(Blur(source, GlassBlur(kind) * k), 0.46f * keep, theme == L"dark" ? 0.9f : 1.f), 1.8f);
        it = factories.emplace(key, g.compositor.CreateEffectFactory(effect.as<wge::IGraphicsEffect>())).first;
    }
    auto brush = it->second.CreateBrush();
    brush.SetSourceParameter(L"backdrop", backdrop);
    return brush;
}

// See-through (Settings > Look > Material): your desktop, frosted, shows through wherever the page doesn't cover the
// window (the Bar's band, behind side tabs), as Zen's glass does: Windows' host backdrop (what's behind the window) in
// the window's own glass recipe, under the page and the chrome.
// Windows draws no backdrop while its Transparency effects are off (Settings > Personalization > Colors): See-through is
// Glass then, and Settings says what it waits for.
static wuc::SpriteVisual g_backdrop{nullptr};
static bool WindowsTransparency() {
    DWORD on = 1, size = sizeof on;
    RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", L"EnableTransparency",
                 RRF_RT_REG_DWORD, nullptr, &on, &size);
    return on != 0;
}
static bool SeeThrough() { return Setting(L"material", L"glass") == L"window" && WindowsTransparency(); }
// Under the pages, the band's own color (the Appearance's page color): glass over a page's top edge (Search's first row,
// the top of a menu) blurs into it, as Exo's CSS glass blurs what's behind it. Without it that frost blurred in nothing
// above the page, came out half see-through, and the page under it read sharp. See-through leaves it out: the band is
// the desktop then.
static wuc::SpriteVisual g_sceneBase{nullptr};
static void ApplyBackdrop() {
    if (!g.hwnd || !g.compositor) return;
    bool on = SeeThrough();
    if (g.scene) {
        if (!g_sceneBase) {
            g_sceneBase = g.compositor.CreateSpriteVisual();
            g_sceneBase.RelativeSizeAdjustment({1, 1});
            g.scene.Children().InsertAtBottom(g_sceneBase);
        }
        g_sceneBase.Brush(g.compositor.CreateColorBrush(winrt::Windows::UI::Color{255, GetRValue(g.page), GetGValue(g.page), GetBValue(g.page)}));
        g_sceneBase.IsVisible(!on);
    }
    BOOL use = on;
    DwmSetWindowAttribute(g.hwnd, 17 /* DWMWA_USE_HOSTBACKDROPBRUSH */, &use, sizeof use);
    if (!on) {
        if (g_backdrop) g_backdrop.IsVisible(false);
        return;
    }
    if (!g_backdrop) {
        g_backdrop = g.compositor.CreateSpriteVisual();
        g_backdrop.RelativeSizeAdjustment({1, 1});
        g.root.Children().InsertAtBottom(g_backdrop);
    }
    g_backdrop.Brush(GlassBrush(L'l', 0.f, g.theme, g.compositor.CreateHostBackdropBrush()));
    g_backdrop.IsVisible(true);
}

// The page lists its glass: "@,theme,material,bar,sidebar;kind,x,y,w,h,radius,place,key,in,out;..." in CSS pixels. The
// first item is how the page looks right now: its theme, glass or solid, and whether the auto-hidden Bar and sidebar
// are in (1) or out (0); the frost follows the page's own frames that way instead of running ahead of them. Then each
// piece: kind s: small, l: large, p: a sheet; place t: the Bar, d: the sidebar, f: anything else (menus, Search,
// toasts, sheets), which stays when they hide; key: the piece's own, while it's on the page; in: how long, in ms, a
// new piece fades in on the page, out: how long one has left as it fades away, so its frost fades with it. A backdrop
// brush cannot see a tab (its pixels come from the browser's own process), so each piece's backdrop is a live surface
// of the tab layer itself, cut to the piece plus a margin for the blur to draw from, then blurred and toned.
//
// Each piece keeps its sprite while it's on the page: when it moves or resizes, its sprite is changed in place.
// (Rebuilding every sprite on each change left all the glass unfrosted for a frame: a menu opening over Settings
// blinked the whole sheet.) A new piece's frost fades in as the piece does (a menu grows in from nothing over 160 ms:
// frost at full strength from the first frame showed as a gray box before the menu), and one that fades away takes
// its frost with it. A new theme or scale gives each its new filters in place.
static std::wstring g_glassSpec;
struct GlassPiece {
    wuc::SpriteVisual sprite{nullptr};
    wuc::CompositionVisualSurface surface{nullptr};
    wuc::CompositionSurfaceBrush backdrop{nullptr};
    wuc::CompositionRoundedRectangleGeometry shape{nullptr};
    wuc::ContainerVisual parent{nullptr};
    bool seen = false, leaving = false;
};

static wuc::CompositionEasingFunction EaseOut();

static void FadeGlass(const wuc::SpriteVisual& sprite, float to, int ms) {
    auto fade = g.compositor.CreateScalarKeyFrameAnimation();
    fade.InsertKeyFrame(1.f, to, EaseOut());
    fade.Duration(std::chrono::milliseconds(ms));
    sprite.StartAnimation(L"Opacity", fade);
}
static std::unordered_map<std::wstring, GlassPiece> g_glassPieces;
static std::wstring g_glassLook;  // the theme and scale the pieces' filters were made for
static void AnimateGlass(const wuc::ContainerVisual& layer, bool on, bool side);

static void SetGlass(const std::wstring& spec) {
    g_glassSpec = spec;
    if (!g.glassTop) return;
    float k = Scale();
    auto items = Split(spec, L';');
    auto page = items.empty() ? std::vector<std::wstring>{} : Split(items[0], L',');
    bool told = page.size() >= 5 && page[0] == L"@";
    std::wstring theme = told ? page[1] : g.theme;
    bool solid = told && page[2] == L"solid";
    if (told && (page[3] == L"1") != g.glassTopIn) AnimateGlass(g.glassTop, g.glassTopIn = page[3] == L"1", false);
    if (told && (page[4] == L"1") != g.glassSideIn) AnimateGlass(g.glassSide, g.glassSideIn = page[4] == L"1", true);
    if (told && theme != g_glassLook.substr(0, g_glassLook.find(L'@'))) PaintTheme(theme);
    std::wstring look = theme + L"@" + std::to_wstring((int)(k * 100));
    bool relook = look != g_glassLook;
    g_glassLook = look;
    if (solid) {
        for (auto& [_, piece] : g_glassPieces) piece.parent.Children().Remove(piece.sprite);
        g_glassPieces.clear();
        return;
    }
    for (auto& [_, piece] : g_glassPieces) piece.seen = false;
    int n = 0;
    for (auto& item : items) {
        auto f = Split(item, L',');
        if (f.size() < 6 || f[0] == L"@") continue;
        n++;
        float x = (float)_wtof(f[1].c_str()) * k, y = (float)_wtof(f[2].c_str()) * k;
        float w = (float)_wtof(f[3].c_str()) * k, h = (float)_wtof(f[4].c_str()) * k, r = (float)_wtof(f[5].c_str()) * k;
        if (w < 1 || h < 1) continue;
        // A piece that doesn't sit over the page has nothing to frost (the Bar's own band is solid); menus open below it.
        if (x + w <= g.contentRect.left || y + h <= g.contentRect.top || x >= g.contentRect.right || y >= g.contentRect.bottom)
            continue;
        wchar_t kind = f[0] == L"p" ? L'p' : f[0] == L"l" ? L'l' : L's';
        float pad = GlassBlur(kind) * 3 * k;
        std::wstring place = f.size() > 6 ? f[6] : L"";
        auto parent = place == L"d" ? g.glassSide : place == L"t" ? g.glassTop : g.glassFree;
        std::wstring key = (f.size() > 7 && !f[7].empty() ? f[7] : L"#" + std::to_wstring(n)) + kind + place;
        GlassPiece& piece = g_glassPieces[key];
        int fadeIn = f.size() > 8 ? _wtoi(f[8].c_str()) : 0;
        int fadeOut = f.size() > 9 ? _wtoi(f[9].c_str()) : 0;
        if (!piece.sprite) {
            piece.surface = g.compositor.CreateVisualSurface();
            piece.surface.SourceVisual(g.scene);
            piece.backdrop = g.compositor.CreateSurfaceBrush(piece.surface);
            piece.backdrop.Stretch(wuc::CompositionStretch::None);
            piece.backdrop.HorizontalAlignmentRatio(0);
            piece.backdrop.VerticalAlignmentRatio(0);
            piece.backdrop.Offset({-pad, -pad});
            piece.sprite = g.compositor.CreateSpriteVisual();
            piece.sprite.Brush(GlassBrush(kind, 0.f, theme, piece.backdrop));
            piece.shape = g.compositor.CreateRoundedRectangleGeometry();
            piece.sprite.Clip(g.compositor.CreateGeometricClip(piece.shape));
            piece.parent = parent;
            parent.Children().InsertAtTop(piece.sprite);  // the newest piece lies on top (a menu over a sheet)
            if (fadeIn > 0) {
                piece.sprite.Opacity(0.f);
                FadeGlass(piece.sprite, 1.f, fadeIn);
            }
        } else if (relook) {
            piece.backdrop.Offset({-pad, -pad});
            piece.sprite.Brush(GlassBrush(kind, 0.f, theme, piece.backdrop));
        }
        // Fading away on the page (Exo's own menus do), its frost goes with it; opened again on the way, it comes back.
        if (fadeOut > 0 && !piece.leaving) FadeGlass(piece.sprite, 0.f, fadeOut);
        else if (fadeOut == 0 && piece.leaving) FadeGlass(piece.sprite, 1.f, std::max(fadeIn, 1));
        piece.leaving = fadeOut > 0;
        piece.seen = true;
        piece.surface.SourceOffset({x - pad, y - pad});
        piece.surface.SourceSize({w + 2 * pad, h + 2 * pad});
        piece.sprite.Offset({x, y, 0});
        piece.sprite.Size({w, h});
        piece.shape.Size({w, h});
        piece.shape.CornerRadius({std::min(r, h / 2), std::min(r, h / 2)});
    }
    // Gone from the page (one that faded away is gone once its fade ended): its frost goes now.
    for (auto it = g_glassPieces.begin(); it != g_glassPieces.end();) {
        if (it->second.seen) { ++it; continue; }
        it->second.parent.Children().Remove(it->second.sprite);
        it = g_glassPieces.erase(it);
    }
}

static void Commit() {}

static wuc::CompositionEasingFunction EaseOut() {
    return g.compositor.CreateCubicBezierEasingFunction({0.23f, 1.f}, {0.32f, 1.f});
}

static void InitComposition() {
    DispatcherQueueOptions options{sizeof options, DQTYPE_THREAD_CURRENT, DQTAT_COM_STA};
    CreateDispatcherQueueController(options, reinterpret_cast<ABI::Windows::System::IDispatcherQueueController**>(winrt::put_abi(g.queue)));
    g.compositor = wuc::Compositor();
    auto interop = g.compositor.as<ABI::Windows::UI::Composition::Desktop::ICompositorDesktopInterop>();
    winrt::check_hresult(interop->CreateDesktopWindowTarget(g.hwnd, TRUE,
        reinterpret_cast<ABI::Windows::UI::Composition::Desktop::IDesktopWindowTarget**>(winrt::put_abi(g.target))));
    g.root = g.compositor.CreateContainerVisual();
    g.root.RelativeSizeAdjustment({1, 1});
    g.content = g.compositor.CreateLayerVisual();
    g.chromeLayer = g.compositor.CreateContainerVisual();
    g.chromeLayer.RelativeSizeAdjustment({1, 1});
    g.glassLayer = g.compositor.CreateContainerVisual();
    g.glassLayer.RelativeSizeAdjustment({1, 1});
    g.glassTop = g.compositor.CreateContainerVisual();
    g.glassTop.RelativeSizeAdjustment({1, 1});
    g.glassSide = g.compositor.CreateContainerVisual();
    g.glassSide.RelativeSizeAdjustment({1, 1});
    g.glassFree = g.compositor.CreateContainerVisual();
    g.glassFree.RelativeSizeAdjustment({1, 1});
    g.glassLayer.Children().InsertAtTop(g.glassSide);
    g.glassLayer.Children().InsertAtTop(g.glassTop);
    g.glassLayer.Children().InsertAtTop(g.glassFree);
    g.chromeVisual = g.compositor.CreateContainerVisual();
    g.chromeVisual.RelativeSizeAdjustment({1, 1});
    g.chromeLayer.Children().InsertAtTop(g.glassLayer);
    g.chromeLayer.Children().InsertAtTop(g.chromeVisual);
    g.peekLayer = g.compositor.CreateContainerVisual();
    g.peekLayer.RelativeSizeAdjustment({1, 1});
    g.scene = g.compositor.CreateContainerVisual();
    g.scene.RelativeSizeAdjustment({1, 1});
    g.scene.Children().InsertAtTop(g.content);
    g.scene.Children().InsertAtTop(g.peekLayer);
    g.root.Children().InsertAtTop(g.scene);
    g.root.Children().InsertAtTop(g.chromeLayer);
    g.target.Root(g.root);
    auto blur = Blur(wuc::CompositionEffectSourceParameter(L"source"), 0.f);
    g.blur = g.compositor.CreateEffectFactory(blur.as<wge::IGraphicsEffect>(), {L"Blur.BlurAmount"}).CreateBrush();
}

static void SetBlur(bool on) {
    if (!g.content) return;
    if (on) {
        g.content.Effect(g.blur);
        // At its full amount at once (Exo never animates a blur: each step of one is a new blur of the whole page); Peek's
        // card coming in is the motion.
        auto a = g.compositor.CreateScalarKeyFrameAnimation();
        a.InsertKeyFrame(1.f, 22.f * Scale());
        a.Duration(std::chrono::milliseconds(1));
        g.blur.StartAnimation(L"Blur.BlurAmount", a);
    } else {
        g.content.Effect(nullptr);
    }
}

// ---------------------------------------------------------------------------------------
// Auto-hide. The window owns it: it sees every pointer move, so the Bar and sidebar come in
// when the pointer touches the top (or left, with tabs down the side) edge, stay while it is
// anywhere on them or a little below, and leave half a second after it goes; anything open in
// the chrome (Search, a menu, Settings, find) holds them.

// The Bar and the sidebar are separate: the top edge brings the Bar, the left edge the sidebar.
// The chrome page slides and fades each in CSS; the window moves its glass the same way once the page says it has
// (SetGlass), so the two arrive and leave together.

static const UINT kTimerHide = 3, kTimerHideSide = 4;
static bool g_hideTopPending = false, g_hideSidePending = false;

// Exo's --ease-spring (tokens.css), point for point: travel and shape move on it, appearing on --ease-out.
static void SpringTo(const wuc::Vector3KeyFrameAnimation& a, wf::Numerics::float3 to) {
    static const float points[][2] = {{1.8f, .005f}, {3.7f, .018f}, {5.7f, .04f}, {8.f, .074f}, {10.2f, .111f}, {12.5f, .156f},
        {25.8f, .437f}, {29.7f, .512f}, {33.2f, .576f}, {37.3f, .645f}, {41.3f, .703f}, {45.5f, .756f}, {49.8f, .803f},
        {54.5f, .846f}, {59.5f, .883f}, {64.7f, .913f}, {70.3f, .939f}, {76.f, .958f}, {82.f, .973f}, {90.2f, .986f},
        {99.8f, .995f}};
    auto linear = g.compositor.CreateLinearEasingFunction();
    a.SetVector3Parameter(L"to", to);
    for (auto& [at, v] : points)
        a.InsertExpressionKeyFrame(at / 100.f, L"this.StartingValue + (to - this.StartingValue) * " + std::to_wstring(v), linear);
    a.InsertKeyFrame(1.f, to, linear);
}

static void AnimateGlass(const wuc::ContainerVisual& layer, bool on, bool side) {
    float k = Scale();
    // As the page's own slide (browser.css): 8 px, fading on --ease-out (base 160 in, quick 120 out) and travelling on
    // --ease-spring (move 220 in, quick 120 out).
    wf::Numerics::float3 away = side ? wf::Numerics::float3{-8.f * k, 0, 0} : wf::Numerics::float3{0, -8.f * k, 0};
    auto opacity = g.compositor.CreateScalarKeyFrameAnimation();
    opacity.InsertKeyFrame(1.f, on ? 1.f : 0.f, EaseOut());
    opacity.Duration(std::chrono::milliseconds(on ? 160 : 120));
    auto offset = g.compositor.CreateVector3KeyFrameAnimation();
    SpringTo(offset, on ? wf::Numerics::float3{0, 0, 0} : away);
    offset.Duration(std::chrono::milliseconds(on ? 220 : 120));
    layer.StartAnimation(L"Opacity", opacity);
    layer.StartAnimation(L"Offset", offset);
}

static void SendRevealed() {
    UiPost(std::wstring(L"{\"t\":\"revealed\",\"top\":") + Bool(g.revealedTop) + L",\"side\":" + Bool(g.revealedSide) + L"}");
}

// The new tab page always shows the Bar and the side tabs, auto-hidden or not.
static bool OnNewTab() {
    Tab* a = Active();
    return a && IsNewTab(a->url.empty() ? a->pendingNav : a->url);
}

static void Reveal(bool top, bool on, bool tell = false) {
    if (!g.glassTop) return;
    if (!g.autohide || g.fullscreen || OnNewTab()) on = true;
    bool& state = top ? g.revealedTop : g.revealedSide;
    bool changed = state != on;
    state = on;
    g.revealTop = g.autohide && g.revealedTop ? Px(g.chromeTopDip) : 0;
    g.revealLeft = g.autohide && g.revealedSide ? Px(g.sidebarDip) : 0;
    if (!changed && !tell) return;
    SendRevealed();
}

static void SetRevealed(bool on) { Reveal(true, on); }

static void Hold(bool top, bool keep) {
    bool& pending = top ? g_hideTopPending : g_hideSidePending;
    UINT id = top ? kTimerHide : kTimerHideSide;
    if (keep) {
        if (pending) { KillTimer(g.hwnd, id); pending = false; }
    } else if (!pending) {
        pending = true;
        SetTimer(g.hwnd, id, 500, nullptr);
    }
}

static void AutoHideTrack(POINT pt, bool outside) {
    if (!g.autohide || g.fullscreen) return;
    // A point beyond the window (the pointer on another screen when a menu or Find lets go) is outside it: left of
    // the window read as at its left edge and brought the side tabs out, above it brought the Bar.
    if (RECT client; !outside && GetClientRect(g.hwnd, &client)) outside = !PtInRect(&client, pt);
    int top = Px(g.chromeTopDip), left = Px(g.sidebarDip), slack = Px(18);
    if (!g.revealedTop) {
        if (!outside && pt.y <= Px(2)) Reveal(true, true);
    } else {
        Hold(true, (!outside && pt.y < top + slack) || g.overlay || g.pinned);
    }
    if (!left) return;
    if (!g.revealedSide) {
        if (!outside && pt.x <= Px(2)) Reveal(false, true);
    } else {
        Hold(false, !outside && pt.x < left + slack);
    }
}



// After the tab on screen changes or goes somewhere: on the new tab page everything shows; anywhere else what is
// shown hides again unless the pointer is over it.
static void FollowNewTab() {
    if (!g.autohide || g.fullscreen || !g.glassTop) return;
    if (OnNewTab()) { Reveal(true, true); Reveal(false, true); return; }
    POINT pt;
    GetCursorPos(&pt);
    ScreenToClient(g.hwnd, &pt);
    // The pointer outside the window (on another screen) is over neither: left of the window read as over the side
    // tabs, and above it as over the Bar, so they stayed out until the pointer came back.
    RECT client;
    GetClientRect(g.hwnd, &client);
    bool in = PtInRect(&client, pt) != FALSE;
    if (g.revealedTop) Hold(true, (in && pt.y < Px(g.chromeTopDip) + Px(18)) || g.overlay || g.pinned);
    if (g.revealedSide && g.sidebarDip) Hold(false, in && pt.x < Px(g.sidebarDip) + Px(18));
}

// Split view: the tab on screen and, when it's in a split, the others in it (in the strip's order, at most 4).
static std::vector<Tab*> Panes() {
    std::vector<Tab*> out;
    Tab* a = Active();
    if (!a) return out;
    if (!a->split) return {a};
    for (auto& t : g.tabs) if (t->split == a->split && !t->peek && out.size() < 4) out.push_back(t.get());
    return out;
}

static bool Shown(const Tab* t) {
    Tab* a = Active();
    return t == a || (a && a->split && t->split == a->split);
}

// A pane's place in the window: 2 or 3 side by side, 4 in a grid, 6 px apart; one tab fills the content area.
// Pane i of n in the content area: side by side, four as two rows of two.
static RECT PaneRectAt(size_t i, size_t n) {
    RECT c = g.contentRect;
    if (n < 2 || i >= n) return c;
    LONG gap = Px(6), w = c.right - c.left, h = c.bottom - c.top;
    size_t cols = n == 4 ? 2 : n, rows = n == 4 ? 2 : 1, col = i % cols, row = i / cols;
    LONG cw = (w - gap * (LONG)(cols - 1)) / (LONG)cols, rh = (h - gap * (LONG)(rows - 1)) / (LONG)rows;
    LONG x = c.left + (LONG)col * (cw + gap), y = c.top + (LONG)row * (rh + gap);
    return {x, y, col == cols - 1 ? c.right : x + cw, row == rows - 1 ? c.bottom : y + rh};
}
static RECT PaneRect(const Tab* t) {
    auto panes = Panes();
    return PaneRectAt(std::find(panes.begin(), panes.end(), t) - panes.begin(), panes.size());
}

// Each pane's view where it belongs; in a split, each rounded at its corners.
static void PlacePanes() {
    auto panes = Panes();
    float k = (float)g.dpi / 96.f;
    for (Tab* t : panes) {
        RECT r = PaneRect(t);
        if (t->ctl) t->ctl->put_Bounds(r);
        if (!t->visual) continue;
        float w = (float)(r.right - r.left), h = (float)(r.bottom - r.top);
        t->visual.Offset({(float)(r.left - g.contentRect.left), (float)(r.top - g.contentRect.top), 0});
        t->visual.Size({w, h});
        if (panes.size() > 1) {
            auto shape = g.compositor.CreateRoundedRectangleGeometry();
            shape.Size({w, h});
            shape.CornerRadius({10 * k, 10 * k});
            t->visual.Clip(g.compositor.CreateGeometricClip(shape));
        } else {
            t->visual.Clip(nullptr);
        }
    }
}

// Peek (below, with the tabs).
static void PlacePeek();
static void OpenPeek(const std::wstring& url);
static bool CleanNavigation(ICoreWebView2* core, ICoreWebView2NavigationStartingEventArgs* a, const std::wstring& url,
                            std::wstring& from, ULONGLONG& at);
static std::wstring CleanUrl(const std::wstring& url);
static bool CopyText(const std::wstring& text);
static void ClosePeek();
static bool IsMeeting(const std::wstring& url);
static bool Downloading(int tabId);
static void CloseWhenDownloaded(int tabId);

// The page on screen runs up under the Bar's clear band once it has scrolled and has no header pinned to its top, so the
// Bar's capsules and menus frost the page itself, as Exo's frost the room under its Bar. Never with a split, Peek or a
// hidden Bar (that one already lies over the page).
static bool UnderBar() {
    Tab* a = Active();
    return a && a->under && !a->split && !g.peekId && !g.fullscreen && !g.autohide;
}

static void Layout();
// The page slid under the Bar or out from it: laid out again and scrolled by the Bar's height the other way, so what
// you're reading stays where it is.
static void SlideUnder(bool was, bool top = false) {
    bool now = UnderBar();
    if (now == was) return;
    Layout();
    // Back below at the page's very top: the top shows, nothing to keep in place.
    if (Tab* a = Active(); a && a->core && !top)
        a->core->ExecuteScript((std::wstring(L"window.scrollBy(0, ") + (now ? L"-" : L"") + std::to_wstring(g.chromeTopDip) + L")").c_str(), nullptr);
}

static void Layout() {
    if (!g.hwnd) return;
    RECT client;
    GetClientRect(g.hwnd, &client);
    RECT c = client;
    if (!g.fullscreen && !g.autohide) {
        c.top = UnderBar() ? 0 : Px(g.chromeTopDip);
        c.left = Px(g.sidebarDip);
    }
    if (c.right < c.left) c.right = c.left;
    if (c.bottom < c.top) c.bottom = c.top;
    g.contentRect = c;
    if (g.content) {
        float w = (float)(c.right - c.left), h = (float)(c.bottom - c.top);
        g.content.Offset({(float)c.left, (float)c.top, 0});
        g.content.Size({w, h});
        for (auto& t : g.tabs) if (t->visual && !t->peek) t->visual.Size({w, h});
    }
    PlacePanes();
    if (g.uiCtl) g.uiCtl->put_Bounds(client);
    if (g.peekId) PlacePeek();
    SetGlass(g_glassSpec);
}

static ICoreWebView2CompositionController* CompFor(int target) {
    if (target == kUi) return g.uiComp.Get();
    if (Tab* t = FindTab(target)) return t->comp.Get();
    return nullptr;
}

static ICoreWebView2Controller* CtlFor(int target) {
    if (target == kUi) return g.uiCtl.Get();
    if (Tab* t = FindTab(target)) return t->ctl.Get();
    return nullptr;
}

static void FocusTarget(int target) {
    if (ICoreWebView2Controller* c = CtlFor(target)) {
        g.focus = target;
        // Only in the window in front: moving focus into a window behind another app activated it, over that app (a
        // window opened in the background, a game in front). WM_SETFOCUS moves it there as the window is next activated.
        if (GetForegroundWindow() == g.hwnd) c->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    }
}

// Reload, or, for a tab whose page hasn't come yet (just woken from sleep, its view still on the about:blank it starts
// on), go to that page: reloading the blank one cancelled the tab's own load and left it empty for good.
static void ReloadTab(Tab* t) {
    if (!t || !t->core) return;
    LPWSTR source = nullptr;
    t->core->get_Source(&source);
    if (Take(source) == L"about:blank" && !t->url.empty() && t->url != L"about:blank") t->core->Navigate(t->url.c_str());
    else t->core->Reload();
}

// A part of the chrome page over the content that takes the pointer while the page keeps the keyboard
// (Exo Vault's menu beside a sign-in field), in window pixels.
// Parts of the chrome page over the page that take the mouse while the page keeps the keyboard (Exo Vault's fill
// menu and its save prompt).
static std::vector<RECT> g_uiHot;

static bool InUiHot(POINT pt) {
    for (auto& r : g_uiHot) if (PtInRect(&r, pt)) return true;
    return false;
}

// What the pointer is over: the Bar and every overlay belong to the chrome page, the content
// card to the active tab.
static const int kPeekAround = -2;  // the blurred page around Peek's card: a press there closes it

static int HitTarget(POINT pt) {
    if (g.overlay || InUiHot(pt)) return kUi;
    if (!g.fullscreen && !g.autohide && pt.y < Px(g.chromeTopDip)) return kUi;
    if (g.peekId && !g.fullscreen) {
        if (PtInRect(&g.peekRect, pt)) return g.peekId;
        if (PtInRect(&g.contentRect, pt)) return kPeekAround;
    }
    // In full screen the chrome page is hidden: a reveal band left from before would swallow the page's clicks.
    if (!g.fullscreen && ((g.revealTop && pt.y < g.revealTop) || (g.revealLeft && pt.x < g.revealLeft))) return kUi;
    if (PtInRect(&g.contentRect, pt)) {
        for (Tab* t : Panes()) {
            RECT r = PaneRect(t);
            if (PtInRect(&r, pt)) return t->comp ? t->id : kUi;
        }
        return 0;  // the gap between panes
    }
    return g.fullscreen ? 0 : kUi;
}

static void SendMouse(int target, COREWEBVIEW2_MOUSE_EVENT_KIND kind, WPARAM wp, POINT pt) {
    ICoreWebView2CompositionController* comp = CompFor(target);
    if (!comp) return;
    UINT32 data = 0;
    if (kind == COREWEBVIEW2_MOUSE_EVENT_KIND_WHEEL || kind == COREWEBVIEW2_MOUSE_EVENT_KIND_HORIZONTAL_WHEEL)
        data = (UINT32)(INT32)GET_WHEEL_DELTA_WPARAM(wp);
    else if (kind == COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_DOWN || kind == COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_UP ||
             kind == COREWEBVIEW2_MOUSE_EVENT_KIND_X_BUTTON_DOUBLE_CLICK)
        data = GET_XBUTTON_WPARAM(wp);
    if (target != kUi) {
        RECT at = target == g.peekId ? g.peekRect : FindTab(target) ? PaneRect(FindTab(target)) : g.contentRect;
        pt.x -= at.left;
        pt.y -= at.top;
    }
    comp->SendMouseInput(kind, (COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS)GET_KEYSTATE_WPARAM(wp), data, pt);
}

// Files, links and text dragged onto the window go to the page under the pointer (an upload, a board's cards), as
// in any browser: views hosted in the window's composition get no drops of their own.
class DropTarget : public IDropTarget {
    LONG refs = 1;
    ComPtr<IDataObject> data;
    ComPtr<ICoreWebView2CompositionController3> over;
    static ComPtr<ICoreWebView2CompositionController3> At(POINTL screen, POINT* pt) {
        POINT p{screen.x, screen.y};
        ScreenToClient(g.hwnd, &p);
        int target = HitTarget(p);
        if (target != kUi) { RECT at = target == g.peekId ? g.peekRect : FindTab(target) ? PaneRect(FindTab(target)) : g.contentRect; p.x -= at.left; p.y -= at.top; }
        *pt = p;
        ComPtr<ICoreWebView2CompositionController3> c3;
        if (ICoreWebView2CompositionController* comp = CompFor(target)) comp->QueryInterface(IID_PPV_ARGS(&c3));
        return c3;
    }
    // The pointer moved onto another view: leave the old one, enter the new.
    void Follow(const ComPtr<ICoreWebView2CompositionController3>& next, DWORD keys, POINT pt, DWORD* effect) {
        if (next == over) return;
        if (over) over->DragLeave();
        over = next;
        if (over) over->DragEnter(data.Get(), keys, pt, effect);
    }
public:
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** out) override {
        if (riid == IID_IUnknown || riid == IID_IDropTarget) { *out = static_cast<IDropTarget*>(this); AddRef(); return S_OK; }
        *out = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs); }
    ULONG STDMETHODCALLTYPE Release() override { ULONG r = InterlockedDecrement(&refs); if (!r) delete this; return r; }
    HRESULT STDMETHODCALLTYPE DragEnter(IDataObject* d, DWORD keys, POINTL screen, DWORD* effect) override {
        data = d;
        POINT pt;
        auto next = At(screen, &pt);
        over.Reset();
        *effect = DROPEFFECT_NONE;
        Follow(next, keys, pt, effect);
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE DragOver(DWORD keys, POINTL screen, DWORD* effect) override {
        POINT pt;
        auto next = At(screen, &pt);
        DWORD entered = *effect;
        Follow(next, keys, pt, &entered);
        if (!over) { *effect = DROPEFFECT_NONE; return S_OK; }
        return over->DragOver(keys, pt, effect);
    }
    HRESULT STDMETHODCALLTYPE DragLeave() override {
        if (over) over->DragLeave();
        over.Reset();
        data.Reset();
        return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Drop(IDataObject* d, DWORD keys, POINTL screen, DWORD* effect) override {
        data = d;
        POINT pt;
        auto next = At(screen, &pt);
        DWORD entered = *effect;
        Follow(next, keys, pt, &entered);
        HRESULT hr = over ? over->Drop(d, keys, pt, effect) : (*effect = DROPEFFECT_NONE, S_OK);
        over.Reset();
        data.Reset();
        return hr;
    }
};

// The button that is down while the window holds the mouse, so a drag cut short (Alt+Tab, a popup taking the
// mouse) can still be ended in the page; and when the middle button last came up (Chromium opens a middle-clicked
// link on release, after the button state is gone).
static UINT g_captureUp = 0;
static POINT g_capturePt{};
static ULONGLONG g_middleUpAt = 0;

static void SendLeave(int target) {
    if (ICoreWebView2CompositionController* comp = CompFor(target))
        comp->SendMouseInput(COREWEBVIEW2_MOUSE_EVENT_KIND_LEAVE, COREWEBVIEW2_MOUSE_EVENT_VIRTUAL_KEYS_NONE, 0, {0, 0});
}

// ---------------------------------------------------------------------------------------
// Tabs

static void ShowActive();
static void Activate(int id);
static void Order();
static void CreateView(Tab* t);
static void OpenOverlay(const wchar_t* mode, const std::wstring& text = L"");
static void OnNewTabMessage(int id, const std::wstring& msg);
static void OnVaultPage(Tab* t, const std::wstring& from, const std::wstring& raw);
static bool HandleKey(UINT vk, bool repeat, bool fromUi);
static void SetFullscreen(bool on);
static void LeaveFullscreen();
static void CloseOverlay(bool tell);

static void EnsureView(Tab* t, std::function<void(Tab*)> then) {
    if (t->ctl) { if (then) then(t); return; }
    if (then) t->whenReady.push_back(std::move(then));
    if (!t->creating) CreateView(t);
}

static void RecordVisit(const std::wstring& u, const std::wstring& title) {
    if ((u.rfind(L"http://", 0) != 0 && u.rfind(L"https://", 0) != 0) || IsNewTab(u)) return;
    Visit& v = g.history[u];
    v.url = u;
    if (!title.empty()) v.title = title;
    v.visits++;
    v.last = NowSeconds();
    g.historyDirty = true;
    UiPost(L"{\"t\":\"visit\",\"item\":[" + Json(v.url) + L"," + Json(v.title) + L"," + std::to_wstring(v.visits) +
           L"," + std::to_wstring(v.last) + L"]}");
}
static void RecordVisit(Tab* t) { if (!t->priv) RecordVisit(t->url, t->title); }

static void RefreshFavicon(int id) {
    Tab* t = FindTab(id);
    if (!t || !t->core) return;
    ComPtr<ICoreWebView2_15> c15;
    if (FAILED(t->core.As(&c15))) return;
    c15->GetFavicon(COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG,
        Callback<ICoreWebView2GetFaviconCompletedHandler>([id](HRESULT hr, IStream* stream) -> HRESULT {
            Tab* t = FindTab(id);
            if (!t) return S_OK;
            std::wstring fav;
            if (SUCCEEDED(hr) && stream) {
                std::vector<BYTE> bytes;
                BYTE buf[8192];
                ULONG read = 0;
                while (SUCCEEDED(stream->Read(buf, sizeof buf, &read)) && read > 0) bytes.insert(bytes.end(), buf, buf + read);
                if (!bytes.empty()) fav = L"data:image/png;base64," + Base64(bytes.data(), (DWORD)bytes.size());
            }
            if (fav != t->favicon) {
                t->favicon = fav;
                SendFavicon(t);
            }
            if (!fav.empty() && !t->priv && !IsNewTab(t->url) && g.favicons[SiteOf(t->url)] != fav) {
                g.favicons[SiteOf(t->url)] = fav;
                g.faviconsDirty = true;
            }
            return S_OK;
        }).Get());
}


// The ID an extension folder loads under when its manifest carries the store's key; empty without one.
static std::wstring ExpectedId(const std::wstring& folder) {
    std::string m = ReadFileUtf8(folder + L"\\manifest.json");
    size_t at = m.find("\"key\"");
    if (at == std::string::npos) return L"";
    size_t open = m.find('"', m.find(':', at) + 1), close = m.find('"', open + 1);
    if (open == std::string::npos || close == std::string::npos) return L"";
    std::string b64 = m.substr(open + 1, close - open - 1);
    DWORD n = 0;
    if (!CryptStringToBinaryA(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, nullptr, &n, nullptr, nullptr)) return L"";
    std::string key(n, 0);
    CryptStringToBinaryA(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, (BYTE*)key.data(), &n, nullptr, nullptr);
    return IdOfKey(key);
}

// Which build an extension folder holds: its manifest's version_name (Exo's builds stamp each one to the minute), else
// its version; empty without either.
static std::wstring ManifestVersion(const std::wstring& folder) {
    std::string m = ReadFileUtf8(folder + L"\\manifest.json");
    size_t at = m.find("\"version_name\"");
    if (at == std::string::npos) at = m.find("\"version\"");
    if (at == std::string::npos) return L"";
    size_t open = m.find('"', m.find(':', at) + 1), close = m.find('"', open + 1);
    return open == std::string::npos || close == std::string::npos ? L"" : Wide(m.substr(open + 1, close - open - 1));
}

// A private tab's profile (made again after the last one closed): Edge's Strict tracking prevention, the Appearance, no
// passwords or form data saved, and Exo Shield.
static void ConfigurePrivate(ICoreWebView2* core) {
    ComPtr<ICoreWebView2_13> c13;
    ComPtr<ICoreWebView2Profile> profile;
    if (FAILED(core->QueryInterface(IID_PPV_ARGS(&c13))) || FAILED(c13->get_Profile(&profile))) return;
    if (ComPtr<ICoreWebView2Profile3> p3; SUCCEEDED(profile.As(&p3)))
        p3->put_PreferredTrackingPreventionLevel(COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_STRICT);
    profile->put_PreferredColorScheme(g.theme == L"light" ? COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT : COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK);
    if (ComPtr<ICoreWebView2Profile6> p6; SUCCEEDED(profile.As(&p6))) {
        p6->put_IsPasswordAutosaveEnabled(FALSE);
        p6->put_IsGeneralAutofillEnabled(FALSE);
    }
    ComPtr<ICoreWebView2Profile7> p7;
    if (FAILED(profile.As(&p7))) return;
    p7->GetBrowserExtensions(Callback<ICoreWebView2ProfileGetBrowserExtensionsCompletedHandler>(
        [p7](HRESULT hr, ICoreWebView2BrowserExtensionList* list) -> HRESULT {
            // Already there (Edge's own Clipboard and PDF viewer are listed too, so it's found by its name).
            UINT count = 0;
            if (SUCCEEDED(hr) && list && SUCCEEDED(list->get_Count(&count)))
                for (UINT i = 0; i < count; i++) {
                    ComPtr<ICoreWebView2BrowserExtension> ext;
                    LPWSTR name = nullptr;
                    if (SUCCEEDED(list->GetValueAtIndex(i, &ext)) && SUCCEEDED(ext->get_Name(&name)) && Take(name).rfind(L"Exo Shield", 0) == 0)
                        return S_OK;
                }
            std::wstring folder = BuiltinFolder(L"exo-shield");
            p7->AddBrowserExtension(folder.c_str(), Callback<ICoreWebView2ProfileAddBrowserExtensionCompletedHandler>(
                [](HRESULT hr, ICoreWebView2BrowserExtension*) -> HRESULT {
                    if (SUCCEEDED(hr)) return S_OK;
                    wchar_t line[96];
                    swprintf_s(line, L"private profile: Exo Shield failed 0x%08lx", (unsigned long)hr);
                    LogLine(line);
                    return S_OK;
                }).Get());
            return S_OK;
        }).Get());
}

static void ConfigureProfile(ICoreWebView2* core) {
    if (g.profileReady) return;
    g.profileReady = true;
    ComPtr<ICoreWebView2_13> c13;
    ComPtr<ICoreWebView2Profile> profile;
    if (FAILED(core->QueryInterface(IID_PPV_ARGS(&c13))) || FAILED(c13->get_Profile(&profile))) return;
    // Edge's own tracker lists on top of Exo Shield's, always at Balanced: trackers from sites you haven't
    // visited are blocked and nothing breaks (Strict breaks some sign-ins); Shield's lists block the rest.
    if (ComPtr<ICoreWebView2Profile3> p3; SUCCEEDED(profile.As(&p3)))
        p3->put_PreferredTrackingPreventionLevel(COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_BALANCED);
    profile->put_PreferredColorScheme(g.theme == L"light" ? COREWEBVIEW2_PREFERRED_COLOR_SCHEME_LIGHT
                                                           : COREWEBVIEW2_PREFERRED_COLOR_SCHEME_DARK);
    // Off: passwords belong to Exo Vault, and Edge's own would only compete with it.
    if (ComPtr<ICoreWebView2Profile6> p6; SUCCEEDED(profile.As(&p6))) {
        p6->put_IsPasswordAutosaveEnabled(FALSE);
        p6->put_IsGeneralAutofillEnabled(FALSE);
    }
    ComPtr<ICoreWebView2Profile7> p7;
    if (FAILED(profile.As(&p7))) return;
    // Exo's built-in extensions, loaded from short copies in the data folder. One loaded from anywhere
    // else (an older build's path), and the uBlock Origin Lite that Exo Shield replaced, are removed
    // first; then whatever is missing is added, one at a time (indexing two large rulesets at once
    // failed with "Internal error while parsing rules").
    struct Shipped { const wchar_t* folder; const wchar_t* name; };
    static const Shipped shipped[] = {{L"exo-shield", L"Exo Shield"}};
    p7->GetBrowserExtensions(Callback<ICoreWebView2ProfileGetBrowserExtensionsCompletedHandler>(
        [p7](HRESULT hr, ICoreWebView2BrowserExtensionList* list) -> HRESULT {
            auto stale = std::make_shared<std::vector<ComPtr<ICoreWebView2BrowserExtension>>>();
            auto missing = std::make_shared<std::vector<std::wstring>>();
            auto removedManagers = std::make_shared<std::vector<std::wstring>>();
            std::vector<std::wstring> present;
            UINT count = 0;
            if (SUCCEEDED(hr) && list && SUCCEEDED(list->get_Count(&count))) {
                for (UINT i = 0; i < count; i++) {
                    ComPtr<ICoreWebView2BrowserExtension> ext;
                    LPWSTR id = nullptr, name = nullptr;
                    if (FAILED(list->GetValueAtIndex(i, &ext)) || FAILED(ext->get_Id(&id)) || FAILED(ext->get_Name(&name))) continue;
                    std::wstring sid = Take(id), sname = Take(name);
                    // What Exo Shield replaced (uBlock Origin Lite, TTV LOL PRO) and the dark mode it dropped.
                    // Exo's own earlier copies of what Exo Shield replaced (uBlock Origin Lite, TTV LOL PRO) and of the dark
                    // mode it dropped; one you add from the Chrome Web Store yourself (kept in Extensions) stays.
                    auto from = g_extFolders.find(sid);
                    bool ours = from == g_extFolders.end() || from->second.rfind(g.dataDir + L"\\Builtin\\", 0) == 0;
                    if (ours && (sname == L"uBlock Origin Lite" || sname == L"TTV LOL PRO" || sname == L"Dark Reader")) {
                        stale->push_back(ext);
                        continue;
                    }
                    // A password manager an earlier import brought along (Exo Vault has the passwords now): gone once.
                    // One you add from the Chrome Web Store yourself afterwards stays.
                    if (Setting(L"passwordManagersGone", L"") != L"1" && IsPasswordManager(sid, sname)) {
                        stale->push_back(ext);
                        removedManagers->push_back(sname.substr(0, sname.find(L':')));
                        continue;
                    }
                    for (auto& s : shipped) {
                        if (sname.rfind(s.name, 0) != 0) continue;
                        auto it = g_extFolders.find(sid);
                        std::wstring folder = BuiltinFolder(s.folder), expected = ExpectedId(folder);
                        // A new build (each has its own version) is added again: WebView2 keeps running the service
                        // worker an extension was first added with, whatever its folder says now, so a new Exo Shield
                        // worker (its count for the Bar) never ran until it was removed and added once more.
                        bool current = Setting((std::wstring(L"builtin.") + s.folder).c_str(), L"") == ManifestVersion(folder);
                        if (it != g_extFolders.end() && it->second == g.dataDir + L"\\Builtin\\" + s.folder &&
                            (expected.empty() || expected == sid) && current)
                            present.push_back(s.folder);
                        else stale->push_back(ext);
                    }
                }
            }
            if (SUCCEEDED(hr) && list && Setting(L"passwordManagersGone", L"") != L"1") {
                g.settings[L"passwordManagersGone"] = L"1";
                SaveSettings();
                if (!removedManagers->empty()) {
                    std::wstring names;
                    for (auto& n : *removedManagers) names += (names.empty() ? L"" : L", ") + n;
                    Toast(names + L" was removed: Exo Vault keeps your passwords now");
                }
            }
            for (auto& s : shipped) {
                std::wstring folder = BuiltinFolder(s.folder);
                if (std::find(present.begin(), present.end(), s.folder) == present.end() &&
                    GetFileAttributesW((folder + L"\\manifest.json").c_str()) != INVALID_FILE_ATTRIBUTES)
                    missing->push_back(folder);
            }
            auto next = std::make_shared<std::function<void()>>();
            // Holding itself weakly, and itself only through the callbacks still to come: it goes when the last one
            // ends (holding itself, it leaked on every run, as an appearance change makes).
            std::weak_ptr<std::function<void()>> weak = next;
            *next = [p7, stale, missing, weak] {
                auto next = weak.lock();
                if (!next) return;
                if (!stale->empty()) {
                    auto ext = stale->back();
                    stale->pop_back();
                    ext->Remove(Callback<ICoreWebView2BrowserExtensionRemoveCompletedHandler>(
                        [next](HRESULT) -> HRESULT { (*next)(); return S_OK; }).Get());
                    return;
                }
                if (missing->empty()) {
                    SendExtensions();
                    return;
                }
                std::wstring folder = missing->front();
                missing->erase(missing->begin());
                p7->AddBrowserExtension(folder.c_str(), Callback<ICoreWebView2ProfileAddBrowserExtensionCompletedHandler>(
                    [folder, next](HRESULT hr, ICoreWebView2BrowserExtension* ext) -> HRESULT {
                        if (SUCCEEDED(hr) && ext) {
                            LPWSTR id = nullptr;
                            ext->get_Id(&id);
                            g_extFolders[Take(id)] = folder;
                            SaveExtFolders();
                            g.settings[L"builtin." + folder.substr(folder.find_last_of(L'\\') + 1)] = ManifestVersion(folder);
                            SaveSettings();
                        } else {
                            wchar_t code[16];
                            swprintf_s(code, L"0x%08X", (unsigned)hr);
                            Toast(folder.substr(folder.find_last_of(L'\\') + 1) + L" could not load (" + code + L")");
                        }
                        (*next)();
                        return S_OK;
                    }).Get());
            };
            (*next)();
            return S_OK;
        }).Get());
}

static void ApplyFind(Tab* t);
static void ServeApi(ICoreWebView2WebResourceRequestedEventArgs* a);
static void TrackDownload(ICoreWebView2DownloadStartingEventArgs* a, int tabId);
static void DownloadTick();
// Split view: `tab` joins the split of `with`, beside its last pane (at most 4), and comes on screen with it.
static void JoinSplit(int withId, int tabId) {
    Tab *a2 = FindTab(withId), *t = FindTab(tabId);
    if (!a2 || a2->peek) return;
    if (!a2->split) a2->split = g.nextSplit++;
    int group = a2->split;
    if (t && t != a2 && !t->peek && std::count_if(g.tabs.begin(), g.tabs.end(), [group](auto& x) { return x->split == group; }) < 4) {
        if (t->split && t->split != group)
            if (int old = t->split; std::count_if(g.tabs.begin(), g.tabs.end(), [old](auto& x) { return x->split == old; }) <= 2)
                for (auto& x : g.tabs) if (x->split == old) x->split = 0;
        t->split = group;
        t->space = a2->space ? a2->space : g.space;
        // Beside the last pane, so the split reads left to right as it shows.
        size_t from = IndexOf(t->id), after = IndexOf(a2->id);
        for (size_t j = 0; j < g.tabs.size(); j++) if (g.tabs[j]->split == group && j != from) after = j;
        auto up = std::move(g.tabs[from]);
        g.tabs.erase(g.tabs.begin() + from);
        if (from < after) after--;
        g.tabs.insert(g.tabs.begin() + std::min(after + 1, g.tabs.size()), std::move(up));
        g.activeId = t->id;
    }
    if (std::count_if(g.tabs.begin(), g.tabs.end(), [group](auto& x) { return x->split == group; }) < 2) a2->split = 0;
    ShowActive();
    if (Tab* now = Active(); now && now->ctl) FocusTarget(now->id);
}

// A tab that hasn't drawn its page (asleep: closed for memory or frozen, its view never shown) joins once it has: a view
// out of sight draws nothing, so shown at once it was the window's black beside the page for a quarter of a second.
// It's drawn first, out of sight at the page's size, and the split opens as it has its page (1.5 s at most). Moved on
// to another tab by then, it doesn't.
static const UINT kTimerSplit = 16;
static struct { int with = 0, tab = 0; ULONGLONG since = 0, drawing = 0; } g_pendingSplit;
static void FinishPendingSplit() {
    KillTimer(g.hwnd, kTimerSplit);
    auto pending = g_pendingSplit;
    g_pendingSplit = {};
    if (pending.with && pending.with == g.activeId) JoinSplit(pending.with, pending.tab);
}
static void TickPendingSplit() {
    Tab* t = FindTab(g_pendingSplit.tab);
    ULONGLONG now = GetTickCount64();
    if (!t || g_pendingSplit.with != g.activeId) { KillTimer(g.hwnd, kTimerSplit); g_pendingSplit = {}; return; }
    if (now - g_pendingSplit.since > 1500) { FinishPendingSplit(); return; }
    if (!t->ctl || t->creating) return;
    if (!g_pendingSplit.drawing) {
        // At the size it will have: the last pane of the split it joins.
        size_t n = Panes().size() + 1;
        t->ctl->put_Bounds(PaneRectAt(n - 1, n));
        t->ctl->put_IsVisible(TRUE);  // drawing (a frozen page wakes), its visual not yet in the window
        g_pendingSplit.drawing = now;
        return;
    }
    if (!t->loading && now - g_pendingSplit.drawing >= 150) FinishPendingSplit();
}
static void WakeForSplit(Tab* with, Tab* t) {
    g_pendingSplit = {with->id, t->id, GetTickCount64(), 0};
    SetTimer(g.hwnd, kTimerSplit, 30, nullptr);
    EnsureView(t, nullptr);
}

static void OnUiMessage(const std::wstring& msg);
static void InstallStoreExtension(const std::wstring& id);
extern const wchar_t kStoreScriptRef[];

// ---------------------------------------------------------------------------------------
// Boosts (Settings > Boosts): a site your way. "boosts" holds, per site (its subdomains too), the things Zap took off
// its pages and a style of your own, as JSON the chrome page edits. Every tab runs it as a script before a page's own,
// so a boosted page paints boosted, and a change reaches the pages already open at once.

static unsigned g_boostGen = 0;  // the boosts' version: a script added for an older one is taken off again

// A boost on a page: a constructed style sheet (no page's Content Security Policy refuses one), made once and changed
// in place. `b` is the site's boost, or null.
static const wchar_t kBoostApply[] = LR"js(
  const css = b && b.on !== false ? (b.zap || []).map(z => z + ' { display: none !important; }').join('\n') + '\n' + (b.css || '') : '';
  let sheet = document.__exoBoost;
  if (!sheet) {
    if (!css.trim()) return;
    sheet = new CSSStyleSheet();
    Object.defineProperty(document, '__exoBoost', { value: sheet });
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(css);
})())js";

// Every page's script, run before the page's own (so no page sees the others' boosts): the most specific site that
// matches wins (news.example.com's own over example.com's).
static std::wstring BoostScript() {
    return L"(() => { if (window.top !== window) return; const all = " + Setting(L"boosts", L"{}") + LR"js(;
  const site = location.hostname.replace(/^www\./, '');
  const key = Object.keys(all).filter(k => site === k || site.endsWith('.' + k)).sort((x, y) => y.length - x.length)[0];
  const b = key ? all[key] : null;)js" + std::wstring(kBoostApply);
}

// The boost of a page already running, read here from "boosts" (its JSON, as the chrome page wrote it): only that
// site's goes into the page, never the rest. The most specific matching site wins; "null" when none does.
static std::wstring BoostFor(const std::wstring& site) {
    std::wstring all = Setting(L"boosts", L"{}"), best, found = L"null";
    size_t i = all.find(L'{');
    if (i == std::wstring::npos || site.empty()) return found;
    i++;
    auto space = [&] { while (i < all.size() && iswspace(all[i])) i++; };
    // A JSON string at i, decoded into `out` (when given); i ends after its closing quote.
    auto text = [&](std::wstring* out) {
        if (i >= all.size() || all[i] != L'"') return false;
        for (i++; i < all.size(); i++) {
            wchar_t c = all[i];
            if (c == L'"') { i++; return true; }
            if (c == L'\\' && i + 1 < all.size()) {
                wchar_t e = all[++i];
                if (e == L'u') {
                    if (out && i + 4 < all.size()) *out += (wchar_t)wcstol(all.substr(i + 1, 4).c_str(), nullptr, 16);
                    i += 4;
                } else if (out) *out += e == L'n' ? L'\n' : e == L't' ? L'\t' : e == L'r' ? L'\r' : e;
            } else if (out) *out += c;
        }
        return false;
    };
    // A JSON value at i, as it's written; i ends after it.
    auto value = [&] {
        size_t start = i;
        int depth = 0;
        while (i < all.size()) {
            wchar_t c = all[i];
            if (c == L'"') { text(nullptr); continue; }
            if (c == L'{' || c == L'[') depth++;
            else if (c == L'}' || c == L']') { if (depth-- == 0) break; if (depth == 0) { i++; break; } }
            else if (c == L',' && depth == 0) break;
            i++;
        }
        return all.substr(start, i - start);
    };
    for (;;) {
        space();
        std::wstring key;
        if (!text(&key)) break;
        space();
        if (i >= all.size() || all[i] != L':') break;
        i++;
        space();
        std::wstring v = value();
        bool match = site == key || (site.size() > key.size() && site.compare(site.size() - key.size() - 1, std::wstring::npos, L"." + key) == 0);
        if (match && key.size() > best.size()) { best = key; found = v; }
        space();
        if (i < all.size() && all[i] == L',') i++;
        else break;
    }
    return found;
}

// A tab's Boosts script, made again from the newest boosts (and run on the page it shows now when `now`).
static void InstallBoost(Tab* t, bool now) {
    if (!t || !t->core) return;
    if (!t->boostScript.empty()) {
        t->core->RemoveScriptToExecuteOnDocumentCreated(t->boostScript.c_str());
        t->boostScript.clear();
    }
    std::wstring script = BoostScript();
    if (now) t->core->ExecuteScript((L"(() => { if (window.top !== window) return; const b = " + BoostFor(SiteOf(t->url)) + L";" + kBoostApply).c_str(), nullptr);
    if (Setting(L"boosts", L"{}") == L"{}") return;
    int id = t->id;
    unsigned gen = g_boostGen;
    t->core->AddScriptToExecuteOnDocumentCreated(script.c_str(), Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
        [id, gen](HRESULT hr, LPCWSTR scriptId) -> HRESULT {
            Tab* t = FindTab(id);
            if (FAILED(hr) || !scriptId || !t || !t->core) return S_OK;
            if (gen != g_boostGen) t->core->RemoveScriptToExecuteOnDocumentCreated(scriptId);
            else t->boostScript = scriptId;
            return S_OK;
        }).Get());
}

static void ApplyBoosts() {
    g_boostGen++;
    for (auto& t : g.tabs) InstallBoost(t.get(), true);
}

// Zap: the page on screen marks what's under the pointer; a click takes it off the site for good (the chrome page adds
// it to the site's boost), Esc or Done ends it. A click there reaches nothing on the page.
static int g_zapId = 0;
static int g_zapsThisRun = 0;
static ULONGLONG g_zapAt = 0;
static const wchar_t kZapScript[] = LR"js((() => {
  if (window.__exoZap) return;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border:2px solid #ff453a;background:rgba(255,69,58,.14);border-radius:6px;display:none';
  document.documentElement.appendChild(box);
  let target = null;
  const ok = c => /^[a-zA-Z_][\w-]*$/.test(c) && !/\d{4,}/.test(c) && !/^(is|has)-|active|hover|focus|open|selected|visible/.test(c);
  // The element as a selector that finds it alone: an id, else its tag and steady classes (its place among its kind
  // where it has siblings), up its parents until one alone matches.
  const selectorOf = el => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement && e !== document.body; e = e.parentElement) {
      let p;
      if (e.id && ok(e.id)) p = '#' + CSS.escape(e.id);
      else {
        p = e.localName;
        const cls = [...e.classList].filter(ok).slice(0, 3);
        if (cls.length) p += '.' + cls.map(c => CSS.escape(c)).join('.');
        const kin = e.parentElement ? [...e.parentElement.children].filter(x => x.localName === e.localName) : [];
        if (kin.length > 1) p += ':nth-of-type(' + (kin.indexOf(e) + 1) + ')';
      }
      parts.unshift(p);
      const sel = parts.join(' > ');
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (_) { }
    }
    return parts.join(' > ');
  };
  const move = e => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box || el === document.documentElement || el === document.body) { box.style.display = 'none'; target = null; return; }
    target = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  const eat = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const click = e => {
    eat(e);
    if (e.button === 0 && target) { chrome.webview.postMessage('exo-zap\t' + selectorOf(target)); box.style.display = 'none'; target = null; }
  };
  const key = e => { if (e.key === 'Escape') { eat(e); chrome.webview.postMessage('exo-zap-end'); } };
  const kinds = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'contextmenu', 'dblclick'];
  const stop = () => {
    removeEventListener('mousemove', move, true);
    for (const k of kinds) removeEventListener(k, eat, true);
    removeEventListener('click', click, true);
    removeEventListener('keydown', key, true);
    box.remove();
    document.documentElement.style.removeProperty('cursor');
    window.__exoZap = null;
  };
  addEventListener('mousemove', move, true);
  for (const k of kinds) addEventListener(k, eat, true);
  addEventListener('click', click, true);
  addEventListener('keydown', key, true);
  document.documentElement.style.cursor = 'crosshair';
  window.__exoZap = stop;
})())js";

static void EndZap() {
    if (!g_zapId) return;
    if (Tab* t = FindTab(g_zapId); t && t->core) t->core->ExecuteScript(L"window.__exoZap && window.__exoZap()", nullptr);
    g_zapId = 0;
    UiPost(L"{\"t\":\"zapping\",\"on\":false}");
}

static void FocusTarget(int target);
static void StartZap(Tab* t) {
    if (!t || !t->core || (t->url.rfind(L"https://", 0) != 0 && t->url.rfind(L"http://", 0) != 0)) return;
    EndZap();
    if (t->id != g.activeId) Activate(t->id);
    g_zapId = t->id;
    g_zapsThisRun = 0;
    t->core->ExecuteScript(kZapScript, nullptr);
    UiPost(L"{\"t\":\"zapping\",\"on\":true,\"site\":" + Json(SiteOf(t->url)) + L"}");
    FocusTarget(t->id);
}

// A page's right-click menu, drawn by the chrome page (ui pageMenu.ts) as Exo's own menu: the engine drew Windows'
// menu in Segoe UI with Fluent's icons over every page. The engine's items go to the chrome page as they are, with
// Open link in Peek after its Open link in new window (a tab here) on a link; the request waits (a deferral) until
// a row is picked, by the engine's own command id, so the engine still does the work, or the menu goes with nothing
// picked (-1). Before the chrome page is up the engine draws its own.
struct PageMenu {
    int tab = 0;
    ComPtr<ICoreWebView2ContextMenuRequestedEventArgs> args;
    ComPtr<ICoreWebView2Deferral> deferral;
    std::wstring link;  // for Open link in Peek (-2)
};
static PageMenu g_pageMenu;

static void EndPageMenu(INT32 command) {
    PageMenu m = std::move(g_pageMenu);
    g_pageMenu = {};
    if (!m.deferral) return;
    if (command == -2 && !m.link.empty()) OpenPeek(m.link);
    else if (command == -3 && !m.link.empty()) {
        std::wstring clean = CleanUrl(m.link);
        if (CopyText(clean) && clean != m.link) Toast(L"Link copied without its trackers");
    } else if (command >= 0) m.args->put_SelectedCommandId(command);
    m.deferral->Complete();
}

static std::wstring PageMenuJson(ICoreWebView2ContextMenuItemCollection* items, int depth, const std::wstring& link) {
    std::wstring out = L"[";
    UINT32 count = 0;
    items->get_Count(&count);
    for (UINT32 i = 0; i < count; i++) {
        ComPtr<ICoreWebView2ContextMenuItem> it;
        if (FAILED(items->GetValueAtIndex(i, &it))) continue;
        LPWSTR name = nullptr, label = nullptr, keys = nullptr;
        it->get_Name(&name);
        it->get_Label(&label);
        it->get_ShortcutKeyDescription(&keys);
        std::wstring n = Take(name);
        COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND;
        BOOL on = TRUE, checked = FALSE;
        INT32 command = -1;
        it->get_Kind(&kind);
        it->get_IsEnabled(&on);
        it->get_IsChecked(&checked);
        it->get_CommandId(&command);
        std::wstring children;
        if (kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SUBMENU && depth < 2) {
            ComPtr<ICoreWebView2ContextMenuItemCollection> inner;
            if (SUCCEEDED(it->get_Children(&inner)) && inner) children = L",\"items\":" + PageMenuJson(inner.Get(), depth + 1, L"");
        }
        if (out.size() > 1) out += L",";
        // Copy link copies it without its trackers (-3), as everywhere else.
        if (!link.empty() && n == L"copyLinkLocation") command = -3;
        out += L"{\"name\":" + Json(n) + L",\"label\":" + Json(Take(label)) + L",\"kind\":" + std::to_wstring((int)kind) +
               L",\"on\":" + Bool(on) + L",\"checked\":" + Bool(checked) + L",\"id\":" + std::to_wstring(command) +
               L",\"keys\":" + Json(Take(keys)) + children + L"}";
        if (!link.empty() && (n == L"openLinkInNewTab" || n == L"openLinkInNewWindow"))
            out += L",{\"name\":\"openLinkInPeek\",\"label\":\"Open link in Peek\",\"kind\":0,\"on\":true,\"checked\":false,\"id\":-2,\"keys\":\"\"}";
    }
    return out + L"]";
}

static void OpenPageMenu(Tab* t, ICoreWebView2ContextMenuRequestedEventArgs* a) {
    if (!t || !g.uiReady) return;
    EndPageMenu(-1);  // one still open on another page
    ComPtr<ICoreWebView2ContextMenuItemCollection> items;
    POINT at{};
    if (FAILED(a->get_MenuItems(&items)) || !items || FAILED(a->get_Location(&at))) return;
    std::wstring link;
    ComPtr<ICoreWebView2ContextMenuTarget> target;
    BOOL hasLink = FALSE;
    if (SUCCEEDED(a->get_ContextMenuTarget(&target)) && SUCCEEDED(target->get_HasLinkUri(&hasLink)) && hasLink) {
        LPWSTR raw = nullptr;
        target->get_LinkUri(&raw);
        link = Take(raw);
        if (link.rfind(L"http://", 0) != 0 && link.rfind(L"https://", 0) != 0) link.clear();
    }
    if (FAILED(a->GetDeferral(&g_pageMenu.deferral))) return;
    a->put_Handled(TRUE);
    g_pageMenu.tab = t->id;
    g_pageMenu.args = a;
    g_pageMenu.link = link;
    // Where it was asked for, in the chrome page's pixels: the engine's point is in the view's own (window) pixels.
    RECT pane = t->peek ? g.peekRect : PaneRect(t);
    float k = Scale();
    UiPost(L"{\"t\":\"pageMenu\",\"x\":" + std::to_wstring((pane.left + at.x) / k) + L",\"y\":" + std::to_wstring((pane.top + at.y) / k) +
           L",\"items\":" + PageMenuJson(items.Get(), 0, t->peek ? L"" : link) + L"}");
}

// A new tab page's color until it draws: its own background (var(--color-bg) in the Appearance's theme), so it doesn't
// open black in Light.
static COREWEBVIEW2_COLOR NewTabColor() {
    return g.theme == L"light" ? COREWEBVIEW2_COLOR{255, 245, 245, 245} : g.theme == L"dark" ? COREWEBVIEW2_COLOR{255, 18, 18, 18}
                               : COREWEBVIEW2_COLOR{255, 0, 0, 0};
}

static void SetupTab(Tab* t, ICoreWebView2CompositionController* comp) {
    int id = t->id;
    t->comp = comp;
    comp->QueryInterface(IID_PPV_ARGS(&t->ctl));
    t->ctl->get_CoreWebView2(&t->core);
    if (t->muted)
        if (ComPtr<ICoreWebView2_8> c8; SUCCEEDED(t->core.As(&c8))) c8->put_IsMuted(TRUE);
    t->visual = g.compositor.CreateContainerVisual();
    t->visual.Size({(float)(g.contentRect.right - g.contentRect.left), (float)(g.contentRect.bottom - g.contentRect.top)});
    comp->put_RootVisualTarget(static_cast<::IUnknown*>(winrt::get_unknown(t->visual)));

    if (ComPtr<ICoreWebView2Controller2> c2; SUCCEEDED(t->ctl.As(&c2)))
        c2->put_DefaultBackgroundColor(t->pendingNav.empty() || IsNewTab(t->pendingNav) ? NewTabColor() : COREWEBVIEW2_COLOR{255, 255, 255, 255});
    ComPtr<ICoreWebView2Settings> s;
    t->core->get_Settings(&s);
    // The address of the link under the pointer shows in Exo's own capsule at the page's foot (ui Status.tsx), not
    // the engine's white Segoe UI bubble: its words go to the chrome page with the place of the tab they belong to.
    bool ownStatus = false;
    if (ComPtr<ICoreWebView2_12> c12; SUCCEEDED(t->core.As(&c12))) {
        EventRegistrationToken status;
        ownStatus = SUCCEEDED(c12->add_StatusBarTextChanged(Callback<ICoreWebView2StatusBarTextChangedEventHandler>(
            [id](ICoreWebView2* core, IUnknown*) -> HRESULT {
                Tab* t = FindTab(id);
                ComPtr<ICoreWebView2_12> w12;
                LPWSTR text = nullptr;
                if (!t || FAILED(core->QueryInterface(IID_PPV_ARGS(&w12))) || FAILED(w12->get_StatusBarText(&text))) return S_OK;
                std::wstring words = Take(text);
                if (!Shown(t) && t->id != g.peekId) words.clear();
                RECT r = t->id == g.peekId ? g.peekRect : PaneRect(t);
                float k = Scale();
                UiPost(L"{\"t\":\"status\",\"tab\":" + std::to_wstring(id) + L",\"text\":" + Json(words.substr(0, 2048)) +
                       L",\"x\":" + std::to_wstring(r.left / k) + L",\"y\":" + std::to_wstring(r.bottom / k) +
                       L",\"w\":" + std::to_wstring((r.right - r.left) / k) + L"}");
                return S_OK;
            }).Get(), &status));
    }
    s->put_IsStatusBarEnabled(ownStatus ? FALSE : TRUE);
    s->put_IsZoomControlEnabled(TRUE);
    if (ComPtr<ICoreWebView2Settings8> s8; SUCCEEDED(s.As(&s8))) s8->put_IsReputationCheckingRequired(FALSE);
    if (ComPtr<ICoreWebView2_9> c9; SUCCEEDED(t->core.As(&c9))) {
        // WebView2's own download bubble stays shut: the Bar's ring and Settings > Downloads show downloads.
        EventRegistrationToken dialog;
        c9->add_IsDefaultDownloadDialogOpenChanged(Callback<ICoreWebView2IsDefaultDownloadDialogOpenChangedEventHandler>(
            [](ICoreWebView2* core, IUnknown*) -> HRESULT {
                ComPtr<ICoreWebView2_9> w9;
                BOOL open = FALSE;
                if (SUCCEEDED(core->QueryInterface(IID_PPV_ARGS(&w9))) && SUCCEEDED(w9->get_IsDefaultDownloadDialogOpen(&open)) && open)
                    w9->CloseDefaultDownloadDialog();
                return S_OK;
            }).Get(), &dialog);
    }
    if (t->priv) ConfigurePrivate(t->core.Get());
    else ConfigureProfile(t->core.Get());

    EventRegistrationToken tok;
    // The new tab page: ui/ served at newtab.exo to top-level navigations only, its data at
    // api.newtab.exo (readable by that origin alone), its requests accepted from that origin alone.
    if (ComPtr<ICoreWebView2_3> c3; SUCCEEDED(t->core.As(&c3)))
        c3->SetVirtualHostNameToFolderMapping(kNewTabHost, (g.exeDir + L"\\ui").c_str(),
                                              COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY);
    t->core->AddWebResourceRequestedFilter(L"https://api.newtab.exo/*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
    t->core->add_WebResourceRequested(Callback<ICoreWebView2WebResourceRequestedEventHandler>(
        [](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* a) -> HRESULT { ServeApi(a); return S_OK; }).Get(), &tok);
    t->core->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
        [id](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* a) -> HRESULT {
            LPWSTR source = nullptr, m = nullptr;
            a->get_Source(&source);
            std::wstring from = Take(source);
            if (FAILED(a->TryGetWebMessageAsString(&m))) return S_OK;
            std::wstring msg = Take(m);
            if (IsNewTab(from)) OnNewTabMessage(id, msg);
            else if (from.rfind(L"https://chromewebstore.google.com/", 0) == 0 && msg.rfind(L"exo-install\t", 0) == 0)
                InstallStoreExtension(msg.substr(12));
            else if (msg.rfind(L"exo-edge\t", 0) == 0) {
                if (Tab* t = FindTab(id); t && !t->peek) {
                    bool was = t->id == g.activeId && UnderBar();
                    t->under = msg.size() > 9 && msg[9] == L'1';
                    if (t->id == g.activeId) SlideUnder(was, msg.size() > 10 && msg[10] == L't');
                }
            }
            else if (msg.rfind(L"exo-vault\t", 0) == 0 && (from.rfind(L"https://", 0) == 0 || from.rfind(L"http://", 0) == 0))
                OnVaultPage(FindTab(id), from, msg.substr(10));
            else if (msg.rfind(L"exo-zap\t", 0) == 0 && id == g_zapId && msg.size() < 520 && msg.find_first_of(L"{};<", 8) == std::wstring::npos &&
                     GetTickCount64() - g_zapAt > 150 && g_zapsThisRun < 50) {
                // What the page says it is goes no further than that page's own boost.
                g_zapAt = GetTickCount64();
                g_zapsThisRun++;
                UiPost(L"{\"t\":\"zap\",\"site\":" + Json(SiteOf(from)) + L",\"sel\":" + Json(msg.substr(8)) + L"}");
            }
            else if (msg == L"exo-zap-end" && id == g_zapId)
                EndZap();
            else if (msg.rfind(L"exo-shield\t", 0) == 0 && msg.size() > 11 && msg.size() <= 17 &&
                     std::all_of(msg.begin() + 11, msg.end(), iswdigit)) {
                // Exo Shield's count for the page in this tab (exo-count.js). A page could send its own; it would
                // only ever change the number shown for itself.
                if (Tab* t = FindTab(id); t && t->blocked != _wtoi(msg.c_str() + 11)) {
                    t->blocked = _wtoi(msg.c_str() + 11);
                    QueueState();
                }
            }
            return S_OK;
        }).Get(), &tok);
    t->core->AddScriptToExecuteOnDocumentCreated(kStoreScriptRef, nullptr);
    InstallBoost(t, false);
    // Whether the page may run up under the Bar (ui/edge-page.js).
    static const std::wstring edgeScript = Wide(ReadFileUtf8(g.exeDir + L"\\ui\\edge-page.js"));
    if (!edgeScript.empty()) t->core->AddScriptToExecuteOnDocumentCreated(edgeScript.c_str(), nullptr);
    // Exo Vault's eyes on sign-in forms (ui/vault-page.js).
    static const std::wstring vaultScript = Wide(ReadFileUtf8(g.exeDir + L"\\ui\\vault-page.js"));
    if (!vaultScript.empty()) t->core->AddScriptToExecuteOnDocumentCreated(vaultScript.c_str(), nullptr);
    if (ComPtr<ICoreWebView2_4> c4; SUCCEEDED(t->core.As(&c4)))
        c4->add_DownloadStarting(Callback<ICoreWebView2DownloadStartingEventHandler>(
            [id](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* a) -> HRESULT { TrackDownload(a, id); return S_OK; }).Get(), &tok);
    t->core->add_SourceChanged(Callback<ICoreWebView2SourceChangedEventHandler>(
        [id](ICoreWebView2* core, ICoreWebView2SourceChangedEventArgs* a) -> HRESULT {
            if (Tab* t = FindTab(id)) {
                LPWSTR u = nullptr;
                core->get_Source(&u);
                t->url = Take(u);
                // A new document: the last page's count, even one that came in after its navigation began, goes.
                BOOL fresh = FALSE;
                if (a && SUCCEEDED(a->get_IsNewDocument(&fresh)) && fresh) t->blocked = 0;
                if (t->url.rfind(L"chrome-search://", 0) == 0 || t->url.rfind(L"edge://newtab", 0) == 0) {
                    core->Navigate(kNewTab);
                    return S_OK;
                }
                MarkSessionDirty();
                QueueState();
                if (id == g.activeId) FollowNewTab();
            }
            return S_OK;
        }).Get(), &tok);
    t->core->add_DocumentTitleChanged(Callback<ICoreWebView2DocumentTitleChangedEventHandler>(
        [id](ICoreWebView2* core, IUnknown*) -> HRESULT {
            if (Tab* t = FindTab(id)) {
                LPWSTR title = nullptr;
                core->get_DocumentTitle(&title);
                std::wstring now = Take(title);
                if (now == t->title) return S_OK;
                t->title = now;
                // A private tab's title never reaches history. And a title alone doesn't save the session: a page that
                // retitles itself (an unread count) rewrote it every 1.5 s; the next real change, or the close, keeps it.
                if (auto it = g.history.find(t->url); !t->priv && it != g.history.end() && !t->title.empty() && it->second.title != t->title) {
                    it->second.title = t->title;
                    g.historyDirty = true;
                }
                QueueState();
            }
            return S_OK;
        }).Get(), &tok);
    t->core->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
        [id](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* a) -> HRESULT {
            if (Tab* t = FindTab(id)) {
                LPWSTR u = nullptr;
                a->get_Uri(&u);
                std::wstring url = Take(u);
                if (IsShieldPage(url)) {
                    a->put_Cancel(TRUE);
                    return S_OK;
                }
                if (CleanNavigation(t->core.Get(), a, url, t->cleanedFrom, t->cleanedAt)) return S_OK;
                // A new page counts its own (Chromium starts the tab's count again as it commits).
                if (t->blocked) { t->blocked = 0; QueueState(); }
                BOOL user = FALSE, redirected = FALSE;
                a->get_IsUserInitiated(&user);
                a->get_IsRedirected(&redirected);
                if (id == g_zapId) EndZap();
                // A pinned tab's own page that redirects (a site's / to /en-US/, by the server or by its script within
                // a few seconds and nobody's click) makes the redirect its page.
                bool follows = redirected || (!user && GetTickCount64() - t->navAt < 5000 && SiteOf(url) == SiteOf(t->navFrom));
                if (follows && t->pinned && !t->home.empty() && t->navFrom == t->home) { t->home = url; MarkSessionDirty(); QueueState(); }
                if (!follows) t->navAt = GetTickCount64();
                t->navFrom = url;
                if (!redirected && t->under) {
                    bool was = t->id == g.activeId && UnderBar();
                    t->under = false;
                    if (t->id == g.activeId && was) Layout();
                }
                t->loading = true;
                a->get_NavigationId(&t->navId);
                if (ComPtr<ICoreWebView2Controller2> c2; SUCCEEDED(t->ctl.As(&c2)))
                    c2->put_DefaultBackgroundColor(IsNewTab(url) ? NewTabColor() : COREWEBVIEW2_COLOR{255, 255, 255, 255});
                QueueState();
            }
            return S_OK;
        }).Get(), &tok);
    t->core->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>(
        [id](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* a) -> HRESULT {
            if (Tab* t = FindTab(id)) {
                UINT64 nav = 0;
                a->get_NavigationId(&nav);
                if (nav != t->navId) return S_OK;
                t->loading = false;
                BOOL ok = FALSE;
                a->get_IsSuccess(&ok);
                if (ok) RecordVisit(t);
                std::wstring site = SiteOf(t->url);
                if (ok && !t->priv && t->url.rfind(L"https://", 0) == 0 && !IsNewTab(t->url) && !g_icons.count(site) && !g_iconTried.count(site + L"#page"))
                    t->core->ExecuteScript(kIconScript, Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                        [site](HRESULT hr, LPCWSTR result) -> HRESULT {
                            std::wstring href = SUCCEEDED(hr) && result ? result : L"";
                            if (href.size() >= 2 && href.front() == L'"') href = href.substr(1, href.size() - 2);
                            if (href.find(L'\\') != std::wstring::npos) href.clear();
                            FetchIcon(site, href);
                            return S_OK;
                        }).Get());
                QueueState();
            }
            return S_OK;
        }).Get(), &tok);
    t->core->add_HistoryChanged(Callback<ICoreWebView2HistoryChangedEventHandler>(
        [](ICoreWebView2*, IUnknown*) -> HRESULT { QueueState(); return S_OK; }).Get(), &tok);
    if (ComPtr<ICoreWebView2_15> c15; SUCCEEDED(t->core.As(&c15)))
        c15->add_FaviconChanged(Callback<ICoreWebView2FaviconChangedEventHandler>(
            [id](ICoreWebView2*, IUnknown*) -> HRESULT { RefreshFavicon(id); return S_OK; }).Get(), &tok);
    if (ComPtr<ICoreWebView2_8> c8; SUCCEEDED(t->core.As(&c8)))
        c8->add_IsDocumentPlayingAudioChanged(Callback<ICoreWebView2IsDocumentPlayingAudioChangedEventHandler>(
            [id](ICoreWebView2* core, IUnknown*) -> HRESULT {
                Tab* t = FindTab(id);
                ComPtr<ICoreWebView2_8> c8;
                if (t && SUCCEEDED(core->QueryInterface(IID_PPV_ARGS(&c8)))) {
                    BOOL playing = FALSE;
                    c8->get_IsDocumentPlayingAudio(&playing);
                    t->audible = playing;
                    QueueState();
                }
                return S_OK;
            }).Get(), &tok);
    t->core->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
        [id](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* a) -> HRESULT {
            ComPtr<ICoreWebView2NewWindowRequestedEventArgs> args = a;
            ComPtr<ICoreWebView2Deferral> deferral;
            a->GetDeferral(&deferral);
            LPWSTR u = nullptr;
            a->get_Uri(&u);
            // Ctrl+click and middle click open behind, as every browser does.
            bool background = GetKeyState(VK_CONTROL) < 0 || GetKeyState(VK_MBUTTON) < 0 || GetTickCount64() - g_middleUpAt < 500;
            // Shift+click: Peek (meeting links get their tab). A plain click opens as it always does; Peek is also on
            // the page's right-click menu.
            std::wstring want = u ? u : L"";
            Tab* from = FindTab(id);
            BOOL user = FALSE;
            a->get_IsUserInitiated(&user);
            if (!background && user && !IsMeeting(want) && (want.rfind(L"http", 0) == 0) && from && !from->peek &&
                GetKeyState(VK_SHIFT) < 0) {
                CoTaskMemFree(u);
                a->put_Handled(TRUE);
                deferral->Complete();
                OpenPeek(want);
                return S_OK;
            }
            auto t = std::make_unique<Tab>();
            t->id = g.nextId++;
            t->url = Take(u);
            t->lastActive = GetTickCount64();
            t->seen = _time64(nullptr);  // never seen, the archive took it within 30 s
            Tab* opener = FindTab(id);
            t->space = opener ? opener->space : g.space;
            t->priv = opener && opener->priv;
            Tab* raw = t.get();
            g.tabs.insert(g.tabs.begin() + std::min(IndexOf(id) + 1, g.tabs.size()), std::move(t));
            Order();
            EnsureView(raw, [args, deferral, background](Tab* nt) {
                args->put_NewWindow(nt->core.Get());
                args->put_Handled(TRUE);
                deferral->Complete();
                if (!background) Activate(nt->id);
            });
            QueueState();
            return S_OK;
        }).Get(), &tok);
    // The page's right-click menu: drawn by the chrome page as Exo's own menu (OpenPageMenu, above).
    if (ComPtr<ICoreWebView2_11> c11; SUCCEEDED(t->core.As(&c11)))
        c11->add_ContextMenuRequested(Callback<ICoreWebView2ContextMenuRequestedEventHandler>(
            [id](ICoreWebView2*, ICoreWebView2ContextMenuRequestedEventArgs* a) -> HRESULT {
                OpenPageMenu(FindTab(id), a);
                return S_OK;
            }).Get(), &tok);
    t->core->add_WindowCloseRequested(Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
        [id](ICoreWebView2*, IUnknown*) -> HRESULT {
            PostMessageW(g.hwnd, WM_COMMAND, MAKEWPARAM(1, 0), (LPARAM)id);
            return S_OK;
        }).Get(), &tok);
    t->core->add_ContainsFullScreenElementChanged(Callback<ICoreWebView2ContainsFullScreenElementChangedEventHandler>(
        [id](ICoreWebView2* core, IUnknown*) -> HRESULT {
            BOOL full = FALSE;
            core->get_ContainsFullScreenElement(&full);
            if (id == g.activeId) {
                g.elementFullscreen = full;
                SetFullscreen(full);
            }
            return S_OK;
        }).Get(), &tok);
    t->core->add_ProcessFailed(Callback<ICoreWebView2ProcessFailedEventHandler>(
        [id](ICoreWebView2* core, ICoreWebView2ProcessFailedEventArgs* a) -> HRESULT {
            COREWEBVIEW2_PROCESS_FAILED_KIND kind;
            a->get_ProcessFailedKind(&kind);
            if (kind != COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED) return S_OK;
            // Off screen (one shared process can take several tabs down), it loads again when it's shown, not all at once now.
            if (Tab* t = FindTab(id); t && !Shown(t) && !t->peek) { t->crashed = true; return S_OK; }
            // At most three reloads a minute: a page that crashes as it loads would loop.
            static std::unordered_map<int, std::pair<int, ULONGLONG>> crashes;
            auto& [count, since] = crashes[id];
            ULONGLONG now = GetTickCount64();
            if (now - since > 60000) { count = 0; since = now; }
            if (++count <= 3) core->Reload();
            return S_OK;
        }).Get(), &tok);
    comp->add_CursorChanged(Callback<ICoreWebView2CursorChangedEventHandler>(
        [id](ICoreWebView2CompositionController* c, IUnknown*) -> HRESULT {
            if (Tab* t = FindTab(id)) {
                c->get_Cursor(&t->cursor);
                if (g.hover == id) SetCursor(t->cursor);
            }
            return S_OK;
        }).Get(), &tok);
    t->ctl->add_AcceleratorKeyPressed(Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
        [](ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs* a) -> HRESULT {
            COREWEBVIEW2_KEY_EVENT_KIND kind;
            a->get_KeyEventKind(&kind);
            if (kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN)
                return S_OK;
            UINT vk = 0;
            a->get_VirtualKey(&vk);
            COREWEBVIEW2_PHYSICAL_KEY_STATUS st;
            a->get_PhysicalKeyStatus(&st);
            if (HandleKey(vk, st.WasKeyDown, false)) a->put_Handled(TRUE);
            return S_OK;
        }).Get(), &tok);

    t->ctl->put_Bounds(g.contentRect);
    t->ctl->put_IsVisible(id == g.activeId && !g.minimized);
    if (!t->pendingNav.empty()) {
        t->core->Navigate(t->pendingNav.c_str());
        t->pendingNav.clear();
    }
    auto ready = std::move(t->whenReady);
    t->whenReady.clear();
    for (auto& f : ready) f(t);
    QueueState();
}

static void CreateView(Tab* t) {
    if (!g.env) return;
    t->creating = true;
    ComPtr<ICoreWebView2ControllerOptions> opts;
    g.env->CreateCoreWebView2ControllerOptions(&opts);
    // A private tab's profile lives in memory and goes with the last private tab.
    opts->put_ProfileName(t->priv ? L"Private" : L"Default");
    if (t->priv) opts->put_IsInPrivateModeEnabled(TRUE);
    int id = t->id;
    g.env->CreateCoreWebView2CompositionControllerWithOptions(g.hwnd, opts.Get(),
        Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(
            [id](HRESULT hr, ICoreWebView2CompositionController* comp) -> HRESULT {
                Tab* t = FindTab(id);
                if (!t) {
                    ComPtr<ICoreWebView2Controller> c;
                    if (comp && SUCCEEDED(comp->QueryInterface(IID_PPV_ARGS(&c)))) c->Close();
                    return S_OK;
                }
                t->creating = false;
                if (SUCCEEDED(hr) && comp) {
                    if (ComPtr<ICoreWebView2Controller> c; SUCCEEDED(comp->QueryInterface(IID_PPV_ARGS(&c)))) MediaRaster(c.Get());
                    SetupTab(t, comp);
                }
                return S_OK;
            }).Get());
}

static void ShowActive() {
    Tab* a = Active();
    for (auto& t : g.tabs)
        if (t->ctl && !Shown(t.get()) && !t->peek) t->ctl->put_IsVisible(FALSE);
    g.content.Children().RemoveAll();
    // On screen, a tab is awake: its memory back to normal, and loaded again if its page's process went while away.
    auto wake = [](Tab* t) {
        if (t->suspended || t->lowMemory) {
            if (ComPtr<ICoreWebView2_19> c19; SUCCEEDED(t->core.As(&c19)))
                c19->put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
            t->suspended = t->lowMemory = false;
        }
        if (t->crashed && t->core) { t->crashed = false; ReloadTab(t); }
        // Placed while it was away: its page's popups (a select's list) open at its window's place now.
        t->ctl->NotifyParentWindowPositionChanged();
    };
    // The other panes of a split, beside it.
    for (Tab* p : Panes()) {
        if (p == a) continue;
        if (p->ctl) { wake(p); g.content.Children().InsertAtTop(p->visual); p->ctl->put_IsVisible(!g.minimized); }
        else EnsureView(p, [](Tab* t) { if (Shown(t)) ShowActive(); });
    }
    if (a) {
        a->lastActive = GetTickCount64();
        if (a->ctl) {
            wake(a);
            g.content.Children().InsertAtTop(a->visual);
            a->ctl->put_IsVisible(!g.minimized);
            if (!g.overlay) FocusTarget(a->id);
        } else {
            EnsureView(a, [](Tab* t) { if (t->id == g.activeId) ShowActive(); });
        }
    }
    if (RECT c = g.contentRect; (c.top == 0) != UnderBar() && !g.fullscreen && !g.autohide) Layout();
    PlacePanes();
    Commit();
    FollowNewTab();
    MarkSessionDirty();
    QueueState();
}

// Minimized, nothing of the window is on screen: every pane of the split and Peek's card stop drawing (not only the
// active tab), and what doesn't play sound gives its memory back as a tab asleep does. Restored, ShowActive wakes what
// shows.
static void SetMinimized(bool on) {
    for (auto& t : g.tabs) {
        if (!t->ctl || !(Shown(t.get()) || t->peek)) continue;
        t->ctl->put_IsVisible(!on);
        if (on && !t->audible && !t->lowMemory) {
            if (ComPtr<ICoreWebView2_19> c19; SUCCEEDED(t->core.As(&c19)))
                c19->put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
            t->lowMemory = true;
        }
    }
    if (g.uiCtl) g.uiCtl->put_IsVisible(!on);
    if (on) return;
    ShowActive();
    if (Tab* p = FindTab(g.peekId); p && p->ctl) {
        if (p->lowMemory) {
            if (ComPtr<ICoreWebView2_19> c19; SUCCEEDED(p->core.As(&c19)))
                c19->put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
            p->lowMemory = false;
        }
        p->ctl->put_IsVisible(TRUE);
    }
}

static void EnterSpace(int id);

// Picture in picture by itself (Settings > General): leaving a tab whose video plays with sound floats the video;
// coming back puts it in the page again. A muted video (an ad playing quietly) stays put.
static void AutoPip(Tab* t, bool enter) {
    if (!t || !t->core || Setting(L"autoPip", L"on") == L"off") return;
    // Coming back, only a tab it floated a video for is asked (a script in every tab it ever switched to woke slept ones).
    if (!enter && !t->pipped) return;
    t->pipped = enter;
    t->core->ExecuteScript(enter
        ? L"(() => { if (document.pictureInPictureElement) return; const v = [...document.querySelectorAll('video')]"
          L".filter(v => !v.paused && !v.muted && v.volume > 0 && v.readyState > 2 && v.clientWidth > 160 && !v.disablePictureInPicture)"
          L".sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];"
          L" if (v) v.requestPictureInPicture().then(() => { window.__exoAutoPip = true }, () => {}); })()"
        : L"(() => { if (window.__exoAutoPip && document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});"
          L" window.__exoAutoPip = false; })()",
        nullptr);
}

static void Activate(int id) {
    Tab* t = FindTab(id);
    if (!t || t->peek) return;
    if (g.peekId) ClosePeek();
    // A video's full screen belongs to its own tab: switching away leaves it.
    if (id != g.activeId && g.elementFullscreen) LeaveFullscreen();
    if (g_zapId && g_zapId != id) EndZap();
    if (Tab* prev = Active()) {
        static UINT64 leftCount = 0;
        if (prev->id != id) prev->left = ++leftCount;
        prev->lastActive = GetTickCount64();
        prev->seen = _time64(nullptr);
        if (prev->id != id && prev->audible) AutoPip(prev, true);
    }
    if (id != g.activeId) AutoPip(t, false);
    t->seen = _time64(nullptr);
    // A tab of another space (Search's "Switch to tab") takes you to its space; a favorite is in every space.
    if (t->space && t->space != g.space) EnterSpace(t->space);
    g.activeId = id;
    ShowActive();
}

// ---------------------------------------------------------------------------------------
// Peek: a link from a pinned tab or a favorite (or any link Shift+clicked) opens in a card over the page, which
// blurs behind it, so the page you were on stays put. Esc or a press around it closes it; Ctrl+O, or its button,
// opens it as a tab. Meeting links open as tabs, as calls need them.

static void Discard(Tab* t);

static bool IsMeeting(const std::wstring& url) {
    std::wstring site = SiteOf(url);
    for (auto m : {L"meet.google.com", L"zoom.us", L"teams.microsoft.com", L"teams.live.com", L"whereby.com", L"meet.jit.si"})
        if (site == m || (site.size() > wcslen(m) && site.compare(site.size() - wcslen(m) - 1, wcslen(m) + 1, std::wstring(L".") + m) == 0)) return true;
    return false;
}

// The card: 84% of the page's width (at most 1180 px), the page's height less a band above (for its buttons) and a
// margin below, centered.
static void PlacePeek() {
    Tab* t = FindTab(g.peekId);
    if (!t) return;
    float k = Scale();
    RECT c = g.contentRect;
    LONG w = c.right - c.left, h = c.bottom - c.top;
    LONG cw = std::min<LONG>((LONG)(w * 0.84f), (LONG)(1180 * k)), top = (LONG)(56 * k), bottom = (LONG)(20 * k);
    g.peekRect = {c.left + (w - cw) / 2, c.top + top, c.left + (w - cw) / 2 + cw, std::max(c.top + top + 1, c.bottom - bottom)};
    if (t->ctl) t->ctl->put_Bounds(g.peekRect);
    if (t->visual) {
        float rw = (float)(g.peekRect.right - g.peekRect.left), rh = (float)(g.peekRect.bottom - g.peekRect.top);
        t->visual.Offset({(float)g.peekRect.left, (float)g.peekRect.top, 0});
        t->visual.Size({rw, rh});
        auto shape = g.compositor.CreateRoundedRectangleGeometry();
        shape.Size({rw, rh});
        shape.CornerRadius({18 * k, 18 * k});
        t->visual.Clip(g.compositor.CreateGeometricClip(shape));
    }
    float css = 1 / k;
    UiPost(L"{\"t\":\"peek\",\"open\":true,\"x\":" + std::to_wstring(g.peekRect.left * css) + L",\"y\":" + std::to_wstring(g.peekRect.top * css) +
           L",\"w\":" + std::to_wstring((g.peekRect.right - g.peekRect.left) * css) + L",\"h\":" + std::to_wstring((g.peekRect.bottom - g.peekRect.top) * css) +
           L",\"title\":" + Json(t->title) + L",\"url\":" + Json(t->url) + L"}");
}

static void ShowPeek(Tab* t) {
    if (t->id != g.peekId || !t->ctl) return;
    g.peekLayer.Children().RemoveAll();
    g.peekLayer.Children().InsertAtTop(t->visual);
    PlacePeek();
    t->ctl->put_IsVisible(!g.minimized);
    FocusTarget(t->id);
}

static void OpenPeek(const std::wstring& url) {
    if (Tab* t = FindTab(g.peekId)) {
        t->url = url;
        if (t->core) t->core->Navigate(url.c_str());
        else t->pendingNav = url;
        return;
    }
    auto t = std::make_unique<Tab>();
    t->id = g.nextId++;
    t->url = t->pendingNav = url;
    t->peek = true;
    t->space = g.space;
    if (Tab* a = Active()) t->priv = a->priv;
    t->seen = _time64(nullptr);
    t->lastActive = GetTickCount64();
    Tab* raw = t.get();
    g.tabs.push_back(std::move(t));
    g.peekId = raw->id;
    SetBlur(true);
    EnsureView(raw, [](Tab* p) { ShowPeek(p); });
}

static void ClosePeek() {
    int id = g.peekId;
    if (!id) return;
    g.peekId = 0;
    g.peekRect = {};
    g.peekLayer.Children().RemoveAll();
    if (g.hover == id) g.hover = 0;
    if (g.capture == id) g.capture = 0;
    size_t i = IndexOf(id);
    if (i < g.tabs.size() && Downloading(id)) {
        // Still fetching a file: out of sight until it's done (the download closes it then).
        if (g.tabs[i]->ctl) g.tabs[i]->ctl->put_IsVisible(FALSE);
        CloseWhenDownloaded(id);
    } else if (i < g.tabs.size()) {
        Discard(g.tabs[i].get());
        g.tabs.erase(g.tabs.begin() + i);
    }
    if (!g.overlay) SetBlur(false);
    UiPost(L"{\"t\":\"peek\",\"open\":false}");
    if (Tab* a = Active(); a && a->ctl && !g.overlay) FocusTarget(a->id);
}

static void Activate(int id);

// The card becomes a tab after the one on screen.
static void ExpandPeek() {
    Tab* t = FindTab(g.peekId);
    if (!t) return;
    g.peekId = 0;
    g.peekRect = {};
    g.peekLayer.Children().RemoveAll();
    t->peek = false;
    t->space = g.space;
    if (t->visual) { t->visual.Offset({0, 0, 0}); t->visual.Clip(nullptr); }
    size_t from = IndexOf(t->id);
    auto up = std::move(g.tabs[from]);
    g.tabs.erase(g.tabs.begin() + from);
    Tab* a = Active();
    g.tabs.insert(g.tabs.begin() + (a ? IndexOf(a->id) + 1 : g.tabs.size()), std::move(up));
    if (!g.overlay) SetBlur(false);
    UiPost(L"{\"t\":\"peek\",\"open\":false}");
    Activate(t->id);
}

static Tab* AddTab(const std::wstring& url, bool activate, size_t index, bool priv = false) {
    auto t = std::make_unique<Tab>();
    t->id = g.nextId++;
    t->priv = priv;
    t->url = url;
    t->pendingNav = url;
    t->lastActive = GetTickCount64();
    t->seen = _time64(nullptr);
    t->space = g.space;
    Tab* raw = t.get();
    g.tabs.insert(g.tabs.begin() + std::min(index, g.tabs.size()), std::move(t));
    Order();  // after the tab on screen, but never among the pinned tabs and folders
    if (activate) Activate(raw->id);
    else QueueState();
    return raw;
}

// After the tab on screen, or at the end of the space when the one on screen is another space's (a space just entered).
static size_t NextPlace() {
    Tab* a = Active();
    if (a && a->space == g.space) return IndexOf(a->id) + 1;
    size_t at = g.tabs.size();
    for (size_t i = 0; i < g.tabs.size(); i++) if (g.tabs[i]->space == g.space) at = i + 1;
    return at;
}

static void NewTabPage() {
    AddTab(kNewTab, true, NextPlace());
}

static void Discard(Tab* t) {
    if (t->ctl) t->ctl->Close();
    t->comp.Reset();
    t->ctl.Reset();
    t->core.Reset();
    t->visual = nullptr;
    t->find.Reset();
    t->suspended = t->lowMemory = t->loading = t->audible = false;
    t->cursor = nullptr;
    // Opening it again loads where it was.
    t->pendingNav = t->url;
}

// The tab that takes the place of one leaving its space at index i (already gone from g.tabs): the next of that space,
// else the one before it.
static Tab* Neighbor(int space, size_t i) {
    auto in = [space](const Tab* t) { return t->space == space || t->space == 0; };
    for (size_t j = i; j < g.tabs.size(); j++) if (in(g.tabs[j].get())) return g.tabs[j].get();
    for (size_t j = std::min(i, g.tabs.size()); j-- > 0;) if (in(g.tabs[j].get())) return g.tabs[j].get();
    return nullptr;
}

// Favorites lead the strip, then pinned tabs, then the rest, each in its own order.
static void Order() {
    // The folders depth first, each before the folders in it, in the order they were made.
    std::unordered_map<int, int> place;
    std::function<void(int)> walk = [&](int parent) {
        for (auto& f : g.folders)
            if (f.parent == parent) {
                place[f.id] = (int)place.size();
                walk(f.id);
            }
    };
    walk(0);
    int loose = (int)place.size();
    std::stable_sort(g.tabs.begin(), g.tabs.end(), [&](auto& a, auto& b) {
        auto rank = [](const Tab* t) { return t->space == 0 ? 0 : t->pinned ? 1 : 2; };
        auto sub = [&](const Tab* t) {
            if (!t->pinned || t->space == 0) return 0;
            auto it = place.find(t->folder);
            return it == place.end() ? loose : it->second;
        };
        int ra = rank(a.get()), rb = rank(b.get());
        return ra != rb ? ra < rb : sub(a.get()) < sub(b.get());
    });
}

static void SwitcherForget(int id);
static void CloseTab(int id, bool force = false) {
    size_t i = IndexOf(id);
    if (i >= g.tabs.size()) return;
    if (id == g_zapId) EndZap();
    SwitcherForget(id);
    Tab* t = g.tabs[i].get();
    int space = t->space ? t->space : g.space;
    // A pinned tab (a favorite too) stays: closing it puts it to sleep on its own page, and the next tab shows.
    if (t->pinned && !force) {
        if (id == g.activeId && g.elementFullscreen) LeaveFullscreen();
        if (g.activeId == id) {
            Tab* next = nullptr;
            for (size_t j = i + 1; j < g.tabs.size() && !next; j++) if (g.tabs[j]->space == space || g.tabs[j]->space == 0) next = g.tabs[j].get();
            for (size_t j = i; j-- > 0 && !next;) if (g.tabs[j]->space == space || g.tabs[j]->space == 0) next = g.tabs[j].get();
            if (next) Activate(next->id);
            else { g.activeId = 0; NewTabPage(); }
        }
        if (!t->home.empty()) t->url = t->home;
        // A pane of the split on screen (not the active one): the rest of the split takes its room.
        bool shown = id != g.activeId && Shown(t);
        Discard(t);
        if (shown) ShowActive();
        MarkSessionDirty();
        QueueState();
        return;
    }
    if (!t->url.empty() && !t->priv) {
        g.closed.push_back({t->url, t->title, i, t->space});
        if (g.closed.size() > 50) g.closed.erase(g.closed.begin());
    }
    if (g.capture == id) g.capture = 0;
    if (g.hover == id) g.hover = 0;
    if (g.focus == id) g.focus = 0;
    if (id == g.activeId && g.elementFullscreen) LeaveFullscreen();
    int split = t->split;
    bool shown = id != g.activeId && Shown(t);
    Discard(t);
    g.tabs.erase(g.tabs.begin() + i);
    if (split && std::count_if(g.tabs.begin(), g.tabs.end(), [split](auto& x) { return x->split == split; }) < 2)
        for (auto& x : g.tabs) if (x->split == split) x->split = 0;
    if (shown) {
        ShowActive();  // a pane of the split on screen went: the others take its room at once
    } else if (g.activeId == id) {
        // The space's last tab closed leaves a new tab page in it.
        if (Tab* next = Neighbor(space, i)) {
            g.activeId = next->id;
            ShowActive();
        } else {
            g.activeId = 0;
            NewTabPage();
        }
    } else {
        QueueState();
    }
    MarkSessionDirty();
}

// Back into the space it was closed from (an archived tab's space may be one you aren't in), and on screen.
static Tab* Reopen(const std::wstring& url, const std::wstring& title, size_t index, int space) {
    Tab* t = AddTab(url, false, index);
    t->title = title;
    if (space && space != t->space && FindSpace(space)) t->space = space;
    Order();
    Activate(t->id);
    MarkSessionDirty();
    return t;
}

static void ReopenClosed() {
    if (g.closed.empty()) return;
    ClosedTab c = g.closed.back();
    g.closed.pop_back();
    Reopen(c.url, c.title, c.index, c.space);
}

// Ctrl+Tab and Ctrl+PageDown go round the space's tabs.
static void CycleTab(int step) {
    auto tabs = SpaceTabs(g.space);
    if (tabs.empty()) return;
    size_t i = std::find(tabs.begin(), tabs.end(), Active()) - tabs.begin();
    if (i >= tabs.size()) i = 0;
    i = (i + tabs.size() + step) % tabs.size();
    Activate(tabs[i]->id);
}

// ---------------------------------------------------------------------------------------
// Spaces

// Into another space: the one left remembers its tab on screen, and the appearance follows the new one.
static void EnterSpace(int id) {
    if (id == g.space || !FindSpace(id)) return;
    if (Space* cur = FindSpace(g.space)) cur->last = g.activeId;
    g.space = id;
    SaveSpaces();
    ThemeChanged();
}

// Shows a space with the tab it last had on screen (its first, or a new tab page when it has none).
static void SwitchSpace(int id) {
    Space* s = FindSpace(id);
    if (!s || id == g.space) return;
    Tab* t = FindTab(s->last);
    if (!t || (t->space != id && t->space != 0)) {
        auto tabs = SpaceTabs(id);
        t = tabs.empty() ? nullptr : tabs[0];
    }
    // Entered first: its tab may be a favorite, which is in every space and so wouldn't take you there itself.
    EnterSpace(id);
    if (t) Activate(t->id);
    else NewTabPage();
}

// A tab into another space, at the end of its tabs (pinned ones still lead). The space on screen keeps a tab: the next
// one, or a new tab page; `follow` goes along with it instead.
static void MoveToSpace(Tab* t, int id, bool follow) {
    if (!FindSpace(id) || t->space == id) { if (follow) Activate(t->id); return; }
    int from = t->space, tabId = t->id;
    bool wasOn = tabId == g.activeId;
    size_t i = IndexOf(tabId);
    auto up = std::move(g.tabs[i]);
    g.tabs.erase(g.tabs.begin() + i);
    up->space = id;
    up->folder = 0;  // folders belong to their space
    size_t at = g.tabs.size();
    for (size_t j = 0; j < g.tabs.size(); j++) if (g.tabs[j]->space == id) at = j + 1;
    g.tabs.insert(g.tabs.begin() + at, std::move(up));
    Order();
    FindSpace(id)->last = tabId;
    if (follow) {
        Activate(tabId);
    } else if (wasOn && from == g.space) {
        if (Tab* next = Neighbor(from, i)) Activate(next->id);
        else { g.activeId = 0; NewTabPage(); }
    }
    MarkSessionDirty();
    QueueState();
}

// A space goes with its tabs (Ctrl+Shift+T brings them back, one by one); the last space stays.
static void DeleteSpace(int id) {
    if (g.spaces.size() < 2 || !FindSpace(id)) return;
    if (id == g.space) {
        size_t i = 0;
        while (g.spaces[i].id != id) i++;
        SwitchSpace(g.spaces[i > 0 ? i - 1 : i + 1].id);
    }
    std::vector<int> ids;
    for (auto& t : g.tabs) if (t->space == id) ids.push_back(t->id);
    for (int tabId : ids) CloseTab(tabId, true);
    std::erase_if(g.spaces, [id](auto& s) { return s.id == id; });
    std::erase_if(g.folders, [id](auto& f) { return f.space == id; });
    SaveSpaces();
    MarkSessionDirty();
    QueueState();
}

// The archive (Settings > General > Archive tabs): a tab that isn't pinned or kept and hasn't been on screen for the
// chosen time (never, by default) closes into it, unless it plays sound or downloads, and each space keeps its five
// newest tabs whatever their age, so a space you come back to is never empty. Settings > Archive lists it, Search
// finds it, Ctrl+Shift+T brings the last ones back, each into the space it left; archive.tsv keeps the newest 300.
static const size_t kArchiveKeeps = 5;

static void SaveArchive() {
    std::string out;
    for (auto& a : g.archive)
        out += Utf8(Field(a.url) + L"\t" + Field(a.title) + L"\t" + std::to_wstring(a.at) + L"\t" + std::to_wstring(a.space)) + "\n";
    WriteFileUtf8(g.dataDir + L"\\archive.tsv", out);
}

static void SendArchive() {
    std::wstring items;
    for (auto it = g.archive.rbegin(); it != g.archive.rend(); ++it) {
        if (!items.empty()) items += L",";
        items += L"[" + Json(it->url) + L"," + Json(it->title) + L"," + std::to_wstring(it->at) + L"," + std::to_wstring(it->space) + L"]";
    }
    UiPost(L"{\"t\":\"archive\",\"items\":[" + items + L"]}");
}

static long long ArchiveAfter() {
    std::wstring v = Setting(L"archive", L"never");
    return v == L"1h" ? 3600LL : v == L"4h" ? 4 * 3600LL : v == L"12h" ? 12 * 3600LL : v == L"24h" ? 24 * 3600LL
         : v == L"7d" ? 7 * 86400LL : v == L"30d" ? 30 * 86400LL : 0;
}

static bool Downloading(int tabId);

static void ArchiveTick() {
    long long after = ArchiveAfter(), now = _time64(nullptr);
    if (!after) return;
    // Each space's tabs that could go, newest first: its five newest stay whatever their age.
    std::unordered_map<int, std::vector<Tab*>> bySpace;
    for (auto& t : g.tabs)
        if (!t->pinned && !t->kept && !t->peek && !t->priv && t->space != 0 && !t->url.empty() && t->url != kNewTab) bySpace[t->space].push_back(t.get());
    std::vector<int> ids;
    for (auto& [space, tabs] : bySpace) {
        std::sort(tabs.begin(), tabs.end(), [](Tab* a, Tab* b) { return a->seen > b->seen; });
        for (size_t i = kArchiveKeeps; i < tabs.size(); i++) {
            Tab* t = tabs[i];
            if (!Shown(t) && !t->audible && !Downloading(t->id) && now - t->seen > after) ids.push_back(t->id);
        }
    }
    if (ids.empty()) return;
    for (int id : ids) {
        Tab* t = FindTab(id);
        g.archive.push_back({t->url, t->title, now, t->space});
        CloseTab(id);
    }
    if (g.archive.size() > 300) g.archive.erase(g.archive.begin(), g.archive.end() - 300);
    SaveArchive();
    SendArchive();
    Toast(ids.size() == 1 ? L"1 tab moved to the archive. Ctrl+Shift+T brings it back"
                          : std::to_wstring(ids.size()) + L" tabs moved to the archive. Ctrl+Shift+T brings the last one back");
}

// The step-down tick (every 30 s) runs only while it has work: a tab off screen still holding its page, the archive on,
// or history and icons waiting to be saved. With none of that it stops, so an idle window wakes for nothing; anything
// that changes the tabs (every change reaches QueueState) or a setting starts it again.
static bool g_sleepArmed = false;
static void ArmSleep() {
    if (g_sleepArmed || !g.hwnd) return;
    g_sleepArmed = true;
    SetTimer(g.hwnd, kTimerSleep, 30 * 1000, nullptr);
}

static bool SleepWork() {
    if (g.historyDirty || g.faviconsDirty || ArchiveAfter()) return true;
    for (auto& t : g.tabs) if (t->ctl && !t->peek && !Shown(t.get())) return true;
    return false;
}

// How long a tab off screen waits before each step down, from this PC's memory as it is right now: with memory to
// spare a tab you go back to is as you left it (closed only after an hour or more, longer with more memory), and the
// tighter memory gets the sooner they step down, so the PC never pages. Fixed steps (lower memory after a minute,
// frozen after five, closed after thirty) made a tab left a few minutes ago slow to come back on every PC: frozen, it
// took 16 to 36 ms to show again (4 to 16 awake), and closed it loaded again. Lower memory alone costs less than a
// frame (about 15 ms to show again the first time, 10 awake) and gives back most of what a page holds (eight sites left
// a minute and a half: 1 GB in use instead of 2.4), so every PC takes that step after a minute.
struct SleepSteps { ULONGLONG low, freeze, discard; };

// Exo Launcher's sign that a game is running (Local\ExoLauncher.GameRunning: set while one runs, and absent while Exo
// Launcher isn't, which reads as no game). While it's set Exo Browser keeps out of the game's way: tabs off screen step
// down within a couple of minutes, and live folders and the update check wait. What's on screen, what plays sound and
// what you keep are left as they are, so a stream or a call goes on.
static bool GameRunning() {
    HANDLE e = OpenEventW(SYNCHRONIZE, FALSE, L"Local\\ExoLauncher.GameRunning");
    if (!e) return false;
    bool on = WaitForSingleObject(e, 0) == WAIT_OBJECT_0;
    CloseHandle(e);
    return on;
}

static SleepSteps SleepStepsNow() {
    const ULONGLONG minute = 60 * 1000;
    MEMORYSTATUSEX m{sizeof m};
    SleepSteps s;
    if (!GlobalMemoryStatusEx(&m) || m.dwMemoryLoad >= 90) s = {1 * minute, 5 * minute, 20 * minute};
    else {
        ULONGLONG gb = (m.ullTotalPhys + (1ull << 29)) >> 30;  // 15.9 GB of usable memory is a 16 GB PC
        ULONGLONG discard = gb >= 32 ? 240 * minute : gb >= 16 ? 120 * minute : gb >= 8 ? 60 * minute : 30 * minute;
        s = m.dwMemoryLoad >= 80 ? SleepSteps{1 * minute, 10 * minute, std::max(30 * minute, discard / 2)} : SleepSteps{1 * minute, 15 * minute, discard};
    }
    // A game running: processor time to the game, from tabs nobody is looking at. None closes for it.
    if (GameRunning()) s.freeze = std::min(s.freeze, 2 * minute);
    return s;
}

// Background tabs step down: lower memory priority, then frozen, then closed (title, icon and address kept), on the
// steps above. Playing tabs are never touched.
static void SleepTick() {
    ArchiveTick();
    ULONGLONG now = GetTickCount64();
    SleepSteps steps = SleepStepsNow();
    for (auto& up : g.tabs) {
        Tab* t = up.get();
        if (Shown(t) || t->peek || t->kept || !t->ctl || t->audible || t->creating || Downloading(t->id)) continue;
        ULONGLONG idle = now - t->lastActive;
        if (idle > steps.discard) {
            Discard(t);
            QueueState();
            continue;
        }
        if (idle > steps.low && !t->lowMemory) {
            if (ComPtr<ICoreWebView2_19> c19; SUCCEEDED(t->core.As(&c19)))
                c19->put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
            t->lowMemory = true;
        }
        if (idle > steps.freeze && !t->suspended) {
            int id = t->id;
            if (ComPtr<ICoreWebView2_3> c3; SUCCEEDED(t->core.As(&c3)))
                c3->TrySuspend(Callback<ICoreWebView2TrySuspendCompletedHandler>([id](HRESULT hr, BOOL ok) -> HRESULT {
                    if (Tab* t = FindTab(id); t && SUCCEEDED(hr) && ok && id != g.activeId) {
                        t->suspended = true;
                        QueueState();
                    }
                    return S_OK;
                }).Get());
        }
    }
}

// ---------------------------------------------------------------------------------------
// Find in page (Ctrl+F): the page draws the field, the engine finds.

static std::wstring g_findTerm;

static void ApplyFind(Tab* t) {
    if (!t || !t->core || !g.env) return;
    if (!t->find) {
        ComPtr<ICoreWebView2_28> c28;
        if (FAILED(t->core.As(&c28)) || FAILED(c28->get_Find(&t->find))) return;
        auto report = [](ICoreWebView2Find* f) {
            INT32 count = 0, index = 0;
            f->get_MatchCount(&count);
            f->get_ActiveMatchIndex(&index);
            UiPost(L"{\"t\":\"findResult\",\"count\":" + std::to_wstring(count) + L",\"index\":" +
                   std::to_wstring(index) + L"}");
        };
        EventRegistrationToken tok;
        t->find->add_MatchCountChanged(Callback<ICoreWebView2FindMatchCountChangedEventHandler>(
            [report](ICoreWebView2Find* f, IUnknown*) -> HRESULT { report(f); return S_OK; }).Get(), &tok);
        t->find->add_ActiveMatchIndexChanged(Callback<ICoreWebView2FindActiveMatchIndexChangedEventHandler>(
            [report](ICoreWebView2Find* f, IUnknown*) -> HRESULT { report(f); return S_OK; }).Get(), &tok);
    }
    if (g_findTerm.empty()) {
        t->find->Stop();
        UiPost(L"{\"t\":\"findResult\",\"count\":0,\"index\":0}");
        return;
    }
    ComPtr<ICoreWebView2Environment15> e15;
    ComPtr<ICoreWebView2FindOptions> opts;
    if (FAILED(g.env.As(&e15)) || FAILED(e15->CreateFindOptions(&opts))) return;
    opts->put_FindTerm(g_findTerm.c_str());
    opts->put_SuppressDefaultFindDialog(TRUE);
    opts->put_ShouldHighlightAllMatches(TRUE);
    t->find->Start(opts.Get(), Callback<ICoreWebView2FindStartCompletedHandler>([](HRESULT) -> HRESULT { return S_OK; }).Get());
}

// ---------------------------------------------------------------------------------------
// Downloads: Exo's own list (Edge's download popup stays hidden), kept across restarts.

struct Download {
    int id = 0;
    std::wstring url, path, state;  // state: progress, paused, done, failed, cancelled
    long long received = 0, total = 0, started = 0;
    ComPtr<ICoreWebView2DownloadOperation> op;
    int closeTab = 0;  // the tab that only fetched this file: closed once the file is finished
    int tab = 0;       // the tab it came from: kept awake until the file is done
    HWND little = nullptr;  // the Little Exo window it came from, kept until it's done
    bool priv = false;      // from a private tab: listed until the browser closes, never saved
    bool openWhenDone = false;  // pressed while still coming in: opens as it finishes, as in Chrome
};
static std::vector<Download> g_downloads;
static void LittleDownloaded(HWND hwnd);
static int g_nextDownload = 1;
static bool g_downloadsPending = false;
static const UINT WM_APP_DOWNLOADS = WM_APP + 3;

static Download* FindDownload(int id) {
    for (auto& d : g_downloads) if (d.id == id) return &d;
    return nullptr;
}

// A download still coming in needs its page: WebView2 never finishes one whose page is gone.
static bool Downloading(int tabId) {
    for (auto& d : g_downloads)
        if (d.op && (d.tab == tabId || d.closeTab == tabId) && (d.state == L"progress" || d.state == L"paused")) return true;
    return false;
}

// A tab that only fetches files now (a Peek card closed mid-download) closes once its downloads are done.
static void CloseWhenDownloaded(int tabId) {
    for (auto& d : g_downloads) if (d.tab == tabId && d.op) d.closeTab = tabId;
}

static void SaveDownloads() {
    std::string out;
    for (auto& d : g_downloads) {
        if (d.state == L"progress" || d.state == L"paused" || d.priv) continue;
        out += Utf8(Field(d.url) + L"\t" + Field(d.path) + L"\t" + d.state + L"\t" + std::to_wstring(d.total) + L"\t" +
                    std::to_wstring(d.started)) + "\n";
    }
    WriteFileUtf8(g.dataDir + L"\\downloads.tsv", out);
}

static void LoadDownloads() {
    for (auto& row : ReadTable(L"downloads.tsv")) {
        if (row.size() < 5) continue;
        Download d;
        d.id = g_nextDownload++;
        d.url = row[0];
        d.path = row[1];
        d.state = row[2];
        d.total = d.received = _wtoi64(row[3].c_str());
        d.started = _wtoi64(row[4].c_str());
        // A file earlier versions marked failed after a pause at 100% is whole on disk: it's done.
        if (WIN32_FILE_ATTRIBUTE_DATA info; d.state == L"failed" && d.total > 0 && GetFileAttributesExW(d.path.c_str(), GetFileExInfoStandard, &info) &&
            (((INT64)info.nFileSizeHigh << 32) | info.nFileSizeLow) == d.total)
            d.state = L"done";
        g_downloads.push_back(d);
    }
}

static std::wstring DownloadsJson(bool checkFiles = false) {
    std::wstring items;
    for (auto it = g_downloads.rbegin(); it != g_downloads.rend(); ++it) {
        auto& d = *it;
        std::wstring name = d.path.substr(d.path.find_last_of(L'\\') + 1);
        // A finished file you deleted shows as gone; asked of the disk only when the list is opened.
        if (checkFiles && d.state == L"done" && GetFileAttributesW(d.path.c_str()) == INVALID_FILE_ATTRIBUTES) d.state = L"gone";
        bool exists = d.state != L"gone";
        if (!items.empty()) items += L",";
        items += L"{\"id\":" + std::to_wstring(d.id) + L",\"url\":" + Json(d.url) + L",\"name\":" + Json(name) + L",\"state\":" +
                 Json(exists ? d.state : L"gone") + L",\"received\":" + std::to_wstring(d.received) + L",\"total\":" +
                 std::to_wstring(d.total) + L",\"started\":" + std::to_wstring(d.started) +
                 (d.openWhenDone && (d.state == L"progress" || d.state == L"paused") ? L",\"opens\":true" : L"") + L"}";
    }
    return L"[" + items + L"]";
}

static void RefreshNewTabs();

// Progress arrives many times a second; the Bar and pages hear it at most every 250ms.
static void QueueDownloads() {
    if (g_downloadsPending) return;
    g_downloadsPending = true;
    SetTimer(g.hwnd, WM_APP_DOWNLOADS, 250, nullptr);
}

static void SendDownloads() {
    g_downloadsPending = false;
    UiPost(L"{\"t\":\"downloads\",\"items\":" + DownloadsJson() + L"}");
}

static const UINT kTimerDownloads = 13;
struct Download;
static void DownloadState(Download* d, ICoreWebView2DownloadOperation* op);

static void TrackDownload(ICoreWebView2DownloadStartingEventArgs* a, int tabId) {
    bool priv = false;
    if (Tab* from = FindTab(tabId)) priv = from->priv;
    // A tab opened only to fetch a file (it never showed a page) steps aside at once and closes once the file is
    // finished, as in Chrome. Closing it sooner left the file half done: WebView2 never finished a download whose
    // page was gone (the whole file sat as a .tmp at 0%).
    int closeTab = 0;
    if (Tab* t = FindTab(tabId); t && t->core) {
        BOOL back = FALSE;
        t->core->get_CanGoBack(&back);
        if (!back && (t->title.empty() || t->url == L"about:blank")) {
            closeTab = tabId;
            auto tabs = SpaceTabs(t->space);
            size_t i = std::find(tabs.begin(), tabs.end(), t) - tabs.begin();
            if (g.activeId == tabId && tabs.size() > 1) Activate(tabs[i > 0 ? i - 1 : i + 1]->id);
        }
    }
    ComPtr<ICoreWebView2DownloadOperation> op;
    if (FAILED(a->get_DownloadOperation(&op))) return;
    a->put_Handled(TRUE);  // no Edge popup: the Bar shows it
    Download d;
    d.id = g_nextDownload++;
    d.op = op;
    d.closeTab = closeTab;
    d.tab = tabId;
    d.priv = priv;
    d.state = L"progress";
    d.started = NowSeconds();
    LPWSTR uri = nullptr, path = nullptr;
    op->get_Uri(&uri);
    a->get_ResultFilePath(&path);
    d.url = Take(uri);
    d.path = Take(path);
    INT64 total = 0;
    op->get_TotalBytesToReceive(&total);
    d.total = total;
    int id = d.id;
    g_downloads.push_back(d);
    if (g_downloads.size() > 500) g_downloads.erase(g_downloads.begin());
    EventRegistrationToken tok;
    op->add_BytesReceivedChanged(Callback<ICoreWebView2BytesReceivedChangedEventHandler>(
        [id](ICoreWebView2DownloadOperation* op, IUnknown*) -> HRESULT {
            if (Download* d = FindDownload(id)) {
                INT64 got = 0, total = 0;
                op->get_BytesReceived(&got);
                op->get_TotalBytesToReceive(&total);
                d->received = got;
                d->total = total;
                QueueDownloads();
            }
            return S_OK;
        }).Get(), &tok);
    op->add_StateChanged(Callback<ICoreWebView2StateChangedEventHandler>(
        [id](ICoreWebView2DownloadOperation* op, IUnknown*) -> HRESULT {
            if (Download* d = FindDownload(id)) DownloadState(d, op);
            return S_OK;
        }).Get(), &tok);
    SetTimer(g.hwnd, kTimerDownloads, 1000, nullptr);
    SendDownloads();
}

// A download's state as WebView2 has it now: done, stopped (cancelled or failed) or still going.
static void DownloadState(Download* d, ICoreWebView2DownloadOperation* op) {
            int id = d->id;
            // The list goes to the chrome page only when this changed (the tick asks every second; its bytes go on their own).
            std::wstring before = d->state + L"|" + d->path;
            COREWEBVIEW2_DOWNLOAD_STATE state;
            op->get_State(&state);
            LPWSTR path = nullptr;
            if (SUCCEEDED(op->get_ResultFilePath(&path))) d->path = Take(path);
            if (state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED) {
                bool was = d->state == L"progress" || d->state == L"paused";
                d->state = L"done";
                d->received = d->total = std::max(d->received, d->total);
                if (was && d->openWhenDone) ShellExecuteW(g.hwnd, L"open", d->path.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
            } else if (state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED) {
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON reason;
                op->get_InterruptReason(&reason);
                // WebView2 calls a pause an interruption: a paused file waits to be resumed, it never failed. (A press on
                // a file at 100%, still being checked and moved into place, paused it, and it read Failed though whole.)
                if (reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_PAUSED) d->state = L"paused";
                else d->state = reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED ? L"cancelled" : L"failed";
            }
            if (d->state == L"failed" || d->state == L"cancelled") {
                COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON reason;
                op->get_InterruptReason(&reason);
                wchar_t line[96];
                swprintf_s(line, L"download %d interrupted: reason %d", id, (int)reason);
                LogLine(line);
            }
            if (d->state != L"progress" && d->state != L"paused") {
                d->op.Reset();
                if (d->closeTab) PostMessageW(g.hwnd, WM_COMMAND, MAKEWPARAM(1, 0), (LPARAM)d->closeTab);
                d->closeTab = 0;
                if (d->little) LittleDownloaded(d->little);
                d->little = nullptr;
                SaveDownloads();
            }
            if (d->state + L"|" + d->path != before) SendDownloads();
}

// Every second while a download runs, its state is read again: its "finished" event never comes once the page that
// started it is gone (a file stayed "in progress" at 418 of 418 MB, finished on disk). Without its operation left to
// ask, a file at its full size on disk is done.
static void DownloadTick() {
    bool running = false;
    for (auto& d : g_downloads) {
        if (d.state != L"progress" && d.state != L"paused") continue;
        if (d.op) DownloadState(&d, d.op.Get());
        else if (WIN32_FILE_ATTRIBUTE_DATA info; !d.path.empty() && GetFileAttributesExW(d.path.c_str(), GetFileExInfoStandard, &info) &&
                 d.total > 0 && (((INT64)info.nFileSizeHigh << 32) | info.nFileSizeLow) == d.total) {
            d.state = L"done";
            d.received = d.total;
            SaveDownloads();
            SendDownloads();
        }
        // A paused one waits without the tick (it kept it going for as long as it stayed paused); resuming starts it again.
        running = running || d.state == L"progress";
    }
    if (!running) KillTimer(g.hwnd, kTimerDownloads);
}

static void DownloadAction(const std::wstring& verb, int id) {
    Download* d = FindDownload(id);
    if (verb == L"dlClear") {
        std::erase_if(g_downloads, [](auto& x) { return x.state != L"progress" && x.state != L"paused"; });
    } else if (!d) {
        return;
    } else if (verb == L"dlOpen") {
        // Still coming in (or paused): it opens as it finishes, a paused one going on again first.
        if (d->state == L"progress" || d->state == L"paused") {
            d->openWhenDone = true;
            if (d->state == L"paused" && d->op) { d->op->Resume(); d->state = L"progress"; SetTimer(g.hwnd, kTimerDownloads, 1000, nullptr); }
        } else {
            ShellExecuteW(g.hwnd, L"open", d->path.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        }
    } else if (verb == L"dlShow") {
        if (PIDLIST_ABSOLUTE pidl = ILCreateFromPathW(d->path.c_str())) {
            SHOpenFolderAndSelectItems(pidl, 0, nullptr, 0);
            ILFree(pidl);
        }
    } else if (verb == L"dlCancel" && d->op) {
        d->op->Cancel();
    } else if (verb == L"dlPause" && d->op) {
        if (d->state == L"paused") { d->op->Resume(); d->state = L"progress"; SetTimer(g.hwnd, kTimerDownloads, 1000, nullptr); }
        else { d->op->Pause(); d->state = L"paused"; }
    } else if (verb == L"dlRemove") {
        if (d->op) d->op->Cancel();
        std::erase_if(g_downloads, [id](auto& x) { return x.id == id; });
    }
    SaveDownloads();
    SendDownloads();
}

// ---------------------------------------------------------------------------------------
// The Settings page, the new tab page and every manager are files in ui/ served at newtab.exo;
// their data is JSON at api.newtab.exo, readable by that origin alone (CORS).

static const wchar_t kSettingsPage[] = L"https://newtab.exo/settings.html";

// Settings is one floating sheet in the chrome page, with every section in it.
static void OpenSettings(const std::wstring& section) {
    UiPost(L"{\"t\":\"settings.open\",\"section\":" + Json(section) + L"}");
}

// The installer registers Exo Browser with Windows as a browser (Software\RegisteredApplications); Windows says
// which browser opens web links in the https UserChoice.
static bool IsRegistered() {
    DWORD size = 0;
    return RegGetValueW(HKEY_CURRENT_USER, L"Software\\RegisteredApplications", L"Exo Browser", RRF_RT_REG_SZ, nullptr, nullptr, &size) == ERROR_SUCCESS;
}

static bool IsDefaultBrowser() {
    wchar_t progId[128] = {};
    DWORD size = sizeof progId;
    return RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice", L"ProgId",
                        RRF_RT_REG_SZ, nullptr, progId, &size) == ERROR_SUCCESS && wcscmp(progId, L"ExoBrowserURL") == 0;
}

// What Windows hands the browser to open: a web address as it is, a file (an .html Windows opens with it) as a file URL.
static std::wstring OpenArgument(const std::wstring& arg) {
    if (arg.size() > 2 && (arg[1] == L':' || arg.rfind(L"\\\\", 0) == 0) && GetFileAttributesW(arg.c_str()) != INVALID_FILE_ATTRIBUTES) {
        wchar_t url[2048];
        DWORD n = ARRAYSIZE(url);
        if (SUCCEEDED(UrlCreateFromPathW(arg.c_str(), url, &n, 0))) return url;
    }
    return arg;
}

static std::wstring StateJson() {
    std::wstring values;
    for (auto& [k, v] : g.settings) {
        if (!values.empty()) values += L",";
        values += Json(k) + L":" + Json(v);
    }
    LPWSTR engine = nullptr;
    GetAvailableCoreWebView2BrowserVersionString(nullptr, &engine);
    // What Exo Shield is made of (its build writes exo-shield.json: versions, list sizes, build date).
    std::string shield = ReadFileUtf8(g.exeDir + L"\\extensions\\exo-shield\\exo-shield.json");
    return L"{\"settings\":{" + values + L"},\"theme\":" + Json(g.theme) + L",\"sources\":" + SourcesJson() + L",\"engine\":" +
           Json(Take(engine)) + L",\"history\":" + std::to_wstring(g.history.size()) + L",\"bookmarks\":" +
           std::to_wstring(g.bookmarks.size()) + L",\"shield\":" + (shield.empty() ? L"null" : Wide(shield)) +
           L",\"version\":" + Json(EXO_VERSION_W) + L",\"registered\":" + Bool(IsRegistered()) + L",\"isDefault\":" + Bool(IsDefaultBrowser()) +
           L",\"transparency\":" + Bool(WindowsTransparency()) + L"}";
}

// Settings' History shows six visits: those only, with icons for their sites and for the archive's tabs (it fetched up
// to 5000 visits and every site's icon each time it opened). Full history asks for HistoryJson.
static std::wstring RecentHistoryJson() {
    std::vector<const Visit*> all;
    for (auto& [_, v] : g.history) all.push_back(&v);
    size_t n = std::min<size_t>(6, all.size());
    std::partial_sort(all.begin(), all.begin() + n, all.end(), [](auto a, auto b) { return a->last > b->last; });
    std::wstring items, favs;
    std::unordered_set<std::wstring> sites;
    for (size_t i = 0; i < n; i++) {
        const Visit* v = all[i];
        if (!items.empty()) items += L",";
        items += L"[" + Json(v->url) + L"," + Json(v->title) + L"," + std::to_wstring(v->visits) + L"," + std::to_wstring(v->last) + L"]";
        sites.insert(SiteOf(v->url));
    }
    for (auto& a : g.archive) sites.insert(SiteOf(a.url));
    for (auto& site : sites)
        if (auto it = g.favicons.find(site); it != g.favicons.end()) {
            if (!favs.empty()) favs += L",";
            favs += Json(site) + L":" + Json(it->second);
        }
    return L"{\"items\":[" + items + L"],\"favicons\":{" + favs + L"}}";
}

static std::wstring HistoryJson() {
    std::vector<const Visit*> all;
    for (auto& [_, v] : g.history) all.push_back(&v);
    // Only the newest 5000 put in order, not all 20,000.
    size_t n = std::min<size_t>(5000, all.size());
    std::partial_sort(all.begin(), all.begin() + n, all.end(), [](auto a, auto b) { return a->last > b->last; });
    all.resize(n);
    std::wstring items, favs;
    std::unordered_map<std::wstring, bool> seen;
    for (auto v : all) {
        if (!items.empty()) items += L",";
        items += L"[" + Json(v->url) + L"," + Json(v->title) + L"," + std::to_wstring(v->visits) + L"," + std::to_wstring(v->last) + L"]";
        std::wstring site = SiteOf(v->url);
        if (seen[site]) continue;
        seen[site] = true;
        if (auto it = g.favicons.find(site); it != g.favicons.end()) {
            if (!favs.empty()) favs += L",";
            favs += Json(site) + L":" + Json(it->second);
        }
    }
    return L"{\"items\":[" + items + L"],\"favicons\":{" + favs + L"}}";
}


// The data behind the new tab page and Settings, by path. Pages in tabs fetch it from
// https://api.newtab.exo/<path>; the chrome page (Settings' sheet) asks with "api\t<id>\t<path>".
using ApiReply = std::function<void(const std::string& body, const wchar_t* type, int status)>;

static void ApiData(const std::wstring& path, ApiReply reply) {
    if (path == L"/ntp.json") reply(Utf8(NewTabJson()), L"application/json", 200);
    // Answered at once from the last look for other browsers to import from, with a fresh look behind it that Settings
    // hears of (importSources); only the first one waits for it (about 120 ms), as every Settings open did.
    else if (path == L"/state.json" && g_browsersAt && !BrowsersFresh()) {
        reply(Utf8(StateJson()), L"application/json", 200);
        WhenBrowsersKnown([] { if (g.uiReady) UiPost(L"{\"t\":\"importSources\"}"); });
    }
    else if (path == L"/state.json") WhenBrowsersKnown([reply] { reply(Utf8(StateJson()), L"application/json", 200); });
    else if (path == L"/bookmarks.json") reply(Utf8(BookmarksJson()), L"application/json", 200);
    else if (path == L"/history.json") reply(Utf8(HistoryJson()), L"application/json", 200);
    else if (path == L"/history-recent.json") reply(Utf8(RecentHistoryJson()), L"application/json", 200);
    else if (path == L"/downloads.json") reply(Utf8(DownloadsJson(true)), L"application/json", 200);
    // /icon/<site>: the icon this browser already has for a site (Exo Vault's rows), never fetched for it.
    else if (path.rfind(L"/icon/", 0) == 0) reply(Utf8(Json(FavFor(L"https://" + path.substr(6) + L"/"))), L"application/json", 200);
    else if (path.rfind(L"/exticon/", 0) == 0) {
        // /exticon/<extension id>/<path inside it>: as a data: URL in JSON, which both kinds of page can use.
        std::wstring rest = path.substr(9);
        std::wstring id = rest.substr(0, rest.find(L'/'));
        std::wstring rel = rest.substr(std::min(rest.size(), id.size() + 1));
        auto it = g_extFolders.find(id);
        if (it == g_extFolders.end() || rel.find(L"..") != std::wstring::npos) { reply("null", L"application/json", 200); return; }
        for (auto& c : rel) if (c == L'/') c = L'\\';
        std::wstring data = FileDataUrl(it->second + L"\\" + rel);
        reply(Utf8(Json(data)), L"application/json", 200);
    } else if (path == L"/extensions.json") {
        ComPtr<ICoreWebView2Profile7> p7 = TabProfile();
        if (!p7) { reply("[]", L"application/json", 200); return; }
        p7->GetBrowserExtensions(Callback<ICoreWebView2ProfileGetBrowserExtensionsCompletedHandler>(
            [reply](HRESULT hr, ICoreWebView2BrowserExtensionList* list) -> HRESULT {
                reply(Utf8(ExtensionsJson(hr, list)), L"application/json", 200);
                return S_OK;
            }).Get());
    } else {
        reply("", L"text/plain", 404);
    }
}

static void Respond(ICoreWebView2WebResourceRequestedEventArgs* a, const std::string& body, const wchar_t* type, int status) {
    ComPtr<IStream> stream;
    stream.Attach(SHCreateMemStream((const BYTE*)body.data(), (UINT)body.size()));
    ComPtr<ICoreWebView2WebResourceResponse> response;
    std::wstring headers = std::wstring(L"Content-Type: ") + type +
                           L"\r\nAccess-Control-Allow-Origin: https://newtab.exo\r\nCache-Control: no-store";
    g.env->CreateWebResourceResponse(stream.Get(), status, status == 200 ? L"OK" : L"Not Found", headers.c_str(), &response);
    a->put_Response(response.Get());
}

static void ServeApi(ICoreWebView2WebResourceRequestedEventArgs* a) {
    ComPtr<ICoreWebView2WebResourceRequest> request;
    LPWSTR uri = nullptr;
    a->get_Request(&request);
    request->get_Uri(&uri);
    std::wstring path = Take(uri).substr(wcslen(L"https://api.newtab.exo"));
    path = path.substr(0, path.find(L'?'));
    ComPtr<ICoreWebView2Deferral> deferral;
    a->GetDeferral(&deferral);
    ComPtr<ICoreWebView2WebResourceRequestedEventArgs> args = a;
    ApiData(path, [args, deferral](const std::string& body, const wchar_t* type, int status) {
        Respond(args.Get(), body, type, status);
        deferral->Complete();
    });
}

// ---------------------------------------------------------------------------------------
// The Chrome Web Store's own "Add to Chrome" button installs into Exo instead.

extern const wchar_t kStoreScriptRef[] =
    L"(() => { if (location.hostname !== 'chromewebstore.google.com') return;"
    L" const idOf = () => (location.pathname.match(/\\/detail\\/(?:[^/]+\\/)?([a-p]{32})/) || [])[1];"
    L" const words = /^(add to chrome|switch to chrome|add to edge|add extension|get|install)$/i;"
    L" const fix = () => { const id = idOf(); if (!id) return;"
    L"  for (const b of document.querySelectorAll('button, a[role=button], a[href*=\"google.com/chrome\"]')) {"
    L"   const text = (b.innerText || '').trim(); if (b.dataset.exo === id || !(words.test(text) || b.dataset.exo)) continue;"
    L"   b.dataset.exo = id; b.removeAttribute('disabled'); b.setAttribute('aria-disabled', 'false'); b.style.pointerEvents = 'auto';"
    L"   const label = [...b.querySelectorAll('span, div')].reverse().find((s) => words.test((s.innerText || '').trim())) || b;"
    L"   label.textContent = 'Add to Exo';"
    L"   if (!b.dataset.exoBound) { b.dataset.exoBound = '1'; b.addEventListener('click', (e) => { e.preventDefault(); e.stopImmediatePropagation();"
    L"    window.chrome.webview.postMessage('exo-install\\t' + idOf()); }, true); } } };"
    L" new MutationObserver(fix).observe(document, { subtree: true, childList: true, characterData: true }); })();";

// Store extensions, installed one after another (each is a download).
static std::vector<std::wstring> g_installQueue;
static bool g_installing = false;

static void InstallNext() {
    if (g_installing || g_installQueue.empty()) return;
    g_installing = true;
    std::wstring id = g_installQueue.front();
    g_installQueue.erase(g_installQueue.begin());
    InstallFromStore(id);
}

static void InstallStoreExtension(const std::wstring& id) {
    if (!IsStoreId(id)) { Toast(L"That is not a Chrome Web Store extension."); return; }
    g_installQueue.push_back(id);
    InstallNext();
}

// ---------------------------------------------------------------------------------------
// Window states

static void OpenOverlay(const wchar_t* mode, const std::wstring& text) {
    if (!g.uiReady) return;
    LeaveFullscreen();  // search needs the Bar, which full screen hides
    bool was = g.overlay;
    g.overlay = true;
    SetRevealed(true);
    Tab* a = Active();
    UiPost(std::wstring(L"{\"t\":\"overlay\",\"mode\":\"") + mode + L"\",\"url\":" + Json(a ? a->url : L"") +
           L",\"text\":" + Json(text) + L"}");
    FocusTarget(kUi);
}

// tell: the host let go on its own (a page opened, a link from another app), so the chrome page closes what it
// has open (Settings, a menu, search) instead of leaving it on screen with no mouse.
static void CloseOverlay(bool tell = true) {
    if (!g.overlay) return;
    g.overlay = false;
    if (tell) UiPost(L"{\"t\":\"overlay.closed\"}");
    SetBlur(g.peekId != 0);
    POINT pt;
    GetCursorPos(&pt);
    ScreenToClient(g.hwnd, &pt);
    AutoHideTrack(pt, false);
    if (Tab* p = FindTab(g.peekId); p && p->ctl) FocusTarget(p->id);
    else if (Tab* a = Active(); a && a->ctl) FocusTarget(a->id);
}

static void SetFullscreen(bool on) {
    if (on == g.fullscreen) return;
    g.fullscreen = on;
    if (on) {
        // The Bar and everything over the page hide in full screen: a sheet or menu left open would keep the
        // window's input with nothing to show for it.
        CloseOverlay(true);
        GetWindowPlacement(g.hwnd, &g.placement);
        g.savedStyle = GetWindowLongPtrW(g.hwnd, GWL_STYLE);
        MONITORINFO mi{sizeof mi};
        GetMonitorInfoW(MonitorFromWindow(g.hwnd, MONITOR_DEFAULTTONEAREST), &mi);
        SetWindowLongPtrW(g.hwnd, GWL_STYLE, (g.savedStyle & ~WS_OVERLAPPEDWINDOW) | WS_POPUP);
        g.chromeLayer.IsVisible(false);
        SetWindowPos(g.hwnd, HWND_TOP, mi.rcMonitor.left, mi.rcMonitor.top, mi.rcMonitor.right - mi.rcMonitor.left,
                     mi.rcMonitor.bottom - mi.rcMonitor.top, SWP_FRAMECHANGED | SWP_NOOWNERZORDER);
    } else {
        SetWindowLongPtrW(g.hwnd, GWL_STYLE, g.savedStyle);
        g.chromeLayer.IsVisible(true);
        SetWindowPlacement(g.hwnd, &g.placement);
        SetWindowPos(g.hwnd, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED);
    }
    Layout();
    QueueState();
}

// Out of full screen for the window's own surfaces (a sheet, a menu, search), and out of a video's full screen
// when its tab is no longer the one on screen.
static void LeaveFullscreen() {
    if (!g.fullscreen) return;
    if (g.elementFullscreen) {
        // Only the tab on screen has a page in full screen (a script into every tab woke the ones asleep).
        if (Tab* a = Active(); a && a->core) a->core->ExecuteScript(L"document.fullscreenElement && document.exitFullscreen()", nullptr);
        g.elementFullscreen = false;
    }
    SetFullscreen(false);
}

// Air Traffic Control (Settings > Spaces): "routes" is site=space|site=space. A link from another app to that site, or
// to any of its subdomains, opens in that space; anything else in the space on screen.
static int RouteFor(const std::wstring& url) {
    std::wstring site = SiteOf(url);
    if (site.empty()) return 0;
    for (auto& r : Split(Setting(L"routes", L""), L'|')) {
        size_t eq = r.find(L'=');
        if (eq == std::wstring::npos || eq == 0) continue;
        std::wstring want = r.substr(0, eq);
        int id = _wtoi(r.c_str() + eq + 1);
        bool sub = site.size() > want.size() && site.compare(site.size() - want.size() - 1, want.size() + 1, L"." + want) == 0;
        if (FindSpace(id) && (site == want || sub)) return id;
    }
    return 0;
}

static void Navigate(const std::wstring& url, bool newTab) {
    Tab* a = Active();
    if (newTab || !a) {
        AddTab(url, true, a ? IndexOf(a->id) + 1 : g.tabs.size());
        return;
    }
    a->url = url;
    if (a->core) a->core->Navigate(url.c_str());
    else { a->pendingNav = url; EnsureView(a, nullptr); }
    QueueState();
}

// ---------------------------------------------------------------------------------------
// Copy link (Ctrl+Shift+C, Search's Copy link, a tab's menu): the tab's address without the tracking parts sites and
// their share buttons add to it (utm_ and the ad networks' click ids everywhere; si on YouTube and Spotify, s and t on X).

static std::wstring CleanUrl(const std::wstring& url) {
    size_t q = url.find(L'?');
    if (q == std::wstring::npos) return url;
    size_t hash = url.find(L'#', q);
    std::wstring query = url.substr(q + 1, hash == std::wstring::npos ? std::wstring::npos : hash - q - 1);
    std::wstring site = SiteOf(url);
    auto on = [&](std::initializer_list<const wchar_t*> sites) {
        for (std::wstring x : sites)
            if (site == x || (site.size() > x.size() && site.compare(site.size() - x.size() - 1, std::wstring::npos, L"." + x) == 0)) return true;
        return false;
    };
    static const std::unordered_set<std::wstring> kTrackers = {
        L"fbclid", L"gclid", L"dclid", L"gbraid", L"wbraid", L"gclsrc", L"msclkid", L"yclid", L"ttclid", L"twclid", L"li_fat_id",
        L"mc_cid", L"mc_eid", L"igshid", L"igsh", L"_hsenc", L"_hsmi", L"mkt_tok", L"oly_anon_id", L"oly_enc_id", L"rb_clickid",
        L"vero_id", L"wickedid", L"_gl", L"ref_src", L"ref_url", L"srsltid", L"epik", L"s_cid", L"spm"};
    std::wstring kept;
    for (auto& part : Split(query, L'&')) {
        if (part.empty()) continue;
        std::wstring name = part.substr(0, part.find(L'='));
        for (auto& c : name) c = towlower(c);
        bool track = name.rfind(L"utm_", 0) == 0 || kTrackers.count(name)
            || (name == L"si" && on({L"youtube.com", L"youtu.be", L"spotify.com"}))
            || ((name == L"s" || name == L"t") && on({L"x.com", L"twitter.com"}))
            || (part == L"feature=shared" && on({L"youtube.com", L"youtu.be"}));
        if (!track) kept += (kept.empty() ? L"" : L"&") + part;
    }
    return url.substr(0, q) + (kept.empty() ? L"" : L"?" + kept) + (hash == std::wstring::npos ? L"" : url.substr(hash));
}

static bool CopyText(const std::wstring& text) {
    if (!OpenClipboard(g.hwnd)) return false;
    EmptyClipboard();
    size_t bytes = (text.size() + 1) * sizeof(wchar_t);
    bool ok = false;
    if (HGLOBAL mem = GlobalAlloc(GMEM_MOVEABLE, bytes)) {
        memcpy(GlobalLock(mem), text.c_str(), bytes);
        GlobalUnlock(mem);
        ok = SetClipboardData(CF_UNICODETEXT, mem) != nullptr;
        if (!ok) GlobalFree(mem);
    }
    CloseClipboard();
    return ok;
}

static void CopyUrl(const std::wstring& url) {
    if (url.empty() || IsNewTab(url)) return;
    std::wstring clean = CleanUrl(url);
    if (CopyText(clean)) Toast(clean == url ? L"Link copied" : L"Link copied without its trackers");
}

static void CopyLink(Tab* t) {
    if (t) CopyUrl(t->url);
}

// Every page goes without the tracking parts of its address, wherever it came from (a shared link, an ad's redirect, a
// link from another app): the load stops and goes again, clean. Not Back, Forward or Reload, which go where they went,
// nor a form's post (its body would be lost), and a site that puts them straight back is let be the second time, or
// the two would go round. True when it went again.
static bool CleanNavigation(ICoreWebView2* core, ICoreWebView2NavigationStartingEventArgs* a, const std::wstring& url,
                            std::wstring& from, ULONGLONG& at) {
    if (url.rfind(L"https://", 0) != 0 && url.rfind(L"http://", 0) != 0) return false;
    std::wstring clean = CleanUrl(url);
    if (clean == url) return false;
    COREWEBVIEW2_NAVIGATION_KIND kind = COREWEBVIEW2_NAVIGATION_KIND_NEW_DOCUMENT;
    if (ComPtr<ICoreWebView2NavigationStartingEventArgs3> a3; SUCCEEDED(a->QueryInterface(IID_PPV_ARGS(&a3)))) a3->get_NavigationKind(&kind);
    if (kind != COREWEBVIEW2_NAVIGATION_KIND_NEW_DOCUMENT) return false;
    ComPtr<ICoreWebView2HttpRequestHeaders> headers;
    BOOL posted = FALSE;
    if (SUCCEEDED(a->get_RequestHeaders(&headers)) && headers) headers->Contains(L"Content-Type", &posted);
    if (posted) return false;
    ULONGLONG now = GetTickCount64();
    if (from == url && now - at < 10000) return false;
    from = url;
    at = now;
    a->put_Cancel(TRUE);
    core->Navigate(clean.c_str());
    return true;
}

// ---------------------------------------------------------------------------------------
// Ctrl+Tab: the space's tabs in the order you used them, as Alt+Tab goes through windows. A quick Ctrl+Tab goes back
// to the tab you were on before; held, the switcher shows after a moment and each Tab moves along it (Shift back).
// Letting go of Ctrl opens the one chosen (going round to the first stays; Windows keeps Ctrl+Esc for Start). Settings >
// General can make Ctrl+Tab go along the strip instead.

static const UINT kTimerSwitcher = 14;
static const ULONGLONG kSwitcherShowMs = 160;
struct Switcher { std::vector<int> ids; size_t sel = 0; ULONGLONG at = 0; bool shown = false; };
static Switcher g_switcher;

static void SwitcherSend() {
    std::wstring ids;
    for (int id : g_switcher.ids) ids += (ids.empty() ? L"" : L",") + std::to_wstring(id);
    UiPost(L"{\"t\":\"switcher\",\"ids\":[" + ids + L"],\"sel\":" + std::to_wstring(g_switcher.sel) + L"}");
}

static void SwitcherEnd(bool go) {
    if (g_switcher.ids.empty()) return;
    KillTimer(g.hwnd, kTimerSwitcher);
    int id = go ? g_switcher.ids[g_switcher.sel] : 0;
    bool shown = g_switcher.shown;
    g_switcher = {};
    if (shown) UiPost(L"{\"t\":\"switcher\",\"ids\":[]}");
    if (id && id != g.activeId && FindTab(id)) Activate(id);
}

static void SwitcherStep(int step) {
    if (g_switcher.ids.empty()) {
        auto tabs = SpaceTabs(g.space);
        if (tabs.size() < 2) return;
        // The tab on screen, then the others by when they were last on screen; ones never opened keep the strip's order.
        std::stable_sort(tabs.begin(), tabs.end(), [](Tab* a, Tab* b) {
            UINT64 x = a->id == g.activeId ? ~0ull : a->left, y = b->id == g.activeId ? ~0ull : b->left;
            return x > y;
        });
        for (Tab* t : tabs) g_switcher.ids.push_back(t->id);
        g_switcher.sel = step > 0 ? 1 : tabs.size() - 1;
        g_switcher.at = GetTickCount64();
        SetTimer(g.hwnd, kTimerSwitcher, 15, nullptr);
        return;
    }
    size_t n = g_switcher.ids.size();
    g_switcher.sel = (g_switcher.sel + n + step) % n;
    g_switcher.shown = true;
    SwitcherSend();
}

static void SwitcherForget(int id) {
    auto it = std::find(g_switcher.ids.begin(), g_switcher.ids.end(), id);
    if (it == g_switcher.ids.end()) return;
    size_t at = it - g_switcher.ids.begin();
    g_switcher.ids.erase(it);
    if (g_switcher.ids.size() < 2) { SwitcherEnd(false); return; }
    if (g_switcher.sel > at || g_switcher.sel >= g_switcher.ids.size()) g_switcher.sel = g_switcher.sel ? g_switcher.sel - 1 : 0;
    if (g_switcher.shown) SwitcherSend();
}

static void SwitcherTick() {
    if (g_switcher.ids.empty()) { KillTimer(g.hwnd, kTimerSwitcher); return; }
    if (GetAsyncKeyState(VK_CONTROL) >= 0) { SwitcherEnd(true); return; }
    if (!g_switcher.shown && GetTickCount64() - g_switcher.at >= kSwitcherShowMs) {
        g_switcher.shown = true;
        SwitcherSend();
    }
}

static void OnUiMessage(const std::wstring& msg);
// Ctrl+Shift+=: a new tab page beside the tab on screen, in split view.
static void OnUiMessageSplitNew() { OnUiMessage(L"split\t0"); }

static bool HandleKey(UINT vk, bool repeat, bool fromUi) {
    bool ctrl = GetKeyState(VK_CONTROL) < 0, shift = GetKeyState(VK_SHIFT) < 0, alt = GetKeyState(VK_MENU) < 0;
    // A sheet that waits for its own button: the Bar's keys (a new tab, Search, a tab switch) wait with everything else.
    // Alt+F4 still closes the window, as its own buttons do.
    if (g.modal) return (ctrl || alt || (vk >= VK_F1 && vk <= VK_F24)) && !(alt && !ctrl && vk == VK_F4);
    Tab* a = Active();
    if (g.peekId && !g.overlay) {
        if (vk == VK_ESCAPE && !ctrl && !alt) { ClosePeek(); return true; }
        if (vk == 'O' && ctrl && !alt && !shift) { ExpandPeek(); return true; }
    }
    if (ctrl && shift && !alt && (vk == VK_OEM_PLUS || vk == VK_ADD) && !repeat) { OnUiMessageSplitNew(); return true; }
    if (ctrl && !alt) {
        if (vk == VK_TAB && Setting(L"ctrlTab", L"recent") == L"recent") { SwitcherStep(shift ? -1 : 1); return true; }
        if (vk == VK_TAB || vk == VK_NEXT || vk == VK_PRIOR) {
            CycleTab((vk == VK_PRIOR || (vk == VK_TAB && shift)) ? -1 : 1);
            return true;
        }
        if (repeat) return vk == 'T' || vk == 'L' || vk == 'K' || vk == 'W' || vk == 'D' || vk == 'N' || vk == 'H' || vk == 'J';
        switch (vk) {
        case 'T': if (shift) ReopenClosed(); else NewTabPage(); return true;
        case 'N': if (shift) AddTab(kNewTab, true, NextPlace(), true); else NewTabPage(); return true;
        case 'D': if (!shift && a) ToggleBookmark(a->url, a->title); return !shift;
        case 'E': if (shift) { UiPost(L"{\"t\":\"extensions.open\"}"); return true; } return false;
        case 'H': if (!shift) { OpenSettings(L"history-full"); return true; } return false;
        case 'C': if (shift) { CopyLink(a); return true; } return false;
        case 'J': if (!shift) { OpenSettings(L"downloads"); return true; } return false;
        case 'L': OpenOverlay(L"edit"); return true;
        case 'K': if (g.overlay && g.tabs.size()) UiPost(L"{\"t\":\"close\"}"); else OpenOverlay(L"palette"); return true;
        case 'W': case VK_F4: if (a) CloseTab(a->id); return true;
        case 'F': if (!shift && a) { LeaveFullscreen(); UiPost(L"{\"t\":\"find\"}"); FocusTarget(kUi); } return !shift;
        case 'R': if (fromUi && a && a->core) ReloadTab(a); return fromUi;
        }
        if (vk >= '1' && vk <= '9') {
            // The tabs as the strip shows them: with side tabs, none inside a closed folder.
            auto tabs = SpaceTabs(g.space);
            if (Setting(L"tabs", L"horizontal") == L"vertical")
                std::erase_if(tabs, [](Tab* t) {
                    for (TabFolder* f = t->pinned ? FindFolder(t->folder) : nullptr; f; f = FindFolder(f->parent))
                        if (!f->open) return true;
                    return false;
                });
            if (tabs.empty()) return false;
            size_t i = vk == '9' ? tabs.size() - 1 : std::min<size_t>(vk - '1', tabs.size() - 1);
            Activate(tabs[i]->id);
            return true;
        }
        return false;
    }
    if (repeat) return false;
    if (alt && !ctrl) {
        // Alt+1 to Alt+9: the spaces, in their order (with one space, the page keeps the keys).
        if (!shift && vk >= '1' && vk <= '9' && g.spaces.size() > 1 && size_t(vk - '1') < g.spaces.size()) {
            SwitchSpace(g.spaces[vk - '1'].id);
            return true;
        }
        if (vk == 'D') { OpenOverlay(L"edit"); return true; }
        if (fromUi && a && a->core && (vk == VK_LEFT || vk == VK_RIGHT)) {
            if (vk == VK_LEFT) a->core->GoBack(); else a->core->GoForward();
            return true;
        }
        return false;
    }
    switch (vk) {
    case VK_F6: OpenOverlay(L"edit"); return true;
    case VK_F11: if (!g.elementFullscreen) SetFullscreen(!g.fullscreen); return true;
    case VK_F5: if (fromUi && a && a->core) { ReloadTab(a); return true; } return false;
    case VK_F3: if (a && a->find) { if (shift) a->find->FindPrevious(); else a->find->FindNext(); } return true;
    case VK_ESCAPE: if (g.fullscreen && !g.elementFullscreen && !fromUi) { SetFullscreen(false); return true; } return false;
    }
    return false;
}

// ---------------------------------------------------------------------------------------
// Little Exo (Settings > General > Links from other apps): a link from another app opens in a small window of its own
// over what you're doing, so a quick look never lands in your tabs. Its strip says where it is and offers Open in Exo
// Browser (Ctrl+O), which moves the page into a tab of the space its site belongs to; Ctrl+W closes it. Arc's Little
// Arc, Exo's way. A site with a space of its own (Air Traffic Control) still opens in that space.

static const wchar_t kLittleClass[] = L"ExoLittleWindow";
static const int kLittleStripDip = 44;
struct Little {
    HWND hwnd = nullptr;
    bool downloading = false;  // a file it started is still coming: closing it only hides it until then
    ComPtr<ICoreWebView2Controller> stripCtl, pageCtl;
    ComPtr<ICoreWebView2> strip, page;
    std::wstring url, title;
    bool loading = true;
    std::wstring cleanedFrom;  // as a tab's (CleanNavigation)
    ULONGLONG cleanedAt = 0;
};
static std::vector<std::unique_ptr<Little>> g_littles;

static Little* LittleOf(HWND hwnd) {
    for (auto& l : g_littles) if (l->hwnd == hwnd) return l.get();
    return nullptr;
}

static void LittleLayout(Little* l) {
    RECT rc;
    GetClientRect(l->hwnd, &rc);
    int strip = MulDiv(kLittleStripDip, GetDpiForWindow(l->hwnd), 96);
    if (l->stripCtl) l->stripCtl->put_Bounds({0, 0, rc.right, strip});
    if (l->pageCtl) l->pageCtl->put_Bounds({0, strip, rc.right, rc.bottom});
}

// The window's caption in the Appearance, and the strip's news: where the page is, its title, whether it loads.
static void LittleTell(Little* l) {
    BOOL dark = g.theme != L"light";
    DwmSetWindowAttribute(l->hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof dark);
    COLORREF caption = g.page;
    DwmSetWindowAttribute(l->hwnd, DWMWA_CAPTION_COLOR, &caption, sizeof caption);
    SetWindowTextW(l->hwnd, (l->title.empty() ? SiteOf(l->url) : l->title).c_str());
    if (l->strip)
        l->strip->PostWebMessageAsJson((L"{\"t\":\"little\",\"url\":" + Json(l->url) + L",\"title\":" + Json(l->title) +
                                        L",\"loading\":" + Bool(l->loading) + L",\"theme\":" + Json(g.theme) + L"}").c_str());
}

// A download from a Little Exo window: the window stays until the file is done, then goes if it was closed meanwhile.
static void LittleDownload(HWND hwnd) {
    if (!g_downloads.empty()) g_downloads.back().little = hwnd;
}

// Its downloads all done: the window closes if it was closed meanwhile.
static void LittleDownloaded(HWND hwnd) {
    Little* l = LittleOf(hwnd);
    if (!l || std::any_of(g_downloads.begin(), g_downloads.end(), [hwnd](auto& d) { return d.little == hwnd && (d.state == L"progress" || d.state == L"paused"); }))
        return;
    l->downloading = false;
    if (!IsWindowVisible(hwnd)) PostMessageW(hwnd, WM_CLOSE, 0, 0);
}

static void LittlesTheme() {
    for (auto& l : g_littles) LittleTell(l.get());
}

// Into the window: a tab in the space its site belongs to, on screen. (Closed with a message: never from inside one of
// its own pages' events.)
static void LittleToTab(Little* l) {
    std::wstring url = l->url;
    PostMessageW(l->hwnd, WM_CLOSE, 0, 0);
    if (url.empty()) return;
    if (IsIconic(g.hwnd)) ShowWindow(g.hwnd, SW_RESTORE);
    SetForegroundWindow(g.hwnd);
    CloseOverlay();
    if (int space = RouteFor(url)) EnterSpace(space);
    AddTab(url, true, NextPlace());
}

static void LittleCopy(Little* l) {
    if (!l->url.empty() && CopyText(CleanUrl(l->url)) && l->strip) l->strip->PostWebMessageAsJson(L"{\"t\":\"copied\"}");
}

static void LittleKeys(ICoreWebView2Controller* c, HWND hwnd) {
    EventRegistrationToken tok;
    c->add_AcceleratorKeyPressed(Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
        [hwnd](ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs* a) -> HRESULT {
            COREWEBVIEW2_KEY_EVENT_KIND kind;
            a->get_KeyEventKind(&kind);
            Little* l = LittleOf(hwnd);
            bool ctrl = GetKeyState(VK_CONTROL) < 0, shift = GetKeyState(VK_SHIFT) < 0, alt = GetKeyState(VK_MENU) < 0;
            if (kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN || !l || !ctrl || alt) return S_OK;
            UINT vk = 0;
            a->get_VirtualKey(&vk);
            if (vk == 'O' && !shift) LittleToTab(l);
            else if (vk == 'W' && !shift) PostMessageW(hwnd, WM_CLOSE, 0, 0);
            else if (vk == 'C' && shift) LittleCopy(l);
            else return S_OK;
            a->put_Handled(TRUE);
            return S_OK;
        }).Get(), &tok);
}

static LRESULT CALLBACK LittleProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    Little* l = LittleOf(hwnd);
    switch (msg) {
    case WM_CLOSE:
        // A file it started is still coming (WebView2 never finishes one whose page is gone): out of sight till then.
        if (l && l->downloading) { ShowWindow(hwnd, SW_HIDE); return 0; }
        break;
    case WM_SIZE:
        if (l) {
            LittleLayout(l);
            BOOL shown = wp != SIZE_MINIMIZED;
            if (l->pageCtl) l->pageCtl->put_IsVisible(shown);
            if (l->stripCtl) l->stripCtl->put_IsVisible(shown);
        }
        return 0;
    case WM_MOVE:
        if (l && l->pageCtl) l->pageCtl->NotifyParentWindowPositionChanged();
        if (l && l->stripCtl) l->stripCtl->NotifyParentWindowPositionChanged();
        break;
    case WM_DPICHANGED: {
        RECT* r = (RECT*)lp;
        SetWindowPos(hwnd, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }
    case WM_ACTIVATE:
        if (l && LOWORD(wp) != WA_INACTIVE && l->pageCtl) l->pageCtl->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        break;
    case WM_ERASEBKGND: {
        RECT rc;
        GetClientRect(hwnd, &rc);
        HBRUSH brush = CreateSolidBrush(g.page);
        FillRect((HDC)wp, &rc, brush);
        DeleteObject(brush);
        return 1;
    }
    case WM_DESTROY: {
        auto it = std::find_if(g_littles.begin(), g_littles.end(), [hwnd](auto& x) { return x->hwnd == hwnd; });
        if (it != g_littles.end()) {
            if ((*it)->pageCtl) (*it)->pageCtl->Close();
            if ((*it)->stripCtl) (*it)->stripCtl->Close();
            g_littles.erase(it);
        }
        return 0;
    }
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

static void OpenLittle(const std::wstring& url) {
    HINSTANCE inst = GetModuleHandleW(nullptr);
    static bool registered = false;
    if (!registered) {
        WNDCLASSEXW wc{sizeof(wc)};
        wc.lpfnWndProc = LittleProc;
        wc.hInstance = inst;
        wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(1));
        wc.lpszClassName = kLittleClass;
        registered = RegisterClassExW(&wc) != 0;
    }
    // In the middle of the screen the pointer is on; each one more a step down and right.
    POINT pt;
    GetCursorPos(&pt);
    MONITORINFO mi{sizeof(mi)};
    GetMonitorInfoW(MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST), &mi);
    RECT wa = mi.rcWork;
    int w = std::min<int>(MulDiv(780, g.dpi, 96), wa.right - wa.left), h = std::min<int>(MulDiv(640, g.dpi, 96), wa.bottom - wa.top);
    int step = MulDiv(28, g.dpi, 96) * (int)(g_littles.size() % 5);
    HWND hwnd = CreateWindowExW(0, kLittleClass, L"Little Exo", WS_OVERLAPPEDWINDOW, wa.left + (wa.right - wa.left - w) / 2 + step,
                                wa.top + (wa.bottom - wa.top - h) / 2 + step, w, h, nullptr, nullptr, inst, nullptr);
    if (!hwnd) return;
    auto little = std::make_unique<Little>();
    little->hwnd = hwnd;
    little->url = url;
    g_littles.push_back(std::move(little));
    LittleTell(g_littles.back().get());
    ShowWindow(hwnd, SW_SHOWNORMAL);
    SetForegroundWindow(hwnd);

    ComPtr<ICoreWebView2ControllerOptions> opts;
    g.env->CreateCoreWebView2ControllerOptions(&opts);
    opts->put_ProfileName(L"Default");
    // The strip, in Exo's look (ui/little.html).
    g.env->CreateCoreWebView2ControllerWithOptions(hwnd, opts.Get(), Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
        [hwnd](HRESULT hr, ICoreWebView2Controller* c) -> HRESULT {
            Little* l = LittleOf(hwnd);
            if (!l || FAILED(hr) || !c) {
                if (c) c->Close();
                return S_OK;
            }
            l->stripCtl = c;
            c->get_CoreWebView2(&l->strip);
            if (ComPtr<ICoreWebView2Controller2> c2; SUCCEEDED(c->QueryInterface(IID_PPV_ARGS(&c2)))) c2->put_DefaultBackgroundColor(NewTabColor());
            ComPtr<ICoreWebView2Settings> s;
            l->strip->get_Settings(&s);
            s->put_IsStatusBarEnabled(FALSE);
            s->put_IsZoomControlEnabled(FALSE);
            s->put_AreDefaultContextMenusEnabled(FALSE);
            s->put_AreDevToolsEnabled(FALSE);
            if (ComPtr<ICoreWebView2_3> c3; SUCCEEDED(l->strip.As(&c3)))
                c3->SetVirtualHostNameToFolderMapping(L"exo.browser", (g.exeDir + L"\\ui").c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
            EventRegistrationToken tok;
            if (ComPtr<ICoreWebView2Controller4> c4; SUCCEEDED(c->QueryInterface(IID_PPV_ARGS(&c4)))) c4->put_AllowExternalDrop(FALSE);
            l->strip->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                [hwnd](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* a) -> HRESULT {
                    LPWSTR m = nullptr, source = nullptr;
                    a->get_Source(&source);
                    Little* l = LittleOf(hwnd);
                    if (!l || Take(source) != L"https://exo.browser/little.html" || FAILED(a->TryGetWebMessageAsString(&m))) return S_OK;
                    std::wstring msg = Take(m);
                    if (msg == L"ready") LittleTell(l);
                    else if (msg == L"open") LittleToTab(l);
                    else if (msg == L"copy") LittleCopy(l);
                    return S_OK;
                }).Get(), &tok);
            LittleKeys(c, hwnd);
            LittleLayout(l);
            l->strip->Navigate(L"https://exo.browser/little.html");
            return S_OK;
        }).Get());
    // The page, on your profile like your tabs, with your boosts; a link it opens in a new window becomes a tab.
    g.env->CreateCoreWebView2ControllerWithOptions(hwnd, opts.Get(), Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
        [hwnd](HRESULT hr, ICoreWebView2Controller* c) -> HRESULT {
            Little* l = LittleOf(hwnd);
            if (!l || FAILED(hr) || !c) {
                if (c) c->Close();
                return S_OK;
            }
            l->pageCtl = c;
            c->get_CoreWebView2(&l->page);
            // White under a page that paints no background of its own, as in a tab.
            if (ComPtr<ICoreWebView2Controller2> c2; SUCCEEDED(c->QueryInterface(IID_PPV_ARGS(&c2)))) c2->put_DefaultBackgroundColor({255, 255, 255, 255});
            l->page->AddScriptToExecuteOnDocumentCreated(BoostScript().c_str(), nullptr);
            EventRegistrationToken tok;
            l->page->add_SourceChanged(Callback<ICoreWebView2SourceChangedEventHandler>(
                [hwnd](ICoreWebView2* core, ICoreWebView2SourceChangedEventArgs*) -> HRESULT {
                    if (Little* l = LittleOf(hwnd)) {
                        LPWSTR u = nullptr;
                        core->get_Source(&u);
                        l->url = Take(u);
                        LittleTell(l);
                    }
                    return S_OK;
                }).Get(), &tok);
            l->page->add_DocumentTitleChanged(Callback<ICoreWebView2DocumentTitleChangedEventHandler>(
                [hwnd](ICoreWebView2* core, IUnknown*) -> HRESULT {
                    if (Little* l = LittleOf(hwnd)) {
                        LPWSTR t = nullptr;
                        core->get_DocumentTitle(&t);
                        l->title = Take(t);
                        LittleTell(l);
                    }
                    return S_OK;
                }).Get(), &tok);
            l->page->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>(
                [hwnd](ICoreWebView2* core, ICoreWebView2NavigationStartingEventArgs* a) -> HRESULT {
                    Little* l = LittleOf(hwnd);
                    if (!l) return S_OK;
                    LPWSTR u = nullptr;
                    a->get_Uri(&u);
                    if (CleanNavigation(core, a, Take(u), l->cleanedFrom, l->cleanedAt)) return S_OK;
                    l->loading = true;
                    LittleTell(l);
                    return S_OK;
                }).Get(), &tok);
            l->page->add_NavigationCompleted(Callback<ICoreWebView2NavigationCompletedEventHandler>(
                [hwnd](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs*) -> HRESULT {
                    if (Little* l = LittleOf(hwnd)) {
                        l->loading = false;
                        LittleTell(l);
                        RecordVisit(l->url, l->title);
                    }
                    return S_OK;
                }).Get(), &tok);
            l->page->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* a) -> HRESULT {
                    // A popup the page sized or placed (a sign-in) opens as a window of its own and can answer the page;
                    // a link in a new window becomes a tab.
                    ComPtr<ICoreWebView2WindowFeatures> features;
                    BOOL sized = FALSE, placed = FALSE;
                    if (SUCCEEDED(a->get_WindowFeatures(&features)) && features) { features->get_HasSize(&sized); features->get_HasPosition(&placed); }
                    if (sized || placed) return S_OK;
                    LPWSTR u = nullptr;
                    a->get_Uri(&u);
                    std::wstring url = Take(u);
                    a->put_Handled(TRUE);
                    if (url.rfind(L"http", 0) == 0) {
                        AddTab(url, true, NextPlace());
                        if (IsIconic(g.hwnd)) ShowWindow(g.hwnd, SW_RESTORE);
                        SetForegroundWindow(g.hwnd);
                    }
                    return S_OK;
                }).Get(), &tok);
            l->page->add_WindowCloseRequested(Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
                [hwnd](ICoreWebView2*, IUnknown*) -> HRESULT {
                    PostMessageW(hwnd, WM_CLOSE, 0, 0);
                    return S_OK;
                }).Get(), &tok);
            if (ComPtr<ICoreWebView2_4> c4; SUCCEEDED(l->page.As(&c4)))
                c4->add_DownloadStarting(Callback<ICoreWebView2DownloadStartingEventHandler>(
                    [hwnd](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* a) -> HRESULT {
                        TrackDownload(a, 0);
                        if (Little* l = LittleOf(hwnd)) { l->downloading = true; LittleDownload(hwnd); }
                        return S_OK;
                    }).Get(), &tok);
            LittleKeys(c, hwnd);
            LittleLayout(l);
            l->page->Navigate(l->url.c_str());
            if (GetForegroundWindow() == hwnd) c->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
            return S_OK;
        }).Get());
}

// ---------------------------------------------------------------------------------------
// Messages from a new tab page (checked to come from its origin).

static void OnNewTabMessage(int id, const std::wstring& msg) {
    auto p = Split(msg, L'\t');
    auto arg = [&](size_t i) { return i < p.size() ? p[i] : std::wstring(); };
    Tab* t = FindTab(id);
    if (!t) return;
    const std::wstring& v = p[0];
    if (v == L"open") {
        std::wstring url = arg(1);
        if (url.rfind(L"http://", 0) != 0 && url.rfind(L"https://", 0) != 0) return;
        if (arg(2) == L"new") AddTab(url, false, IndexOf(id) + 1);
        else if (t->core) t->core->Navigate(url.c_str());
    } else if (v == L"palette") {
        if (id == g.activeId) OpenOverlay(L"ntp", arg(1));
    } else if (v == L"unbookmark") {
        RemoveBookmark(arg(1));
    } else if (v == L"forget") {
        std::wstring site = SiteOf(arg(1));
        for (auto it = g.history.begin(); it != g.history.end();)
            it = SiteOf(it->first) == site ? g.history.erase(it) : std::next(it);
        SaveHistory();
        SendHistory();
        RefreshNewTabs();
    } else if (v == L"settings") {
        OpenSettings(arg(1));
    } else if (v == L"bookmarkMove") {  // dragging a card; nothing else of the chrome page's is the page's to ask
        OnUiMessage(msg);
        RefreshNewTabs();
    }
}

// ---------------------------------------------------------------------------------------
// Updates: the newest release of Exo Browser on GitHub, asked when the browser starts and twice a day, and installed
// when you choose. Its Setup is downloaded, checked against the SHA-256 the
// release publishes beside it, then run silently: it closes this window (which saves your tabs), swaps the app and
// opens it again. GitHub sees the address it's asked from and "ExoBrowser/<version>"; nothing else is sent.

static const wchar_t kReleases[] = L"https://github.com/UhhErix/ExoBrowser/releases";
// Exo's update address (Exo Launcher's cloud/updates): it answers from GitHub's releases, or its own mirror when GitHub
// can't, so a move of the downloads (an account renamed) never strands an installed copy again. GitHub itself is asked
// only when it doesn't answer.
static const wchar_t kUpdates[] = L"https://updates.getexo.app/v1/browser";
static const UINT WM_APP_UPDATE = WM_APP + 6;  // lParam: new UpdateNews*
static const UINT kTimerUpdate = 12;
static const UINT kUpdateEveryMs = 12 * 60 * 60 * 1000;

// What the page shows: idle, checking, current, available, downloading, installing or error.
// notes: the newer release's whats-new.json (its What's New items, which the page checks before showing).
// from: where the release's files come from, up to their tag ("<kUpdates>/download/v" or "<kReleases>/download/v").
// opening: found by the check as the window opened (the update sheet offers it); a later check only updates About.
struct UpdateNews { std::wstring state, latest, message, file; int percent = -1; bool quiet = false; std::wstring notes, from; bool opening = false; };
static UpdateNews g_update{L"idle"};
static bool g_updateBusy = false;

static std::vector<int> VersionParts(const std::wstring& v) {
    std::vector<int> parts;
    for (auto& p : Split(v, L'.')) parts.push_back(_wtoi(p.c_str()));
    while (parts.size() < 3) parts.push_back(0);
    return parts;
}
static bool Newer(const std::wstring& latest) { return VersionParts(latest) > VersionParts(EXO_VERSION_W); }

// Installing replaces the copy Setup put in %LOCALAPPDATA%\ExoBrowser\app; a copy run from anywhere else (a build)
// can see an update but not install it over itself. EXO_UPDATE_ANYWHERE lets a test build try the whole path.
static bool InstalledCopy() {
    if (GetEnvironmentVariableW(L"EXO_UPDATE_ANYWHERE", nullptr, 0) > 0) return true;
    return _wcsicmp(g.exeDir.c_str(), (KnownFolder(FOLDERID_LocalAppData) + L"\\ExoBrowser\\app").c_str()) == 0;
}

static void SendUpdate() {
    UiPost(L"{\"t\":\"update\",\"state\":" + Json(g_update.state) + L",\"version\":" + Json(EXO_VERSION_W) + L",\"latest\":" +
           Json(g_update.latest) + L",\"message\":" + Json(g_update.message) + L",\"percent\":" + std::to_wstring(g_update.percent) +
           L",\"checked\":" + std::to_wstring(_wtoi64(Setting(L"updateChecked", L"0").c_str())) + L",\"installable\":" +
           (InstalledCopy() ? L"true" : L"false") + L",\"opening\":" + (g_update.opening ? L"true" : L"false") + L",\"notes\":" + Json(g_update.notes) + L"}");
}

static void PostUpdate(HWND hwnd, UpdateNews news) { PostMessageW(hwnd, WM_APP_UPDATE, 0, (LPARAM)new UpdateNews(std::move(news))); }

// One HTTPS GET, off the UI thread, for what `why` names (EgressAllowed): the body, or into a file with progress, or
// (follow off) a redirect's Location.
static bool HttpGet(Egress why, const std::wstring& url, std::string* body, std::wstring* location = nullptr, HANDLE file = nullptr,
                    const std::function<void(int)>& progress = nullptr, size_t limit = 1024 * 1024) {
    if (!EgressAllowed(why, url)) return false;
    wchar_t host[256] = {}, path[2048] = {};
    URL_COMPONENTS u{sizeof u};
    u.lpszHostName = host;
    u.dwHostNameLength = ARRAYSIZE(host);
    u.lpszUrlPath = path;
    u.dwUrlPathLength = ARRAYSIZE(path);
    if (!WinHttpCrackUrl(url.c_str(), 0, 0, &u)) return false;
    std::wstring agent = std::wstring(L"ExoBrowser/") + EXO_VERSION_W;
    HINTERNET session = WinHttpOpen(agent.c_str(), WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) return false;
    WinHttpSetTimeouts(session, 10000, 10000, 15000, 30000);
    HINTERNET connect = WinHttpConnect(session, host, u.nPort, 0);
    HINTERNET request = connect ? WinHttpOpenRequest(connect, L"GET", path, nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE) : nullptr;
    bool ok = false;
    if (request) {
        if (location) {
            DWORD never = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
            WinHttpSetOption(request, WINHTTP_OPTION_REDIRECT_POLICY, &never, sizeof never);
        }
        DWORD status = 0, size = sizeof status;
        if (WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) && WinHttpReceiveResponse(request, nullptr) &&
            WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX)) {
            if (location) {
                wchar_t where[2048] = {};
                DWORD bytes = sizeof where;
                ok = status / 100 == 3 && WinHttpQueryHeaders(request, WINHTTP_QUERY_LOCATION, WINHTTP_HEADER_NAME_BY_INDEX, where, &bytes, WINHTTP_NO_HEADER_INDEX);
                if (ok) *location = where;
            } else if (status == 200) {
                DWORD total = 0;
                size = sizeof total;
                WinHttpQueryHeaders(request, WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &total, &size, WINHTTP_NO_HEADER_INDEX);
                ok = true;
                unsigned long long got = 0;
                int shown = -1;
                std::vector<char> buffer(64 * 1024);
                for (;;) {
                    DWORD read = 0;
                    if (!WinHttpReadData(request, buffer.data(), (DWORD)buffer.size(), &read)) { ok = false; break; }
                    if (!read) break;
                    if (file) {
                        DWORD written = 0;
                        if (!WriteFile(file, buffer.data(), read, &written, nullptr) || written != read) { ok = false; break; }
                    } else if (body) {
                        body->append(buffer.data(), read);
                        if (body->size() > limit) { ok = false; break; }  // a page, not what was asked (a release note, a feed)
                    }
                    got += read;
                    if (progress && total) {
                        int percent = (int)(got * 100 / total);
                        if (percent != shown) progress(shown = percent);
                    }
                }
                if (ok && total && got != total) ok = false;
            }
        }
        WinHttpCloseHandle(request);
    }
    if (connect) WinHttpCloseHandle(connect);
    WinHttpCloseHandle(session);
    return ok;
}

static std::string Sha256File(const std::wstring& path) {
    HANDLE f = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr);
    if (f == INVALID_HANDLE_VALUE) return {};
    BCRYPT_HASH_HANDLE hash = nullptr;
    std::string hex;
    if (BCRYPT_SUCCESS(BCryptCreateHash(BCRYPT_SHA256_ALG_HANDLE, &hash, nullptr, 0, nullptr, 0, 0))) {
        std::vector<BYTE> buffer(1 << 20);
        DWORD read = 0;
        bool ok = true;
        while (ok && ReadFile(f, buffer.data(), (DWORD)buffer.size(), &read, nullptr) && read)
            ok = BCRYPT_SUCCESS(BCryptHashData(hash, buffer.data(), read, 0));
        BYTE digest[32];
        if (ok && BCRYPT_SUCCESS(BCryptFinishHash(hash, digest, sizeof digest, 0)))
            for (BYTE b : digest) { char h[3]; sprintf_s(h, "%02x", b); hex += h; }
        BCryptDestroyHash(hash);
    }
    CloseHandle(f);
    return hex;
}

// Asks Exo's update address (GitHub when it doesn't answer) which release is the newest. quiet: an automatic check,
// which shows nothing while it runs. opening: the one as the window opens, whose news the update sheet offers.
static void UpdateCheck(bool quiet, bool opening = false) {
    if (g_updateBusy) return;
    g_updateBusy = true;
    if (!quiet) {
        g_update = {L"checking"};
        SendUpdate();
    }
    HWND hwnd = g.hwnd;
    std::thread([hwnd, quiet, opening] {
        UpdateNews news;
        news.quiet = quiet;
        news.opening = opening;
        // A version is digits and dots, nothing else (it goes into the files' addresses).
        auto version = [](std::wstring tag) {
            if (!tag.empty() && (tag[0] == L'v' || tag[0] == L'V')) tag.erase(0, 1);
            bool ok = !tag.empty() && iswdigit(tag[0]) && std::all_of(tag.begin(), tag.end(), [](wchar_t c) { return iswdigit(c) || c == L'.'; });
            return ok ? tag : std::wstring();
        };
        // Exo's update address: {"app":"browser","tag":"v1.2.0","version":"1.2.0",...}.
        std::string latest;
        std::wstring tag;
        if (HttpGet(Egress::Update, std::wstring(kUpdates) + L"/latest", &latest) && latest.size() <= 16 * 1024) {
            size_t at = latest.find("\"version\":\"");
            if (at != std::string::npos) tag = version(Wide(latest.substr(at + 11, latest.find('"', at + 11) - at - 11)));
            if (!tag.empty()) news.from = std::wstring(kUpdates) + L"/download/v";
        }
        // GitHub itself when it didn't answer: its latest release's page names the tag.
        std::wstring where;
        if (tag.empty() && HttpGet(Egress::Update, std::wstring(kReleases) + L"/latest", nullptr, &where)) {
            size_t at = where.rfind(L"/tag/");
            tag = version(at == std::wstring::npos ? L"" : where.substr(at + 5));
            if (!tag.empty()) news.from = std::wstring(kReleases) + L"/download/v";
        }
        if (tag.empty()) {
            news.state = L"error";
            news.message = L"Couldn't check for updates. Try again in a moment.";
            LogLine(L"update check: neither Exo's update address nor GitHub answered");
        } else {
            if (news.from.rfind(kUpdates, 0) != 0) LogLine(L"update check: Exo's update address didn't answer; GitHub did (" + tag + L")");
            news.latest = tag;
            news.state = Newer(tag) ? L"available" : L"current";
            // Its What's New, from beside its Setup (none on a release without one).
            std::string notes;
            if (news.state == L"available" && HttpGet(Egress::Update, news.from + tag + L"/whats-new.json", &notes) && notes.size() <= 64 * 1024)
                news.notes = Wide(notes);
        }
        PostUpdate(hwnd, std::move(news));
    }).detach();
}

// Downloads the release's Setup and its SHA-256, checks one against the other, and has it run.
static void UpdateInstall() {
    // Available, or again after a download or install that failed (the update sheet's Try again).
    if (g_updateBusy || (g_update.state != L"available" && g_update.state != L"error") || g_update.latest.empty()) return;
    if (!InstalledCopy()) {
        g_update.state = L"error";
        g_update.message = L"This copy of Exo Browser wasn't installed by its Setup, so it can't update itself.";
        SendUpdate();
        return;
    }
    g_updateBusy = true;
    std::wstring version = g_update.latest, notes = g_update.notes, from = g_update.from;
    g_update = {L"downloading", version};
    g_update.notes = notes;
    g_update.percent = 0;
    SendUpdate();
    std::wstring dir = g.dataDir + L"\\Updates";
    CreateDirectoryW(dir.c_str(), nullptr);
    HWND hwnd = g.hwnd;
    std::thread([hwnd, version, dir, from] {
        // From where the check found it (Exo's update address, or GitHub), and GitHub if that doesn't answer now.
        std::wstring github = std::wstring(kReleases) + L"/download/v";
        std::wstring base = (from.empty() ? github : from) + version + L"/ExoBrowser-Setup.exe";
        std::wstring file = dir + L"\\ExoBrowser-Setup-" + version + L".exe", part = file + L".part";
        UpdateNews news{L"error", version};
        std::string sum;
        bool summed = HttpGet(Egress::Update, base + L".sha256", &sum) && sum.size() >= 64;
        if (!summed && base.rfind(github, 0) != 0) {
            base = github + version + L"/ExoBrowser-Setup.exe";
            sum.clear();
            summed = HttpGet(Egress::Update, base + L".sha256", &sum) && sum.size() >= 64;
        }
        if (!summed) {
            news.message = L"Couldn't get the update's checksum. Try again in a moment.";
            LogLine(L"update to " + version + L": no checksum from " + base + L".sha256");
            PostUpdate(hwnd, std::move(news));
            return;
        }
        std::string expected = sum.substr(0, 64);
        for (auto& c : expected) c = (char)tolower((unsigned char)c);
        HANDLE f = CreateFileW(part.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, 0, nullptr);
        bool got = f != INVALID_HANDLE_VALUE && HttpGet(Egress::Update, base, nullptr, nullptr, f, [hwnd, version](int percent) {
            UpdateNews step{L"downloading", version};
            step.percent = percent;
            PostUpdate(hwnd, std::move(step));
        });
        if (f != INVALID_HANDLE_VALUE) CloseHandle(f);
        // What went wrong, with where the file came from (a public address), for Copy logs.
        if (!got) {
            DeleteFileW(part.c_str());
            news.message = L"The download didn't finish. Try again.";
            LogLine(L"update to " + version + L": the download from " + base + L" didn't finish");
        } else if (Sha256File(part) != expected) {
            DeleteFileW(part.c_str());
            news.message = L"The download didn't match its checksum, so it wasn't installed. Try again.";
            LogLine(L"update to " + version + L": the download from " + base + L" didn't match its checksum");
        } else if (!MoveFileExW(part.c_str(), file.c_str(), MOVEFILE_REPLACE_EXISTING)) {
            news.message = L"The update couldn't be saved. Try again.";
            LogLine(L"update to " + version + L": saving the download failed (error " + std::to_wstring(GetLastError()) + L")");
        } else {
            news.state = L"installing";
            news.file = file;
        }
        PostUpdate(hwnd, std::move(news));
    }).detach();
}

static void OnUpdateNews(UpdateNews* raw) {
    std::unique_ptr<UpdateNews> news(raw);
    if (news->state == L"downloading") {  // progress
        if (g_update.state == L"downloading") { g_update.percent = news->percent; SendUpdate(); }
        return;
    }
    g_updateBusy = false;
    if (news->state == L"current" || news->state == L"available") {
        g.settings[L"updateChecked"] = std::to_wstring(NowSeconds());
        SaveSettings();
    }
    // A quiet check that failed leaves what was shown before (no network on the train is no news).
    if (news->quiet && news->state == L"error") return;
    // The update before this start didn't take (Setup ran, and here is the same version): said as a failure as the window
    // opens, so the sheet offers Try again and Not now from the start, not Update now again and again.
    if (news->opening) {
        std::wstring tried = Setting(L"updateTried", L"");
        if (!tried.empty() && !Newer(tried)) {
            g.settings.erase(L"updateTried");
            SaveSettings();
        } else if (news->state == L"available" && !tried.empty() && tried == news->latest) {
            news->state = L"error";
            news->message = L"The last update didn't finish. Try again.";
            LogLine(L"update to " + tried + L": Setup ran, but this start is still " EXO_VERSION_W);
        }
    }
    // Found by the automatic check: said once per version, then waiting in Settings > About.
    // Found as the window opened, the update sheet offers it; found later, it waits in Settings > About (a release that
    // comes out while the window is open never interrupts it: the next open offers it).
    // The install's own news keeps the notes its check brought.
    if (news->notes.empty() && !news->latest.empty() && news->latest == g_update.latest) news->notes = g_update.notes;
    g_update = *news;
    // EXO_UPDATE_DRYRUN: a test build stops here, with Setup downloaded and checked but not run.
    if (news->state == L"installing" && GetEnvironmentVariableW(L"EXO_UPDATE_DRYRUN", nullptr, 0) > 0) {
        SendUpdate();
        return;
    }
    if (news->state == L"installing") {
        // Setup runs silently: it closes this window (saving your tabs), installs and opens Exo Browser again.
        STARTUPINFOW si{sizeof si};
        PROCESS_INFORMATION pi{};
        std::wstring line = L"\"" + news->file + L"\" /S";
        // Started in Updates, not the app folder it replaces (that would hold it in use). Written with two backslashes:
        // the compiler drops a lone one, and 1.1.3 to 1.1.6 asked for a folder that doesn't exist, so Setup never ran.
        std::wstring updates = g.dataDir + L"\\Updates";
        if (CreateProcessW(news->file.c_str(), line.data(), nullptr, nullptr, FALSE, 0, nullptr, updates.c_str(), &si, &pi)) {
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
            // Should the next start come back on this version, the update didn't take: that start says so.
            g.settings[L"updateTried"] = news->latest;
            SaveSettings();
            LogLine(L"update to " + news->latest + L": Setup started");
        } else {
            LogLine(L"update to " + news->latest + L": Setup couldn't be started (error " + std::to_wstring(GetLastError()) + L")");
            g_update = {L"error", news->latest, L"Setup couldn't be started. Try again."};
        }
    }
    SendUpdate();
}

// The automatic check: shortly after start, then every twelve hours.
static void UpdateTick() {
    // A game running (GameRunning): asked again in half an hour, not now.
    if (GameRunning()) { SetTimer(g.hwnd, kTimerUpdate, 30 * 60 * 1000, nullptr); return; }
    SetTimer(g.hwnd, kTimerUpdate, kUpdateEveryMs, nullptr);
    // Always, as Exo Launcher looks for its own: only a benefit, since nothing installs until you choose Install update
    // (a switch to stop it was removed in 1.1.5).
    UpdateCheck(true);
}

// Earlier updates' Setups, once they're done with (a Setup still running is in use and stays).
// Copy logs, beside an error the page shows (the update sheet's): Exo Browser's version, Windows' and WebView2's, where it
// happened, the error and exo.log's last 40 lines, on the clipboard for a report. Nothing personal: the log never
// holds a page's address or a path on this PC.
static void CopyLogs(const std::wstring& error, const std::wstring& area) {
    const wchar_t* nt = L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
    wchar_t build[32] = L"";
    DWORD size = sizeof build, rev = 0;
    RegGetValueW(HKEY_LOCAL_MACHINE, nt, L"CurrentBuild", RRF_RT_REG_SZ, nullptr, build, &size);
    size = sizeof rev;
    RegGetValueW(HKEY_LOCAL_MACHINE, nt, L"UBR", RRF_RT_REG_DWORD, nullptr, &rev, &size);
    LPWSTR engine = nullptr;
    GetAvailableCoreWebView2BrowserVersionString(nullptr, &engine);
    std::wstring text = L"Exo Browser " EXO_VERSION_W L", Windows build " + std::wstring(build) + L"." + std::to_wstring(rev) +
                        L", WebView2 " + Take(engine) + L"\r\n";
    if (!area.empty()) text += L"Where: " + area + L"\r\n";
    if (!error.empty()) text += L"Error: " + error + L"\r\n";
    auto lines = Split(Wide(ReadFileUtf8(g.dataDir + L"\\exo.log")), L'\n');
    while (!lines.empty() && lines.back().empty()) lines.pop_back();
    text += L"\r\nexo.log, last " + std::to_wstring(std::min<size_t>(lines.size(), 40)) + L" lines:\r\n";
    for (size_t i = lines.size() > 40 ? lines.size() - 40 : 0; i < lines.size(); i++) text += lines[i] + L"\r\n";
    UiPost(std::wstring(L"{\"t\":\"logsCopied\",\"ok\":") + Bool(CopyText(text)) + L"}");
}

static void CleanUpdates() {
    std::wstring dir = g.dataDir + L"\\Updates";
    WIN32_FIND_DATAW d;
    HANDLE find = FindFirstFileW((dir + L"\\*").c_str(), &d);
    if (find == INVALID_HANDLE_VALUE) return;
    do {
        if (!(d.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) DeleteFileW((dir + L"\\" + d.cFileName).c_str());
    } while (FindNextFileW(find, &d));
    FindClose(find);
}

// ---------------------------------------------------------------------------------------
// Live folders: each one's feed, asked for when it's made, a moment after start and every 30 minutes, only for the
// feeds you follow (the site sees the address it's asked from and "ExoBrowser/<version>"). The page reads the posts
// out of it; the newest copy of each is kept for a page that loads again.

static const UINT WM_APP_FEED = WM_APP + 8;  // wParam: the folder's id; lParam: new std::string* (the feed, or empty)
static const UINT kTimerFeeds = 15;
static std::unordered_map<int, std::string> g_feeds;

static void SendFeed(int id) {
    auto it = g_feeds.find(id);
    if (it == g_feeds.end()) return;
    // UTF-8 unless its declaration says Latin-1 (ISO-8859-1, or Windows-1252, which browsers read it as).
    std::string head = it->second.substr(0, 200);
    for (auto& c : head) c = (char)tolower((unsigned char)c);
    std::wstring xml;
    if (head.find("iso-8859-1") != std::string::npos || head.find("windows-1252") != std::string::npos) {
        xml.resize(MultiByteToWideChar(1252, 0, it->second.data(), (int)it->second.size(), nullptr, 0));
        MultiByteToWideChar(1252, 0, it->second.data(), (int)it->second.size(), xml.data(), (int)xml.size());
    } else xml = Wide(it->second);
    UiPost(L"{\"t\":\"feed\",\"id\":" + std::to_wstring(id) + L",\"xml\":" + Json(xml) + L"}");
}

// A feed cut to its newest few posts, all the page reads: some feeds carry whole articles, megabytes of them.
static std::string FeedHead(std::string xml) {
    bool atom = xml.find("<rss") == std::string::npos && xml.find("<feed") != std::string::npos;
    const char* tag = atom ? "<entry" : "<item";
    size_t at = std::string::npos;
    for (int n = 0; n < 9; n++) {
        at = xml.find(tag, at == std::string::npos ? 0 : at + 1);
        if (at == std::string::npos) return xml;
    }
    xml.resize(at);
    return xml + (atom ? "</feed>" : "</channel></rss>");
}

static void FetchFeed(const TabFolder& f) {
    if (f.feed.rfind(L"https://", 0) != 0) return;
    HWND hwnd = g.hwnd;
    int id = f.id;
    std::wstring url = f.feed;
    std::thread([hwnd, id, url] {
        auto body = new std::string;
        if (!HttpGet(Egress::Feed, url, body, nullptr, nullptr, nullptr, 8 * 1024 * 1024)) body->clear();
        else *body = FeedHead(std::move(*body));
        PostMessageW(hwnd, WM_APP_FEED, (WPARAM)id, (LPARAM)body);
    }).detach();
}

static void FeedsTick() {
    // A game running (GameRunning): live folders look again in five minutes.
    if (GameRunning()) { SetTimer(g.hwnd, kTimerFeeds, 5 * 60 * 1000, nullptr); return; }
    SetTimer(g.hwnd, kTimerFeeds, 30 * 60 * 1000, nullptr);
    for (auto& f : g.folders) if (!f.feed.empty()) FetchFeed(f);
}

// A tab's site into a live folder: the feed its page names (<link rel="alternate">), a folder named after the site.
static void FollowSite(Tab* t) {
    if (!t || !t->core || !t->space || (t->url.rfind(L"https://", 0) != 0 && t->url.rfind(L"http://", 0) != 0)) return;
    int id = t->id;
    t->core->ExecuteScript(LR"js((() => {
  const l = document.querySelector('link[rel~="alternate"][type*="rss"], link[rel~="alternate"][type*="atom"], link[rel~="alternate"][type*="feed"]');
  return l ? new URL(l.getAttribute('href'), location.href).href : '';
})())js", Callback<ICoreWebView2ExecuteScriptCompletedHandler>([id](HRESULT hr, LPCWSTR json) -> HRESULT {
        Tab* t = FindTab(id);
        std::wstring feed = SUCCEEDED(hr) && json ? std::wstring(json) : L"";
        if (feed.size() >= 2 && feed.front() == L'"') feed = feed.substr(1, feed.size() - 2);
        if (!t || feed.rfind(L"https://", 0) != 0) {
            Toast(L"This site has no feed to follow");
            return S_OK;
        }
        for (auto& f : g.folders)
            if (f.feed == feed && f.space == t->space) { Toast(L"Already in " + f.name); return S_OK; }
        std::wstring name = SiteOf(t->url);
        g.folders.push_back({g.nextFolder++, t->space, 0, name.empty() ? L"Live folder" : name, true, feed});
        SaveSpaces();
        QueueState();
        FetchFeed(g.folders.back());
        SetTimer(g.hwnd, kTimerFeeds, 30 * 60 * 1000, nullptr);
        return S_OK;
    }).Get());
}

// ---------------------------------------------------------------------------------------
// Exo Vault. The file and its keys are vault.cpp's; here are its messages, auto-lock, the clipboard,
// passwords from other browsers and sign-in forms. The vault window (the chrome page) holds the unlocked
// items and picks what to fill; a page only ever receives the login you chose for it, and only while it
// is still the site you chose it for. Secrets and free text travel base64-encoded (they may hold tabs).

static const UINT WM_APP_VAULT = WM_APP + 5;  // lParam: new VaultJob*
static const UINT kTimerVault = 9, kTimerClipboard = 10;
struct VaultJob { std::wstring op; vault::Opened opened; vault::Result result = vault::Ok; unsigned epoch = 0; };
// Each lock moves this on: an unlock that finishes after Windows locked (or the user locked) is dropped.
static unsigned g_vaultEpoch = 0;
static bool g_vaultOpening = false;  // an unlock, Hello or create is running (each holds 256 MiB)
static ULONGLONG g_vaultActive = 0;
static DWORD g_clipboardSeq = 0;
static bool g_helloReady = false;
static std::wstring g_vaultImportFile;  // an .exovault picked to import, waiting for its password

static std::wstring VaultFile() { return g.dataDir + L"\\vault.exovault"; }

static std::string FromB64(const std::wstring& b64) {
    DWORD n = 0;
    if (b64.empty() || !CryptStringToBinaryW(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, nullptr, &n, nullptr, nullptr)) return "";
    std::string out(n, 0);
    CryptStringToBinaryW(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, (BYTE*)out.data(), &n, nullptr, nullptr);
    out.resize(n);
    return out;
}

static const wchar_t* VaultReason(vault::Result r) {
    switch (r) {
    case vault::WrongPassword: return L"wrong";
    case vault::NoFile: return L"nofile";
    case vault::Corrupt: return L"corrupt";
    case vault::WriteFailed: return L"write";
    case vault::NoHello: return L"nohello";
    case vault::HelloCancelled: return L"cancelled";
    case vault::HelloFailed: return L"hellofailed";
    default: return L"ok";
    }
}

static void VaultPost(const std::wstring& kind, const std::wstring& rest = L"") {
    UiPost(L"{\"t\":\"vault\",\"kind\":" + Json(kind) + rest + L"}");
}

static void VaultState() {
    std::wstring state = vault::Unlocked() ? L"unlocked" : vault::Exists(VaultFile()) ? L"locked" : L"none";
    VaultPost(L"state", L",\"state\":" + Json(state) + L",\"hello\":" + Bool(vault::Exists(VaultFile()) && vault::HasHello(VaultFile())) +
                            L",\"helloReady\":" + Bool(g_helloReady));
}

static void VaultError(const std::wstring& op, vault::Result r) {
    VaultPost(L"error", L",\"op\":" + Json(op) + L",\"reason\":" + Json(VaultReason(r)));
}

// Argon2id takes a moment: the work runs on its own thread and comes back as WM_APP_VAULT.
static void VaultOffThread(const std::wstring& op, std::function<VaultJob()> work) {
    unsigned epoch = g_vaultEpoch;
    // Moved, not copied: each job wipes what it holds (a password, the whole vault for an export), and a copy of it left
    // behind here went unwiped.
    std::thread([op, work = std::move(work), epoch] {
        auto* job = new VaultJob(work());
        job->op = op;
        job->epoch = epoch;
        if (!PostMessageW(g.hwnd, WM_APP_VAULT, 0, (LPARAM)job)) { vault::Wipe(job->opened.key); vault::Wipe(job->opened.json); delete job; }
    }).detach();
}

static void VaultOpened(vault::Opened& o) {
    vault::Adopt(o.key);
    vault::Wipe(o.key);
    g_vaultActive = GetTickCount64();
    SetTimer(g.hwnd, kTimerVault, 20 * 1000, nullptr);  // its auto-lock, only while it's open
    VaultPost(L"opened", L",\"json\":" + Json(Wide(o.json)));
    vault::Wipe(o.json);
    VaultState();
}

static void OnVaultJob(VaultJob* job) {
    std::unique_ptr<VaultJob> owned(job);
    vault::Opened& o = job->opened;
    if (job->op == L"create" || job->op == L"unlock" || job->op == L"hello") {
        g_vaultOpening = false;
        if (job->epoch != g_vaultEpoch) {  // locked meanwhile
            vault::Wipe(o.key);
            vault::Wipe(o.json);
            VaultState();
        } else if (o.result == vault::Ok) VaultOpened(o);
        else VaultError(job->op, o.result);
    } else if (job->op == L"importExo") {
        if (o.result == vault::Ok) VaultPost(L"importJson", L",\"json\":" + Json(Wide(o.json)));
        else VaultError(L"import", o.result);
        vault::Wipe(o.key);
        vault::Wipe(o.json);
    } else if (job->op == L"password") {
        if (job->result == vault::Ok) VaultPost(L"passwordChanged");
        else VaultError(L"password", job->result);
    } else if (job->op == L"export") {
        if (job->result == vault::Ok) VaultPost(L"exported");
        else VaultError(L"export", job->result);
    }
}

static void VaultLock() {
    g_vaultEpoch++;
    KillTimer(g.hwnd, kTimerVault);
    if (!vault::Unlocked()) return;
    vault::Lock();
    VaultPost(L"locked");
    VaultState();
}

static void VaultTouch() { g_vaultActive = GetTickCount64(); }

// Locks after the minutes in "vaultLock" without use (15 by default), and whenever Windows locks or sleeps.
static void VaultTick() {
    if (!vault::Unlocked()) return;
    int minutes = _wtoi(Setting(L"vaultLock", L"15").c_str());
    if (minutes > 0 && GetTickCount64() - g_vaultActive > (ULONGLONG)minutes * 60000) VaultLock();
}

// ---------------------------------------------------------------------------------------
// Exo Vault across a close. Closing Exo Browser (or an update restarting it) doesn't lock the vault: open at the close,
// its key goes to a keeper, which holds it until Windows locks, the PC sleeps, you sign out or the Lock after time runs
// out, and hands it to the next start, which opens the vault without asking. The keeper is this exe, copied beside the
// vault (one running from the app folder would hold it in use, and an update couldn't swap it), with nothing else to
// do. It keeps the key encrypted in its own memory, and its pipe answers only this Windows user, on this PC and in this
// sign-in (not even this user's sandboxed page processes), and only a copy of Exo Browser.

struct KeptVault {
    uint32_t version = 1;
    char key[32] = {};
    long long leftMs = -1;  // the Lock after time still to run; -1: none ("Only when Windows locks")
    wchar_t browser[MAX_PATH] = {};  // the Exo Browser that left it, which may ask for it back
};

static std::wstring KeeperExe() { return g.dataDir + L"\\Keeper\\ExoVaultKeeper.exe"; }

// One per profile and sign-in.
static std::wstring KeeperPipe() {
    std::wstring dir = g.dataDir;
    CharLowerBuffW(dir.data(), (DWORD)dir.size());
    uint64_t h = 1469598103934665603ull;
    for (wchar_t c : dir) { h ^= (uint64_t)c; h *= 1099511628211ull; }
    DWORD session = 0;
    ProcessIdToSessionId(GetCurrentProcessId(), &session);
    wchar_t name[96];
    swprintf_s(name, L"\\\\.\\pipe\\ExoBrowser.VaultKeeper.%lu.%016llx", session, (unsigned long long)h);
    return name;
}

static std::wstring ImageOf(DWORD pid) {
    HANDLE p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!p) return L"";
    wchar_t path[MAX_PATH];
    DWORD n = MAX_PATH;
    bool ok = QueryFullProcessImageNameW(p, 0, path, &n);
    CloseHandle(p);
    return ok ? std::wstring(path, n) : L"";
}

// Asks a waiting keeper for its key, which ends it: the key and the Lock after time it had left.
static bool TakeKeptKey(std::string& key, long long& leftMs) {
    std::wstring name = KeeperPipe();
    auto open = [&] { return CreateFileW(name.c_str(), GENERIC_READ, 0, nullptr, OPEN_EXISTING, SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr); };
    HANDLE pipe = open();
    if (pipe == INVALID_HANDLE_VALUE && GetLastError() == ERROR_PIPE_BUSY && WaitNamedPipeW(name.c_str(), 1000)) pipe = open();
    if (pipe == INVALID_HANDLE_VALUE) return false;
    // A pipe of that name made by anything else isn't believed.
    ULONG server = 0;
    bool keeper = GetNamedPipeServerProcessId(pipe, &server) && _wcsicmp(ImageOf(server).c_str(), KeeperExe().c_str()) == 0;
    KeptVault k;
    DWORD got = 0;
    bool ok = keeper && ReadFile(pipe, &k, sizeof k, &got, nullptr) && got == sizeof k && k.version == 1;
    CloseHandle(pipe);
    if (ok) { key.assign(k.key, sizeof k.key); leftMs = k.leftMs; }
    SecureZeroMemory(&k, sizeof k);
    return ok;
}

// The first time the vault's state is asked: a key kept across the close opens it, its Lock after time going on.
static bool g_keptAsked = false;
static void TakeKeptVault() {
    if (g_keptAsked || vault::Unlocked() || g_vaultOpening) return;
    g_keptAsked = true;
    std::string key;
    long long left = -1;
    if (!TakeKeptKey(key, left)) return;
    vault::Opened o = vault::UnlockWithKey(VaultFile(), key);
    vault::Wipe(key);
    if (o.result != vault::Ok) { vault::Wipe(o.key); vault::Wipe(o.json); return; }
    VaultOpened(o);
    long long limit = (long long)_wtoi(Setting(L"vaultLock", L"15").c_str()) * 60000;
    if (limit > 0 && left >= 0) g_vaultActive = GetTickCount64() - (ULONGLONG)std::clamp(limit - left, 0LL, limit);
}

static bool SameFile(const std::wstring& a, const std::wstring& b) {
    WIN32_FILE_ATTRIBUTE_DATA x, y;
    return GetFileAttributesExW(a.c_str(), GetFileExInfoStandard, &x) && GetFileAttributesExW(b.c_str(), GetFileExInfoStandard, &y) &&
           x.nFileSizeLow == y.nFileSizeLow && x.nFileSizeHigh == y.nFileSizeHigh && CompareFileTime(&x.ftLastWriteTime, &y.ftLastWriteTime) == 0;
}

// At the close, with the vault open and time left on its Lock after: the key goes to a new keeper, through a pipe only
// it inherits.
static void KeepVault() {
    if (!vault::Unlocked()) return;
    long long limit = (long long)_wtoi(Setting(L"vaultLock", L"15").c_str()) * 60000, left = -1;
    if (limit > 0 && (left = limit - (long long)(GetTickCount64() - g_vaultActive)) <= 0) return;
    // One keeper at a time: one still waiting (a start that never asked it) lets go first.
    std::string old;
    long long unused = 0;
    if (TakeKeptKey(old, unused)) vault::Wipe(old);
    wchar_t self[MAX_PATH];
    GetModuleFileNameW(nullptr, self, MAX_PATH);
    std::wstring exe = KeeperExe();
    CreateDirectoryW((g.dataDir + L"\\Keeper").c_str(), nullptr);
    for (int i = 0; i < 10 && !SameFile(self, exe) && !CopyFileW(self, exe.c_str(), FALSE); i++) Sleep(50);
    if (!SameFile(self, exe)) return;
    SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
    HANDLE readEnd = nullptr, writeEnd = nullptr;
    if (!CreatePipe(&readEnd, &writeEnd, &sa, 0)) return;
    SetHandleInformation(writeEnd, HANDLE_FLAG_INHERIT, 0);
    SIZE_T size = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &size);
    std::vector<char> attributes(size);
    auto* list = (LPPROC_THREAD_ATTRIBUTE_LIST)attributes.data();
    bool listed = InitializeProcThreadAttributeList(list, 1, 0, &size) &&
                  UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &readEnd, sizeof readEnd, nullptr, nullptr);
    STARTUPINFOEXW si{};
    si.StartupInfo.cb = sizeof si;
    si.lpAttributeList = list;
    PROCESS_INFORMATION pi{};
    std::wstring line = L"\"" + exe + L"\" --vault-keeper " + std::to_wstring((unsigned long long)(ULONG_PTR)readEnd);
    bool started = listed && CreateProcessW(exe.c_str(), line.data(), nullptr, nullptr, TRUE, EXTENDED_STARTUPINFO_PRESENT, nullptr,
                                            g.dataDir.c_str(), &si.StartupInfo, &pi);
    if (listed) DeleteProcThreadAttributeList(list);
    CloseHandle(readEnd);
    if (started) {
        KeptVault k;
        std::string key = vault::Key();
        memcpy(k.key, key.data(), sizeof k.key);
        vault::Wipe(key);
        k.leftMs = left;
        wcscpy_s(k.browser, self);
        DWORD wrote = 0;
        WriteFile(writeEnd, &k, sizeof k, &wrote, nullptr);
        SecureZeroMemory(&k, sizeof k);
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
    }
    CloseHandle(writeEnd);
}

// Copied secrets stay out of Windows' clipboard history and cloud clipboard, and are cleared after 30 seconds
// unless something else was copied since.
static void VaultCopy(const std::string& utf8) {
    std::wstring text = Wide(utf8);
    if (!OpenClipboard(g.hwnd)) return;
    EmptyClipboard();
    auto put = [](UINT format, const void* data, size_t size) {
        HGLOBAL mem = GlobalAlloc(GMEM_MOVEABLE, size);
        if (!mem) return;
        memcpy(GlobalLock(mem), data, size);
        GlobalUnlock(mem);
        if (!SetClipboardData(format, mem)) GlobalFree(mem);
    };
    put(CF_UNICODETEXT, text.c_str(), (text.size() + 1) * sizeof(wchar_t));
    DWORD no = 0;
    put(RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing"), &no, sizeof no);
    put(RegisterClipboardFormatW(L"CanIncludeInClipboardHistory"), &no, sizeof no);
    put(RegisterClipboardFormatW(L"CanUploadToCloudClipboard"), &no, sizeof no);
    CloseClipboard();
    SecureZeroMemory(text.data(), text.size() * sizeof(wchar_t));
    g_clipboardSeq = GetClipboardSequenceNumber();
    SetTimer(g.hwnd, kTimerClipboard, 30000, nullptr);
}

static void VaultClearClipboard() {
    KillTimer(g.hwnd, kTimerClipboard);
    if (g_clipboardSeq && GetClipboardSequenceNumber() == g_clipboardSeq && OpenClipboard(g.hwnd)) {
        EmptyClipboard();
        CloseClipboard();
    }
    g_clipboardSeq = 0;
}

// Saved passwords from a Chromium browser on this PC: its "Login Data" (and "Login Data For Account", where
// Chrome keeps a signed-in account's), opened with the same key as its cookies. Chrome's app-bound ("v20")
// passwords can only be read by Chrome: they are counted, so the vault can say to export them from Chrome.
// Every profile of the browser (Default, Profile 1, ...): any folder in its User Data with a Login Data.
static std::vector<std::wstring> ProfileDirs(const std::wstring& dir) {
    std::wstring parent = dir.substr(0, dir.find_last_of(L'\\'));
    std::vector<std::wstring> out{dir};
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileW((parent + L"\\*").c_str(), &fd);
    if (h == INVALID_HANDLE_VALUE) return out;
    do {
        std::wstring p = parent + L"\\" + fd.cFileName;
        if ((fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && fd.cFileName[0] != L'.' && _wcsicmp(p.c_str(), dir.c_str()) != 0 &&
            Exists(p + L"\\Login Data"))
            out.push_back(p);
    } while (FindNextFileW(h, &fd));
    FindClose(h);
    return out;
}

static std::string ChromiumPasswords(const std::wstring& dir, int& locked) {
    std::string key = ChromiumKey(dir);
    std::wstring items;
    std::unordered_set<std::wstring> seen;
    Sql sql;
    std::vector<std::wstring> files;
    for (auto& profile : ProfileDirs(dir))
        for (const wchar_t* db : {L"\\Login Data", L"\\Login Data For Account"}) files.push_back(profile + db);
    for (auto& file : files) {
        sql.Query(file, "SELECT origin_url, username_value, password_value, date_created FROM logins WHERE blacklisted_by_user = 0",
                  [&](void* st) {
                      std::wstring url = sql.Text(st, 0), user = sql.Text(st, 1);
                      auto enc = (const BYTE*)sql.blob(st, 2);
                      int n = sql.bytes(st, 2);
                      if (!enc || n <= 0) return;
                      std::string plain;
                      if (n > 3 && memcmp(enc, "v20", 3) == 0) { locked++; return; }
                      if (n > 3 && (memcmp(enc, "v10", 3) == 0 || memcmp(enc, "v11", 3) == 0)) {
                          if (n < 3 + 12 + 16 || !AesGcm(key, enc + 3, enc + 15, (size_t)n - 15, plain)) { locked++; return; }
                      } else {
                          // Before Chrome 80: each password sealed for this Windows user on its own.
                          DATA_BLOB in{(DWORD)n, (BYTE*)enc}, out{};
                          if (!CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr, 0, &out)) { locked++; return; }
                          plain.assign((char*)out.pbData, out.cbData);
                          SecureZeroMemory(out.pbData, out.cbData);
                          LocalFree(out.pbData);
                      }
                      std::wstring password = Wide(plain);
                      vault::Wipe(plain);
                      if (url.empty() || !seen.insert(url + L"\n" + user + L"\n" + password).second) {
                          SecureZeroMemory(password.data(), password.size() * sizeof(wchar_t));
                          return;
                      }
                      // Chromium's times are microseconds since 1601.
                      long long created = (sql.int64(st, 3) / 1000) - 11644473600000LL;
                      if (!items.empty()) items += L",";
                      items += L"{\"url\":" + Json(url) + L",\"username\":" + Json(user) + L",\"password\":" + Json(password) +
                               L",\"created\":" + std::to_wstring(created > 0 ? created : 0) + L"}";
                      SecureZeroMemory(password.data(), password.size() * sizeof(wchar_t));
                  });
    }
    vault::Wipe(key);
    std::string out = Utf8(L"[" + items + L"]");
    SecureZeroMemory(items.data(), items.size() * sizeof(wchar_t));
    return out;
}

// Firefox keeps saved passwords in logins.json, encrypted with a key that its NSS library keeps in key4.db,
// itself encrypted (PBES2: PBKDF2-SHA-256 and AES-256-CBC) under a Primary Password, empty unless you set
// one. With one set they stay locked, and the vault asks for Firefox's CSV export instead.
namespace ff {
struct Leaf { BYTE tag; std::string bytes; };

// Every OID, INTEGER and OCTET STRING in a DER structure, in order.
static void Leaves(const BYTE* p, const BYTE* end, std::vector<Leaf>& out, int depth = 0) {
    while (p + 2 <= end && depth < 16) {
        BYTE tag = *p++;
        size_t len = *p++;
        if (len & 0x80) {
            int n = len & 0x7f;
            if (n < 1 || n > 4 || p + n > end) return;
            len = 0;
            while (n--) len = (len << 8) | *p++;
        }
        if (len > (size_t)(end - p)) return;
        if (tag == 0x30) Leaves(p, p + len, out, depth + 1);
        else if (tag == 0x02 || tag == 0x04 || tag == 0x06) out.push_back({tag, std::string((const char*)p, len)});
        p += len;
    }
}

static std::string Hash(BCRYPT_ALG_HANDLE alg, size_t size, const std::string& data) {
    std::string out(size, 0);
    BCryptHash(alg, nullptr, 0, (PUCHAR)data.data(), (ULONG)data.size(), (PUCHAR)out.data(), (ULONG)size);
    return out;
}

static std::string Decrypt(BCRYPT_ALG_HANDLE alg, const std::string& key, std::string iv, const std::string& data) {
    BCRYPT_KEY_HANDLE k = nullptr;
    std::string out(data.size(), 0);
    ULONG got = 0;
    if (BCryptGenerateSymmetricKey(alg, &k, nullptr, 0, (PUCHAR)key.data(), (ULONG)key.size(), 0) != 0) return "";
    NTSTATUS st = BCryptDecrypt(k, (PUCHAR)data.data(), (ULONG)data.size(), nullptr, (PUCHAR)iv.data(), (ULONG)iv.size(),
                                (PUCHAR)out.data(), (ULONG)out.size(), &got, 0);
    BCryptDestroyKey(k);
    if (st != 0 || got == 0) return "";
    out.resize(got);
    BYTE pad = (BYTE)out.back();  // PKCS #7
    if (pad >= 1 && pad <= 16 && pad <= out.size()) out.resize(out.size() - pad);
    return out;
}

static const std::string kPbes2("\x2a\x86\x48\x86\xf7\x0d\x01\x05\x0d", 9), kAes256Cbc("\x60\x86\x48\x01\x65\x03\x04\x01\x2a", 9),
    kDes3Cbc("\x2a\x86\x48\x86\xf7\x0d\x03\x07", 8);

// PBES2 under the Primary Password (empty): key = PBKDF2-SHA-256(SHA-1(global salt), salt, iterations).
static std::string OpenPbes2(const std::string& der, const std::string& globalSalt) {
    std::vector<Leaf> l;
    Leaves((const BYTE*)der.data(), (const BYTE*)der.data() + der.size(), l);
    std::vector<std::string> octets, ints;
    bool pbes2 = false;
    for (auto& x : l) {
        if (x.tag == 0x06 && x.bytes == kPbes2) pbes2 = true;
        if (x.tag == 0x04) octets.push_back(x.bytes);
        if (x.tag == 0x02) ints.push_back(x.bytes);
    }
    if (!pbes2 || octets.size() < 3 || ints.empty() || ints[0].size() > 4) return "";
    ULONG iterations = 0;
    for (BYTE c : ints[0]) iterations = (iterations << 8) | c;
    std::string password = Hash(BCRYPT_SHA1_ALG_HANDLE, 20, globalSalt), key(32, 0);
    if (BCryptDeriveKeyPBKDF2(BCRYPT_HMAC_SHA256_ALG_HANDLE, (PUCHAR)password.data(), (ULONG)password.size(), (PUCHAR)octets[0].data(),
                              (ULONG)octets[0].size(), iterations, (PUCHAR)key.data(), 32, 0) != 0)
        return "";
    // NSS stores a 14-byte IV; the real one is its DER header (04 0E) and those 14 bytes.
    std::string iv = octets[1].size() == 14 ? std::string("\x04\x0e", 2) + octets[1] : octets[1];
    return Decrypt(BCRYPT_AES_CBC_ALG_HANDLE, key, iv, octets.back());
}

// One of logins.json's encrypted fields: { key id, { cipher, IV }, ciphertext }.
static std::string OpenField(const std::string& b64, const std::string& key) {
    std::string der;
    DWORD n = 0;
    if (!CryptStringToBinaryA(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, nullptr, &n, nullptr, nullptr)) return "";
    der.assign(n, 0);
    CryptStringToBinaryA(b64.c_str(), (DWORD)b64.size(), CRYPT_STRING_BASE64, (BYTE*)der.data(), &n, nullptr, nullptr);
    std::vector<Leaf> l;
    Leaves((const BYTE*)der.data(), (const BYTE*)der.data() + der.size(), l);
    std::string oid, iv, data;
    for (auto& x : l) {
        if (x.tag == 0x06) oid = x.bytes;
        else if (x.tag == 0x04 && !oid.empty() && iv.empty()) iv = x.bytes;
        else if (x.tag == 0x04 && !iv.empty()) data = x.bytes;
    }
    if (oid == kDes3Cbc && key.size() >= 24) return Decrypt(BCRYPT_3DES_CBC_ALG_HANDLE, key.substr(0, 24), iv, data);
    if (oid == kAes256Cbc && key.size() >= 32) return Decrypt(BCRYPT_AES_CBC_ALG_HANDLE, key.substr(0, 32), iv, data);
    return "";
}

static std::string JsonField(const std::string& obj, const char* name) {
    std::string k = std::string("\"") + name + "\":";
    size_t at = obj.find(k);
    if (at == std::string::npos) return "";
    at += k.size();
    if (obj[at] == '"') return obj.substr(at + 1, obj.find('"', at + 1) - at - 1);
    return obj.substr(at, obj.find_first_of(",}", at) - at);
}
}  // namespace ff

static std::string FirefoxPasswords(const std::wstring& dir, int& locked) {
    std::string logins = ReadFileUtf8(dir + L"\\logins.json");
    if (logins.empty()) return "[]";
    Sql sql;
    std::string globalSalt, check, key;
    sql.Query(dir + L"\\key4.db", "SELECT item1, item2 FROM metaData WHERE id = 'password'", [&](void* st) {
        if (sql.bytes(st, 0) > 0) globalSalt.assign((const char*)sql.blob(st, 0), sql.bytes(st, 0));
        if (sql.bytes(st, 1) > 0) check.assign((const char*)sql.blob(st, 1), sql.bytes(st, 1));
    });
    bool open = ff::OpenPbes2(check, globalSalt).rfind("password-check", 0) == 0;
    if (open)
        sql.Query(dir + L"\\key4.db", "SELECT a11, a102 FROM nssPrivate", [&](void* st) {
            static const std::string id("\xf8\0\0\0\0\0\0\0\0\0\0\0\0\0\0\x01", 16);
            if (!key.empty() || sql.bytes(st, 0) <= 0 || sql.bytes(st, 1) != 16 || memcmp(sql.blob(st, 1), id.data(), 16) != 0) return;
            key = ff::OpenPbes2(std::string((const char*)sql.blob(st, 0), sql.bytes(st, 0)), globalSalt);
        });
    std::wstring items;
    for (size_t at = 0; (at = logins.find("\"hostname\":", at)) != std::string::npos; at++) {
        size_t end = logins.find("\"hostname\":", at + 1);
        std::string obj = logins.substr(at, end == std::string::npos ? std::string::npos : end - at);
        if (key.empty()) { locked++; continue; }
        std::string user = ff::OpenField(ff::JsonField(obj, "encryptedUsername"), key);
        std::string pass = ff::OpenField(ff::JsonField(obj, "encryptedPassword"), key);
        if (pass.empty()) { locked++; continue; }
        if (!items.empty()) items += L",";
        items += L"{\"url\":" + Json(Wide(ff::JsonField(obj, "hostname"))) + L",\"username\":" + Json(Wide(user)) + L",\"password\":" +
                 Json(Wide(pass)) + L",\"created\":" + std::to_wstring(_atoi64(ff::JsonField(obj, "timeCreated").c_str())) + L"}";
        vault::Wipe(pass);
    }
    vault::Wipe(key);
    std::string out = Utf8(L"[" + items + L"]");
    SecureZeroMemory(items.data(), items.size() * sizeof(wchar_t));
    return out;
}

static void VaultImportBrowser(const std::wstring& key) {
    for (auto& b : DetectBrowsers()) {
        if (b.key != key) continue;
        int locked = 0;
        std::string items = b.firefox ? FirefoxPasswords(b.dir, locked) : ChromiumPasswords(b.dir, locked);
        VaultPost(L"importItems", L",\"source\":" + Json(b.name) + L",\"locked\":" + std::to_wstring(locked) + L",\"items\":" + Json(Wide(items)));
        vault::Wipe(items);
        return;
    }
}

static void VaultSources() {
    std::wstring items;
    for (auto& b : DetectBrowsers()) {
        if (!items.empty()) items += L",";
        items += L"[" + Json(b.key) + L"," + Json(b.name) + L"," + Bool(b.firefox) + L"]";
    }
    VaultPost(L"sources", L",\"items\":[" + items + L"]");
}

// A file to import: an Exo Vault export waits for its password; anything else (CSV or JSON from another
// password manager) goes to the vault window as text to read.
static void VaultImportFile() {
    std::wstring file = PickFile(false, L"Passwords (Exo Vault, CSV, JSON)", L"*.exovault;*.csv;*.json;*.txt", L"csv", L"");
    if (file.empty()) return;
    std::wstring name = file.substr(file.find_last_of(L"\\/") + 1);
    std::wstring lower = name;
    for (auto& c : lower) c = towlower(c);
    if (lower.size() > 9 && lower.compare(lower.size() - 9, 9, L".exovault") == 0) {
        g_vaultImportFile = file;
        VaultPost(L"importLocked", L",\"name\":" + Json(name));
        return;
    }
    std::string text = ReadFileUtf8(file);
    if (text.size() >= 3 && (BYTE)text[0] == 0xEF && (BYTE)text[1] == 0xBB && (BYTE)text[2] == 0xBF) text.erase(0, 3);
    VaultPost(L"importText", L",\"name\":" + Json(name) + L",\"text\":" + Json(Wide(text)));
    vault::Wipe(text);
}

static void VaultExport(std::string password, std::string json) {
    SYSTEMTIME now;
    GetLocalTime(&now);
    wchar_t name[64];
    swprintf_s(name, L"Exo Vault %04d-%02d-%02d.exovault", now.wYear, now.wMonth, now.wDay);
    std::wstring file = PickFile(true, L"Exo Vault export", L"*.exovault", L"exovault", name);
    if (file.empty()) { vault::Wipe(password); vault::Wipe(json); return; }
    VaultOffThread(L"export", [file, password = std::move(password), json = std::move(json)]() mutable {
        VaultJob job;
        job.result = vault::Export(file, password, json);
        vault::Wipe(password);
        vault::Wipe(json);
        return job;
    });
}

static std::wstring OriginOf(const std::wstring& url) {
    size_t scheme = url.find(L"://");
    if (scheme == std::wstring::npos) return L"";
    size_t end = url.find_first_of(L"/?#", scheme + 3);
    return url.substr(0, end);
}

static void OnVaultMessage(const std::vector<std::wstring>& p) {
    const std::wstring& v = p[0];
    auto arg = [&](size_t i) { return i < p.size() ? p[i] : std::wstring(); };
    if (v != L"vaultState") VaultTouch();
    if (v == L"vaultState") {
        TakeKeptVault();
        VaultState();
    } else if (v == L"vaultCreate" || v == L"vaultUnlock") {
        bool create = v == L"vaultCreate";
        std::wstring file = VaultFile();
        // Create never replaces a vault (a page that thought there was none); a second click waits for the first.
        if (create && GetFileAttributesW(file.c_str()) != INVALID_FILE_ATTRIBUTES) { VaultState(); return; }
        if (g_vaultOpening) return;
        g_vaultOpening = true;
        std::string password = FromB64(arg(1));
        VaultOffThread(create ? L"create" : L"unlock", [create, file, password]() mutable {
            VaultJob job;
            job.opened = create ? vault::Create(file, password, "{\"version\":1,\"items\":[]}") : vault::Unlock(file, password);
            vault::Wipe(password);
            return job;
        });
        vault::Wipe(password);
    } else if (v == L"vaultHello") {
        if (g_vaultOpening) return;
        g_vaultOpening = true;
        std::wstring file = VaultFile();
        vault::HelloKey(false, [file](vault::Result r, std::string key) {
            if (r != vault::Ok) { g_vaultOpening = false; VaultError(L"hello", r); return; }
            VaultOffThread(L"hello", [file, key]() mutable {
                VaultJob job;
                job.opened = vault::UnlockWithHelloKey(file, key);
                vault::Wipe(key);
                return job;
            });
            vault::Wipe(key);
        });
    } else if (v == L"vaultHelloOn") {
        if (!vault::Unlocked()) return;
        vault::HelloKey(true, [](vault::Result r, std::string key) {
            vault::Result saved = r == vault::Ok ? vault::SetHelloKey(VaultFile(), key) : r;
            vault::Wipe(key);
            if (saved != vault::Ok) VaultError(L"helloOn", saved);
            VaultState();
        });
    } else if (v == L"vaultHelloOff") {
        if (vault::Unlocked()) vault::SetHelloKey(VaultFile(), "");
        VaultState();
    } else if (v == L"vaultLock") {
        VaultLock();
    } else if (v == L"vaultSave") {
        std::string json = FromB64(arg(1));
        vault::Result r = vault::Save(VaultFile(), json);
        vault::Wipe(json);
        if (r == vault::Ok) VaultPost(L"saved");
        else VaultError(L"save", r);
    } else if (v == L"vaultPassword") {
        // The current password proves it's you before the new one replaces it.
        std::string current = FromB64(arg(1)), next = FromB64(arg(2)), key = vault::Key();
        std::wstring file = VaultFile();
        VaultOffThread(L"password", [file, current, next, key]() mutable {
            VaultJob job;
            vault::Opened check = vault::Unlock(file, current);
            job.result = check.result != vault::Ok ? check.result : check.key != key ? vault::WrongPassword : vault::ChangePassword(file, key, next);
            vault::Wipe(check.key);
            vault::Wipe(check.json);
            vault::Wipe(current);
            vault::Wipe(next);
            vault::Wipe(key);
            return job;
        });
        vault::Wipe(current);
        vault::Wipe(next);
        vault::Wipe(key);
    } else if (v == L"vaultExport") {
        if (vault::Unlocked()) VaultExport(FromB64(arg(1)), FromB64(arg(2)));
    } else if (v == L"vaultImportFile") {
        VaultImportFile();
    } else if (v == L"vaultImportOpen") {
        std::string password = FromB64(arg(1));
        std::wstring file = g_vaultImportFile;
        VaultOffThread(L"importExo", [file, password]() mutable {
            VaultJob job;
            job.opened = vault::Open(file, password);
            vault::Wipe(password);
            return job;
        });
        vault::Wipe(password);
    } else if (v == L"vaultSources") {
        WhenBrowsersKnown(VaultSources);
    } else if (v == L"vaultImportBrowser") {
        if (vault::Unlocked()) WhenBrowsersKnown([key = arg(1)] { VaultImportBrowser(key); });
    } else if (v == L"vaultCopy") {
        std::string text = FromB64(arg(1));
        VaultCopy(text);
        vault::Wipe(text);
    } else if (v == L"vaultFill") {
        // Only into the tab it was picked for, and only while that tab still shows the same site.
        Tab* t = FindTab(_wtoi(arg(1).c_str()));
        std::wstring origin = arg(2);
        std::string payload = FromB64(arg(3));
        if (vault::Unlocked() && t && t->core && !origin.empty() && OriginOf(t->url) == origin) {
            std::wstring script = L"location.origin===" + Json(origin) + L"&&window.__exoVaultFill&&window.__exoVaultFill(" + Wide(payload) + L")";
            t->core->ExecuteScript(script.c_str(), nullptr);
            SecureZeroMemory(script.data(), script.size() * sizeof(wchar_t));
        }
        vault::Wipe(payload);
    } else if (v == L"vaultFocusTab") {
        // Back to the page after the fill menu (a click there gave the chrome page the keyboard).
        if (FindTab(_wtoi(arg(1).c_str()))) FocusTarget(_wtoi(arg(1).c_str()));
    }
}

// The places of what the chrome page lays over the page and takes the pointer for (Exo Vault's fill menu and save
// prompt, Peek's buttons, Ctrl+Tab's switcher, the zapper's bar), "x,y,w,h;..." in the chrome page's pixels; none
// when closed. Not a "vault" message: handled with the vault's, it never arrived, and none of them took a click.
static void SetUiHot(const std::wstring& spec) {
    float k = Scale();
    g_uiHot.clear();
    for (auto& item : Split(spec, L';')) {
        auto f = Split(item, L',');
        if (f.size() < 4) continue;
        float x = (float)_wtof(f[0].c_str()), y = (float)_wtof(f[1].c_str()), w = (float)_wtof(f[2].c_str()), h = (float)_wtof(f[3].c_str());
        if (w > 0 && h > 0) g_uiHot.push_back({(LONG)(x * k), (LONG)(y * k), (LONG)((x + w) * k), (LONG)((y + h) * k)});
    }
}

// While Exo Vault shows what's in it (its sheet, the fill menu beside a sign-in, the offer to save one), the window
// stays out of screen captures: a stream, a call's screen share, a recording or a screenshot shows nothing there, and
// you see it as always. Windows 10 before 2004 can't leave a window out, so there it shows black.
static void HideFromCapture(bool hide) {
#ifdef EXO_MEDIA
    // A build for the README's pictures (cl /DEXO_MEDIA, never released) leaves it in them, sample vault and all.
    return;
#endif
    if (!SetWindowDisplayAffinity(g.hwnd, hide ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE) && hide) SetWindowDisplayAffinity(g.hwnd, WDA_MONITOR);
}

// What a page's sign-in fields report (ui/vault-page.js): the field you're in, where it is, and what was
// submitted. The page's own words reach the vault window as a string to parse, beside what the host knows
// for certain (which tab, which site, where the tab sits), so a page can't speak for another site.
static void OnVaultPage(Tab* t, const std::wstring& from, const std::wstring& raw) {
    if (!t || raw.size() > 65536 || t->id != g.activeId) return;
    double zoom = 1;
    if (t->ctl) t->ctl->get_ZoomFactor(&zoom);
    float k = Scale();
    UiPost(L"{\"t\":\"vaultPage\",\"tab\":" + std::to_wstring(t->id) + L",\"origin\":" + Json(OriginOf(from)) +
           L",\"dx\":" + std::to_wstring(g.contentRect.left / k) + L",\"dy\":" + std::to_wstring(g.contentRect.top / k) +
           L",\"zoom\":" + std::to_wstring(zoom) + L",\"page\":" + Json(raw) + L"}");
}

// ---------------------------------------------------------------------------------------
// Messages from the chrome page: a verb and tab-separated arguments.

static void OnUiMessage(const std::wstring& msg) {
    auto p = Split(msg, L'\t');
    const std::wstring& v = p[0];
    if (v.rfind(L"vault", 0) == 0) { OnVaultMessage(p); return; }
    if (v == L"hot") { SetUiHot(p.size() > 1 ? p[1] : std::wstring()); return; }
    if (v == L"pageMenuPick") { EndPageMenu(p.size() > 1 ? _wtoi(p[1].c_str()) : -1); return; }
    if (v == L"hideFromCapture") { HideFromCapture(p.size() > 1 && p[1] == L"1"); return; }
    if (v == L"modal") { g.modal = p.size() > 1 && p[1] == L"1"; return; }
    auto arg = [&](size_t i) { return i < p.size() ? p[i] : std::wstring(); };
    auto argId = [&](size_t i) { return _wtoi(arg(i).c_str()); };
    Tab* a = Active();
    if (v == L"ready") {
        g.uiReady = true;
        // The tabs first, then history (up to 4000 visits for Search to suggest from), so the Bar draws its tabs
        // without waiting for it. Other browsers to import from are looked for when Settings or first run asks: the
        // search walks two levels of AppData (3,800 folders, 120 ms on the PC it was measured on) and held up every start.
        SendSettings();
        SendState();
        for (auto& t : g.tabs) if (!t->favicon.empty()) SendFavicon(t.get());
        SendHistory();
        SendArchive();
        for (auto& [id, xml] : g_feeds) SendFeed(id);
        UiPost(L"{\"t\":\"bookmarks\",\"items\":" + BookmarksJson() + L"}");
        SendExtensions();
        SendUpdate();
        UiPost(std::wstring(L"{\"t\":\"active\",\"on\":") + (GetForegroundWindow() == g.hwnd ? L"true" : L"false") + L"}");
        for (auto& t : g_pendingToasts) UiPost(t);
        g_pendingToasts.clear();
    } else if (v == L"activate") {
        Activate(argId(1));
    } else if (v == L"close") {
        CloseTab(argId(1));
    } else if (v == L"navigate") {
        CloseOverlay();
        Navigate(arg(1), arg(2) == L"new");
    } else if (v == L"overlay") {
        // 1: a menu or sheet takes the whole window's input; 0: back to the page.
        if (arg(1) == L"0") CloseOverlay(false);
        else if (!g.overlay) {
            LeaveFullscreen();
            g.overlay = true;
            SetRevealed(true);
            if (arg(2) == L"blur") SetBlur(true);
            FocusTarget(kUi);
        }
    } else if (v == L"updateCheck") {
        UpdateCheck(false);
    } else if (v == L"updateInstall") {
        UpdateInstall();
    } else if (v == L"copyLogs") {
        CopyLogs(arg(1), arg(2));
    } else if (v == L"makeDefault") {
        // Only you can choose the default browser: Windows' Default apps, open at Exo Browser once Setup registered it.
        ShellExecuteW(nullptr, L"open", IsRegistered() ? L"ms-settings:defaultapps?registeredAppUser=Exo%20Browser" : L"ms-settings:defaultapps",
                      nullptr, nullptr, SW_SHOWNORMAL);
    } else if (v == L"back") {
        if (a && a->core) a->core->GoBack();
    } else if (v == L"forward") {
        if (a && a->core) a->core->GoForward();
    } else if (v == L"reload") {
        if (a && a->core) { if (a->loading) a->core->Stop(); else ReloadTab(a); }
    } else if (v == L"min") {
        ShowWindow(g.hwnd, SW_MINIMIZE);
    } else if (v == L"max") {
        ShowWindow(g.hwnd, IsZoomed(g.hwnd) ? SW_RESTORE : SW_MAXIMIZE);
    } else if (v == L"closewin") {
        PostMessageW(g.hwnd, WM_CLOSE, 0, 0);
    } else if (v == L"mute") {
        if (Tab* t = FindTab(argId(1)); t && t->core) {
            ComPtr<ICoreWebView2_8> c8;
            if (SUCCEEDED(t->core.As(&c8))) {
                t->muted = !t->muted;
                c8->put_IsMuted(t->muted);
                QueueState();
            }
        }
    } else if (v == L"pin") {
        // Pinned, a tab keeps the page it's on as its own; unpinned, a favorite leaves the favorites too.
        if (Tab* t = FindTab(argId(1)); t && !t->priv) {
            t->pinned = !t->pinned;
            t->home = t->pinned ? t->url : L"";
            if (!t->pinned) t->folder = 0;
            if (!t->pinned && t->space == 0) t->space = g.space;
            Order();
            MarkSessionDirty();
            QueueState();
        }
    } else if (v == L"favorite") {
        // A favorite is in every space, pinned to its page; taken out, it stays pinned in the space on screen.
        if (Tab* t = FindTab(argId(1)); t && !t->priv) {
            if (t->space == 0) t->space = g.space;
            else { t->space = 0; t->folder = 0; if (!t->pinned) { t->pinned = true; t->home = t->url; } }
            Order();
            MarkSessionDirty();
            QueueState();
        }
    } else if (v == L"home") {
        // Back to the pinned tab's own page.
        if (Tab* t = FindTab(argId(1)); t && !t->home.empty()) {
            if (t->core) t->core->Navigate(t->home.c_str());
            else t->url = t->pendingNav = t->home;
            Activate(t->id);
        }
    } else if (v == L"rehome") {
        // The page it's on becomes the pinned tab's own.
        if (Tab* t = FindTab(argId(1)); t && t->pinned && !t->url.empty()) { t->home = t->url; MarkSessionDirty(); QueueState(); }
    } else if (v == L"move") {
        // To a place among its space's tabs.
        size_t from = IndexOf(argId(1)), to = (size_t)argId(2);
        if (from < g.tabs.size()) {
            auto t = std::move(g.tabs[from]);
            g.tabs.erase(g.tabs.begin() + from);
            // Places count the way the strip shows them: the favorites first, then the space's tabs.
            std::vector<size_t> at;
            for (size_t i = 0; i < g.tabs.size(); i++)
                if (g.tabs[i]->space == t->space || (t->space != 0 && g.tabs[i]->space == 0)) at.push_back(i);
            size_t i = to < at.size() ? at[to] : at.empty() ? g.tabs.size() : at.back() + 1;
            g.tabs.insert(g.tabs.begin() + i, std::move(t));
            Order();
            MarkSessionDirty();
            QueueState();
        }
    } else if (v == L"space") {
        SwitchSpace(argId(1));
    } else if (v == L"spaceNew") {
        // A new space, on screen at once: with the tab given (Move to › New space), else a new tab page.
        if (g.spaces.size() < 32) {
            Space s{g.nextSpace++, arg(1).empty() ? L"Space " + std::to_wstring(g.spaces.size() + 1) : arg(1), arg(2), arg(3)};
            g.spaces.push_back(s);
            SaveSpaces();
            if (Tab* t = FindTab(argId(4))) MoveToSpace(t, s.id, true);
            else SwitchSpace(s.id);
            QueueState();
        }
    } else if (v == L"spaceEdit") {
        if (Space* s = FindSpace(argId(1))) {
            const std::wstring& field = arg(2);
            if (field == L"name" && !arg(3).empty()) s->name = arg(3);
            else if (field == L"icon") s->icon = arg(3);
            else if (field == L"color") s->color = arg(3);
            else if (field == L"theme") s->theme = arg(3);
            SaveSpaces();
            if (field == L"theme") ThemeChanged();
            QueueState();
        }
    } else if (v == L"spaceMove") {
        size_t from = (size_t)argId(1), to = (size_t)argId(2);
        if (from < g.spaces.size() && to < g.spaces.size() && from != to) {
            Space s = g.spaces[from];
            g.spaces.erase(g.spaces.begin() + from);
            g.spaces.insert(g.spaces.begin() + to, s);
            SaveSpaces();
            QueueState();
        }
    } else if (v == L"importArc") {
        // Arc's sidebar, as the page read it: each space (one of the same name is reused), then its tabs, all asleep
        // until opened. Favorites come first and go in every space. Arc's own habit comes too: tabs archive after 12 hours,
        // unless you've chosen otherwise.
        int space = g.space, spacesMade = 0, made = 0;
        long long now = _time64(nullptr);
        std::unordered_map<std::wstring, int> folderOf;  // Arc's folders, as Exo's
        for (size_t i = 1; i < p.size(); i++) {
            auto f = Split(p[i], L'\x1f');
            if (f[0] == L"F" && f.size() >= 4 && !f[1].empty()) {
                // A pinned folder (one of the same name in the same place is reused).
                auto up = folderOf.find(f[2]);
                int parent = up == folderOf.end() ? 0 : up->second;
                std::wstring name = f[3].empty() ? L"Folder" : f[3].substr(0, 60);
                auto same = std::find_if(g.folders.begin(), g.folders.end(), [&](auto& x) { return x.space == space && x.parent == parent && x.name == name; });
                if (same != g.folders.end()) folderOf[f[1]] = same->id;
                else { g.folders.push_back({g.nextFolder++, space, parent, name, true}); folderOf[f[1]] = g.folders.back().id; }
                continue;
            }
            if (f[0] == L"S" && f.size() >= 4 && !f[1].empty()) {
                auto same = std::find_if(g.spaces.begin(), g.spaces.end(), [&](auto& x) { return _wcsicmp(x.name.c_str(), f[1].c_str()) == 0; });
                if (same != g.spaces.end()) space = same->id;
                else if (g.spaces.size() < 32) { g.spaces.push_back({g.nextSpace++, f[1].substr(0, 40), f[2], f[3]}); space = g.spaces.back().id; spacesMade++; }
            } else if (f[0] == L"T" && f.size() >= 4 && (f[2].rfind(L"https://", 0) == 0 || f[2].rfind(L"http://", 0) == 0)) {
                int in = f[1] == L"f" ? 0 : space;
                bool pinned = f[1] != L"t";
                if (std::any_of(g.tabs.begin(), g.tabs.end(), [&](auto& t) { return t->space == in && (t->url == f[2] || t->home == f[2]); })) continue;
                auto t = std::make_unique<Tab>();
                t->id = g.nextId++;
                t->url = t->pendingNav = f[2];
                t->title = f[3];
                t->pinned = pinned;
                if (pinned) t->home = f[2];
                t->space = in;
                if (auto it = folderOf.find(f.size() >= 5 ? f[4] : L""); pinned && in && it != folderOf.end()) t->folder = it->second;
                t->seen = now;
                t->lastActive = GetTickCount64();
                if (auto it = g.favicons.find(SiteOf(t->url)); it != g.favicons.end()) t->favicon = it->second;
                g.tabs.push_back(std::move(t));
                made++;
            }
        }
        Order();
        SaveSpaces();
        if (Setting(L"archive", L"").empty()) { g.settings[L"archive"] = L"12h"; SaveSettings(); SendSettings(); }
        MarkSessionDirty();
        QueueState();
        UiPost(L"{\"t\":\"arcImported\",\"spaces\":" + std::to_wstring(spacesMade) + L",\"tabs\":" + std::to_wstring(made) + L"}");
    } else if (v == L"split") {
        // The tab given (none: a new tab page) joins the split of the tab on screen, beside it, at most 4.
        Tab* a2 = Active();
        int group = a2 ? a2->split : 0;
        if (a2 && !a2->peek && (!group || std::count_if(g.tabs.begin(), g.tabs.end(), [group](auto& x) { return x->split == group; }) < 4)) {
            // Or an address (Search's row actions) in a new tab beside it.
            Tab* t = FindTab(argId(1));
            if (!t) t = AddTab(arg(2).empty() ? kNewTab : arg(2), false, IndexOf(a2->id) + 1);
            if (t && t != a2 && !t->peek && (!t->ctl || t->creating || t->suspended)) WakeForSplit(a2, t);
            else if (t) JoinSplit(a2->id, t->id);
        }
    } else if (v == L"unsplit") {
        if (Tab* t = FindTab(argId(1)); t && t->split) {
            int group = t->split;
            for (auto& x : g.tabs) if (x->split == group) x->split = 0;
            ShowActive();
        }
    } else if (v == L"peekOpen") {
        ExpandPeek();
    } else if (v == L"peekClose") {
        ClosePeek();
    } else if (v == L"spaceDelete") {
        DeleteSpace(argId(1));
    } else if (v == L"toSpace") {
        if (Tab* t = FindTab(argId(1))) MoveToSpace(t, argId(2), false);
    } else if (v == L"folderNew") {
        // A folder among the space's pinned tabs (inside another, when given), with the tab given in it.
        Tab* t = FindTab(argId(3));
        int space = t && t->space ? t->space : g.space;
        TabFolder* up = FindFolder(argId(1));
        TabFolder f{g.nextFolder++, space, up && up->space == space ? up->id : 0, arg(2).empty() ? L"New folder" : arg(2).substr(0, 60), true};
        g.folders.push_back(f);
        if (t && t->space) {
            t->folder = f.id;
            if (!t->pinned) { t->pinned = true; t->home = t->url; }
        }
        Order();
        SaveSpaces();
        MarkSessionDirty();
        QueueState();
    } else if (v == L"folderEdit") {
        if (TabFolder* f = FindFolder(argId(1))) {
            if (arg(2) == L"name" && !arg(3).empty()) f->name = arg(3).substr(0, 60);
            else if (arg(2) == L"open") f->open = arg(3) == L"1";
            SaveSpaces();
            QueueState();
        }
    } else if (v == L"folderDelete") {
        // What it held moves up to where it was.
        if (TabFolder* f = FindFolder(argId(1))) {
            int id = f->id, parent = f->parent;
            for (auto& x : g.folders) if (x.parent == id) x.parent = parent;
            for (auto& t : g.tabs) if (t->folder == id) t->folder = parent;
            g.folders.erase(std::remove_if(g.folders.begin(), g.folders.end(), [id](const TabFolder& x) { return x.id == id; }), g.folders.end());
            g_feeds.erase(id);  // a live folder's feed went with it
            Order();
            SaveSpaces();
            MarkSessionDirty();
            QueueState();
        }
    } else if (v == L"follow") {
        FollowSite(FindTab(argId(1)));
    } else if (v == L"feedRefresh") {
        if (TabFolder* f = FindFolder(argId(1)); f && !f->feed.empty()) FetchFeed(*f);
    } else if (v == L"toFolder") {
        // Into a folder of its own space (pinned, as everything there is), or out of folders with 0.
        if (Tab* t = FindTab(argId(1)); t && t->space && !t->priv) {
            TabFolder* f = FindFolder(argId(2));
            if (!f || (f->space == t->space && f->feed.empty())) {
                t->folder = f ? f->id : 0;
                if (f && !t->pinned) { t->pinned = true; t->home = t->url; }
                Order();
                MarkSessionDirty();
                QueueState();
            }
        }
    } else if (v == L"zap") {
        StartZap(FindTab(argId(1)));
    } else if (v == L"zapEnd") {
        EndZap();
    } else if (v == L"privateTab") {
        // A new private tab, or an address in one (Search's row actions).
        AddTab(arg(1).empty() ? kNewTab : arg(1), true, NextPlace(), true);
    } else if (v == L"copyLink") {
        CopyLink(FindTab(argId(1)));
    } else if (v == L"copyUrl") {
        CopyUrl(arg(1));
    } else if (v == L"switchTo") {
        SwitcherEnd(false);
        Activate(argId(1));
    } else if (v == L"duplicate") {
        if (Tab* t = FindTab(argId(1)); t && !t->url.empty()) AddTab(t->url, true, IndexOf(t->id) + 1, t->priv);
    } else if (v == L"sleep") {
        if (Tab* t = FindTab(argId(1)); t && t->id != g.activeId) { Discard(t); QueueState(); }
    } else if (v == L"closeOthers") {
        int keep = argId(1);
        Tab* kept = FindTab(keep);
        std::vector<int> ids;
        for (auto& t : g.tabs) if (kept && t->id != keep && !t->pinned && t->space == kept->space) ids.push_back(t->id);
        for (int id : ids) CloseTab(id);
    } else if (v == L"keep") {
        // Keep this tab: never archived or asleep; one put away to sleep comes back when next on screen, as any does.
        if (Tab* t = FindTab(argId(1)); t && !t->priv) { t->kept = !t->kept; MarkSessionDirty(); QueueState(); }
    } else if (v == L"archiveOpen" || v == L"archiveRemove") {
        // One archived tab, by its address and when it was archived: back into its space as a tab, or gone.
        long long at = _wtoi64(arg(2).c_str());
        auto it = std::find_if(g.archive.begin(), g.archive.end(), [&](const Archived& x) { return x.url == arg(1) && x.at == at; });
        if (it != g.archive.end()) {
            Archived a = *it;
            g.archive.erase(it);
            SaveArchive();
            SendArchive();
            if (v == L"archiveOpen") { CloseOverlay(); Reopen(a.url, a.title, g.tabs.size(), a.space); }
        }
    } else if (v == L"archiveClear") {
        g.archive.clear();
        SaveArchive();
        SendArchive();
    } else if (v == L"reopen") {
        ReopenClosed();
    } else if (v == L"find") {
        g_findTerm = arg(1);
        ApplyFind(a);
    } else if (v == L"findNext") {
        if (a && a->find) a->find->FindNext();
    } else if (v == L"findPrev") {
        if (a && a->find) a->find->FindPrevious();
    } else if (v == L"findClose") {
        g_findTerm.clear();
        if (a && a->find) a->find->Stop();
        if (a && a->ctl) FocusTarget(a->id);
    } else if (v == L"newtab") {
        NewTabPage();
    } else if (v == L"openSettings") {
        OpenSettings(arg(1));
    } else if (v == L"api") {
        std::wstring reqId = arg(1);
        ApiData(arg(2), [reqId](const std::string& body, const wchar_t*, int) {
            UiPost(L"{\"t\":\"api\",\"id\":" + Json(reqId) + L",\"data\":" + (body.empty() ? L"null" : Wide(body)) + L"}");
        });
    } else if (v == L"bookmarksExport") {
        ExportBookmarks();
    } else if (v == L"bookmarksImport") {
        ImportBookmarksFile();
    } else if (v == L"importSources") {
        WhenBrowsersKnown(SendImportSources);
    } else if (v == L"chrome") {
        // The page's chrome: top px, sidebar px, auto-hide.
        g.chromeTopDip = std::max(0, argId(1));
        g.sidebarDip = std::max(0, argId(2));
        bool was = g.autohide;
        g.autohide = arg(3) == L"1";
        Layout();
        RefreshNewTabs();
        // Turning auto-hide on or off settles both at once, and the page hears it either way (it slides them, and
        // their glass follows it).
        if (!g.autohide || !was) {
            Reveal(true, !g.autohide, true);
            Reveal(false, !g.autohide, true);
            FollowNewTab();
        } else {
            SendRevealed();
        }
    } else if (v == L"glass") {
        SetGlass(arg(1));
    } else if (v == L"holdBar") {
        // Something of the chrome is open (find, a menu): the Bar stays. (Its own verb: "pin" pins a tab.)
        g.pinned = arg(1) == L"1";
        if (g.pinned) { Reveal(true, true); FocusTarget(kUi); }  // the find field types even when Search just closed
        else { POINT pt; GetCursorPos(&pt); ScreenToClient(g.hwnd, &pt); AutoHideTrack(pt, false); }
    } else if (v == L"peek") {
        // An address in Peek (Search's row actions).
        if (!arg(1).empty()) { CloseOverlay(); OpenPeek(arg(1)); }
    } else if (v == L"bookmarkAdd") {
        if (std::none_of(g.bookmarks.begin(), g.bookmarks.end(), [&](auto& b) { return b.url == arg(1); })) {
            g.bookmarks.push_back({arg(1), arg(2).empty() ? SiteOf(arg(1)) : arg(2)});
            SaveBookmarks();
            SendBookmarks();
        }
    } else if (v == L"bookmarkEdit") {
        for (auto& b : g.bookmarks)
            if (b.url == arg(1)) { b.title = arg(2); if (!arg(3).empty()) b.url = arg(3); }
        SaveBookmarks();
        SendBookmarks();
    } else if (v == L"bookmarkMove") {
        size_t from = (size_t)argId(1), to = (size_t)argId(2);
        if (from < g.bookmarks.size() && to < g.bookmarks.size()) {
            Bookmark b = g.bookmarks[from];
            g.bookmarks.erase(g.bookmarks.begin() + from);
            g.bookmarks.insert(g.bookmarks.begin() + to, b);
            SaveBookmarks();
            SendBookmarks();
        }
    } else if (v == L"historyDelete") {
        for (size_t i = 1; i < p.size(); i++) g.history.erase(p[i]);
        g.historyDirty = true;
        PruneSiteIcons();
        SendHistory();
        RefreshNewTabs();
    } else if (v == L"clearData") {
        // Cookies, site storage and cache across every site.
        if (Tab* t = a ? a : (g.tabs.empty() ? nullptr : g.tabs[0].get()); t && t->core) {
            ComPtr<ICoreWebView2_13> c13;
            ComPtr<ICoreWebView2Profile> profile;
            ComPtr<ICoreWebView2Profile2> p2;
            if (SUCCEEDED(t->core.As(&c13)) && SUCCEEDED(c13->get_Profile(&profile)) && SUCCEEDED(profile.As(&p2)))
                p2->ClearBrowsingData((COREWEBVIEW2_BROWSING_DATA_KINDS)(COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_SITE |
                                      COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE),
                    Callback<ICoreWebView2ClearBrowsingDataCompletedHandler>([](HRESULT) -> HRESULT {
                        Toast(L"Cookies, site data and cache cleared");
                        return S_OK;
                    }).Get());
        }
    } else if (v.rfind(L"dl", 0) == 0) {
        DownloadAction(v, argId(1));
    } else if (v == L"downloads") {
        SendDownloads();
    } else if (v == L"extInstallMany") {
        for (size_t i = 1; i < p.size(); i++) {
            bool have = std::any_of(g_extFolders.begin(), g_extFolders.end(), [&](auto& e) {
                return e.first == p[i] || e.second == ExtensionsDir() + L"\\" + p[i]; });
            if (IsStoreId(p[i]) && !have && std::find(g_installQueue.begin(), g_installQueue.end(), p[i]) == g_installQueue.end())
                g_installQueue.push_back(p[i]);
        }
        InstallNext();
    } else if (v == L"bookmark") {
        if (a) ToggleBookmark(a->url, a->title);
    } else if (v == L"unbookmark") {
        RemoveBookmark(arg(1));
    } else if (v == L"addBookmarks") {
        // Imported: url, title pairs; ones already saved are skipped.
        int added = 0;
        for (size_t i = 1; i + 1 < p.size(); i += 2) {
            if (std::none_of(g.bookmarks.begin(), g.bookmarks.end(), [&](auto& b) { return b.url == p[i]; })) {
                g.bookmarks.push_back({p[i], p[i + 1]});
                added++;
            }
        }
        if (added) { SaveBookmarks(); SendBookmarks(); }
    } else if (v == L"sidebar") {
        g.sidebarDip = std::max(0, argId(1));
        Layout();
    } else if (v == L"import") {
        WhenBrowsersKnown([key = arg(1)] { Import(key); });
    } else if (v == L"extensions") {
        SendExtensions();
    } else if (v == L"extInstall") {
        InstallStoreExtension(arg(1));
    } else if (v == L"extLoad") {
        PickExtensionFolder();
    } else if (v == L"extIcon") {
        SendExtensionIcon(arg(1), arg(2));
    } else if (v == L"extPopup") {
        CloseOverlay();
        OpenExtensionPopup(arg(1), arg(2), argId(3), argId(4));
    } else if ((v == L"extToggle" || v == L"extRemove") && arg(1) != g_shieldId) {
        bool remove = v == L"extRemove";
        WithExtension(arg(1), [remove](ICoreWebView2BrowserExtension* ext) {
            auto done = [](HRESULT) -> HRESULT { SendExtensions(); return S_OK; };
            if (remove) {
                ext->Remove(Callback<ICoreWebView2BrowserExtensionRemoveCompletedHandler>(done).Get());
            } else {
                BOOL on = FALSE;
                ext->get_IsEnabled(&on);
                ext->Enable(!on, Callback<ICoreWebView2BrowserExtensionEnableCompletedHandler>(done).Get());
            }
        });
    } else if (v == L"pip") {
        // Picture in picture for the page's largest playing video.
        if (a && a->core)
            a->core->ExecuteScript(
                L"(() => { const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];"
                L" if (!v) return; if (document.pictureInPictureElement) document.exitPictureInPicture(); else v.requestPictureInPicture(); })()",
                nullptr);
    } else if (v == L"set") {
        g.settings[arg(1)] = arg(2);
        SaveSettings();
        if (arg(1) == L"boosts") ApplyBoosts();
        if (arg(1) == L"material") ApplyBackdrop();
        ArmSleep();  // the archive may have been turned on
        if (arg(1) == L"appearance") {
            ApplyTheme();
            g.profileReady = false;
            if (Tab* t = Active(); t && t->core) ConfigureProfile(t->core.Get());
        }
        SendSettings();
        RefreshNewTabs();
    } else if (v == L"key") {
        HandleKey((UINT)_wtoi(arg(1).c_str()), false, true);
    } else if (v == L"clearHistory") {
        g.history.clear();
        SaveHistory();
        PruneSiteIcons();
        SendHistory();
    }
}

// ---------------------------------------------------------------------------------------
// Startup: the environment, the chrome page, then the session.

static std::wstring BrowserArguments() {
    // Secure DNS, always Cloudflare and with no plaintext fallback: every lookup goes over HTTPS to it.
    std::wstring enable = L"ParallelDownloading,DnsOverHttps:Fallback/false/Templates/https%3A%2F%2Fchrome.cloudflare-dns.com%2Fdns-query";
    std::wstring debug;
    wchar_t port[16] = {};
    if (GetEnvironmentVariableW(L"EXO_BROWSER_CDP", port, 16)) debug = std::wstring(L" --remote-debugging-port=") + port;
    wchar_t extra[512] = {};
    if (GetEnvironmentVariableW(L"EXO_BROWSER_ARGS", extra, 512)) debug += std::wstring(L" ") + extra;
    // The engine's spare renderer, a page process started ahead of the next site you open, takes the process start out
    // of every new tab and every move to another site; it costs one idle process, so a PC short of memory (under 8 GB,
    // or 80% in use as the browser starts) goes without it.
    MEMORYSTATUSEX m{sizeof m};
    bool roomy = GlobalMemoryStatusEx(&m) && m.ullTotalPhys >= (7ull << 30) && m.dwMemoryLoad < 80;
    return L"--process-per-site --no-pings --disable-domain-reliability"
           L" --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection" + std::wstring(roomy ? L"" : L",SpareRendererForSitePerProcess") +
           L" --enable-features=" + enable + debug;
}

static void RestoreSession() {
    size_t active = 0;
    std::vector<std::pair<int, size_t>> last;
    bool fresh = Setting(L"startup", L"restore") == L"fresh";
    for (auto& row : fresh ? std::vector<std::vector<std::wstring>>{} : ReadTable(L"session.tsv")) {
        if (row[0] == L"active" && row.size() > 1) active = (size_t)_wtoi(row[1].c_str());
        if (row[0] == L"last" && row.size() > 2) last.push_back({_wtoi(row[1].c_str()), (size_t)_wtoi(row[2].c_str())});
        if (row[0] != L"tab" || row.size() < 3) continue;
        auto t = std::make_unique<Tab>();
        t->id = g.nextId++;
        t->url = row[1];
        t->pendingNav = row[1];
        t->title = row[2];
        t->pinned = row.size() > 3 && row[3] == L"1";
        // A space that's gone (or a session from before spaces): the space on screen. 0 is a favorite.
        int space = row.size() > 4 ? _wtoi(row[4].c_str()) : -1;
        t->space = (space == 0 && t->pinned) || FindSpace(space) ? space : g.space;
        if (t->pinned) t->home = row.size() > 5 && !row[5].empty() ? row[5] : t->url;
        t->seen = row.size() > 6 ? _wtoi64(row[6].c_str()) : 0;
        if (t->seen <= 0) t->seen = _time64(nullptr);
        t->split = row.size() > 7 ? _wtoi(row[7].c_str()) : 0;
        if (TabFolder* f = row.size() > 8 && t->pinned ? FindFolder(_wtoi(row[8].c_str())) : nullptr; f && f->space == t->space) t->folder = f->id;
        t->kept = row.size() > 9 && row[9] == L"1";
        g.nextSplit = std::max(g.nextSplit, t->split + 1);
        // An asleep tab shows its site's icon from last time, not a blank globe, until it loads.
        if (auto it = g.favicons.find(SiteOf(t->url)); it != g.favicons.end()) t->favicon = it->second;
        g.tabs.push_back(std::move(t));
    }
    for (auto& [id, i] : last)
        if (Space* s = FindSpace(id); s && i < g.tabs.size() && (g.tabs[i]->space == id || g.tabs[i]->space == 0)) s->last = g.tabs[i]->id;
    // Only the tab on screen loads; the rest wait, asleep, until they are opened. It's the one last on screen in the
    // space last on screen (an address another app opened goes there too).
    // An address another app opened Exo Browser with goes to its route's space, if it has one.
    for (auto& u : g.startupUrls) {
        if (int space = RouteFor(u)) g.space = space;
        AddTab(u, false, g.tabs.size());
    }
    Tab* show = g.startupUrls.empty() ? nullptr : g.tabs.back().get();
    if (Space* s = FindSpace(g.space); !show && s && FindTab(s->last)) show = FindTab(s->last);
    if (!show && active < g.tabs.size() && (g.tabs[active]->space == g.space || g.tabs[active]->space == 0)) show = g.tabs[active].get();
    if (!show) if (auto tabs = SpaceTabs(g.space); !tabs.empty()) show = tabs[0];
    if (show) Activate(show->id);
    else NewTabPage();
}

static void InitBrowser();

// The engine turns a window away while the last one on this profile is still closing: its engine keeps the profile to
// itself until it has gone, a moment after its window (an update's restart, a quick reopen). Instead of staying an
// empty window, Exo Browser asks again every quarter second for 15 seconds, and only then says why.
static void EngineFailed(HRESULT hr) {
    static int tries = 0;
    g.env.Reset();
    bool missing = hr == HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND) || hr == E_NOINTERFACE;  // none, or too old
    if (!missing && ++tries < 60) {
        SetTimer(nullptr, 0, 250, [](HWND, UINT, UINT_PTR id, DWORD) { KillTimer(nullptr, id); InitBrowser(); });
        return;
    }
    wchar_t why[160] = L"Exo Browser needs the Microsoft Edge WebView2 Runtime.";
    if (!missing) swprintf_s(why, L"Exo Browser's engine didn't start (error 0x%08X). Open it again in a moment.", (unsigned)hr);
    MessageBoxW(g.hwnd, why, L"Exo Browser", MB_ICONERROR);
    PostQuitMessage(1);
}

static void CreateUi() {
    ComPtr<ICoreWebView2ControllerOptions> opts;
    g.env->CreateCoreWebView2ControllerOptions(&opts);
    // Its own profile: no extensions, no history, nothing from the web.
    opts->put_ProfileName(L"Chrome");
    if (ComPtr<ICoreWebView2ControllerOptions3> o3; SUCCEEDED(opts.As(&o3))) o3->put_DefaultBackgroundColor({0, 0, 0, 0});
    g.env->CreateCoreWebView2CompositionControllerWithOptions(g.hwnd, opts.Get(),
        Callback<ICoreWebView2CreateCoreWebView2CompositionControllerCompletedHandler>(
            [](HRESULT hr, ICoreWebView2CompositionController* comp) -> HRESULT {
                if (FAILED(hr) || !comp) { EngineFailed(hr); return S_OK; }
                g.uiComp = comp;
                comp->QueryInterface(IID_PPV_ARGS(&g.uiCtl));
                MediaRaster(g.uiCtl.Get());
                g.uiCtl->get_CoreWebView2(&g.ui);
                comp->put_RootVisualTarget(static_cast<::IUnknown*>(winrt::get_unknown(g.chromeVisual)));
                if (ComPtr<ICoreWebView2Controller2> c2; SUCCEEDED(g.uiCtl.As(&c2))) c2->put_DefaultBackgroundColor({0, 0, 0, 0});
                ComPtr<ICoreWebView2Settings> s;
                g.ui->get_Settings(&s);
                s->put_IsStatusBarEnabled(FALSE);
                s->put_IsZoomControlEnabled(FALSE);
                s->put_AreDefaultContextMenusEnabled(FALSE);
#ifndef _DEBUG
                s->put_AreDevToolsEnabled(FALSE);
#endif
                if (ComPtr<ICoreWebView2Settings3> s3; SUCCEEDED(s.As(&s3))) s3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
                if (ComPtr<ICoreWebView2Settings5> s5; SUCCEEDED(s.As(&s5))) s5->put_IsPinchZoomEnabled(FALSE);
                if (ComPtr<ICoreWebView2Settings6> s6; SUCCEEDED(s.As(&s6))) s6->put_IsSwipeNavigationEnabled(FALSE);
                if (ComPtr<ICoreWebView2Settings9> s9; SUCCEEDED(s.As(&s9))) s9->put_IsNonClientRegionSupportEnabled(TRUE);
                EventRegistrationToken tok;
                g.ui->add_ProcessFailed(Callback<ICoreWebView2ProcessFailedEventHandler>(
                    [](ICoreWebView2* core, ICoreWebView2ProcessFailedEventArgs* a) -> HRESULT {
                        COREWEBVIEW2_PROCESS_FAILED_KIND kind;
                        a->get_ProcessFailedKind(&kind);
                        if (kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED ||
                            kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE) {
                            g.uiReady = false;  // until it says "ready" again
                            g_uiHot.clear();
                            EndPageMenu(-1);
                            CloseOverlay(false);
                            core->Reload();
                        }
                        return S_OK;
                    }).Get(), nullptr);
                g.ui->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                    [](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* a) -> HRESULT {
                        LPWSTR m = nullptr;
                        if (SUCCEEDED(a->TryGetWebMessageAsString(&m))) OnUiMessage(Take(m));
                        return S_OK;
                    }).Get(), &tok);
                comp->add_CursorChanged(Callback<ICoreWebView2CursorChangedEventHandler>(
                    [](ICoreWebView2CompositionController* c, IUnknown*) -> HRESULT {
                        c->get_Cursor(&g.uiCursor);
                        if (g.hover == kUi) SetCursor(g.uiCursor);
                        return S_OK;
                    }).Get(), &tok);
                g.uiCtl->add_AcceleratorKeyPressed(Callback<ICoreWebView2AcceleratorKeyPressedEventHandler>(
                    [](ICoreWebView2Controller*, ICoreWebView2AcceleratorKeyPressedEventArgs* a) -> HRESULT {
                        COREWEBVIEW2_KEY_EVENT_KIND kind;
                        a->get_KeyEventKind(&kind);
                        if (kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN)
                            return S_OK;
                        UINT vk = 0;
                        a->get_VirtualKey(&vk);
                        COREWEBVIEW2_PHYSICAL_KEY_STATUS st;
                        a->get_PhysicalKeyStatus(&st);
                        if (HandleKey(vk, st.WasKeyDown, true)) a->put_Handled(TRUE);
                        return S_OK;
                    }).Get(), &tok);
                if (ComPtr<ICoreWebView2_3> c3; SUCCEEDED(g.ui.As(&c3)))
                    c3->SetVirtualHostNameToFolderMapping(L"exo.browser", (g.exeDir + L"\\ui").c_str(),
                                                          COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS);
                Layout();
                g.uiCtl->put_IsVisible(TRUE);
                g.ui->Navigate(L"https://exo.browser/browser.html");
                return S_OK;
            }).Get());
}

static void InitBrowser() {
    BuiltinFolder(L"exo-shield");
    auto options = Make<CoreWebView2EnvironmentOptions>();
    std::wstring args = BrowserArguments();
    options->put_AdditionalBrowserArguments(args.c_str());
    if (ComPtr<ICoreWebView2EnvironmentOptions2> o2; SUCCEEDED(options.As(&o2))) o2->put_ExclusiveUserDataFolderAccess(TRUE);
    // Crash dumps stay on this PC instead of going to Microsoft.
    if (ComPtr<ICoreWebView2EnvironmentOptions3> o3; SUCCEEDED(options.As(&o3))) o3->put_IsCustomCrashReportingEnabled(TRUE);
    if (ComPtr<ICoreWebView2EnvironmentOptions6> o6; SUCCEEDED(options.As(&o6))) o6->put_AreBrowserExtensionsEnabled(TRUE);
    // Pages' scrollbars as Windows 11 draws its own: thin, over the page instead of beside it, wider under the pointer,
    // gone while you aren't scrolling, in the page's own light or dark (Edge's Fluent overlay scrollbars). Windows'
    // contrast themes keep the classic ones, as Exo's own pages do.
    HIGHCONTRASTW contrast{sizeof contrast};
    bool highContrast = SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof contrast, &contrast, 0) && (contrast.dwFlags & HCF_HIGHCONTRASTON);
    if (ComPtr<ICoreWebView2EnvironmentOptions8> o8; !highContrast && SUCCEEDED(options.As(&o8)))
        o8->put_ScrollBarStyle(COREWEBVIEW2_SCROLLBAR_STYLE_FLUENT_OVERLAY);
    std::wstring profile = g.dataDir + L"\\Profile";
    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), options.Get(),
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [](HRESULT hr, ICoreWebView2Environment* env) -> HRESULT {
                if (FAILED(hr) || !env || FAILED(env->QueryInterface(IID_PPV_ARGS(&g.env)))) {
                    EngineFailed(FAILED(hr) ? hr : E_NOINTERFACE);
                    return S_OK;
                }
                CreateUi();
                // A second try finds the session restored already, only without its pages' views.
                if (g.tabs.empty()) RestoreSession();
                else ShowActive();
                return S_OK;
            }).Get());
    if (FAILED(hr)) EngineFailed(hr);
}

// ---------------------------------------------------------------------------------------
// Window

static void SavePlacement() {
    WINDOWPLACEMENT wp{sizeof wp};
    if (g.fullscreen) wp = g.placement;
    else GetWindowPlacement(g.hwnd, &wp);
    RECT r = wp.rcNormalPosition;
    g.settings[L"window"] = std::to_wstring(r.left) + L"," + std::to_wstring(r.top) + L"," + std::to_wstring(r.right) +
                            L"," + std::to_wstring(r.bottom) + L"," + (wp.showCmd == SW_SHOWMAXIMIZED ? L"1" : L"0");
    SaveSettings();
}

static bool IsMouseMessage(UINT m) {
    return (m >= WM_MOUSEFIRST && m <= WM_MOUSELAST && m != WM_MOUSEWHEEL && m != WM_MOUSEHWHEEL);
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    if (IsMouseMessage(msg)) {
        POINT pt{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
        bool down = msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN || msg == WM_XBUTTONDOWN ||
                    msg == WM_LBUTTONDBLCLK || msg == WM_RBUTTONDBLCLK || msg == WM_MBUTTONDBLCLK || msg == WM_XBUTTONDBLCLK;
        bool up = msg == WM_LBUTTONUP || msg == WM_RBUTTONUP || msg == WM_MBUTTONUP || msg == WM_XBUTTONUP;
        int target = g.capture ? g.capture : HitTarget(pt);
        if (target == kPeekAround) {
            if (down) ClosePeek();
            return 0;
        }
        if (msg == WM_MOUSEMOVE && !g.capture) AutoHideTrack(pt, false);
        if (msg == WM_MOUSEMOVE) {
            if (!g.tracking) {
                TRACKMOUSEEVENT tme{sizeof tme, TME_LEAVE, hwnd, 0};
                TrackMouseEvent(&tme);
                g.tracking = true;
            }
            if (g.hover && g.hover != target) SendLeave(g.hover);
            g.hover = target;
        }
        if (down) {
            if (!g.capture) SetCapture(hwnd);
            g.capture = target;
            g_captureUp = msg == WM_RBUTTONDOWN || msg == WM_RBUTTONDBLCLK ? WM_RBUTTONUP : msg == WM_MBUTTONDOWN || msg == WM_MBUTTONDBLCLK ? WM_MBUTTONUP
                        : msg == WM_XBUTTONDOWN || msg == WM_XBUTTONDBLCLK ? WM_XBUTTONUP : WM_LBUTTONUP;
            if (g.focus != target) FocusTarget(target);
            if (target > 0 && target != g.activeId && target != g.peekId && FindTab(target)) { g.activeId = target; QueueState(); }
        }
        if (g.capture) g_capturePt = pt;
        if (msg == WM_MBUTTONUP) g_middleUpAt = GetTickCount64();
        if (target) SendMouse(target, (COREWEBVIEW2_MOUSE_EVENT_KIND)msg, wp, pt);
        if (up && !(GET_KEYSTATE_WPARAM(wp) & (MK_LBUTTON | MK_RBUTTON | MK_MBUTTON | MK_XBUTTON1 | MK_XBUTTON2))) {
            g.capture = 0;
            ReleaseCapture();
        }
        return 0;
    }
    switch (msg) {
    case WM_MOUSEWHEEL:
    case WM_MOUSEHWHEEL: {
        POINT pt{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
        ScreenToClient(hwnd, &pt);
        if (int target = HitTarget(pt)) SendMouse(target, (COREWEBVIEW2_MOUSE_EVENT_KIND)msg, wp, pt);
        return 0;
    }
    case WM_MOUSELEAVE:
        g.tracking = false;
        AutoHideTrack({0, 0}, true);
        if (g.hover && !g.capture) { SendLeave(g.hover); g.hover = 0; }
        return 0;
    case WM_NCMOUSEMOVE: {
        if (g.hover) { SendLeave(g.hover); g.hover = 0; }
        POINT pt{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
        ScreenToClient(hwnd, &pt);
        AutoHideTrack(pt, false);
        break;
    }
    case WM_CAPTURECHANGED:
        // Something else took the mouse mid-press: end the press in the page (a drag or a selection would stay
        // live), and its hover.
        if ((HWND)lp != hwnd && g.capture) {
            int target = g.capture;
            g.capture = 0;
            SendMouse(target, (COREWEBVIEW2_MOUSE_EVENT_KIND)g_captureUp, 0, g_capturePt);
            SendLeave(target);
            if (g.hover == target) g.hover = 0;
        }
        return 0;
    case WM_SETCURSOR:
        if (LOWORD(lp) == HTCLIENT) {
            HCURSOR c = nullptr;
            if (g.hover == kUi) c = g.uiCursor;
            else if (Tab* t = FindTab(g.hover)) c = t->cursor;
            SetCursor(c ? c : LoadCursorW(nullptr, IDC_ARROW));
            return TRUE;
        }
        break;
    case WM_NCCALCSIZE:
        // No title bar: the Bar is the window's top. When maximized, Windows hangs the frame off-screen; otherwise
        // the left, right and bottom keep Windows' own frame, which Windows 11 draws invisible outside the window,
        // so resizing grabs there and not over the page (a page's scrollbar sits at the right edge).
        if (wp && !g.fullscreen) {
            auto* p = (NCCALCSIZE_PARAMS*)lp;
            int f = GetSystemMetricsForDpi(SM_CXFRAME, g.dpi) + GetSystemMetricsForDpi(SM_CXPADDEDBORDER, g.dpi);
            if (IsZoomed(hwnd)) p->rgrc[0].top += f;
            p->rgrc[0].left += f;
            p->rgrc[0].right -= f;
            p->rgrc[0].bottom -= f;
            return 0;
        }
        break;
    case WM_NCHITTEST: {
        if (g.fullscreen) return HTCLIENT;
        POINT pt{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
        ScreenToClient(hwnd, &pt);
        RECT rc;
        GetClientRect(hwnd, &rc);
        if (!IsZoomed(hwnd)) {
            // The top edge is inside the Bar; the others are Windows' frame, outside the client area.
            int b = Px(kResizeDip);
            bool t = pt.y < b, l = pt.x < (t ? b : 0), r = pt.x >= rc.right - (t ? b : 0), d = pt.y >= rc.bottom;
            if (t && l) return HTTOPLEFT;
            if (t && r) return HTTOPRIGHT;
            if (d && l) return HTBOTTOMLEFT;
            if (d && r) return HTBOTTOMRIGHT;
            if (t) return HTTOP;
            if (d) return HTBOTTOM;
            if (l) return HTLEFT;
            if (r) return HTRIGHT;
        }
        bool inBar = g.autohide ? g.revealTop && pt.y < g.revealTop : pt.y < g.contentRect.top;
        if (!g.overlay && inBar && g.uiComp) {
            ComPtr<ICoreWebView2CompositionController4> c4;
            COREWEBVIEW2_NON_CLIENT_REGION_KIND kind = COREWEBVIEW2_NON_CLIENT_REGION_KIND_CLIENT;
            if (SUCCEEDED(g.uiComp.As(&c4)) && SUCCEEDED(c4->GetNonClientRegionAtPoint(pt, &kind)) &&
                kind == COREWEBVIEW2_NON_CLIENT_REGION_KIND_CAPTION)
                return HTCAPTION;
        }
        return HTCLIENT;
    }
    case WM_SIZE: {
        bool was = g.minimized;
        g.minimized = wp == SIZE_MINIMIZED;
        if (g.minimized != was) SetMinimized(g.minimized);
        if (!g.minimized) Layout();
        static WPARAM shown = SIZE_RESTORED;
        if (wp != shown) { shown = wp; QueueState(); }  // the page shows Maximize or Restore
        return 0;
    }
    case WM_MOVE:
        // A page's own popups (a select's list, its context menu, autofill) open where WebView2 thinks the window is:
        // told to what's on screen (each tab off it is told as it comes back, in ShowActive), not every tab at every step
        // of a drag.
        if (g.uiCtl) g.uiCtl->NotifyParentWindowPositionChanged();
        for (auto& t : g.tabs) if (t->ctl && (Shown(t.get()) || t->peek)) t->ctl->NotifyParentWindowPositionChanged();
        return 0;
    case WM_QUERYENDSESSION:
        return TRUE;
    case WM_ENDSESSION:
        // Windows is signing out or restarting: WM_CLOSE never comes, so keep what it would have saved.
        if (wp) {
            vault::Lock();
            SavePlacement();
            SaveSession();
            SaveHistory();
            if (g.faviconsDirty) SaveFavicons();
        }
        return 0;
    case WM_DPICHANGED: {
        if (MediaScale()) return 0;
        g.dpi = HIWORD(wp);
        auto* r = (RECT*)lp;
        SetWindowPos(hwnd, nullptr, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
        Layout();
        return 0;
    }
    case WM_SETFOCUS:
        if (g.focus) FocusTarget(g.focus);
        else if (g.overlay) FocusTarget(kUi);
        else if (Tab* a = Active(); a && a->ctl) FocusTarget(a->id);
        return 0;
    case WM_GETMINMAXINFO: {
        auto* mm = (MINMAXINFO*)lp;
        mm->ptMinTrackSize = {Px(520), Px(360)};
        // A picture build at twice the pixels is a window larger than the screens (Windows caps it at their size).
        if (MediaScale()) mm->ptMaxTrackSize = {16384, 16384};
        return 0;
    }
    case WM_APP_STATE:
        SendState();
        return 0;
    case WM_APP_VAULT:
        OnVaultJob((VaultJob*)lp);
        return 0;
    // Another app in front (a game): the chrome page pauses its loops (spinners, the loading sweep) until it's back. The
    // page can't tell by its own focus, which a click into a tab takes.
    case WM_ACTIVATEAPP:
        if (g.uiReady) UiPost(std::wstring(L"{\"t\":\"active\",\"on\":") + (wp ? L"true" : L"false") + L"}");
        break;
    // Exo Vault locks with Windows, and before the PC sleeps.
    case WM_WTSSESSION_CHANGE:
        if (wp == WTS_SESSION_LOCK) VaultLock();
        break;
    case WM_POWERBROADCAST:
        if (wp == PBT_APMSUSPEND) VaultLock();
        break;
    case WM_APP_UPDATE:
        OnUpdateNews((UpdateNews*)lp);
        return 0;
    case WM_APP_FEED: {
        std::unique_ptr<std::string> body((std::string*)lp);
        if (!body->empty() && FindFolder((int)wp)) {
            g_feeds[(int)wp] = std::move(*body);
            SendFeed((int)wp);
        }
        return 0;
    }
    case WM_APP_SCANNED: {
        std::unique_ptr<std::vector<Browser>> found((std::vector<Browser>*)lp);
        g_browsers = std::move(*found);
        g_browsersAt = GetTickCount64();
        auto waiting = std::move(g_scanWaiters);
        g_scanWaiters.clear();
        for (auto& then : waiting) then();
        return 0;
    }
    case WM_APP_ICON: {
        std::unique_ptr<std::pair<std::wstring, std::wstring>> icon((std::pair<std::wstring, std::wstring>*)lp);
        if (icon->second.empty()) g_iconMiss[icon->first] = NowSeconds();
        else { g_icons[icon->first] = icon->second; g_iconMiss.erase(icon->first); }
        g_iconsDirty = true;
        SetTimer(hwnd, kTimerIcons, 400, nullptr);
        return 0;
    }
    case WM_APP_EXT_READY: {
        std::unique_ptr<std::wstring> result((std::wstring*)lp);
        if (!result->empty() && (*result)[0] == L'!') Toast(result->substr(1));
        else AddExtensionFolder(*result);
        g_installing = false;
        InstallNext();
        return 0;
    }
    case WM_ERASEBKGND: {
        RECT r;
        GetClientRect(hwnd, &r);
        HBRUSH b = CreateSolidBrush(g.page);
        FillRect((HDC)wp, &r, b);
        DeleteObject(b);
        return 1;
    }
    case WM_SETTINGCHANGE:
        if (lp && wcscmp((LPCWSTR)lp, L"ImmersiveColorSet") == 0) ApplyBackdrop();  // Transparency effects on or off
        if (Setting(L"appearance", L"void") == L"match" && lp && wcscmp((LPCWSTR)lp, L"ImmersiveColorSet") == 0) {
            ApplyTheme();
            SendSettings();
            RefreshNewTabs();
        }
        break;
    case WM_COMMAND:
        if (LOWORD(wp) == 1) CloseTab((int)lp);  // a page closed its own window
        return 0;
    case WM_COPYDATA: {
        auto* cd = (COPYDATASTRUCT*)lp;
        std::wstring url = OpenArgument(std::wstring((const wchar_t*)cd->lpData, cd->cbData / sizeof(wchar_t)));
        if (url.rfind(L"http", 0) == 0 && Setting(L"little", L"off") == L"on" && !RouteFor(url) && g.env) {
            OpenLittle(url);
            return TRUE;
        }
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
        if (!url.empty()) {
            CloseOverlay();
            if (int space = RouteFor(url)) EnterSpace(space);
            AddTab(url, true, NextPlace());
        }
        return TRUE;
    }
    case WM_TIMER:
        if (wp == kTimerHide || wp == kTimerHideSide) {
            bool top = wp == kTimerHide;
            KillTimer(hwnd, wp);
            (top ? g_hideTopPending : g_hideSidePending) = false;
            POINT pt;
            GetCursorPos(&pt);
            ScreenToClient(hwnd, &pt);
            RECT rc;
            GetClientRect(hwnd, &rc);
            bool in = PtInRect(&rc, pt) && (top ? pt.y < Px(g.chromeTopDip) + Px(18) : pt.x < Px(g.sidebarDip) + Px(18));
            if (!in && !(top && (g.overlay || g.pinned))) Reveal(top, false);
            return 0;
        }
        if (wp == kTimerDownloads) { DownloadTick(); return 0; }
        if (wp == kTimerSwitcher) { SwitcherTick(); return 0; }
        if (wp == kTimerFeeds) { FeedsTick(); return 0; }
        if (wp == kTimerSleep) {
            SleepTick();
            if (g.historyDirty) SaveHistory();
            if (g.faviconsDirty) SaveFavicons();
            if (!SleepWork()) { KillTimer(hwnd, kTimerSleep); g_sleepArmed = false; }
        } else if (wp == WM_APP_DOWNLOADS) {
            KillTimer(hwnd, WM_APP_DOWNLOADS);
            SendDownloads();
        } else if (wp == kTimerSplit) {
            TickPendingSplit();
        } else if (wp == kTimerUpdate) {
            UpdateTick();
        } else if (wp == kTimerIcons) {
            KillTimer(hwnd, kTimerIcons);
            if (g_iconsDirty) SaveIcons();
            RefreshNewTabs();
        } else if (wp == kTimerSave) {
            KillTimer(hwnd, kTimerSave);
            if (g.sessionDirty) SaveSession();
        } else if (wp == kTimerVault) {
            VaultTick();
        } else if (wp == kTimerClipboard) {
            VaultClearClipboard();
        }
        return 0;
    case WM_CLOSE:
        // Where it was, then out of sight at once: the vault's hand-over and the saves happen behind it.
        SavePlacement();
        ShowWindow(hwnd, SW_HIDE);
        KeepVault();  // open, it stays open for the next start
        vault::Lock();
        VaultClearClipboard();
        SaveSession();
        SaveHistory();
        if (g.faviconsDirty) SaveFavicons();
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY:
        for (auto& t : g.tabs) if (t->ctl) t->ctl->Close();
        if (g.uiCtl) g.uiCtl->Close();
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

static std::wstring ExeDir() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    std::wstring s = path;
    return s.substr(0, s.find_last_of(L'\\'));
}

// Windows' Installed apps entry (HKCU Uninstall\ExoBrowser, or ExoBrowserTest for a walk-through install): its version,
// publisher and links, kept to the running copy. Setup writes them on every install and update (tools/ExoBrowser.nsi,
// the same values); a copy put in place another way left the entry on an older version and an old publisher, so these
// few values are put right as it starts. Only the entry Setup made for this copy's folder is touched, never created.
static void RefreshInstalledEntry() {
    const std::pair<const wchar_t*, const wchar_t*> values[] = {
        {L"DisplayVersion", EXO_VERSION_W},
        {L"Publisher", L"Exo"},  // the family, as getexo.app names it, in every Exo app
        {L"URLInfoAbout", L"https://getexo.app/browser"},
        {L"URLUpdateInfo", L"https://getexo.app/browser"},
        {L"HelpLink", L"https://discord.gg/44mXWhaHP4"},  // the Exo Discord
    };
    auto trimmed = [](std::wstring s) { while (!s.empty() && (s.back() == L'\\' || s.back() == L'/')) s.pop_back(); return s; };
    for (const wchar_t* name : {L"ExoBrowser", L"ExoBrowserTest"}) {
        HKEY key = nullptr;
        if (RegOpenKeyExW(HKEY_CURRENT_USER, (std::wstring(L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\") + name).c_str(),
                          0, KEY_QUERY_VALUE | KEY_SET_VALUE, &key) != ERROR_SUCCESS) continue;
        auto read = [key](const wchar_t* value) {
            wchar_t text[MAX_PATH * 2] = {};
            DWORD size = sizeof text;
            return RegGetValueW(key, nullptr, value, RRF_RT_REG_SZ, nullptr, text, &size) == ERROR_SUCCESS ? std::wstring(text) : L"";
        };
        // A build run from anywhere but the installed folder leaves the installed copy's entry alone.
        std::wstring where = trimmed(read(L"InstallLocation")), here = trimmed(g.exeDir);
        if (!read(L"UninstallString").empty() && !where.empty() &&
            CompareStringOrdinal(where.c_str(), -1, here.c_str(), -1, TRUE) == CSTR_EQUAL)
            for (auto& [value, text] : values)
                if (read(value) != text)
                    RegSetValueExW(key, value, 0, REG_SZ, (const BYTE*)text, (DWORD)((wcslen(text) + 1) * sizeof(wchar_t)));
        RegCloseKey(key);
    }
}

static std::wstring DataDir() {
    // EXO_BROWSER_DATA runs a separate profile (testing logged out, beside your own window).
    wchar_t custom[MAX_PATH] = {};
    if (GetEnvironmentVariableW(L"EXO_BROWSER_DATA", custom, MAX_PATH)) {
        CreateDirectoryW(custom, nullptr);
        return custom;
    }
    PWSTR local = nullptr;
    SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local);
    std::wstring dir = Take(local) + L"\\ExoBrowser";
    CreateDirectoryW(dir.c_str(), nullptr);
    return dir;
}

// The keeper (KeepVault): a window never shown, to hear Windows lock, sleep and sign out; the pipe; and the key.
static bool g_keeperDone = false;

static LRESULT CALLBACK KeeperProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_WTSSESSION_CHANGE:
        if (wp == WTS_SESSION_LOCK || wp == WTS_SESSION_LOGOFF) g_keeperDone = true;
        return 0;
    case WM_POWERBROADCAST:
        if (wp == PBT_APMSUSPEND) g_keeperDone = true;
        return TRUE;
    case WM_QUERYENDSESSION:
        return TRUE;
    case WM_ENDSESSION:
        if (wp) g_keeperDone = true;
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

// This Windows user only, at medium integrity or above: the same user's sandboxed processes (a page's) are refused.
static PSECURITY_DESCRIPTOR OwnerOnly() {
    HANDLE token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return nullptr;
    BYTE buf[256];
    DWORD n = 0;
    bool ok = GetTokenInformation(token, TokenUser, buf, sizeof buf, &n);
    CloseHandle(token);
    LPWSTR sid = nullptr;
    if (!ok || !ConvertSidToStringSidW(((TOKEN_USER*)buf)->User.Sid, &sid)) return nullptr;
    std::wstring sddl = L"D:P(A;;GA;;;" + std::wstring(sid) + L")S:(ML;;NWNR;;;ME)";
    LocalFree(sid);
    PSECURITY_DESCRIPTOR sd = nullptr;
    return ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &sd, nullptr) ? sd : nullptr;
}

// Only a copy of Exo Browser in this sign-in: the one that left the key, or the installed one (an update's).
static bool KeeperAsker(HANDLE pipe, const wchar_t* browser) {
    ULONG pid = 0;
    DWORD theirs = 0, mine = 0;
    if (!GetNamedPipeClientProcessId(pipe, &pid) || !ProcessIdToSessionId(pid, &theirs) || !ProcessIdToSessionId(GetCurrentProcessId(), &mine) ||
        theirs != mine)
        return false;
    std::wstring image = ImageOf(pid), installed = KnownFolder(FOLDERID_LocalAppData) + L"\\ExoBrowser\\app\\ExoBrowser.exe";
    return !image.empty() && (_wcsicmp(image.c_str(), browser) == 0 || _wcsicmp(image.c_str(), installed.c_str()) == 0);
}

static int KeeperMain(HANDLE in) {
    g.dataDir = DataDir();
    KeptVault k;
    DWORD got = 0;
    bool ok = ReadFile(in, &k, sizeof k, &got, nullptr) && got == sizeof k && k.version == 1;
    CloseHandle(in);
    // Encrypted while it waits, readable only inside this process.
    if (!ok || !CryptProtectMemory(k.key, sizeof k.key, CRYPTPROTECTMEMORY_SAME_PROCESS)) { SecureZeroMemory(&k, sizeof k); return 1; }
    ULONGLONG until = k.leftMs < 0 ? 0 : GetTickCount64() + (ULONGLONG)k.leftMs;
    PSECURITY_DESCRIPTOR sd = OwnerOnly();
    SECURITY_ATTRIBUTES sa{sizeof sa, sd, FALSE};
    // FIRST_PIPE_INSTANCE: if anything else holds the name, there is no keeper (and the vault stays locked).
    HANDLE pipe = sd ? CreateNamedPipeW(KeeperPipe().c_str(), PIPE_ACCESS_OUTBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
                                        PIPE_TYPE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, sizeof k, 0, 0, &sa)
                     : INVALID_HANDLE_VALUE;
    if (sd) LocalFree(sd);
    if (pipe == INVALID_HANDLE_VALUE) { SecureZeroMemory(&k, sizeof k); return 1; }
    WNDCLASSW wc{};
    wc.lpfnWndProc = KeeperProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"ExoVaultKeeper";
    RegisterClassW(&wc);
    HWND hwnd = CreateWindowExW(WS_EX_TOOLWINDOW, wc.lpszClassName, L"", WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, wc.hInstance, nullptr);
    WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
    OVERLAPPED ov{};
    ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    auto listen = [&] {
        ResetEvent(ov.hEvent);
        if (!ConnectNamedPipe(pipe, &ov) && GetLastError() == ERROR_PIPE_CONNECTED) SetEvent(ov.hEvent);
    };
    listen();
    // It sleeps until something happens (asked, Windows' news, the vault's folder changing, its time running out): it
    // woke every 2 s to look for the vault file.
    HANDLE folder = FindFirstChangeNotificationW(g.dataDir.c_str(), FALSE, FILE_NOTIFY_CHANGE_FILE_NAME);
    HANDLE waits[2] = {ov.hEvent, folder};
    DWORD count = folder == INVALID_HANDLE_VALUE ? 1 : 2;
    while (!g_keeperDone) {
        DWORD wait = count == 1 ? 2000 : INFINITE;
        if (until) {
            ULONGLONG now = GetTickCount64();
            if (now >= until) break;
            wait = (DWORD)std::min<ULONGLONG>(wait, until - now);
        }
        DWORD r = MsgWaitForMultipleObjects(count, waits, FALSE, wait, QS_ALLINPUT);
        if (r == WAIT_FAILED) break;
        if (r == WAIT_OBJECT_0 + 1 && count == 2) {
            if (!vault::Exists(VaultFile())) break;  // the vault went (removed with Exo Browser's data)
            FindNextChangeNotification(folder);
        } else if (r == WAIT_OBJECT_0) {
            bool handed = false;
            if (KeeperAsker(pipe, k.browser)) {
                KeptVault out = k;
                CryptUnprotectMemory(out.key, sizeof out.key, CRYPTPROTECTMEMORY_SAME_PROCESS);
                out.leftMs = until ? (long long)(until - std::min(until, GetTickCount64())) : -1;
                OVERLAPPED wov{};
                wov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
                DWORD wrote = 0;
                handed = (WriteFile(pipe, &out, sizeof out, nullptr, &wov) || GetLastError() == ERROR_IO_PENDING) &&
                         GetOverlappedResult(pipe, &wov, &wrote, TRUE) && wrote == sizeof out;
                CloseHandle(wov.hEvent);
                SecureZeroMemory(&out, sizeof out);
                if (handed) FlushFileBuffers(pipe);
            }
            if (handed) break;
            DisconnectNamedPipe(pipe);
            listen();
        } else if (r == WAIT_OBJECT_0 + count) {
            MSG m;
            while (PeekMessageW(&m, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&m); DispatchMessageW(&m); }
        } else if (!vault::Exists(VaultFile())) {
            break;  // the vault went (removed with Exo Browser's data)
        }
    }
    if (folder != INVALID_HANDLE_VALUE) FindCloseChangeNotification(folder);
    SecureZeroMemory(&k, sizeof k);
    WTSUnRegisterSessionNotification(hwnd);
    DestroyWindow(hwnd);
    CloseHandle(pipe);
    CloseHandle(ov.hEvent);
    return 0;
}

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int show) {
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    // The vault's keeper: nothing but that.
    if (argc == 3 && wcscmp(argv[1], L"--vault-keeper") == 0) {
        HANDLE in = (HANDLE)(ULONG_PTR)_wcstoui64(argv[2], nullptr, 10);
        LocalFree(argv);
        return KeeperMain(in);
    }
    for (int i = 1; i < argc; i++)
        if (argv[i][0] != L'-') g.startupUrls.push_back(OpenArgument(argv[i]));
    LocalFree(argv);

    // One window per profile: a second start hands its address to the first.
    bool separate = GetEnvironmentVariableW(L"EXO_BROWSER_DATA", nullptr, 0) > 0;
    HANDLE mutex = CreateMutexW(nullptr, TRUE, separate ? L"ExoBrowser.SingleInstance.Separate" : L"ExoBrowser.SingleInstance");
    if (GetLastError() == ERROR_ALREADY_EXISTS && !separate) {
        if (HWND other = FindWindowW(kClassName, nullptr)) {
            std::wstring url = g.startupUrls.empty() ? L"" : g.startupUrls[0];
            COPYDATASTRUCT cd{1, (DWORD)(url.size() * sizeof(wchar_t)), (void*)url.data()};
            AllowSetForegroundWindow(ASFW_ANY);
            SendMessageW(other, WM_COPYDATA, 0, (LPARAM)&cd);
        }
        return 0;
    }

    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    OleInitialize(nullptr);  // COM for this thread, and drag and drop
    g.exeDir = ExeDir();
    g.dataDir = DataDir();
    // Working in the data folder, never the app folder it was started in (a shortcut's Start in, Setup's Launch): a
    // process's current folder can't be renamed, and the app folder is what an update swaps. The engine's helpers and
    // the Setup an update starts inherit it.
    SetCurrentDirectoryW(g.dataDir.c_str());
    for (auto& row : ReadTable(L"settings.tsv"))
        if (row.size() >= 2) g.settings[row[0]] = row[1];
    // A first start (first run not finished yet) sets Reduce motion as Windows has its animation effects (off: Reduce
    // motion on); first run shows it, and from then on only the switch decides, as in every Exo app. A copy already set
    // up keeps what its switch showed.
    if (!g.settings.count(L"reduceMotion") && Setting(L"onboarded", L"") != L"1") {
        BOOL animate = TRUE;
        SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &animate, 0);
        g.settings[L"reduceMotion"] = animate ? L"off" : L"on";
        SaveSettings();
    }
    LoadSpaces();
    for (auto& row : ReadTable(L"archive.tsv"))
        if (row.size() >= 3 && !row[0].empty()) g.archive.push_back({row[0], row[1], _wtoi64(row[2].c_str()), row.size() > 3 ? _wtoi(row[3].c_str()) : 0});
    LoadHistory();
    for (auto& row : ReadTable(L"bookmarks.tsv"))
        if (row.size() >= 2) g.bookmarks.push_back({row[0], row[1]});
    for (auto& row : ReadTable(L"favicons.tsv"))
        if (row.size() >= 2) g.favicons[row[0]] = row[1];
    for (auto& row : ReadTable(L"icons.tsv"))
        if (row.size() >= 2) g_icons[row[0]] = row[1];
    for (auto& row : ReadTable(L"iconmiss.tsv"))
        if (row.size() >= 2) g_iconMiss[row[0]] = _wtoi64(row[1].c_str());
    // Icons saved full size by an earlier version shrink once, off the UI thread.
    {
        std::vector<std::pair<std::wstring, std::wstring>> large;
        for (auto& [site, data] : g_icons)
            if (data.size() > 24 * 1024 && data.rfind(L"data:image/svg", 0) != 0) large.push_back({site, data});
        if (!large.empty()) {
            std::thread([large] {
                // After startup has settled (and the window exists to hear the results).
                std::this_thread::sleep_for(std::chrono::seconds(5));
                HWND hwnd = g.hwnd;
                CoInitializeEx(nullptr, COINIT_MULTITHREADED);
                for (auto& [site, data] : large) {
                    size_t comma = data.find(L',');
                    std::string png = comma == std::wstring::npos ? std::string() : ShrinkIcon(FromB64(data.substr(comma + 1)));
                    if (!png.empty())
                        PostMessageW(hwnd, WM_APP_ICON, 0, (LPARAM)new std::pair<std::wstring, std::wstring>(
                            site, L"data:image/png;base64," + Base64((const BYTE*)png.data(), (DWORD)png.size())));
                }
                CoUninitialize();
            }).detach();
        }
    }
    for (auto& row : ReadTable(L"extensions.tsv"))
        if (row.size() >= 2) g_extFolders[row[0]] = row[1];
    LoadDownloads();
    g.autohide = Setting(L"autohide", L"off") == L"on";
    g.chromeTopDip = Setting(L"tabs", L"horizontal") == L"vertical" ? 52 : 94;
    if (Setting(L"tabs", L"horizontal") == L"vertical") g.sidebarDip = _wtoi(Setting(L"sidebarWidth", L"240").c_str());
    ApplyTheme();

    WNDCLASSEXW wc{sizeof wc};
    wc.style = CS_DBLCLKS;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = inst;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = nullptr;
    wc.hIcon = LoadIconW(inst, MAKEINTRESOURCEW(1));
    wc.lpszClassName = kClassName;
    RegisterClassExW(&wc);

    RECT work;
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
    int w = std::min(1440L, work.right - work.left - 80), h = std::min(900L, work.bottom - work.top - 80);
    RECT r{work.left + (work.right - work.left - w) / 2, work.top + (work.bottom - work.top - h) / 2, 0, 0};
    r.right = r.left + w;
    r.bottom = r.top + h;
    bool maximized = false;
    auto saved = Split(Setting(L"window", L""), L',');
    if (saved.size() == 5) {
        RECT s{_wtoi(saved[0].c_str()), _wtoi(saved[1].c_str()), _wtoi(saved[2].c_str()), _wtoi(saved[3].c_str())};
        if (MonitorFromRect(&s, MONITOR_DEFAULTTONULL) && s.right - s.left > 300 && s.bottom - s.top > 200) r = s;
        maximized = saved[4] == L"1";
    }

    g.hwnd = CreateWindowExW(0, kClassName, L"Exo Browser", WS_OVERLAPPEDWINDOW,
                             r.left, r.top, r.right - r.left, r.bottom - r.top, nullptr, nullptr, inst, nullptr);
    g.dpi = MediaScale() ? (UINT)(96 * MediaScale()) : GetDpiForWindow(g.hwnd);
    ApplyTheme();
    InitComposition();
    ApplyBackdrop();
    RegisterDragDrop(g.hwnd, new DropTarget());
    // The frame applied, not the window activated: that's ShowWindow's, by how it was started (a start in the
    // background, SW_SHOWNOACTIVATE, stays behind the app in front; this call alone brought it in front).
    SetWindowPos(g.hwnd, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    ShowWindow(g.hwnd, maximized ? SW_SHOWMAXIMIZED : show);
    Layout();
    // Once a launch, as the window opens and before the pages start: what's newest, for the update sheet (its answer
    // waits for the chrome page's ready, which sends it).
    UpdateCheck(true, true);
    // Its answer can come at once, inside this call (the window has to be there by then).
    InitBrowser();
    SetTimer(g.hwnd, kTimerUpdate, kUpdateEveryMs, nullptr);  // the next after the one as the window opens
    if (std::any_of(g.folders.begin(), g.folders.end(), [](auto& f) { return !f.feed.empty(); })) SetTimer(g.hwnd, kTimerFeeds, 15 * 1000, nullptr);
    CleanUpdates();
    RefreshInstalledEntry();
    WTSRegisterSessionNotification(g.hwnd, NOTIFY_FOR_THIS_SESSION);
    vault::HelloAvailable([](bool yes) { g_helloReady = yes; if (g.uiReady) VaultState(); });

    MSG m;
    while (GetMessageW(&m, nullptr, 0, 0)) {
        TranslateMessage(&m);
        DispatchMessageW(&m);
    }
    RevokeDragDrop(g.hwnd);
    OleUninitialize();
    if (mutex) CloseHandle(mutex);
    return 0;
}
