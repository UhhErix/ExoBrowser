# Contributing to Exo Browser

Exo Browser is free for personal use, and its source isn't published ([LICENSE](LICENSE)), so there are no pull requests or patches to send. Issues are welcome all the same: a bug, a site that renders or blocks wrongly, an import from another browser or password manager that goes wrong, an idea, or a clearer sentence or a translation for the help. This page says how, and what you agree to when you send one.

## Sending an issue

- **A bug or a site that breaks:** [open an issue](https://github.com/UhhErix/ExoBrowser/issues/new/choose) with the version (Settings > About), what you did and what happened. **Copy logs**, beside an update that failed, copies a short report to paste in.
- **An idea:** open an issue and say what you'd do with it.
- **The help:** an issue with the sentence as it is and as you'd have it, or with a translation.

Don't put passwords, vault exports, sign-ins or personal paths in an issue.

## What you agree to

By sending an issue, a suggestion, a translation or any other contribution you confirm that:

1. you wrote it, or have the right to send it;
2. you grant the copyright holder a perpetual, worldwide, royalty-free and irrevocable license to use, change and distribute it as part of Exo Browser under any terms, which is the clause in [LICENSE](LICENSE). You keep your own copyright.

**Exo Shield is different.** It is a separate program under GPL-3.0, made from uBlock Origin Lite, HaGeZi's DNS blocklists and TTV LOL PRO, and its source is public in [its own repository](https://github.com/UhhErix/exo-shield). Code for Exo Shield goes there, under GPL-3.0. Problems with a filter list itself belong upstream with uBlock Origin Lite or HaGeZi.

## The lines that do not move

An idea that crosses one of these won't ship.

- **No ads, analytics, telemetry or Exo account.** Every place Exo Browser connects to is listed in [PRIVACY.md](PRIVACY.md).
- **Exo Shield stays locked on.** No setting, page or extension may turn it off or remove it.
- **The interface has no web.** The Bar, new tab page, Settings and Exo Vault stay in their own profile with no extensions and no access to the web.
- **Vault secrets stay on this PC.** Nothing in Exo Vault leaves the PC except in an export the user makes, and an export is always encrypted.
- **Nothing runs as administrator or as a service,** and nothing installs without the user's say-so.

## Security problems

Don't open a public issue. [Report it privately](https://github.com/UhhErix/ExoBrowser/security/advisories/new), as [SECURITY.md](SECURITY.md) says.
