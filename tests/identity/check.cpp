// Independent check of the Exo identity spec v0 test vectors (ExoLauncher's plan, §2) for Exo Browser.
// Every value in exo-identity-vectors.json (exo-identity-vectors/2) is worked out again here from the spec
// text with Windows' own crypto only (CNG: BCrypt, and NCrypt on the Software KSP), so Browser knows the spec
// builds in C++ the way Launcher built it in C# before anything depends on it. No third-party code, JSON
// reader included.
//
// Build: cl /nologo /std:c++20 /EHsc /O2 /W3 /DUNICODE /D_UNICODE check.cpp bcrypt.lib ncrypt.lib crypt32.lib
// Run:   check.exe <path to exo-identity-vectors.json>
// One line per check, then the totals; the exit code is 1 when anything failed.
#define NOMINMAX  // std::min, not windows.h's macro
#include <windows.h>
#include <bcrypt.h>
#include <ncrypt.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <vector>

using Bytes = std::string;  // byte strings, as vault.cpp keeps them

// ---- Reporting

struct Tally {
    std::string section;
    int pass = 0, fail = 0;
};
static std::vector<Tally> g_tally;

// Failure details go to a console that may not be UTF-8, so anything outside printable ASCII is escaped.
static std::string Printable(const std::string& s, size_t max = 160) {
    std::string out;
    for (unsigned char c : s) {
        if (out.size() >= max) { out += "..."; break; }
        if (c >= 0x20 && c < 0x7f) out += (char)c;
        else { char b[8]; snprintf(b, sizeof b, "\\x%02x", c); out += b; }
    }
    return out;
}

static bool Check(const char* section, const std::string& what, bool ok, const std::string& expected = "",
                  const std::string& computed = "") {
    auto t = std::find_if(g_tally.begin(), g_tally.end(), [&](const Tally& x) { return x.section == section; });
    if (t == g_tally.end()) { g_tally.push_back({section}); t = g_tally.end() - 1; }
    (ok ? t->pass : t->fail)++;
    printf("%s  %-13s %s\n", ok ? "PASS" : "FAIL", section, Printable(what).c_str());
    if (!ok && !(expected.empty() && computed.empty()))
        printf("      expected %s\n      computed %s\n", Printable(expected, 4000).c_str(), Printable(computed, 4000).c_str());
    return ok;
}

static bool Same(const char* section, const std::string& what, const std::string& expected, const std::string& computed) {
    return Check(section, what, expected == computed, expected, computed);
}

// ---- Encodings

static std::string Hex(const Bytes& b) {
    static const char d[] = "0123456789abcdef";
    std::string h;
    for (unsigned char c : b) { h += d[c >> 4]; h += d[c & 15]; }
    return h;
}

// The vectors write bytes as lowercase hex; anything else reads as empty and fails its check.
static Bytes Unhex(const std::string& h) {
    auto nibble = [](char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1; };
    Bytes b;
    if (h.size() % 2) return b;
    for (size_t i = 0; i < h.size(); i += 2) {
        int hi = nibble(h[i]), lo = nibble(h[i + 1]);
        if (hi < 0 || lo < 0) return Bytes();
        b += (char)(hi << 4 | lo);
    }
    return b;
}

