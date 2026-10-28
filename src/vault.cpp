// Exo Vault's file and keys (vault.h says what it is). Argon2id is the reference implementation
// (vendor/argon2); AES-256-GCM, SHA-256 and the random numbers are Windows' own (CNG).
#include "vault.h"
#include <windows.h>
#include <bcrypt.h>
#include <wincrypt.h>
#include <mutex>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Credentials.h>
#include <winrt/Windows.Security.Cryptography.h>
#include <winrt/Windows.Storage.Streams.h>
#include "argon2.h"

namespace vault {

// Argon2id at 256 MiB, 4 passes, 4 lanes: a fraction of a second to unlock, and every guess at a
// stolen file costs an attacker the same memory and time.
static const uint32_t kMemory = 262144, kPasses = 4, kLanes = 4;
static const char kKeyAad[] = "exovault-key-v1", kDataAad[] = "exovault-data-v1";

static std::mutex g_io;   // one reader or writer of a vault file at a time
static std::string g_key; // the vault key while unlocked (UI thread only)

void Wipe(std::string& s) {
    if (!s.empty()) SecureZeroMemory(s.data(), s.size());
    s.clear();
}

static std::string Random(size_t n) {
    std::string s(n, 0);
    BCryptGenRandom(nullptr, (PUCHAR)s.data(), (ULONG)n, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    return s;
}

static std::string Derive(const std::string& password, const std::string& salt, uint32_t memory, uint32_t passes, uint32_t lanes) {
    std::string key(32, 0);
    if (argon2id_hash_raw(passes, memory, lanes, password.data(), password.size(), salt.data(), salt.size(), key.data(), 32) != ARGON2_OK)
        return "";
    return key;
}

// AES-256-GCM: sealed is nonce (12) + ciphertext + tag (16), bound to `aad`.
static bool Gcm(bool encrypt, const std::string& key, const std::string& nonce, const char* aad, const BYTE* in, size_t n,
                BYTE* tag, std::string& out) {
    BCRYPT_KEY_HANDLE k = nullptr;
    if (key.size() != 32 || BCryptGenerateSymmetricKey(BCRYPT_AES_GCM_ALG_HANDLE, &k, nullptr, 0, (PUCHAR)key.data(), 32, 0) != 0)
        return false;
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
    BCRYPT_INIT_AUTH_MODE_INFO(info);
    info.pbNonce = (PUCHAR)nonce.data();
    info.cbNonce = 12;
    info.pbAuthData = (PUCHAR)aad;
    info.cbAuthData = (ULONG)strlen(aad);
    info.pbTag = tag;
    info.cbTag = 16;
    out.assign(n, 0);
    ULONG got = 0;
    NTSTATUS st = encrypt ? BCryptEncrypt(k, (PUCHAR)in, (ULONG)n, &info, nullptr, 0, (PUCHAR)out.data(), (ULONG)n, &got, 0)
                          : BCryptDecrypt(k, (PUCHAR)in, (ULONG)n, &info, nullptr, 0, (PUCHAR)out.data(), (ULONG)n, &got, 0);
    BCryptDestroyKey(k);
    if (st != 0) { Wipe(out); return false; }
    return true;
}

static std::string Seal(const std::string& key, const std::string& plain, const char* aad) {
    std::string nonce = Random(12), out;
    BYTE tag[16];
    if (!Gcm(true, key, nonce, aad, (const BYTE*)plain.data(), plain.size(), tag, out)) return "";
    return nonce + out + std::string((const char*)tag, 16);
}

static bool Unseal(const std::string& key, const std::string& sealed, const char* aad, std::string& plain) {
    if (sealed.size() < 12 + 16) return false;
    BYTE tag[16];
    memcpy(tag, sealed.data() + sealed.size() - 16, 16);
    return Gcm(false, key, sealed.substr(0, 12), aad, (const BYTE*)sealed.data() + 12, sealed.size() - 28, tag, plain);
}

static std::string ToBase64(const std::string& s) {
    DWORD n = 0;
    CryptBinaryToStringA((const BYTE*)s.data(), (DWORD)s.size(), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &n);
    std::string out(n, 0);
    CryptBinaryToStringA((const BYTE*)s.data(), (DWORD)s.size(), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, out.data(), &n);
    out.resize(n);
    return out;
}

static std::string FromBase64(const std::string& s) {
    DWORD n = 0;
    if (s.empty() || !CryptStringToBinaryA(s.c_str(), (DWORD)s.size(), CRYPT_STRING_BASE64, nullptr, &n, nullptr, nullptr)) return "";
    std::string out(n, 0);
    CryptStringToBinaryA(s.c_str(), (DWORD)s.size(), CRYPT_STRING_BASE64, (BYTE*)out.data(), &n, nullptr, nullptr);
    out.resize(n);
    return out;
}

// The file: one flat JSON object. {"exovault":1,"kdf":"argon2id","m":..,"t":..,"p":..,"salt":..,
// "password": the vault key sealed under the master password's key, "hello": the same under Windows
// Hello's (optional), "data": the items sealed under the vault key}. Byte fields are base64.
struct Envelope {
    uint32_t memory = kMemory, passes = kPasses, lanes = kLanes;
    std::string salt, password, hello, data;
};

static std::string ToJson(const Envelope& e) {
    std::string j = "{\"exovault\":1,\"kdf\":\"argon2id\",\"m\":" + std::to_string(e.memory) + ",\"t\":" + std::to_string(e.passes) +
                    ",\"p\":" + std::to_string(e.lanes) + ",\"salt\":\"" + ToBase64(e.salt) + "\",\"password\":\"" + ToBase64(e.password) + "\"";
    if (!e.hello.empty()) j += ",\"hello\":\"" + ToBase64(e.hello) + "\"";
    return j + ",\"data\":\"" + ToBase64(e.data) + "\"}";
}

static std::string Field(const std::string& j, const char* name) {
    std::string k = std::string("\"") + name + "\":";
    size_t at = j.find(k);
    if (at == std::string::npos) return "";
    at += k.size();
    if (at < j.size() && j[at] == '"') {
        size_t end = j.find('"', at + 1);
        return end == std::string::npos ? "" : j.substr(at + 1, end - at - 1);
    }
    return j.substr(at, j.find_first_of(",}", at) - at);
}

static std::string ReadAll(const std::wstring& file) {
    HANDLE h = CreateFileW(file.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    if (h == INVALID_HANDLE_VALUE) return "";
    LARGE_INTEGER size{};
    std::string s;
    // A vault is small; anything over 256 MB is not one.
    if (GetFileSizeEx(h, &size) && size.QuadPart > 0 && size.QuadPart < (256ll << 20)) {
        s.resize((size_t)size.QuadPart);
        DWORD got = 0;
        if (!ReadFile(h, s.data(), (DWORD)s.size(), &got, nullptr)) got = 0;
        s.resize(got);
    }
    CloseHandle(h);
    return s;
}

// Written whole to a temporary file, flushed, then swapped in; the version before is kept as .bak.
static bool WriteAtomic(const std::wstring& file, const std::string& data) {
    std::wstring tmp = file + L".tmp";
    HANDLE h = CreateFileW(tmp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD wrote = 0;
    bool ok = WriteFile(h, data.data(), (DWORD)data.size(), &wrote, nullptr) && wrote == data.size() && FlushFileBuffers(h);
    CloseHandle(h);
    if (!ok) { DeleteFileW(tmp.c_str()); return false; }
    if (GetFileAttributesW(file.c_str()) != INVALID_FILE_ATTRIBUTES) CopyFileW(file.c_str(), (file + L".bak").c_str(), FALSE);
    return MoveFileExW(tmp.c_str(), file.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0;
}

static Result Read(const std::wstring& file, Envelope& e) {
    if (GetFileAttributesW(file.c_str()) == INVALID_FILE_ATTRIBUTES) return NoFile;
    std::string j = ReadAll(file);
    if (Field(j, "exovault") != "1" || Field(j, "kdf") != "argon2id") return Corrupt;
    e.memory = strtoul(Field(j, "m").c_str(), nullptr, 10);
    e.passes = strtoul(Field(j, "t").c_str(), nullptr, 10);
    e.lanes = strtoul(Field(j, "p").c_str(), nullptr, 10);
    // An imported file can't ask for an unreasonable amount of work or memory (8 MiB to 1 GiB).
    if (e.memory < 8192 || e.memory > 1048576 || e.passes < 1 || e.passes > 32 || e.lanes < 1 || e.lanes > 16) return Corrupt;
    e.salt = FromBase64(Field(j, "salt"));
    e.password = FromBase64(Field(j, "password"));
    e.hello = FromBase64(Field(j, "hello"));
    e.data = FromBase64(Field(j, "data"));
    return e.salt.size() == 16 && !e.password.empty() && !e.data.empty() ? Ok : Corrupt;
}

static Opened OpenSlot(const Envelope& e, const std::string& slotKey, const std::string& slot) {
    Opened o;
    std::string key;
    if (slot.empty() || !Unseal(slotKey, slot, kKeyAad, key) || key.size() != 32) { Wipe(key); o.result = WrongPassword; return o; }
    if (!Unseal(key, e.data, kDataAad, o.json)) { Wipe(key); o.result = Corrupt; return o; }
    o.key = std::move(key);
    o.result = Ok;
    return o;
}

Opened Create(const std::wstring& file, const std::string& password, const std::string& json) {
    Opened o;
    Envelope e;
    e.salt = Random(16);
    std::string kek = Derive(password, e.salt, e.memory, e.passes, e.lanes);
    if (kek.empty()) return o;
    std::string key = Random(32);
    e.password = Seal(kek, key, kKeyAad);
    e.data = Seal(key, json, kDataAad);
    Wipe(kek);
    std::lock_guard<std::mutex> lock(g_io);
    if (e.password.empty() || e.data.empty() || !WriteAtomic(file, ToJson(e))) { Wipe(key); o.result = WriteFailed; return o; }
    o.key = std::move(key);
    o.json = json;
    o.result = Ok;
    return o;
}

Opened Unlock(const std::wstring& file, const std::string& password) {
    Envelope e;
    {
        std::lock_guard<std::mutex> lock(g_io);
        if (Result r = Read(file, e); r != Ok) { Opened o; o.result = r; return o; }
    }
    std::string kek = Derive(password, e.salt, e.memory, e.passes, e.lanes);
    Opened o = OpenSlot(e, kek, e.password);
    Wipe(kek);
    return o;
}

Opened Open(const std::wstring& file, const std::string& password) { return Unlock(file, password); }

Opened UnlockWithHelloKey(const std::wstring& file, const std::string& helloKey) {
    Envelope e;
    {
        std::lock_guard<std::mutex> lock(g_io);
        if (Result r = Read(file, e); r != Ok) { Opened o; o.result = r; return o; }
    }
    if (e.hello.empty()) { Opened o; o.result = NoHello; return o; }
    Opened o = OpenSlot(e, helloKey, e.hello);
    if (o.result == WrongPassword) o.result = HelloFailed;
    return o;
}

Opened UnlockWithKey(const std::wstring& file, const std::string& key) {
    Envelope e;
    {
        std::lock_guard<std::mutex> lock(g_io);
        if (Result r = Read(file, e); r != Ok) { Opened o; o.result = r; return o; }
    }
    Opened o;
    if (key.size() != 32 || !Unseal(key, e.data, kDataAad, o.json)) { o.result = WrongPassword; return o; }
    o.key = key;
    o.result = Ok;
    return o;
}

Result Export(const std::wstring& file, const std::string& password, const std::string& json) {
    Opened o = Create(file, password, json);
    Wipe(o.key);
    Wipe(o.json);
    return o.result;
}

void Adopt(const std::string& key) { Wipe(g_key); g_key = key; }
bool Unlocked() { return g_key.size() == 32; }
std::string Key() { return g_key; }
void Lock() { Wipe(g_key); }

Result Save(const std::wstring& file, const std::string& json) {
    if (!Unlocked()) return WrongPassword;
    std::lock_guard<std::mutex> lock(g_io);
    Envelope e;
    if (Result r = Read(file, e); r != Ok) return r;
    e.data = Seal(g_key, json, kDataAad);
    return !e.data.empty() && WriteAtomic(file, ToJson(e)) ? Ok : WriteFailed;
}

Result ChangePassword(const std::wstring& file, const std::string& key, const std::string& password) {
    if (key.size() != 32) return WrongPassword;
    std::string salt = Random(16);
    std::string kek = Derive(password, salt, kMemory, kPasses, kLanes);
    if (kek.empty()) return Corrupt;
    std::string slot = Seal(kek, key, kKeyAad);
    Wipe(kek);
    std::lock_guard<std::mutex> lock(g_io);
    Envelope e;
    if (Result r = Read(file, e); r != Ok) return r;
    e.memory = kMemory, e.passes = kPasses, e.lanes = kLanes, e.salt = salt, e.password = slot;
    if (!WriteAtomic(file, ToJson(e))) return WriteFailed;
    // The backup is the file as it was, sealed under the old password: it becomes this one too, so the old password
    // opens nothing kept here.
    CopyFileW(file.c_str(), (file + L".bak").c_str(), FALSE);
    return Ok;
}

Result SetHelloKey(const std::wstring& file, const std::string& helloKey) {
    if (!Unlocked()) return WrongPassword;
    std::lock_guard<std::mutex> lock(g_io);
    Envelope e;
    if (Result r = Read(file, e); r != Ok) return r;
    e.hello = helloKey.empty() ? "" : Seal(helloKey, g_key, kKeyAad);
    return WriteAtomic(file, ToJson(e)) ? Ok : WriteFailed;
}

bool HasHello(const std::wstring& file) {
    std::lock_guard<std::mutex> lock(g_io);
    Envelope e;
    return Read(file, e) == Ok && !e.hello.empty();
}

bool Exists(const std::wstring& file) { return GetFileAttributesW(file.c_str()) != INVALID_FILE_ATTRIBUTES; }

// Windows Hello signs a fixed message with a key kept in this PC's TPM, and only after you confirm it's
// you. RSA signatures of this kind come out the same every time, so their SHA-256 is a key that exists
// only in that moment.
static winrt::fire_and_forget RunHello(bool create, std::function<void(Result, std::string)> done) {
    using namespace winrt::Windows::Security::Credentials;
    using namespace winrt::Windows::Security::Cryptography;
    try {
        if (!co_await KeyCredentialManager::IsSupportedAsync()) { done(NoHello, ""); co_return; }
        KeyCredentialRetrievalResult found = create
            ? co_await KeyCredentialManager::RequestCreateAsync(L"Exo Vault", KeyCredentialCreationOption::ReplaceExisting)
            : co_await KeyCredentialManager::OpenAsync(L"Exo Vault");
        if (found.Status() == KeyCredentialStatus::UserCanceled) { done(HelloCancelled, ""); co_return; }
        if (found.Status() == KeyCredentialStatus::NotFound) { done(NoHello, ""); co_return; }
        if (found.Status() != KeyCredentialStatus::Success) { done(HelloFailed, ""); co_return; }
        auto message = CryptographicBuffer::ConvertStringToBinary(L"Exo Vault unlock key, version 1", BinaryStringEncoding::Utf8);
        KeyCredentialOperationResult signedMessage = co_await found.Credential().RequestSignAsync(message);
        if (signedMessage.Status() == KeyCredentialStatus::UserCanceled) { done(HelloCancelled, ""); co_return; }
        if (signedMessage.Status() != KeyCredentialStatus::Success) { done(HelloFailed, ""); co_return; }
        winrt::com_array<uint8_t> signature;
        CryptographicBuffer::CopyToByteArray(signedMessage.Result(), signature);
        std::string key(32, 0);
        if (BCryptHash(BCRYPT_SHA256_ALG_HANDLE, nullptr, 0, signature.data(), (ULONG)signature.size(), (PUCHAR)key.data(), 32) != 0) {
            done(HelloFailed, "");
            co_return;
        }
        SecureZeroMemory(signature.data(), signature.size());
        done(Ok, key);
        Wipe(key);
    } catch (...) {
        done(HelloFailed, "");
    }
}

void HelloKey(bool create, std::function<void(Result, std::string)> done) { RunHello(create, std::move(done)); }

static winrt::fire_and_forget RunAvailable(std::function<void(bool)> done) {
    bool yes = false;
    try { yes = co_await winrt::Windows::Security::Credentials::KeyCredentialManager::IsSupportedAsync(); } catch (...) {}
    done(yes);
}

void HelloAvailable(std::function<void(bool)> done) { RunAvailable(std::move(done)); }

}  // namespace vault
