# Getting started and help

## Install and update

1. Download **ExoBrowser-Setup.exe** from the [latest release](https://github.com/UhhErix/ExoBrowser/releases/latest).
2. Run it, choose Install, then Launch Exo Browser. **Options** under Install has the desktop shortcut switch.
3. First run walks you through Exo Vault, bringing your things from your other browsers, your look and your default browser. Every step can be skipped and found later in Settings.

Exo Browser looks for a new version when it starts and twice a day, and tells you when one is ready. **Settings > About** shows your version with **Check for updates**; when a new one is out, **Install update** downloads it, checks it, then closes Exo Browser, installs it and opens it again with your tabs, history, sign-ins and vault as they were. New versions are also on the [releases page](https://github.com/UhhErix/ExoBrowser/releases): running a newer Setup does the same.

Exo Browser needs **Windows 11 x64** and installs for your Windows user only, in `%LOCALAPPDATA%\ExoBrowser\app`. The installer isn't code-signed yet, so SmartScreen may warn the first time: choose **More info**, then **Run anyway**. Each release lists the installer's SHA-256.

To uninstall, open **Windows Settings > Apps > Installed apps**, choose **Exo Browser**, then **Uninstall**. Your data stays for a reinstall unless you switch on **Also remove my data and Exo Vault**.

## Make it your default browser

**Settings > General > Default browser > Make default** opens Windows' Default apps page at Exo Browser: choose **Set default** there. Windows only lets you make that choice yourself. Links from your other apps then open in Exo Browser, in a new tab of the window you have open.

## The Bar

- **Search or go:** click the address, or press **Ctrl+L** or **F6**, and type. An address opens; anything else is searched with your search engine (**Settings > General > Search engine**). Suggestions come from your open tabs, bookmarks and history.
- **Search one site:** type its keyword and a space ("yt cats" searches YouTube, "wp" Wikipedia, "gh" GitHub), "@" and its name, or its address and **Tab**. It shows as a chip in the field, with that site's pages from your history under it; **Backspace** in the empty field takes it off. **Settings > Search** keeps the list and adds your own with a %s address.
- **Everything at once:** **Ctrl+K** finds a tab, bookmark, page from your history or action.
- **Actions on a result:** right-click it, or press **Tab** (after anything but a site's keyword), **→** at the end of the line or the menu key: open it in a new tab, beside this tab, in Peek or in a private tab, copy its link without trackers, switch to, mute or close an open tab, or remove a page from your history or the archive. Under what you type, the first three sites in **Settings > Search** offer to search it.
- **Tabs:** across the top or down the side (**Settings > Look > Tabs**). Drag a tab to move it; right-click it to pin, mute, duplicate, copy its link or close others. **Ctrl+T** opens a new tab, **Ctrl+Shift+T** reopens the last one you closed, **Ctrl+W** closes one, and **Ctrl+1** to **9** go to the first nine.
- **Ctrl+Tab** goes back through the tabs in the order you used them, as Alt+Tab does with windows: a quick press returns to the tab before, and held, it lists the space's tabs. **Settings > General > Ctrl+Tab in recent order** makes it follow the strip instead.
- **Clean links:** every page opens without the tracking parts that share buttons and ads add to its address (`utm_` tags, click ids), whether you click it, paste it or it comes from another app, and **Ctrl+Shift+C** or a link's **Copy link** copies it the same way.
- **Hide the toolbar** gives the page the whole window; the Bar slides in when the pointer touches the top edge (side tabs at the left edge).
- **More keys:** **Ctrl+D** bookmarks the page, **Ctrl+F** finds on it, **Ctrl+H** opens History, **Ctrl+J** Downloads, **Ctrl+Shift+E** your extensions, **F11** full screen, **Alt+Left** and **Alt+Right** back and forward.

## Spaces, favorites and folders

- **Spaces:** keep work, school and play apart. **Settings > Spaces** adds one and gives it an icon, a color (the accent while it's on screen) and its own appearance. **Alt+1** to **9** switch them; drag a tab onto one to move it there. A site's links from your other apps can open in the space you pick for it: right-click its tab in that space and choose, for example, **Open github.com links in Work**, or add it under **Settings > Spaces > Links from other apps**.
- **Favorites** show in every space; right-click a tab and choose **Add to Favorites**. A **pinned tab** remembers its page: its icon takes it back when it wanders, and closing it only puts it to sleep.
- **Folders:** with tabs down the side, pinned tabs can sit in folders, folders inside folders too. Drop a tab on a folder, or right-click it and choose one; a folder's row opens and closes it, and right-click renames it.
- **Live folders:** right-click a site's tab and choose **Follow this site in a live folder**. Its newest posts show in the folder, checked every 30 minutes, and open in a new tab. Delete the folder to stop following.
- **Archive tabs** (**Settings > General**, off by default) closes tabs you haven't opened in a while, from an hour to 30 days, into an archive. Each space keeps its five newest tabs, and a tab you right-click and choose **Keep this tab** is never archived or put to sleep. **Settings > Archive** lists what was archived to open again or remove; Search finds it too, and **Ctrl+Shift+T** brings back the last one. Each comes back in the space it left.
- **From Arc:** **Settings > Import** brings Arc's spaces, colors, favorites, pinned tabs with their folders and Today tabs from its files, even after Arc stops opening.

## Split view, Peek and private tabs

- **Split view:** up to four tabs side by side, from a tab's menu, **Ctrl+K** or **Ctrl+Shift+=**.
- **Peek:** right-click a link and choose **Open link in Peek**, or **Shift+click** it, to read it in a card over the page. **Ctrl+O** keeps it as a tab; **Esc** or a click around it closes it.
- **Private tabs:** **Ctrl+Shift+N** opens a tab whose cookies and sign-ins stay apart from your other tabs and go when the last private tab closes. Nothing it visits reaches your history or saved tabs, and Exo Shield runs in it too.
- **Little Exo:** with **Settings > General > Links from other apps > In Little Exo**, a link from another app opens in a small window of its own; **Ctrl+O** (or **Open in Exo Browser**) moves it into your tabs.
- **Picture in picture:** a video playing with sound floats over everything when you leave its tab, and goes back when you return (**Settings > General**).

## The new tab page

Your bookmarks as glass cards (drag one to rearrange them) and, under them, the sites you visit most; a card's × forgets a most-visited site. **Settings > New tab** shows bookmarks as cards, a bar, icons only or not at all, and turns Most visited off.

## Exo Shield

Exo Shield is always on, at its strongest, on every site, and has no settings. If a site misbehaves, reload it; if it still does, [report it](https://github.com/UhhErix/ExoBrowser/issues/new/choose) with the site's address. **Settings > About** lists Exo Shield's parts and when its lists were built.

Twitch: a stream can take a second longer to start, since its playlist comes through another country. The video itself comes straight from Twitch.

## Exo Vault

- **Open it:** **Settings > Privacy > Passwords > Exo Vault**. Make a master password the first time: at least 10 characters, and nobody can reset it, Exo included.
- **Windows Hello:** **Vault settings > Unlock with Windows Hello** opens the vault with your face, fingerprint or PIN.
- **Signing in:** click a sign-in field and pick a login from the menu. After you sign in somewhere new, Exo Vault offers to save the login, or to update a saved password you changed.
- **New passwords:** on a sign-up form the menu offers a strong password; **Vault settings** sets its length and symbols.
- **2FA codes:** add a site's setup key (or its otpauth link) to a login, and Exo Vault shows its current code.
- **Bring your passwords in:** **Import and export** brings them from the browsers on this PC (close that browser first), or from a file: an export from Proton Pass, Bitwarden, 1Password, LastPass, Dashlane, KeePass, Safari or any browser (CSV or JSON), or an Exo Vault export. Proton Pass: in Proton Pass, **Settings > Export**, choose CSV, then import that file.
- **Moving to another PC:** **Import and export > Encrypted export** saves everything as one file locked with a password you choose; import it in Exo Vault on the other PC.
- **Locking:** after the time you set in **Vault settings**, when Windows locks and when the PC sleeps, or with **Lock**.
- **Off your stream:** while the vault shows what's in it (its window, the menu beside a sign-in field, the offer to save a login), Exo Browser is left out of screen shares, recordings and screenshots, and shows as always on your screen. Locked, it shows nothing of yours, so it stays in them.

## Bringing your things from another browser

**Settings > Import** lists the browsers on this PC. **Import** brings bookmarks, history, sign-ins (so you stay signed in), site icons, the search engine and Chrome Web Store extensions; Arc brings its spaces, favorites and folders too; Firefox, Zen, Floorp, LibreWolf and Waterfox bring bookmarks, history and sign-ins. Close that browser first so its sign-ins can be read. Nothing is removed from it. Passwords go into Exo Vault from its own **Import and export**.

Bookmarks from any browser: export them as an HTML file there, then **Settings > Bookmarks > Import file**.

Password managers' extensions (Proton Pass, Bitwarden, 1Password and others) aren't brought over: Exo Vault keeps your passwords, and two managers would both answer every sign-in field. Bring your passwords into Exo Vault instead. One you add from the Chrome Web Store yourself stays.

## Extensions

Open the [Chrome Web Store](https://chromewebstore.google.com) from **Settings > Extensions** and choose **Add to Exo** on an extension's page, or paste its link or id into **Add an extension**. **Load unpacked** adds an extension from a folder. Each extension there can be turned off or removed.

## Look and feel

- **Settings > Look:** **Appearance** (Match Windows, Light, Dark or Void, pure black for OLED screens), **Material** (Liquid Glass, See-through or solid), tabs across the top or down the side, the accent color, a compact Bar, tab size, text size and reduced motion.
- **Settings > Mods:** eight themes that set the look in one click, small tweaks (tab numbers, calm icons, no new tab button, square corners, the accent on the Bar) and your own CSS for Exo Browser itself. Your CSS never reaches Settings, so you can always undo it there.
- **Boosts:** right-click a tab and choose **Zap things on this page** to click away things on a site's pages for good, or **Boost this site** to give it a style of your own. **Settings > Boosts** lists them, each with a switch.

## Privacy

Exo Browser has no account and sends nothing to Exo. **Settings > Privacy > Cookies, site data and cache > Clear** signs you out of every site. The [privacy policy](../PRIVACY.md) lists everything that leaves your PC.

## Something wrong?

[Report a problem or suggest a feature](https://github.com/UhhErix/ExoBrowser/issues/new/choose). Issues are public: leave out passwords, addresses you'd rather keep private and personal details.
