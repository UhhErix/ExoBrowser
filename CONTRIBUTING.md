# Contributing to Exo Browser

Exo Browser is source-available, not open source ([LICENSE](LICENSE)). Contributions are welcome all the same: a bug fix, a site that renders or blocks wrongly, an import from another browser or password manager that goes wrong, or a clearer sentence in the help. This page says what you agree to and what a change needs.

## What you agree to

By sending a pull request, patch or any other contribution you confirm that:

1. you wrote it, or have the right to submit it;
2. it doesn't include code from a project whose license forbids that, and it adds no dependency without saying so;
3. you grant the copyright holder a perpetual, worldwide, royalty-free and irrevocable license to use, change and distribute it as part of Exo Browser under any terms, which is the clause in [LICENSE](LICENSE). You keep your own copyright.

Add a `Signed-off-by: Your Name <email>` line to each commit (`git commit -s`) to say you agree.

**Exo Shield is different.** It is a separate program under GPL-3.0, made from uBlock Origin Lite, HaGeZi's DNS blocklists and TTV LOL PRO. A change to Exo Shield (`extensions/exo-shield`, or `tools/build-shield.mjs`) is under GPL-3.0, and its source lives in [its own repository](https://github.com/UhhErix/exo-shield). Problems with a filter list itself belong upstream with uBlock Origin Lite or HaGeZi.

Code in `vendor/` (uBlock Origin Lite, TTV LOL PRO and Argon2) is kept unmodified. Don't change it in place.

## Before you start

- **A small fix:** open the pull request.
- **A new feature, or anything that changes what Exo Browser sends over the network:** open an [issue](https://github.com/UhhErix/ExoBrowser/issues) first, so you don't build something that can't ship.
- **Anything touching Exo Vault, its file format or its keys:** open an issue first, and read [SECURITY.md](SECURITY.md).
- Read [docs/DEVELOPING.md](docs/DEVELOPING.md) for how the source fits together and how to build it.
- The parts of `ui/src/` outside `browser/` and `setup/` are Exo Launcher's design, copied in by `ui/scripts/sync-exo.mjs`. Change those in Exo Launcher, not here.

## What a change needs

- It builds with `build.cmd` and passes `npm --prefix ui run check`.
- A change to the interface's layout passes `node tools/layout-check.mjs --port <port>` ([docs/DEVELOPING.md](docs/DEVELOPING.md) says how to open the port).
- The smallest complete change: reuse before adding, and delete what the change replaces.
- A change a user will notice gets a [CHANGELOG](CHANGELOG.md) line in plain words, ending with how it was checked (for example, _Verified: on screen._ or _Checked in code only._).

## The lines that do not move

A change that crosses one of these will be closed.

- **No ads, analytics, telemetry or Exo account.** Every place Exo Browser connects to is listed in [PRIVACY.md](PRIVACY.md); a change that adds one updates that list.
- **Exo Shield stays locked on.** No setting, page or extension may turn it off or remove it.
- **The interface has no web.** The Bar, new tab page, Settings and Exo Vault stay in their own profile with no extensions and no access to the web.
- **Vault secrets stay on this PC.** Nothing in Exo Vault leaves the PC except in an export the user makes, and an export is always encrypted.
- **Nothing runs as administrator or as a service,** and nothing installs without the user's say-so.

## Security problems

Don't open a public issue. [Report it privately](https://github.com/UhhErix/ExoBrowser/security/advisories/new), as [SECURITY.md](SECURITY.md) says. Don't put passwords, vault exports, sign-ins or personal paths in a public issue or pull request.
