// Exo Vault's file and keys: a local password vault, encrypted on this PC and nowhere else.
//
// A vault is one file. Its contents (the items, as JSON the vault window reads and writes) are sealed with
// AES-256-GCM under a random 256-bit vault key. That key is stored only wrapped: under a key derived from
// your master password with Argon2id (256 MiB, 4 passes, 4 lanes), and, when you turn it on, under a key
// only Windows Hello can produce (a signature from a key in this PC's TPM). An export is the same format
// with its own fresh vault key under the password you export it with, so it opens on any PC.
#pragma once
#include <functional>
#include <string>

namespace vault {

enum Result { Ok = 0, WrongPassword, NoFile, Corrupt, WriteFailed, NoHello, HelloCancelled, HelloFailed };

// The slow parts (Argon2id) run off the UI thread: these return what to adopt and change nothing.
struct Opened {
    Result result = Corrupt;
    std::string key;   // the vault key (32 bytes), to Adopt()
    std::string json;  // the items
};
Opened Create(const std::wstring& file, const std::string& password, const std::string& json);
Opened Unlock(const std::wstring& file, const std::string& password);
Opened UnlockWithHelloKey(const std::wstring& file, const std::string& helloKey);
// With the vault key itself (the one Exo Browser's keeper held across a close): no Argon2id, so at once.
Opened UnlockWithKey(const std::wstring& file, const std::string& key);
// Reads any vault or export with its password (an import), leaving this vault as it is.
Opened Open(const std::wstring& file, const std::string& password);
Result Export(const std::wstring& file, const std::string& password, const std::string& json);

// On the UI thread, with the vault unlocked.
void Adopt(const std::string& key);
bool Unlocked();
std::string Key();  // a copy, for ChangePassword off the UI thread
void Lock();
Result Save(const std::wstring& file, const std::string& json);
Result SetHelloKey(const std::wstring& file, const std::string& helloKey);  // "" removes it
// Slow (Argon2id): off the UI thread, with a copy of the vault key.
Result ChangePassword(const std::wstring& file, const std::string& key, const std::string& password);
bool HasHello(const std::wstring& file);
bool Exists(const std::wstring& file);

// Windows Hello: a key that exists only after you confirm it's you. `create` makes (or replaces) the
// Hello key first. Calls back on the calling thread with Ok and the key, or the reason it didn't.
void HelloKey(bool create, std::function<void(Result, std::string)> done);
void HelloAvailable(std::function<void(bool)> done);

// Wipes a string's bytes before it goes.
void Wipe(std::string& s);

}  // namespace vault