static bool LowerHex(const std::string& s, size_t n) {
    return s.size() == n && std::all_of(s.begin(), s.end(), [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
}

static Bytes U32(uint32_t n) { return Bytes{(char)(n >> 24), (char)(n >> 16), (char)(n >> 8), (char)n}; }
static Bytes U16(size_t n) { return Bytes{(char)(n >> 8), (char)n}; }

// RFC 4648 base32, uppercase, no padding (Exo IDs, the QR hash, the recovery code).
static const char kBase32[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

static std::string Base32(const Bytes& b) {
    std::string out;
    unsigned acc = 0;
    int bits = 0;
    for (unsigned char c : b) {
        acc = acc << 8 | c;
        bits += 8;
        while (bits >= 5) { out += kBase32[acc >> (bits - 5) & 31]; bits -= 5; }
    }
    if (bits > 0) out += kBase32[acc << (5 - bits) & 31];
    return out;
}

// §2.13's reader: any case, spaces and hyphens skipped, 0/1/8 read as O/I/B. It refuses any other
// character ('=' included), a length no whole number of bytes gives (fewer than 5 bits may be left over)
// and leftover bits that aren't zero, so one value has one spelling once normalized.
static bool ReadBase32(const std::string& text, Bytes& out) {
    out.clear();
    unsigned acc = 0;
    int bits = 0;
    for (char ch : text) {
        if (ch == ' ' || ch == '-') continue;
        if (ch >= 'a' && ch <= 'z') ch = (char)(ch - 32);
        if (ch == '0') ch = 'O';
        else if (ch == '1') ch = 'I';
        else if (ch == '8') ch = 'B';
        const char* p = ch ? strchr(kBase32, ch) : nullptr;
        if (!p) return false;
        acc = acc << 5 | (unsigned)(p - kBase32);
        bits += 5;
        if (bits >= 8) { out += (char)(acc >> (bits - 8)); bits -= 8; }
    }
    return bits < 5 && (acc & ((1u << bits) - 1)) == 0;
}

// §2.12: 26 characters in groups of 5-5-5-5-6.
static std::string RecoveryText(const Bytes& code) {
    std::string t = Base32(code);
    if (t.size() != 26) return "";
    return t.substr(0, 5) + "-" + t.substr(5, 5) + "-" + t.substr(10, 5) + "-" + t.substr(15, 5) + "-" + t.substr(20);
}

static bool ParseRecovery(const std::string& typed, Bytes& code) { return ReadBase32(typed, code) && code.size() == 16; }

// Base64url (RFC 4648 §5) without padding: keys and signatures inside signed records (§2.13).
static const char kBase64Url[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

static std::string Base64Url(const Bytes& b) {
    std::string out;
    unsigned acc = 0;
    int bits = 0;
    for (unsigned char c : b) {
        acc = acc << 8 | c;
        bits += 8;
        while (bits >= 6) { out += kBase64Url[acc >> (bits - 6) & 63]; bits -= 6; }
    }
    if (bits > 0) out += kBase64Url[acc << (6 - bits) & 63];
    return out;
}

// Refuses '=', white space and anything else outside the alphabet; re-encoding must give the same
// text, which also refuses non-zero leftover bits and a length no whole number of bytes gives.
static bool FromBase64Url(const std::string& s, Bytes& out) {
    out.clear();
    unsigned acc = 0;
    int bits = 0;
    for (char ch : s) {
        const char* p = ch ? strchr(kBase64Url, ch) : nullptr;
        if (!p) return false;
        acc = acc << 6 | (unsigned)(p - kBase64Url);
        bits += 6;
        if (bits >= 8) { out += (char)(acc >> (bits - 8)); bits -= 8; }
    }
    return Base64Url(out) == s;
}

// Well-formed UTF-8 to scalar values: no overlongs, no encoded surrogates, nothing past U+10FFFF.
static bool Utf8Decode(const std::string& s, std::vector<unsigned>& out) {
    out.clear();
    for (size_t i = 0; i < s.size();) {
        unsigned char lead = (unsigned char)s[i++];
        int more;
        unsigned cp, min;
        if (lead < 0x80) { out.push_back(lead); continue; }
        if (lead >= 0xC2 && lead <= 0xDF) { more = 1; cp = lead & 0x1Fu; min = 0x80; }
        else if (lead >= 0xE0 && lead <= 0xEF) { more = 2; cp = lead & 0x0Fu; min = 0x800; }
        else if (lead >= 0xF0 && lead <= 0xF4) { more = 3; cp = lead & 0x07u; min = 0x10000; }
        else return false;
        if (i + more > s.size()) return false;
        for (int k = 0; k < more; k++) {
            unsigned char c = (unsigned char)s[i++];
            if ((c & 0xC0) != 0x80) return false;
            cp = cp << 6 | (c & 0x3Fu);
        }
        if (cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return false;
        out.push_back(cp);
    }
    return true;
}

// ---- JSON: one strict reader for the spec's canonical subset (§2.1, §2.11 item 7)

struct Json {
    enum Kind { Missing, Bool, Int, String, Array, Object } kind = Missing;
    bool b = false;
    long long n = 0;
    std::string s;
    std::vector<Json> items;
    std::vector<std::pair<std::string, Json>> fields;

    const Json& operator[](const std::string& key) const {
        static const Json missing;
        for (auto& f : fields)
            if (f.first == key) return f.second;
        return missing;
    }
    const Json& operator[](size_t i) const {
        static const Json missing;
        return i < items.size() ? items[i] : missing;
    }
};

// Objects, arrays, ASCII keys, strings, true/false and integers below 2^53. It refuses null (the subset
// leaves the key out), fractions and exponents (even 1.0), -0, repeated keys, non-ASCII keys, lone
// surrogates and malformed UTF-8. The vectors file sits inside the subset too, so it loads the file as well.
class Reader {
public:
    explicit Reader(const std::string& text) : t_(text) {}
    bool Parse(Json& out) {
        Space();
        if (!Value(out, 0)) return false;
        Space();
        return at_ == t_.size();
    }

private:
    const std::string& t_;
    size_t at_ = 0;

    bool Peek(char c) const { return at_ < t_.size() && t_[at_] == c; }
    void Space() {
        while (at_ < t_.size() && (t_[at_] == ' ' || t_[at_] == '\t' || t_[at_] == '\n' || t_[at_] == '\r')) at_++;
    }
    bool Word(const char* w) {
        size_t n = strlen(w);
        if (t_.compare(at_, n, w) != 0) return false;
        at_ += n;
        return true;
    }

    bool Value(Json& v, int depth) {
        if (depth > 64 || at_ >= t_.size()) return false;
        char c = t_[at_];
        if (c == '{') return Object(v, depth);
        if (c == '[') return Array(v, depth);
        if (c == '"') { v.kind = Json::String; return String(v.s); }
        if (Word("true")) { v.kind = Json::Bool; v.b = true; return true; }
        if (Word("false")) { v.kind = Json::Bool; v.b = false; return true; }
        if (c == '-' || (c >= '0' && c <= '9')) return Number(v);
        return false;
    }

    bool Object(Json& v, int depth) {
        v.kind = Json::Object;
        at_++;
        Space();
        if (Peek('}')) { at_++; return true; }
        for (;;) {
            std::string key;
            if (!Peek('"') || !String(key)) return false;
            for (unsigned char k : key)
                if (k >= 0x80) return false;
            for (auto& f : v.fields)
                if (f.first == key) return false;
            Space();
            if (!Peek(':')) return false;
            at_++;
            Space();
            Json item;
            if (!Value(item, depth + 1)) return false;
            v.fields.emplace_back(std::move(key), std::move(item));
            Space();
            if (Peek(',')) { at_++; Space(); continue; }
            if (Peek('}')) { at_++; return true; }
            return false;
        }
    }

    bool Array(Json& v, int depth) {
        v.kind = Json::Array;
        at_++;
        Space();
        if (Peek(']')) { at_++; return true; }
        for (;;) {
            Json item;
            if (!Value(item, depth + 1)) return false;
            v.items.push_back(std::move(item));
            Space();
            if (Peek(',')) { at_++; Space(); continue; }
            if (Peek(']')) { at_++; return true; }
            return false;
        }
    }

    // Integers only and |n| <= 2^53 - 1: past that JavaScript and C# doubles stop agreeing with C++.
    bool Number(Json& v) {
        bool negative = Peek('-');
        if (negative) at_++;
        if (at_ >= t_.size() || t_[at_] < '0' || t_[at_] > '9') return false;
        if (t_[at_] == '0' && at_ + 1 < t_.size() && t_[at_ + 1] >= '0' && t_[at_ + 1] <= '9') return false;
        unsigned long long n = 0;
        while (at_ < t_.size() && t_[at_] >= '0' && t_[at_] <= '9') {
            n = n * 10 + (unsigned)(t_[at_++] - '0');
            if (n > 9007199254740991ull) return false;
        }
        if (Peek('.') || Peek('e') || Peek('E')) return false;
        if (negative && n == 0) return false;
        v.kind = Json::Int;
        v.n = negative ? -(long long)n : (long long)n;
        return true;
    }

    bool Hex4(unsigned& u) {
        if (at_ + 4 > t_.size()) return false;
        u = 0;
        for (int i = 0; i < 4; i++) {
            char c = t_[at_++];
            int d = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
            if (d < 0) return false;
            u = u << 4 | (unsigned)d;
        }
        return true;
    }

    static void Utf8(unsigned u, std::string& out) {
        if (u < 0x80) out += (char)u;
        else if (u < 0x800) { out += (char)(0xC0 | u >> 6); out += (char)(0x80 | (u & 0x3F)); }
        else if (u < 0x10000) { out += (char)(0xE0 | u >> 12); out += (char)(0x80 | (u >> 6 & 0x3F)); out += (char)(0x80 | (u & 0x3F)); }
        else {
            out += (char)(0xF0 | u >> 18);
            out += (char)(0x80 | (u >> 12 & 0x3F));
            out += (char)(0x80 | (u >> 6 & 0x3F));
            out += (char)(0x80 | (u & 0x3F));
        }
    }

    // Raw UTF-8 in the text: one well-formed sequence, copied as it is.
    bool RawUtf8(std::string& out) {
        size_t start = at_ - 1, n = 1;
        unsigned char lead = (unsigned char)t_[start];
        n = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : 2;
        std::vector<unsigned> cps;
        if (start + n > t_.size() || !Utf8Decode(t_.substr(start, n), cps) || cps.size() != 1) return false;
        out.append(t_, start, n);
        at_ = start + n;
        return true;
    }

    bool String(std::string& out) {
        at_++;
        out.clear();
        while (at_ < t_.size()) {
            unsigned char c = (unsigned char)t_[at_++];
            if (c == '"') return true;
            if (c < 0x20) return false;
            if (c >= 0x80) {
                if (!RawUtf8(out)) return false;
                continue;
            }
            if (c != '\\') { out += (char)c; continue; }
            if (at_ >= t_.size()) return false;
            switch (t_[at_++]) {
                case '"': out += '"'; break;
                case '\\': out += '\\'; break;
                case '/': out += '/'; break;
                case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                case 'u': {
                    unsigned u, lo;
                    if (!Hex4(u) || (u >= 0xDC00 && u <= 0xDFFF)) return false;  // a low half with no high half
                    if (u >= 0xD800 && u <= 0xDBFF) {
                        if (at_ + 2 > t_.size() || t_[at_] != '\\' || t_[at_ + 1] != 'u') return false;
                        at_ += 2;
                        if (!Hex4(lo) || lo < 0xDC00 || lo > 0xDFFF) return false;
                        u = 0x10000 + ((u - 0xD800) << 10) + (lo - 0xDC00);
                    }
                    Utf8(u, out);
                    break;
                }
                default: return false;
            }
        }
        return false;
    }
};

static bool ParseJson(const std::string& text, Json& out) {
    out = Json();
    return Reader(text).Parse(out);
}

// RFC 8785 for the subset: keys sorted (they are ASCII, so byte order is UTF-16 order), no whitespace,
// integers as plain decimals, and strings escaping only '"', '\' and U+0000..U+001F, with \b \t \n \f \r
// short and the rest as \u00xx in lowercase hex, as ECMAScript's JSON.stringify writes them.
static void Write(const Json& v, std::string& out) {
    switch (v.kind) {
        case Json::Bool: out += v.b ? "true" : "false"; break;
        case Json::Int: out += std::to_string(v.n); break;
        case Json::String:
            out += '"';
            for (unsigned char c : v.s) {
                switch (c) {
                    case '"': out += "\\\""; break;
                    case '\\': out += "\\\\"; break;
                    case '\b': out += "\\b"; break;
                    case '\f': out += "\\f"; break;
                    case '\n': out += "\\n"; break;
                    case '\r': out += "\\r"; break;
                    case '\t': out += "\\t"; break;
                    default:
                        if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); out += b; }
                        else out += (char)c;
                }
            }
            out += '"';
            break;
        case Json::Array:
            out += '[';
            for (size_t i = 0; i < v.items.size(); i++) {
                if (i) out += ',';
                Write(v.items[i], out);
            }
            out += ']';
            break;
        case Json::Object: {
            std::vector<const std::pair<std::string, Json>*> sorted;
            for (auto& f : v.fields) sorted.push_back(&f);
            std::sort(sorted.begin(), sorted.end(), [](auto a, auto b) { return a->first < b->first; });
            out += '{';
            for (size_t i = 0; i < sorted.size(); i++) {
                if (i) out += ',';
                Write(Json{Json::String, false, 0, sorted[i]->first, {}, {}}, out);
                out += ':';
                Write(sorted[i]->second, out);
            }
            out += '}';
            break;
        }
        default: break;
    }
}

static std::string Canonical(const Json& v) {
    std::string out;
    Write(v, out);
    return out;
}

static Json Without(const Json& v, const char* key) {
    Json copy = v;
    copy.fields.erase(std::remove_if(copy.fields.begin(), copy.fields.end(), [&](auto& f) { return f.first == key; }),
                      copy.fields.end());
    return copy;
}

static Json With(const Json& v, const char* key, const Json& value) {
    Json copy = Without(v, key);
    copy.fields.emplace_back(key, value);
    return copy;
}

static Json Text(const std::string& s) { return Json{Json::String, false, 0, s, {}, {}}; }

// ---- CNG: hashes, HKDF, AES-GCM

static Bytes Sha256(const Bytes& m) {
    Bytes h(32, 0);
    if (BCryptHash(BCRYPT_SHA256_ALG_HANDLE, nullptr, 0, (PUCHAR)m.data(), (ULONG)m.size(), (PUCHAR)h.data(), 32) != 0) return "";
    return h;
}

static Bytes HmacSha256(const Bytes& key, const Bytes& m) {
    Bytes h(32, 0);
    if (BCryptHash(BCRYPT_HMAC_SHA256_ALG_HANDLE, (PUCHAR)key.data(), (ULONG)key.size(), (PUCHAR)m.data(), (ULONG)m.size(),
                   (PUCHAR)h.data(), 32) != 0)
        return "";
    return h;
}

// RFC 5869 by hand on CNG's HMAC. An absent salt is HashLen zero bytes (the RFC's rule, and what HMAC
// does with an empty key anyway), spelled out so CNG never sees a zero-length HMAC secret.
static Bytes Extract(const Bytes& salt, const Bytes& ikm) { return HmacSha256(salt.empty() ? Bytes(32, 0) : salt, ikm); }

static Bytes Expand(const Bytes& prk, const Bytes& info, size_t n) {
    Bytes out, t;
    for (int i = 1; out.size() < n; i++) {
        t = HmacSha256(prk, t + info + (char)i);
        if (t.size() != 32 || i > 255) return "";
        out += t;
    }
    out.resize(n);
    return out;
}

static Bytes Hkdf(const Bytes& ikm, const Bytes& salt, const Bytes& info, size_t n) { return Expand(Extract(salt, ikm), info, n); }

// CNG's own HKDF (BCRYPT_HKDF_ALGORITHM, Windows 10 1803 and later), to show Browser can use either. With a
// salt it is §2.13's Extract-then-Expand shape (SALT_AND_FINALIZE); without one, Expand only (PRK_AND_FINALIZE).
static Bytes CngHkdf(const Bytes& input, const Bytes* salt, const Bytes& info, size_t n) {
    BCRYPT_ALG_HANDLE alg = nullptr;
    BCRYPT_KEY_HANDLE k = nullptr;
    Bytes out;
    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_HKDF_ALGORITHM, nullptr, 0) != 0) return out;
    bool ready = BCryptGenerateSymmetricKey(alg, &k, nullptr, 0, (PUCHAR)input.data(), (ULONG)input.size(), 0) == 0 &&
                 BCryptSetProperty(k, BCRYPT_HKDF_HASH_ALGORITHM, (PUCHAR)BCRYPT_SHA256_ALGORITHM, sizeof(BCRYPT_SHA256_ALGORITHM), 0) == 0 &&
                 (salt ? BCryptSetProperty(k, BCRYPT_HKDF_SALT_AND_FINALIZE, (PUCHAR)salt->data(), (ULONG)salt->size(), 0)
                       : BCryptSetProperty(k, BCRYPT_HKDF_PRK_AND_FINALIZE, nullptr, 0, 0)) == 0;
    if (ready) {
        BCryptBuffer b{(ULONG)info.size(), KDF_HKDF_INFO, (PVOID)info.data()};
        BCryptBufferDesc d{BCRYPTBUFFER_VERSION, 1, &b};
        out.assign(n, 0);
        ULONG got = 0;
        if (BCryptKeyDerivation(k, &d, (PUCHAR)out.data(), (ULONG)n, &got, 0) != 0 || got != n) out.clear();
    }
    if (k) BCryptDestroyKey(k);
    BCryptCloseAlgorithmProvider(alg, 0);
    return out;
}

// AES-GCM as vault.cpp's Gcm, with the tag after the ciphertext. The key's size picks the cipher:
// 16 bytes for HPKE's AES-128-GCM, 32 for the spec's AES-256-GCM.
static bool Gcm(bool encrypt, const Bytes& key, const Bytes& nonce, const Bytes& aad, const Bytes& in, Bytes& out) {
    out.clear();
    if ((key.size() != 16 && key.size() != 32) || nonce.size() != 12 || (!encrypt && in.size() < 16)) return false;
    BCRYPT_KEY_HANDLE k = nullptr;
    if (BCryptGenerateSymmetricKey(BCRYPT_AES_GCM_ALG_HANDLE, &k, nullptr, 0, (PUCHAR)key.data(), (ULONG)key.size(), 0) != 0)
        return false;
    size_t n = encrypt ? in.size() : in.size() - 16;
    BYTE tag[16];
    if (!encrypt) memcpy(tag, in.data() + n, 16);
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
    BCRYPT_INIT_AUTH_MODE_INFO(info);
    info.pbNonce = (PUCHAR)nonce.data();
    info.cbNonce = 12;
    info.pbAuthData = (PUCHAR)aad.data();
    info.cbAuthData = (ULONG)aad.size();
    info.pbTag = tag;
    info.cbTag = 16;
    out.assign(n, 0);
    ULONG got = 0;
    NTSTATUS st = encrypt ? BCryptEncrypt(k, (PUCHAR)in.data(), (ULONG)n, &info, nullptr, 0, (PUCHAR)out.data(), (ULONG)n, &got, 0)
                          : BCryptDecrypt(k, (PUCHAR)in.data(), (ULONG)n, &info, nullptr, 0, (PUCHAR)out.data(), (ULONG)n, &got, 0);
    BCryptDestroyKey(k);
    if (st != 0) { out.clear(); return false; }
    if (encrypt) out += Bytes((const char*)tag, 16);
    return true;
}

static Bytes Seal(const Bytes& key, const Bytes& nonce, const Bytes& aad, const Bytes& plain) {
    Bytes out;
    return Gcm(true, key, nonce, aad, plain, out) ? out : Bytes();
}

static bool Open(const Bytes& key, const Bytes& nonce, const Bytes& aad, const Bytes& sealed, Bytes& plain) {
    return Gcm(false, key, nonce, aad, sealed, plain);
}

// ---- P-256 numbers

// The group order n and floor(n / 2), big-endian.
static const Bytes kOrder = Unhex("ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

static Bytes HalfOf(const Bytes& x) {
    Bytes h(x.size(), 0);
    unsigned carry = 0;
    for (size_t i = 0; i < x.size(); i++) {
        unsigned v = (unsigned char)x[i];
        h[i] = (char)(v >> 1 | carry << 7);
        carry = v & 1;
    }
    return h;
}
static const Bytes kHalfOrder = HalfOf(kOrder);

static bool ValidScalar(const Bytes& d) {
    return d.size() == 32 && d != Bytes(32, 0) && memcmp(d.data(), kOrder.data(), 32) < 0;
}

// n - s, for the (r, n - s) twin of a signature.
static Bytes Negate(const Bytes& s) {
    Bytes out(32, 0);
    int borrow = 0;
    for (int i = 31; i >= 0; i--) {
        int v = (unsigned char)kOrder[i] - (unsigned char)s[i] - borrow;
        borrow = v < 0;
        out[i] = (char)(v + (borrow ? 256 : 0));
    }
    return out;
}

static bool HighS(const Bytes& sig) { return sig.size() == 64 && memcmp(sig.data() + 32, kHalfOrder.data(), 32) > 0; }

static Bytes Twin(const Bytes& sig) { return sig.size() == 64 ? sig.substr(0, 32) + Negate(sig.substr(32)) : Bytes(); }

// §2.1: a signer that gets a high s from CNG or the TPM writes n - s instead.
static Bytes LowS(const Bytes& sig) { return HighS(sig) ? Twin(sig) : sig; }

// §2.13: HKDF-Expand(prk, info || counter byte, 32) for counter 0, 1, ... until 1 <= d < n. The counter
// byte is there even on the first try; `rejected` collects the candidates that missed.
static Bytes DeriveScalar(const Bytes& prk, const std::string& info, int* counter = nullptr, std::vector<Bytes>* rejected = nullptr) {
    for (int c = 0; c < 256; c++) {
        Bytes d = Expand(prk, info + (char)c, 32);
        if (ValidScalar(d)) {
            if (counter) *counter = c;
            return d;
        }
        if (rejected) rejected->push_back(d);
    }
    return "";
}

// ---- CNG: P-256 keys

// BCRYPT_ECCKEY_BLOB header, then X, Y (and d for a private blob), each 32 bytes big-endian.
static Bytes EccBlob(ULONG magic, const Bytes& x, const Bytes& y, const Bytes& d = "") {
    BCRYPT_ECCKEY_BLOB h{magic, 32};
    return Bytes((const char*)&h, sizeof h) + x + y + d;
}

// The point a key holds, as SEC1 uncompressed (04 || X || Y), from its BCRYPT_ECCPUBLIC_BLOB.
static Bytes Sec1(const Bytes& blob) {
    if (blob.size() != sizeof(BCRYPT_ECCKEY_BLOB) + 64) return "";
    return Bytes(1, '\x04') + blob.substr(sizeof(BCRYPT_ECCKEY_BLOB));
}

static bool SplitPoint(const Bytes& sec1, Bytes& x, Bytes& y) {
    if (sec1.size() != 65 || sec1[0] != 4) return false;
    x = sec1.substr(1, 32);
    y = sec1.substr(33, 32);
    return true;
}

// A private key from d alone: X and Y are zero and CNG works the public point out itself (§2.2).
static BCRYPT_KEY_HANDLE BcryptScalar(bool ecdh, const Bytes& d, ULONG flags, const Bytes& x = Bytes(32, 0), const Bytes& y = Bytes(32, 0)) {
    if (d.size() != 32) return nullptr;
    Bytes blob = EccBlob(ecdh ? BCRYPT_ECDH_PRIVATE_P256_MAGIC : BCRYPT_ECDSA_PRIVATE_P256_MAGIC, x, y, d);
    BCRYPT_KEY_HANDLE k = nullptr;
    if (BCryptImportKeyPair(ecdh ? BCRYPT_ECDH_P256_ALG_HANDLE : BCRYPT_ECDSA_P256_ALG_HANDLE, nullptr, BCRYPT_ECCPRIVATE_BLOB, &k,
                            (PUCHAR)blob.data(), (ULONG)blob.size(), flags) != 0)
        k = nullptr;
    SecureZeroMemory(blob.data(), blob.size());
    return k;
}

// A public key; CNG checks the point is on the curve.
static BCRYPT_KEY_HANDLE BcryptPoint(bool ecdh, const Bytes& sec1) {
    Bytes x, y;
    if (!SplitPoint(sec1, x, y)) return nullptr;
    Bytes blob = EccBlob(ecdh ? BCRYPT_ECDH_PUBLIC_P256_MAGIC : BCRYPT_ECDSA_PUBLIC_P256_MAGIC, x, y);
    BCRYPT_KEY_HANDLE k = nullptr;
    if (BCryptImportKeyPair(ecdh ? BCRYPT_ECDH_P256_ALG_HANDLE : BCRYPT_ECDSA_P256_ALG_HANDLE, nullptr, BCRYPT_ECCPUBLIC_BLOB, &k,
                            (PUCHAR)blob.data(), (ULONG)blob.size(), 0) != 0)
        k = nullptr;
    return k;
}

static bool ValidPoint(const Bytes& sec1) {
    BCRYPT_KEY_HANDLE k = BcryptPoint(true, sec1);
    if (k) BCryptDestroyKey(k);
    return k != nullptr;
}

static Bytes BcryptExportPublic(BCRYPT_KEY_HANDLE k) {
    if (!k) return "";
    Bytes b(sizeof(BCRYPT_ECCKEY_BLOB) + 64, 0);
    ULONG n = 0;
    if (BCryptExportKey(k, nullptr, BCRYPT_ECCPUBLIC_BLOB, (PUCHAR)b.data(), (ULONG)b.size(), &n, 0) != 0 || n != b.size()) return "";
    return Sec1(b);
}

static Bytes BcryptPublicFromScalar(bool ecdh, const Bytes& d, ULONG flags) {
    BCRYPT_KEY_HANDLE k = BcryptScalar(ecdh, d, flags);
    Bytes p = BcryptExportPublic(k);
    if (k) BCryptDestroyKey(k);
    return p;
}

// The Software KSP (Microsoft Software Key Storage Provider). Keys imported without a name are
// ephemeral: they live in this process only and nothing is written to disk.
static NCRYPT_PROV_HANDLE g_ksp = 0;

static NCRYPT_KEY_HANDLE NcryptImport(LPCWSTR type, const Bytes& blob) {
    NCRYPT_KEY_HANDLE k = 0;
    if (!g_ksp || NCryptImportKey(g_ksp, 0, type, nullptr, &k, (PBYTE)blob.data(), (DWORD)blob.size(), 0) != ERROR_SUCCESS) k = 0;
    return k;
}

static NCRYPT_KEY_HANDLE NcryptScalar(bool ecdh, const Bytes& d) {
    if (d.size() != 32) return 0;
    Bytes blob = EccBlob(ecdh ? BCRYPT_ECDH_PRIVATE_P256_MAGIC : BCRYPT_ECDSA_PRIVATE_P256_MAGIC, Bytes(32, 0), Bytes(32, 0), d);
    NCRYPT_KEY_HANDLE k = NcryptImport(BCRYPT_ECCPRIVATE_BLOB, blob);
    SecureZeroMemory(blob.data(), blob.size());
    return k;
}

static NCRYPT_KEY_HANDLE NcryptPoint(bool ecdh, const Bytes& sec1) {
    Bytes x, y;
    if (!SplitPoint(sec1, x, y)) return 0;
    return NcryptImport(BCRYPT_ECCPUBLIC_BLOB, EccBlob(ecdh ? BCRYPT_ECDH_PUBLIC_P256_MAGIC : BCRYPT_ECDSA_PUBLIC_P256_MAGIC, x, y));
}

static Bytes NcryptPublicFromScalar(bool ecdh, const Bytes& d) {
    NCRYPT_KEY_HANDLE k = NcryptScalar(ecdh, d);
    if (!k) return "";
    Bytes b(sizeof(BCRYPT_ECCKEY_BLOB) + 64, 0);
    DWORD n = 0;
    SECURITY_STATUS st = NCryptExportKey(k, 0, BCRYPT_ECCPUBLIC_BLOB, nullptr, (PBYTE)b.data(), (DWORD)b.size(), &n, 0);
    NCryptFreeObject(k);
    return st == ERROR_SUCCESS && n == b.size() ? Sec1(b) : Bytes();
}

// CNG gives the raw ECDH secret (the shared X) least significant byte first; DHKEM and the link key
// need it big-endian (§2.1), so it is reversed. `asReturned` keeps CNG's own order for the check.
static Bytes BcryptEcdh(const Bytes& d, const Bytes& peer, LPCWSTR kdf = BCRYPT_KDF_RAW_SECRET, Bytes* asReturned = nullptr) {
    BCRYPT_KEY_HANDLE priv = BcryptScalar(true, d, 0), pub = BcryptPoint(true, peer);
    BCRYPT_SECRET_HANDLE s = nullptr;
    Bytes z;
    if (priv && pub && BCryptSecretAgreement(priv, pub, &s, 0) == 0) {
        BCryptBuffer b{sizeof(BCRYPT_SHA256_ALGORITHM), KDF_HASH_ALGORITHM, (PVOID)BCRYPT_SHA256_ALGORITHM};
        BCryptBufferDesc params{BCRYPTBUFFER_VERSION, 1, &b};
        bool hash = wcscmp(kdf, BCRYPT_KDF_HASH) == 0;
        z.assign(32, 0);
        ULONG n = 0;
        if (BCryptDeriveKey(s, kdf, hash ? &params : nullptr, (PUCHAR)z.data(), 32, &n, 0) != 0 || n != 32) z.clear();
        BCryptDestroySecret(s);
        if (!hash) {
            if (asReturned) *asReturned = z;
            std::reverse(z.begin(), z.end());
        }
    }
    if (priv) BCryptDestroyKey(priv);
    if (pub) BCryptDestroyKey(pub);
    return z;
}

static Bytes NcryptEcdh(const Bytes& d, const Bytes& peer) {
    NCRYPT_KEY_HANDLE priv = NcryptScalar(true, d), pub = NcryptPoint(true, peer);
    NCRYPT_SECRET_HANDLE s = 0;
    Bytes z;
    if (priv && pub && NCryptSecretAgreement(priv, pub, &s, 0) == ERROR_SUCCESS) {
        z.assign(32, 0);
        DWORD n = 0;
        if (NCryptDeriveKey(s, BCRYPT_KDF_RAW_SECRET, nullptr, (PBYTE)z.data(), 32, &n, 0) != ERROR_SUCCESS || n != 32) z.clear();
        NCryptFreeObject(s);
        std::reverse(z.begin(), z.end());
    }
    if (priv) NCryptFreeObject(priv);
    if (pub) NCryptFreeObject(pub);
    return z;
}

// CNG's own ECDSA P-256/SHA-256 check of a P1363 r || s signature. It takes either s.
static bool CngVerify(const Bytes& sec1, const Bytes& message, const Bytes& sig) {
    if (sig.size() != 64) return false;
    BCRYPT_KEY_HANDLE k = BcryptPoint(false, sec1);
    if (!k) return false;
    Bytes h = Sha256(message);
    bool ok = BCryptVerifySignature(k, nullptr, (PUCHAR)h.data(), 32, (PUCHAR)sig.data(), 64, 0) == 0;
    BCryptDestroyKey(k);
    return ok;
}

// The spec's check (§2.1): low-s only, since (r, n - s) verifies too and anyone holding a signature can make it.
static bool Verify(const Bytes& sec1, const Bytes& message, const Bytes& sig) { return !HighS(sig) && CngVerify(sec1, message, sig); }

// Signing as CNG does it, before §2.1's low-s rule.
static Bytes BcryptSignRaw(const Bytes& d, const Bytes& message) {
    BCRYPT_KEY_HANDLE k = BcryptScalar(false, d, 0);
    Bytes h = Sha256(message), sig(64, 0);
    ULONG n = 0;
    bool ok = k && BCryptSignHash(k, nullptr, (PUCHAR)h.data(), 32, (PUCHAR)sig.data(), 64, &n, 0) == 0 && n == 64;
    if (k) BCryptDestroyKey(k);
    return ok ? sig : Bytes();
}

static Bytes NcryptSignRaw(const Bytes& d, const Bytes& message) {
    NCRYPT_KEY_HANDLE k = NcryptScalar(false, d);
    Bytes h = Sha256(message), sig(64, 0);
    DWORD n = 0;
    bool ok = k && NCryptSignHash(k, nullptr, (PBYTE)h.data(), 32, (PBYTE)sig.data(), 64, &n, 0) == ERROR_SUCCESS && n == 64;
    if (k) NCryptFreeObject(k);
    return ok ? sig : Bytes();
}

// Point 1 of Browser's first brief: a P-256 private key imported from d alone (X and Y zero) through every
// CNG path Browser could use, with the public point CNG works out compared against the vector's.
static void CheckPublic(const char* section, const std::string& what, const Bytes& d, const std::string& expected) {
    Same(section, what + " public key: BCrypt ECDSA, d only", expected, Hex(BcryptPublicFromScalar(false, d, 0)));
    Same(section, what + " public key: BCrypt ECDSA, d only, NO_KEY_VALIDATION", expected,
         Hex(BcryptPublicFromScalar(false, d, BCRYPT_NO_KEY_VALIDATION)));
    Same(section, what + " public key: BCrypt ECDH, d only", expected, Hex(BcryptPublicFromScalar(true, d, 0)));
    Same(section, what + " public key: NCrypt Software KSP ECDSA, d only", expected, Hex(NcryptPublicFromScalar(false, d)));
    Same(section, what + " public key: NCrypt Software KSP ECDH, d only", expected, Hex(NcryptPublicFromScalar(true, d)));
}

// ---- Padding (§2.5)

// Plaintext = u32 length (big-endian) || data || zeros, in the smallest size class that holds 4 + length.
// The top class is 64 KiB less the largest envelope's own 151 bytes.
static const size_t kClasses[] = {256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65385};

static size_t PaddedSize(size_t n) {
    for (size_t c : kClasses)
        if (n + 4 <= c) return c;
    return 0;
}

static Bytes Pad(const Bytes& data) {
    size_t c = PaddedSize(data.size());
    if (!c) return "";
    Bytes p = U32((uint32_t)data.size()) + data;
    p.resize(c, 0);
    return p;
}

// A reader takes only the smallest class for the length (an over-padded message is a second spelling of
// it), a length that fits, and zeros after the data.
static bool Unpad(const Bytes& p, Bytes& data) {
    if (p.size() < 4) return false;
    size_t n = (size_t)(unsigned char)p[0] << 24 | (size_t)(unsigned char)p[1] << 16 | (size_t)(unsigned char)p[2] << 8 | (unsigned char)p[3];
    if (n > p.size() - 4 || PaddedSize(n) != p.size()) return false;
    for (size_t i = 4 + n; i < p.size(); i++)
        if (p[i]) return false;
    data = p.substr(4, n);
    return true;
}

// ---- HPKE (RFC 9180), base mode, DHKEM(P-256, HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM

namespace hpke {

static const Bytes kKemSuite = "KEM" + U16(0x0010);
static const Bytes kSuite = "HPKE" + U16(0x0010) + U16(0x0001) + U16(0x0001);

static Bytes LabeledExtract(const Bytes& suite, const Bytes& salt, const char* label, const Bytes& ikm) {
    return Extract(salt, "HPKE-v1" + suite + label + ikm);
}

static Bytes LabeledExpand(const Bytes& suite, const Bytes& prk, const char* label, const Bytes& info, size_t n) {
    return Expand(prk, U16(n) + "HPKE-v1" + suite + label + info, n);
}

static Bytes ExtractAndExpand(const Bytes& dh, const Bytes& kemContext) {
    return LabeledExpand(kKemSuite, LabeledExtract(kKemSuite, "", "eae_prk", dh), "shared_secret", kemContext, 32);
}

// RFC 9180 7.1.3 for P-256: the bitmask is 0xff, so only the range check can make it try again.
static Bytes DeriveKeyPair(const Bytes& ikm) {
    Bytes prk = LabeledExtract(kKemSuite, "", "dkp_prk", ikm);
    for (int c = 0; c < 256; c++) {
        Bytes d = LabeledExpand(kKemSuite, prk, "candidate", Bytes(1, (char)c), 32);
        if (ValidScalar(d)) return d;
    }
    return "";
}

struct Encapsulated {
    Bytes enc, sharedSecret;
};

// Encap with a given ephemeral scalar, so the result is the vector's. enc is CNG's point for skE.
static Encapsulated Encap(const Bytes& skE, const Bytes& pkR) {
    Bytes pkE = BcryptPublicFromScalar(true, skE, 0);
    return {pkE, ExtractAndExpand(BcryptEcdh(skE, pkR), pkE + pkR)};
}

static Bytes Decap(const Bytes& enc, const Bytes& skR) {
    return ExtractAndExpand(BcryptEcdh(skR, enc), enc + BcryptPublicFromScalar(true, skR, 0));
}

struct Context {
    Bytes keyScheduleContext, secret, key, baseNonce, exporterSecret;
};

static Context KeySchedule(const Bytes& sharedSecret, const Bytes& info) {
    Context c;
    c.keyScheduleContext = Bytes(1, '\0') + LabeledExtract(kSuite, "", "psk_id_hash", "") + LabeledExtract(kSuite, "", "info_hash", info);
    c.secret = LabeledExtract(kSuite, sharedSecret, "secret", "");
    c.key = LabeledExpand(kSuite, c.secret, "key", c.keyScheduleContext, 16);
    c.baseNonce = LabeledExpand(kSuite, c.secret, "base_nonce", c.keyScheduleContext, 12);
    c.exporterSecret = LabeledExpand(kSuite, c.secret, "exp", c.keyScheduleContext, 32);
    return c;
}

static Bytes Nonce(const Bytes& base, uint64_t seq) {
    Bytes n = base;
    for (int i = 0; i < 8 && n.size() == 12; i++) n[11 - i] ^= (char)(seq >> (8 * i));
    return n;
}

}  // namespace hpke

// ---- Device names (§2.13)

// 1 to 64 Unicode scalar values. Refused anywhere: controls (U+0000-001F, U+007F-009F), the line and
// paragraph separators, and the bidi embeddings, overrides and isolates. Refused first or last: white space.
// Explicit lists, as the spec asks, not a runtime's Unicode tables.
static bool NameOk(const std::string& name) {
    std::vector<unsigned> cps;
    if (!Utf8Decode(name, cps) || cps.empty() || cps.size() > 64) return false;
    for (unsigned u : cps)
        if (u <= 0x1F || (u >= 0x7F && u <= 0x9F) || u == 0x2028 || u == 0x2029 || (u >= 0x202A && u <= 0x202E) || (u >= 0x2066 && u <= 0x2069))
            return false;
    auto space = [](unsigned u) {
        return u == 0x20 || u == 0xA0 || u == 0x1680 || (u >= 0x2000 && u <= 0x200A) || u == 0x202F || u == 0x205F || u == 0x3000;
    };
    return !space(cps.front()) && !space(cps.back());
}

// ---- The sync batch (§2.7): a 0x01 envelope's data, taken whole or not at all

static bool ReadBatch(const std::string& bytes, const std::string& app, std::string& why) {
    auto no = [&](const char* w) { why = w; return false; };
    Json b;
    if (!ParseJson(bytes, b)) return no("not JSON of the subset");
    if (Canonical(b) != bytes) return no("not in canonical form");
    if (b.kind != Json::Object || b.fields.size() != 3 || b["v"].kind != Json::Int || b["v"].n != 1) return no("not {app, items, v:1}");
    if (b["app"].kind != Json::String || b["app"].s != app) return no("app is not the app whose sub-key opened it");
    if (b["items"].kind != Json::Array || b["items"].items.empty()) return no("no items");
    std::set<std::pair<std::string, std::string>> names;
    for (const Json& item : b["items"].items) {
        if (item.kind != Json::Object || item.fields.size() != 5) return no("an item with missing or extra fields");
        bool tombstone = item["deleted"].kind != Json::Missing;
        if (tombstone && (item["deleted"].kind != Json::Bool || !item["deleted"].b)) return no("deleted is not true");
        if (tombstone == (item["body"].kind != Json::Missing)) return no("not exactly one of body and deleted");
        const std::string &type = item["type"].s, &id = item["id"].s;
        if (item["type"].kind != Json::String || type.empty() || type.size() > 32 ||
            !std::all_of(type.begin(), type.end(), [](char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-'; }))
            return no("type is not 1 to 32 of a-z 0-9 -");
        if (item["id"].kind != Json::String || id.empty() || id.size() > 256 ||
            !std::all_of(id.begin(), id.end(), [](char c) { return c >= 0x21 && c <= 0x7e; }))
            return no("id is not 1 to 256 printable ASCII");
        if (item["modified"].kind != Json::Int || item["modified"].n < 0) return no("modified is not Unix milliseconds");
        if (item["device"].kind != Json::String || !LowerHex(item["device"].s, 32)) return no("device is not 32 lowercase hex");
        if (!names.insert({type, id}).second) return no("an item named twice");
    }
    why = "accepted";
    return true;
}

// ---- The device list (§2.3, §2.13)

struct Member {
    std::string name;
    Bytes sigPub;
    bool recovery = false;
    long long addSeq = 0;  // the seq of its own add: the mutual-removal tie-break
};

struct Chain {
    std::string exoId;
    std::map<std::string, Member> devices;
    std::string head;  // the last change's hash; "" before the first
    long long next = 0;
    bool recoveryUsed = false;
};

// A change's hash: the hex SHA-256 of its canonical form without its own sig. The nested device record of
// an add keeps its sig: that is content the change's signature covers.
static std::string ChangeHash(const Json& c) { return Hex(Sha256(Canonical(Without(c, "sig")))); }

// Checks one change against the chain and applies it when everything holds. With `report`, each step is a
// check line under that section; without, it only answers.
static bool Apply(Chain& chain, const Json& c, const char* report = nullptr, const std::string& label = "") {
    bool ok = true;
    auto step = [&](bool good, const std::string& what) {
        if (report) Check(report, label + " " + what, good);
        ok = ok && good;
        return good;
    };
    const std::string& op = c["op"].s;
    const Json& d = c["device"];
    step(c.kind == Json::Object && c["v"].kind == Json::Int && c["v"].n == 1 && c["exoId"].s == chain.exoId && c["seq"].kind == Json::Int &&
             c["seq"].n == chain.next && c["prev"].kind == Json::String && c["prev"].s == chain.head && c["at"].kind == Json::Int,
         "v 1, the list's exoId, seq " + std::to_string(chain.next) + ", prev = the head's hash");

    // Who signed it: the first change by the device it adds, every later one by a device already listed.
    Bytes signer, sig;
    bool byRecovery = false;
    if (chain.next == 0) {
        step(op == "add" && c["by"].s == d["id"].s && FromBase64Url(d["sigPub"].s, signer), "the first change adds its own author");
    } else {
        auto by = chain.devices.find(c["by"].s);
        if (step(by != chain.devices.end(), "by a device already in the list")) {
            signer = by->second.sigPub;
            byRecovery = by->second.recovery;
        }
    }
    step(FromBase64Url(c["sig"].s, sig) && Verify(signer, "exo-change/1" + Canonical(Without(c, "sig")), sig),
         "signature (exo-change/1) is low-s and verifies");
    if (byRecovery) step(op == "add" && !chain.recoveryUsed, "the recovery entry signs one add and nothing else");

    if (op == "add") {
        Bytes sigPub, recordSig, encPub;
        bool recovery = d["recovery"].kind == Json::Bool && d["recovery"].b;
        step(d.kind == Json::Object && d["v"].kind == Json::Int && d["v"].n == 1 && FromBase64Url(d["sigPub"].s, sigPub) && ValidPoint(sigPub) &&
                 d["id"].s == Hex(Sha256(sigPub).substr(0, 16)),
             "device record v 1, id = first 16 bytes of SHA-256(sigPub)");
        step(FromBase64Url(d["sig"].s, recordSig) && Verify(sigPub, "exo-device/1" + Canonical(Without(d, "sig")), recordSig),
             "device record signature (exo-device/1) is low-s and verifies under its own sigPub");
        if (recovery) {
            bool another = std::any_of(chain.devices.begin(), chain.devices.end(), [](auto& m) { return m.second.recovery; });
            step(d["encPub"].kind == Json::Missing && !another, "the recovery entry has no encPub and is the only one");
        } else {
            step(FromBase64Url(d["encPub"].s, encPub) && ValidPoint(encPub), "encPub is a P-256 point");
        }
        step(NameOk(d["name"].s), "name passes the name rule");
        step(!chain.devices.count(d["id"].s), "a device not already listed");
        if (!ok) return false;
        chain.devices[d["id"].s] = {d["name"].s, sigPub, recovery, c["seq"].n};
        if (byRecovery) chain.recoveryUsed = true;
    } else if (op == "remove") {
        step(d.kind == Json::String && chain.devices.count(d.s), "removes a listed device");
        if (!ok) return false;
        chain.devices.erase(d.s);
    } else if (op == "rename") {
        auto it = chain.devices.find(d["id"].s);
        step(it != chain.devices.end() && d.fields.size() == 2 && NameOk(d["name"].s), "renames a listed device to a valid name");
        if (!ok) return false;
        it->second.name = d["name"].s;
    } else {
        step(false, "a known op");
        return false;
    }
    if (!ok) return false;
    chain.head = ChangeHash(c);
    chain.next++;
    return true;
}

// The fork rule (§2.13) for two changes with the same seq after the same prev; returns which one (0 or 1)
// every device keeps.
static int ForkWinner(const Chain& base, const Json& a, const Json& b) {
    auto removesAuthorOf = [](const Json& x, const Json& y) {
        return x["op"].s == "remove" && x["device"].kind == Json::String && x["device"].s == y["by"].s;
    };
    bool ab = removesAuthorOf(a, b), ba = removesAuthorOf(b, a);
    // 1. A remove beats any concurrent change by the device it removes.
    if (ab != ba) return ab ? 0 : 1;
    // 2. Two devices removing each other: the remove by the one added earlier wins.
    if (ab && ba) {
        auto ia = base.devices.find(a["by"].s), ib = base.devices.find(b["by"].s);
        if (ia != base.devices.end() && ib != base.devices.end() && ia->second.addSeq != ib->second.addSeq)
            return ia->second.addSeq < ib->second.addSeq ? 0 : 1;
    }
    // 3. Otherwise the lower hash, its lowercase hex compared as text.
    return ChangeHash(a) < ChangeHash(b) ? 0 : 1;
}

// The loser is dropped when it no longer applies: its author was removed, the device it adds is in, the
// one it removes (or renames) is gone. Otherwise its author signs it again on top.
static bool StillApplies(const Chain& after, const Json& loser) {
    const Json& d = loser["device"];
    if (!after.devices.count(loser["by"].s)) return false;
    if (loser["op"].s == "add") return !after.devices.count(d["id"].s);
    if (loser["op"].s == "remove") return after.devices.count(d.s) > 0;
    if (loser["op"].s == "rename") return after.devices.count(d["id"].s) > 0;
    return false;
}

// What a change says, apart from where it sits in the chain and when it was signed.
static std::string Content(const Json& c) { return Canonical(Without(Without(Without(Without(c, "sig"), "seq"), "prev"), "at")); }

static std::string Ids(const Chain& chain) {
    std::string s;
    for (auto& [id, m] : chain.devices) s += id + " ";
    return s;
}

static std::string Ids(const Json& list) {
    std::vector<std::string> ids;
    for (const Json& id : list.items) ids.push_back(id.s);
    std::sort(ids.begin(), ids.end());
    std::string s;
    for (auto& id : ids) s += id + " ";
    return s;
}

// ---- The sections

static void CheckRfc9180() {
    const char* S = "rfc9180";
    // RFC 9180 A.3.1 (DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-128-GCM, base mode), from the RFC text.
    const Bytes info = Unhex("4f6465206f6e2061204772656369616e2055726e");
    const Bytes ikmE = Unhex("4270e54ffd08d79d5928020af4686d8f6b7d35dbe470265f1f5aa22816ce860e");
    const Bytes ikmR = Unhex("668b37171f1072f3cf12ea8a236a45df23fc13b82af3609ad1e354f6ef817550");
    const std::string pkEm = "04a92719c6195d5085104f469a8b9814d5838ff72b60501e2c4466e5e67b325ac98536d7b61a1af4b78e5b7f951c0900be863c403ce65c9bfcb9382657222d18c4";
    const std::string skEm = "4995788ef4b9d6132b249ce59a77281493eb39af373d236a1fe415cb0c2d7beb";
    const std::string pkRm = "04fe8c19ce0905191ebc298a9245792531f26f0cece2460639e8bc39cb7f706a826a779b4cf969b8a0e539c7f62fb3d30ad6aa8f80e30f1d128aafd68a2ce72ea0";
    const std::string skRm = "f3ce7fdae57e1a310d87f1ebbde6f328be0a99cdbcadf4d6589cf29de4b8ffd2";
    const std::string sharedSecret = "c0d26aeab536609a572b07695d933b589dcf363ff9d93c93adea537aeabb8cb8";
    const std::string ksc = "00b88d4e6d91759e65e87c470e8b9141113e9ad5f0c8ceefc1e088c82e6980500798e486f9c9c09c9b5c753ac72d6005de254c607d1b534ed11d493ae1c1d9ac85";
    const std::string secret = "2eb7b6bf138f6b5aff857414a058a3f1750054a9ba1f72c2cf0684a6f20b10e1";
    const std::string key = "868c066ef58aae6dc589b6cfdd18f97e", baseNonce = "4e0bc5018beba4bf004cca59";
    const std::string exporter = "14ad94af484a7ad3ef40e9f3be99ecc6fa9036df9d4920548424df127ee0d99f";
    const Bytes pt = Unhex("4265617574792069732074727574682c20747275746820626561757479");
    const std::string ct0 = "5ad590bb8baa577f8619db35a36311226a896e7342a6d836d8b7bcd2f20b6c7f9076ac232e3ab2523f39513434";
    const std::string ct1 = "fa6f037b47fc21826b610172ca9637e82d6e5801eb31cbd3748271affd4ecb06646e0329cbdf3c3cd655b28e82";

    Same(S, "DeriveKeyPair(ikmE) = skEm", skEm, Hex(hpke::DeriveKeyPair(ikmE)));
    Same(S, "DeriveKeyPair(ikmR) = skRm", skRm, Hex(hpke::DeriveKeyPair(ikmR)));
    CheckPublic(S, "skEm", Unhex(skEm), pkEm);
    CheckPublic(S, "skRm", Unhex(skRm), pkRm);
    hpke::Encapsulated e = hpke::Encap(Unhex(skEm), Unhex(pkRm));
    Same(S, "enc", pkEm, Hex(e.enc));
    Same(S, "shared_secret (Encap)", sharedSecret, Hex(e.sharedSecret));
    Same(S, "shared_secret (Decap with skRm)", sharedSecret, Hex(hpke::Decap(Unhex(pkEm), Unhex(skRm))));
    hpke::Context c = hpke::KeySchedule(e.sharedSecret, info);
    Same(S, "key_schedule_context", ksc, Hex(c.keyScheduleContext));
    Same(S, "secret", secret, Hex(c.secret));
    Same(S, "key", key, Hex(c.key));
    Same(S, "base_nonce", baseNonce, Hex(c.baseNonce));
    Same(S, "exporter_secret", exporter, Hex(c.exporterSecret));
    Same(S, "seq 0 ct", ct0, Hex(Seal(c.key, hpke::Nonce(c.baseNonce, 0), "Count-0", pt)));
    Same(S, "seq 1 nonce", "4e0bc5018beba4bf004cca58", Hex(hpke::Nonce(c.baseNonce, 1)));
    Same(S, "seq 1 ct", ct1, Hex(Seal(c.key, hpke::Nonce(c.baseNonce, 1), "Count-1", pt)));
}

static void CheckBase32(const Json& root) {
    const char* S = "base32";
    for (const Json& t : root["base32"].items) {
        const std::string& hex = t["hex"].s;
        const std::string& text = t["text"].s;
        std::string shown = hex.empty() ? "(empty)" : hex.size() > 16 ? hex.substr(0, 16) + "..." : hex;
        Same(S, "encode " + shown, text, Base32(Unhex(hex)));
        Bytes back;
        Check(S, "decode \"" + text + "\"", ReadBase32(text, back) && Hex(back) == hex, hex, Hex(back));
    }
    for (const Json& t : root["base32Read"].items) {
        Bytes back;
        Check(S, "read \"" + t["text"].s + "\"", ReadBase32(t["text"].s, back) && Hex(back) == t["hex"].s, t["hex"].s, Hex(back));
    }
    for (const Json& t : root["base32Refused"].items) {
        Bytes back;
        bool read = ReadBase32(t["text"].s, back);
        Check(S, "refused \"" + t["text"].s + "\" (" + t["why"].s + ")", !read, "(refused)", read ? Hex(back) : "");
    }
}

// No vectors for these in the file; §2.13's base64url reader rules, on cases made here.
static void CheckBase64Url(const Json& root) {
    const char* S = "base64url";
    Bytes key = Unhex(root["sync"]["syncKey"].s), back;
    std::string text = Base64Url(key);
    Check(S, "32 bytes round-trip as 43 characters", text.size() == 43 && FromBase64Url(text, back) && back == key);
    Check(S, "refused: '=' padding", !FromBase64Url(text + "=", back));
    Check(S, "refused: white space inside", !FromBase64Url(text.substr(0, 20) + " " + text.substr(20), back));
    Check(S, "refused: a trailing newline", !FromBase64Url(text + "\n", back));
    Check(S, "refused: '+' (plain base64, not base64url)", !FromBase64Url(text.substr(0, 10) + "+" + text.substr(11), back));
    std::string stray = text;
    stray.back() = kBase64Url[(strchr(kBase64Url, stray.back()) - kBase64Url) | 1];  // the last char's low leftover bit set
    Check(S, "refused: non-zero leftover bits", stray != text && !FromBase64Url(stray, back));
    Check(S, "refused: a length no whole number of bytes gives (45 characters)", !FromBase64Url(text + "AA", back));
}

static void CheckCanonicalJson(const Json& c) {
    const char* S = "canonicalJson";
    for (const Json& t : c["valid"].items) {
        Json v;
        bool parsed = ParseJson(t["input"].s, v);
        Same(S, "valid " + t["input"].s, t["canonical"].s, parsed ? Canonical(v) : "(refused)");
        Json again;
        Check(S, "  its canonical form reads back to itself", ParseJson(t["canonical"].s, again) && Canonical(again) == t["canonical"].s);
    }
    for (const Json& t : c["refused"].items) {
        Json v;
        bool parsed = ParseJson(t.s, v);
        Check(S, "refused " + t.s, !parsed, "(refused)", parsed ? Canonical(v) : "");
    }
}

static void CheckDeviceNames(const Json& n) {
    const char* S = "deviceNames";
    Same(S, "the vectors count names in Unicode scalar values, 1 to 64", "Unicode scalar values, 1 to 64", n["counts"].s);
    for (const Json& t : n["accepted"].items) {
        std::vector<unsigned> cps;
        Utf8Decode(t.s, cps);
        Check(S, "accepted \"" + t.s + "\" (" + std::to_string(cps.size()) + " scalar values)", NameOk(t.s));
    }
    for (const Json& t : n["refused"].items) Check(S, "refused \"" + t["name"].s + "\" (" + t["why"].s + ")", !NameOk(t["name"].s));
}

static std::string Joined(const std::vector<Bytes>& list) {
    std::string s;
    for (auto& b : list) s += Hex(b) + " ";
    return s;
}

static void CheckDeriveScalar(const Json& list) {
    const char* S = "deriveScalar";
    for (const Json& t : list.items) {
        int counter = -1;
        std::vector<Bytes> rejected, want;
        Bytes d = DeriveScalar(Unhex(t["prk"].s), t["info"].s, &counter, &rejected);
        for (const Json& r : t["rejected"].items) want.push_back(Unhex(r.s));
        std::string n = "prk " + t["prk"].s.substr(0, 8) + ".. info \"" + t["info"].s + "\"";
        Same(S, n + " scalar", t["scalar"].s, Hex(d));
        Same(S, n + " counter", std::to_string(t["counter"].n), std::to_string(counter));
        Same(S, n + " rejected candidates", Joined(want), Joined(rejected));
        for (const Bytes& r : rejected) Check(S, n + " candidate " + Hex(r).substr(0, 8) + ".. is out of range (0 or >= n)", !ValidScalar(r));
        CheckPublic(S, n, d, t["publicKey"].s);
    }
}

static Bytes SubKey(const Bytes& syncKey, const std::string& app) { return Expand(syncKey, "exo sync v1/" + app, 32); }

static std::string BoxId(const Bytes& publicKey) { return Hex(Sha256(publicKey).substr(0, 16)); }

static void CheckSync(const Json& sync) {
    const char* S = "sync";
    Bytes syncKey = Unhex(sync["syncKey"].s);
    for (const Json& t : sync["subKeys"].items) {
        std::string info = "exo sync v1/" + t["app"].s;
        Same(S, "sub-key HKDF-Expand(sync key, \"" + info + "\")", t["key"].s, Hex(SubKey(syncKey, t["app"].s)));
        Same(S, "  again through CNG's HKDF, PRK_AND_FINALIZE (Expand only)", t["key"].s, Hex(CngHkdf(syncKey, nullptr, info, 32)));
    }
    for (const Json& t : sync["boxes"].items) {
        Bytes from = t["from"].s == "sync key" ? syncKey : t["from"].s == "browser-history sub-key" ? SubKey(syncKey, "browser-history") : Bytes();
        std::string n = "box from " + t["from"].s;
        int counter = -1;
        Bytes d = DeriveScalar(from, "exo sync box v1", &counter);
        Same(S, n + ": scalar (counter " + std::to_string(counter) + ")", t["scalar"].s, Hex(d));
        CheckPublic(S, n, d, t["publicKey"].s);
        Same(S, n + ": box id", t["boxId"].s, BoxId(Unhex(t["publicKey"].s)));
    }
}

static void CheckSyncBatch(const Json& root) {
    const char* S = "syncBatch";
    const Json& sb = root["syncBatch"];
    std::string why;
    bool ok = ReadBatch(sb["canonical"].s, sb["app"].s, why);
    Check(S, "the canonical batch is accepted for \"" + sb["app"].s + "\"", ok, "accepted", why);
    for (const Json& e : root["envelopes"].items)
        if (e["kind"].n == 1) Same(S, "it is the 0x01 envelope's data", e["data"].s, Hex(sb["canonical"].s));
    for (const Json& r : sb["refused"].items) {
        bool read = ReadBatch(r["text"].s, r["app"].s, why);
        Check(S, "refused (" + r["why"].s + "): " + why, !read, "(refused)", read ? "accepted" : "");
    }
}

static void CheckMailboxAuth(const Json& root) {
    const char* S = "mailboxAuth";
    const Json& m = root["mailboxAuth"];
    const Json& box = root["sync"]["boxes"][0];
    Bytes pub = Unhex(m["boxPublicKey"].s), message = Unhex(m["message"].s);
    Same(S, "box public key is the sync box's", box["publicKey"].s, m["boxPublicKey"].s);
    Same(S, "box id = first 16 bytes of SHA-256(box public key)", m["boxId"].s, BoxId(pub));
    Same(S, "message = \"exo-box-auth/1\" || id (16 raw bytes) || challenge", m["message"].s,
         Hex("exo-box-auth/1" + Unhex(m["boxId"].s) + Unhex(m["challenge"].s)));
    // The box key exists only as a derived scalar, so it has to sign once imported from d alone; CNG hands
    // back a high s about half the time, and §2.1's signer turns it into n - s.
    Bytes d = Unhex(box["scalar"].s);
    for (int path = 0; path < 2; path++) {
        int high = 0, good = 0;
        for (int i = 0; i < 16; i++) {
            Bytes raw = path ? NcryptSignRaw(d, message) : BcryptSignRaw(d, message);
            high += HighS(raw);
            good += !HighS(LowS(raw)) && Verify(pub, message, LowS(raw)) && CngVerify(pub, message, raw);
        }
        Check(S, std::string("16 fresh logins by the d-only ") + (path ? "NCrypt" : "BCrypt") + " key, made low-s, all verify (CNG gave " +
                     std::to_string(high) + " high s)",
              good == 16);
    }
}

static void CheckHighS(const Json& h) {
    const char* S = "highS";
    Bytes pub = Unhex(h["publicKey"].s), msg = Unhex(h["message"].s), low = Unhex(h["lowS"].s), high = Unhex(h["highS"].s);
    Same(S, "half order = floor(n / 2)", h["halfOrder"].s, Hex(kHalfOrder));
    Check(S, "the low-s signature verifies", Verify(pub, msg, low));
    Same(S, "highS is the (r, n - s) twin of lowS", h["highS"].s, Hex(Twin(low)));
    Check(S, "CNG's own BCryptVerifySignature accepts the high s (so the refusal has to be Exo's)", CngVerify(pub, msg, high));
    Check(S, "the spec's verifier refuses the high s", !Verify(pub, msg, high));
    Same(S, "a signer that got the high s writes the low one", h["lowS"].s, Hex(LowS(high)));
}

static void CheckPadding(const Json& root) {
    const char* S = "padding";
    for (const Json& t : root["padding"].items) {
        Same(S, std::to_string(t["dataBytes"].n) + " data bytes", std::to_string(t["paddedBytes"].n),
             std::to_string(PaddedSize((size_t)t["dataBytes"].n)));
    }
    const Json& ex = root["paddingExample"];
    Bytes back;
    Same(S, "example: pad(\"abc\"), length big-endian", ex["padded"].s, Hex(Pad(Unhex(ex["data"].s))));
    Check(S, "example: unpads to the data", Unpad(Unhex(ex["padded"].s), back) && Hex(back) == ex["data"].s);
    for (const Json& t : root["paddingRefused"].items) {
        Bytes p = Unhex(t["padded"].s);
        Check(S, "refused " + std::to_string(p.size()) + " bytes (" + t["why"].s + ")", !p.empty() && !Unpad(p, back));
    }
    Check(S, "65,382 data bytes are refused (over the top class)", PaddedSize(65382) == 0 && Pad(Bytes(65382, 'x')).empty());
    Check(S, "65,381 data bytes fill the top class and read back", Unpad(Pad(Bytes(65381, 'x')), back) && back.size() == 65381);
}

static Bytes EnvelopeAad(const Bytes& mailboxId, const Bytes& header) { return "exo-env/1" + mailboxId + header; }

static Bytes EnvelopeHeader(int kind, uint32_t epoch) { return Bytes{'\x02', (char)kind} + U32(epoch); }

static Bytes LinkKey(const Json& l) {
    Bytes pN = Unhex(l["newPcPublicKey"].s), pE = Unhex(l["existingPcPublicKey"].s);
    return Hkdf(BcryptEcdh(Unhex(l["newPcScalar"].s), pE), l["nameplate"].s, "exo link v1" + pN + pE, 32);
}

static void CheckEnvelopes(const Json& root) {
    const char* S = "envelopes";
    Bytes syncKey = Unhex(root["sync"]["syncKey"].s);
    for (const Json& e : root["envelopes"].items) {
        int kind = (int)e["kind"].n;
        std::string k = kind == 1 ? "0x01" : kind == 2 ? "0x02" : kind == 4 ? "0x04" : "0x??";
        Bytes mailbox = Unhex(e["mailboxId"].s), data = Unhex(e["data"].s), env = Unhex(e["envelope"].s);
        Bytes signer = Unhex(e["signerPublicKey"].s);
        Bytes header = EnvelopeHeader(kind, (uint32_t)e["epoch"].n), aad = EnvelopeAad(mailbox, header), body, plain, opened;
        size_t P = PaddedSize(data.size());
        Same(S, k + " AAD = \"exo-env/1\" || mailbox id (16 raw bytes) || bytes 0..5", e["aad"].s, Hex(aad));
        if (kind == 1) {
            Bytes key = Unhex(e["key"].s), nonce = Unhex(e["nonce"].s);
            std::string why;
            Same(S, k + " key is the \"" + e["app"].s + "\" sub-key", Hex(SubKey(syncKey, e["app"].s)), e["key"].s);
            body = header + nonce + Seal(key, nonce, aad, Pad(data));
            Same(S, k + " bytes before the signature", Hex(body), Hex(env.substr(0, std::min(env.size(), body.size()))));
            Check(S, k + " length 6 + 12 + P + 16 + 64 (P = " + std::to_string(P) + ")", env.size() == body.size() + 64 && body.size() == 6 + 12 + P + 16);
            Check(S, k + " signature over every byte before it is low-s and verifies", Verify(signer, body, env.substr(body.size())));
            Check(S, k + " a reader opens and unpads it to the data",
                  env.size() > 18 + 64 && Open(key, env.substr(6, 12), EnvelopeAad(mailbox, env.substr(0, 6)), env.substr(18, env.size() - 18 - 64), opened) &&
                      Unpad(opened, plain) && plain == data);
            Check(S, k + " its data is a sync batch the reader takes for \"" + e["app"].s + "\"", ReadBatch(plain, e["app"].s, why));
            Check(S, k + " refused under another mailbox id",
                  !Open(key, env.substr(6, 12), EnvelopeAad(Bytes(16, 0), env.substr(0, 6)), env.substr(18, env.size() - 18 - 64), opened));
        } else if (kind == 2) {
            // HPKE to one device, recomputed from the given ephemeral scalar, then opened as the recipient.
            Bytes skR = Unhex(e["recipientScalar"].s), pkR = Unhex(e["recipientPublicKey"].s), skE = Unhex(e["ephemeralScalar"].s);
            Bytes info = e["hpkeInfo"].s;
            Same(S, k + " HPKE info is \"exo-env/1 to-device\"", "exo-env/1 to-device", info);
            CheckPublic(S, k + " recipient", skR, e["recipientPublicKey"].s);
            hpke::Encapsulated enc = hpke::Encap(skE, pkR);
            Same(S, k + " enc (bytes 6-70) is the ephemeral key's point", Hex(env.substr(6, 65)), Hex(enc.enc));
            hpke::Context c = hpke::KeySchedule(enc.sharedSecret, info);
            body = header + enc.enc + Seal(c.key, c.baseNonce, aad, Pad(data));
            Same(S, k + " bytes before the signature", Hex(body), Hex(env.substr(0, std::min(env.size(), body.size()))));
            Check(S, k + " length 6 + 65 + P + 16 + 64", env.size() == body.size() + 64 && body.size() == 6 + 65 + P + 16);
            Check(S, k + " signature over every byte before it is low-s and verifies", Verify(signer, body, env.substr(body.size())));
            hpke::Context r = hpke::KeySchedule(hpke::Decap(env.substr(6, 65), skR), info);
            Check(S, k + " the recipient opens and unpads it to the data",
                  env.size() > 71 + 64 && Open(r.key, r.baseNonce, EnvelopeAad(mailbox, env.substr(0, 6)), env.substr(71, env.size() - 71 - 64), opened) &&
                      Unpad(opened, plain) && plain == data);
            Same(S, k + " the data is the sync key (sync-key delivery)", root["sync"]["syncKey"].s, Hex(data));
        } else if (kind == 4) {
            Bytes key = Unhex(e["key"].s), nonce = Unhex(e["nonce"].s);
            Same(S, k + " key is the link's k, recomputed from the link section", Hex(LinkKey(root["link"])), e["key"].s);
            Check(S, k + " mailbox id is 16 zero bytes", mailbox == Bytes(16, 0));
            body = header + nonce + Seal(key, nonce, aad, Pad(data));
            Same(S, k + " whole envelope (no signature)", e["envelope"].s, Hex(body));
            Check(S, k + " a reader opens and unpads it to the data",
                  env.size() > 18 && Open(key, env.substr(6, 12), EnvelopeAad(mailbox, env.substr(0, 6)), env.substr(18), opened) &&
                      Unpad(opened, plain) && plain == data);
        } else {
            Check(S, "envelope of unknown kind " + std::to_string(kind), false);
        }
    }
}

static void CheckLink(const Json& l) {
    const char* S = "link";
    Bytes dN = Unhex(l["newPcScalar"].s), dE = Unhex(l["existingPcScalar"].s);
    Bytes pN = Unhex(l["newPcPublicKey"].s), pE = Unhex(l["existingPcPublicKey"].s);
    const std::string& nameplate = l["nameplate"].s;
    CheckPublic(S, "eN", dN, l["newPcPublicKey"].s);
    CheckPublic(S, "eE", dE, l["existingPcPublicKey"].s);
    Check(S, "nameplate is 8 ASCII digits",
          nameplate.size() == 8 && std::all_of(nameplate.begin(), nameplate.end(), [](char c) { return c >= '0' && c <= '9'; }));
    Same(S, "commitment SHA-256(\"exo-link-commit\" || eE_pub)", l["commitment"].s, Hex(Sha256("exo-link-commit" + pE)));
    Same(S, "QR exo-link:1:<nameplate>:<base32 SHA-256(eN_pub)>", l["qr"].s, "exo-link:1:" + nameplate + ":" + Base32(Sha256(pN)));

    // CNG's raw secret is little-endian; reversed, it is the big-endian X the vectors hold.
    Bytes asReturned, shared = Unhex(l["shared"].s), reversed = shared;
    std::reverse(reversed.begin(), reversed.end());
    Bytes s = BcryptEcdh(dN, pE, BCRYPT_KDF_RAW_SECRET, &asReturned);
    Same(S, "BCrypt RAW_SECRET as CNG returns it is shared byte-reversed", Hex(reversed), Hex(asReturned));
    Same(S, "BCrypt RAW_SECRET reversed, eN with eE_pub", l["shared"].s, Hex(s));
    Same(S, "BCrypt RAW_SECRET reversed, eE with eN_pub", l["shared"].s, Hex(BcryptEcdh(dE, pN)));
    Same(S, "NCrypt RAW_SECRET reversed, eN with eE_pub", l["shared"].s, Hex(NcryptEcdh(dN, pE)));
    Same(S, "NCrypt RAW_SECRET reversed, eE with eN_pub", l["shared"].s, Hex(NcryptEcdh(dE, pN)));
    Same(S, "BCrypt KDF_HASH(SHA256) = SHA-256 of shared big-endian", Hex(Sha256(shared)), Hex(BcryptEcdh(dN, pE, BCRYPT_KDF_HASH)));

    Bytes info = "exo link v1" + pN + pE, salt = nameplate;
    Same(S, "k = Expand(Extract(nameplate, s), \"exo link v1\" || eN_pub || eE_pub, 32)", l["key"].s, Hex(Hkdf(s, salt, info, 32)));
    Same(S, "k again through CNG's HKDF, SALT_AND_FINALIZE", l["key"].s, Hex(CngHkdf(s, &salt, info, 32)));
    Bytes sas = Hkdf(s, salt, "exo link sas" + pN + pE, 8);
    uint64_t n = 0;
    for (unsigned char c : sas) n = n << 8 | c;
    char code[16];
    snprintf(code, sizeof code, "%06llu", (unsigned long long)(n % 1000000));
    Same(S, "match code: 8 bytes big-endian mod 1,000,000", l["matchCode"].s, sas.size() == 8 ? code : "");
}

static void CheckRecovery(const Json& r) {
    const char* S = "recovery";
    Bytes code = Unhex(r["code"].s), typed;
    const std::string& text = r["text"].s;
    Same(S, "code as five base32 groups", text, RecoveryText(code));
    std::string mangled;
    for (char c : text) {
        if (c == '-') { mangled += ' '; continue; }
        mangled += c == 'O' ? '0' : c == 'I' ? '1' : c == 'B' ? '8' : (char)(c >= 'A' && c <= 'Z' ? c + 32 : c);
    }
    Check(S, "typed back as \"" + mangled + "\" reads as the same code", ParseRecovery(mangled, typed) && typed == code);
    Check(S, "typed back as printed reads as the same code", ParseRecovery(text, typed) && typed == code);

    Bytes prk = Extract("exo recovery v1", code);
    int cb = -1, cs = -1;
    Bytes boxD = DeriveScalar(prk, "box", &cb), signD = DeriveScalar(prk, "sign", &cs), wrap = Expand(prk, "wrap", 32);
    Same(S, "box scalar (counter " + std::to_string(cb) + ")", r["boxScalar"].s, Hex(boxD));
    Same(S, "sign scalar (counter " + std::to_string(cs) + ")", r["signScalar"].s, Hex(signD));
    Same(S, "wrap key Expand(Extract(\"exo recovery v1\", code), \"wrap\", 32)", r["wrapKey"].s, Hex(wrap));
    Bytes recoverySalt = "exo recovery v1";
    Same(S, "  again through CNG's HKDF, SALT_AND_FINALIZE", r["wrapKey"].s, Hex(CngHkdf(code, &recoverySalt, "wrap", 32)));
    CheckPublic(S, "box", boxD, r["boxPublicKey"].s);
    CheckPublic(S, "sign", signD, r["signPublicKey"].s);
    Same(S, "box id", r["boxId"].s, BoxId(Unhex(r["boxPublicKey"].s)));
    Bytes msg = "exo-change/1 check";
    Check(S, "the d-only sign key signs (NCrypt, made low-s) and verifies", Verify(Unhex(r["signPublicKey"].s), msg, LowS(NcryptSignRaw(signD, msg))));

    // The kit: {v:1, exoId, epoch, syncKey (base64url)} canonical, padded, sealed 01 || nonce || AES-256-GCM.
    const Json& want = r["kit"];
    Bytes sealed = Unhex(r["sealedKit"].s), nonce = Unhex(r["nonce"].s), aad = "exo-recovery/1" + Unhex(r["boxId"].s), padded, kitText;
    std::string plaintext = "{\"epoch\":" + std::to_string(want["epoch"].n) + ",\"exoId\":\"" + want["exoId"].s + "\",\"syncKey\":\"" +
                            Base64Url(Unhex(want["syncKey"].s)) + "\",\"v\":1}";
    Same(S, "kit plaintext: canonical, syncKey in base64url", r["plaintext"].s, plaintext);
    Same(S, "kit AAD = \"exo-recovery/1\" || box id (16 raw bytes)", r["aad"].s, Hex(aad));
    Same(S, "sealed kit = 01 || nonce || AES-256-GCM(wrap, pad(kit))", r["sealedKit"].s, Hex(Bytes(1, '\x01') + nonce + Seal(wrap, nonce, aad, Pad(plaintext))));
    bool opened = sealed.size() > 13 && sealed[0] == 1 && Open(wrap, sealed.substr(1, 12), aad, sealed.substr(13), padded) && Unpad(padded, kitText);
    Check(S, "a reader opens and unpads the sealed kit to that plaintext", opened && kitText == r["plaintext"].s);
    Json kit;
    Bytes keyFromKit;
    Check(S, "the kit reads back: canonical, v 1, exoId, epoch, syncKey",
          ParseJson(kitText, kit) && Canonical(kit) == kitText && kit.fields.size() == 4 && kit["v"].n == 1 && kit["exoId"].s == want["exoId"].s &&
              kit["epoch"].n == want["epoch"].n && FromBase64Url(kit["syncKey"].s, keyFromKit) && Hex(keyFromKit) == want["syncKey"].s);
}

static void CheckDeviceList(const Json& root) {
    const char* S = "deviceList";
    const Json& list = root["deviceList"];
    Chain chain;
    chain.exoId = list["exoId"].s;
    for (size_t i = 0; i < list["changes"].items.size(); i++) {
        const Json& c = list["changes"][i];
        std::string n = "change " + std::to_string(i) + " (" + c["op"].s + ")";
        Same(S, n + " canonical form as it travels", list["canonical"][i].s, Canonical(c));
        Same(S, n + " hashed form = canonical without its own sig", list["hashed"][i].s, Canonical(Without(c, "sig")));
        Same(S, n + " hash = SHA-256 of the hashed form", list["hashes"][i].s, ChangeHash(c));
        Same(S, n + " prev = the previous change's hash", chain.head, c["prev"].s);
        Apply(chain, c, S, n);
    }
    Bytes firstSigPub, recoverySigPub;
    FromBase64Url(list["changes"][0]["device"]["sigPub"].s, firstSigPub);
    for (auto& [id, m] : chain.devices)
        if (m.recovery) recoverySigPub = m.sigPub;
    Same(S, "Exo ID = base32 of the first 16 bytes of SHA-256(first device's sigPub)", list["exoId"].s, Base32(Sha256(firstSigPub).substr(0, 16)));
    Same(S, "the recovery kit carries the same Exo ID", list["exoId"].s, root["recovery"]["kit"]["exoId"].s);
    Same(S, "the recovery entry's sigPub is the recovery code's sign key", root["recovery"]["signPublicKey"].s, Hex(recoverySigPub));
    Same(S, "devices at the end of the chain", Ids(list["devicesAtEnd"]), Ids(chain));

    // The hash no longer moves with the signature, and the signature's high-s twin is refused.
    const Json& first = list["changes"][0];
    Bytes sig;
    FromBase64Url(first["sig"].s, sig);
    Json twinned = With(first, "sig", Text(Base64Url(Twin(sig))));
    Check(S, "change 0's hash is the same with its sig swapped for the twin", ChangeHash(twinned) == ChangeHash(first));
    Chain fresh;
    fresh.exoId = chain.exoId;
    Check(S, "change 0 carrying the high-s twin is refused", !Apply(fresh, twinned));
}

static void CheckForks(const Json& root) {
    const char* S = "forks";
    const Json& f = root["forks"];
    Chain base;
    base.exoId = root["deviceList"]["exoId"].s;
    bool baseOk = !f["base"].items.empty();
    for (const Json& c : f["base"].items) baseOk = Apply(base, c) && baseOk;
    Check(S, "the base chain applies (" + std::to_string(f["base"].items.size()) + " changes)", baseOk);
    for (size_t k = 0; k < f["cases"].items.size(); k++) {
        const Json& cs = f["cases"][k];
        const Json &a = cs["changes"][0], &b = cs["changes"][1];
        std::string n = "case " + std::to_string(k + 1);
        Same(S, n + " change 0 hash", cs["hashes"][0].s, ChangeHash(a));
        Same(S, n + " change 1 hash", cs["hashes"][1].s, ChangeHash(b));
        Chain ca = base, cb = base;
        Check(S, n + " both changes apply on the base alone (a real fork: same seq, same prev)",
              Apply(ca, a) && Apply(cb, b) && a["seq"].n == b["seq"].n && a["prev"].s == b["prev"].s);
        int w = ForkWinner(base, a, b);
        Same(S, n + " winner: " + cs["rule"].s, std::to_string(cs["winner"].n), std::to_string(w));
        int hashOnly = ChangeHash(a) < ChangeHash(b) ? 0 : 1;
        if (k < 2) Check(S, n + " a hash-only rule would keep the other change", hashOnly != cs["winner"].n);
        const Json &winner = w ? b : a, &loser = w ? a : b;
        Chain after = base;
        Apply(after, winner);
        bool still = StillApplies(after, loser);
        if (cs["reapplied"].kind == Json::Missing) {
            Check(S, n + " the loser is dropped: it no longer applies", !still);
        } else {
            const Json& r = cs["reapplied"];
            Check(S, n + " the loser still applies, so its author signs it again", still);
            Check(S, n + " re-applied = the loser's content by its author, seq " + std::to_string(winner["seq"].n + 1) + ", prev = the winner's hash",
                  r["seq"].n == winner["seq"].n + 1 && r["prev"].s == ChangeHash(winner) && r["by"].s == loser["by"].s && Content(r) == Content(loser));
            Check(S, n + " the re-applied change applies on top of the winner", Apply(after, r));
        }
        Same(S, n + " devices after", Ids(cs["devicesAfter"]), Ids(after));
    }
}

static void CheckSignatures(const Json& list) {
    const char* S = "signatures";
    for (size_t i = 0; i < list.items.size(); i++) {
        const Json& t = list[i];
        Bytes pub = Unhex(t["publicKey"].s), msg = Unhex(t["message"].s), sig = Unhex(t["signature"].s);
        std::string what = msg.rfind("exo-box-auth/1", 0) == 0   ? "mailbox login"
                           : msg.rfind("exo-device/1", 0) == 0   ? "device record"
                           : msg.rfind("exo-change/1", 0) == 0   ? "device-list change"
                           : msg.rfind("\x02\x01", 0) == 0       ? "0x01 envelope"
                           : msg.rfind("\x02\x02", 0) == 0       ? "0x02 envelope"
                                                                 : "unknown";
        Check(S, "signature " + std::to_string(i) + " (" + what + "): 64-byte P1363, low-s, verifies", sig.size() == 64 && Verify(pub, msg, sig));
    }
    // The verifier has to be able to say no.
    if (list.items.size() < 2) return;
    Bytes pub = Unhex(list[0]["publicKey"].s), msg = Unhex(list[0]["message"].s), sig = Unhex(list[0]["signature"].s);
    Bytes badMsg = msg, badSig = sig;
    if (!badMsg.empty()) badMsg.back() ^= 1;
    if (!badSig.empty()) badSig[10] ^= 1;
    Check(S, "refused: signature 0 over a changed message", !Verify(pub, badMsg, sig));
    Check(S, "refused: signature 0 with one bit changed", !Verify(pub, msg, badSig));
    Check(S, "refused: signature 0 under another public key", !Verify(Unhex(list[1]["publicKey"].s), msg, sig));
    Check(S, "refused: signature 0's (r, n - s) twin", !Verify(pub, msg, Twin(sig)));
}

static std::string ReadAll(const std::wstring& file) {
    HANDLE h = CreateFileW(file.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
    if (h == INVALID_HANDLE_VALUE) return "";
    LARGE_INTEGER size{};
    std::string s;
    if (GetFileSizeEx(h, &size) && size.QuadPart > 0 && size.QuadPart < (16ll << 20)) {
        s.resize((size_t)size.QuadPart);
        DWORD got = 0;
        if (!ReadFile(h, s.data(), (DWORD)s.size(), &got, nullptr)) got = 0;
        s.resize(got);
    }
    CloseHandle(h);
    return s;
}

static int Summary() {
    int pass = 0, fail = 0;
    printf("\n");
    for (auto& t : g_tally) {
        printf("%-14s %3d pass  %3d fail\n", t.section.c_str(), t.pass, t.fail);
        pass += t.pass;
        fail += t.fail;
    }
    printf("%-14s %3d pass  %3d fail\n", "TOTAL", pass, fail);
    return fail ? 1 : 0;
}

int wmain(int argc, wchar_t** argv) {
    std::wstring path = argc > 1 ? argv[1] : L"exo-identity-vectors.json";
    std::string text = ReadAll(path);
    Json v;
    if (!Check("file", "vectors file reads and parses with the strict reader", !text.empty() && ParseJson(text, v))) return Summary();
    // The spec's hash is over the file with LF line endings; git may have checked it out with CRLF.
    std::string lf;
    for (size_t i = 0; i < text.size(); i++)
        if (!(text[i] == '\r' && i + 1 < text.size() && text[i + 1] == '\n')) lf += text[i];
    Same("file", "SHA-256 (LF line endings) matches the plan's 2.11", "7a993bb873ac5836f00b48f6fba4f219a836de8d3eaa8152bd6d946f796dbed0", Hex(Sha256(lf)));
    Same("file", "version", "exo-identity-vectors/2", v["version"].s);
    Check("file", "Software KSP opens", NCryptOpenStorageProvider(&g_ksp, MS_KEY_STORAGE_PROVIDER, 0) == ERROR_SUCCESS);

    CheckRfc9180();
    CheckBase32(v);
    CheckBase64Url(v);
    CheckCanonicalJson(v["canonicalJson"]);
    CheckDeviceNames(v["deviceNames"]);
    CheckDeriveScalar(v["deriveScalar"]);
    CheckSync(v["sync"]);
    CheckSyncBatch(v);
    CheckMailboxAuth(v);
    CheckHighS(v["highS"]);
    CheckPadding(v);
    CheckEnvelopes(v);
    CheckLink(v["link"]);
    CheckRecovery(v["recovery"]);
    CheckDeviceList(v);
    CheckForks(v);
    CheckSignatures(v["signatures"]);

    // A scalar blob whose X/Y is some other key's point must be refused while CNG validates keys, so a
    // d-only import really is CNG computing the point, not CNG trusting whatever X/Y it was given.
    Bytes x, y, d = Unhex(v["link"]["newPcScalar"].s);
    SplitPoint(Unhex(v["link"]["existingPcPublicKey"].s), x, y);
    BCRYPT_KEY_HANDLE wrong = BcryptScalar(false, d, 0, x, y);
    Check("cng", "BCrypt refuses a private blob whose X/Y belongs to another key", wrong == nullptr);
    if (wrong) BCryptDestroyKey(wrong);

    if (g_ksp) NCryptFreeObject(g_ksp);
    return Summary();
}
