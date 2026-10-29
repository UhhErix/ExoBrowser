// Builds extensions/exo-shield: Exo Browser's one blocker. It is uBlock Origin Lite (GPL-3.0,
// vendor/ublock-origin-lite) with HaGeZi's Multi PRO DNS list (GPL-3.0) as one more ruleset,
// cookie notices, overlays and tracking parameters blocked by default, TTV LOL PRO (GPL-3.0,
// vendor/ttv-lol-pro) for Twitch's stream ads, and Exo's icon. Built in and locked: always at its
// strongest, with no settings, popup or off switch.
// node tools/build-shield.mjs [path-to-pro-onlydomains.txt]
import { readFileSync, writeFileSync, rmSync, cpSync, copyFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const vendor = new URL("vendor/ublock-origin-lite/", root);
const out = new URL("extensions/exo-shield/", root);
const SOURCE = "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/pro-onlydomains.txt";

const text = process.argv[2] ? readFileSync(process.argv[2], "utf8") : await (await fetch(SOURCE)).text();
const domains = [...new Set(text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")))];
if (domains.length < 50000) throw new Error(`only ${domains.length} domains: refusing to ship a short list`);

rmSync(out, { recursive: true, force: true });
cpSync(vendor, out, { recursive: true });
rmSync(new URL("_metadata/", out), { recursive: true, force: true });

// HaGeZi's list: never what you open yourself, only what a page loads.
const types = ["sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "media", "websocket", "webtransport", "webbundle", "other"];
const rules = [];
for (let i = 0; i < domains.length; i += 4000)
  rules.push({ id: rules.length + 1, priority: 1, action: { type: "block" }, condition: { requestDomains: domains.slice(i, i + 4000), resourceTypes: types } });
// TTV LOL PRO's two rules (Twitch's ad scripts and beacons) ride along in this always-on ruleset.
const ttvSource = new URL("vendor/ttv-lol-pro/", root);
const ttvManifest = JSON.parse(readFileSync(new URL("manifest.json", ttvSource), "utf8"));
for (const r of JSON.parse(readFileSync(new URL(ttvManifest.declarative_net_request.rule_resources[0].path, ttvSource), "utf8")))
  rules.push({ ...r, id: rules.length + 1 });
writeFileSync(new URL("hagezi-pro.json", out), JSON.stringify(rules));

// Everything that blocks without breaking: tracking parameters stripped from links, and every
// annoyance list (cookie notices, overlays, social and chat widgets, notification prompts, AI widgets).
const ON = new Set(["adguard-spyware-url", "annoyances-cookies", "annoyances-overlays", "annoyances-social", "annoyances-widgets",
  "annoyances-others", "annoyances-notifications", "annoyances-ai"]);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", out), "utf8"));
manifest.name = "Exo Shield";
manifest.short_name = "Exo Shield";
manifest.description = "Exo Browser's blocker: uBlock Origin Lite's filters with HaGeZi's Multi PRO list.";
manifest.author = "Exo Browser, from uBlock Origin Lite by Raymond Hill";
const resources = manifest.declarative_net_request.rule_resources;
for (const r of resources) if (ON.has(r.id)) r.enabled = true;
resources.splice(4, 0, { id: "hagezi-pro", enabled: true, path: "hagezi-pro.json" });
// Built in and always at its strongest, with nothing to set: no popup, no settings page, no picker or
// zapper shortcuts (the browser also refuses to open its pages, turn it off or remove it).
delete manifest.action.default_popup;
delete manifest.options_page;
delete manifest.options_ui;
// The commands stay declared (uBlock's worker listens for them at start and fails to load without them),
// with no keys bound.
for (const command of Object.values(manifest.commands ?? {})) delete command.suggested_key;
// Twitch stitches its ads into the stream itself, past any filter list. TTV LOL PRO asks Twitch for
// the stream's playlist (only that, never the video) through a server in a country Twitch shows no
// ads in, so streams play ad-free at full quality. Merged in unchanged except for two defaults: no
// ad reports sent to its developers, and no first-run page. One service worker runs both.
const ttvOut = new URL("ttv/", out);
cpSync(ttvSource, ttvOut, { recursive: true });
rmSync(new URL("manifest.json", ttvOut));
for (const file of readdirSync(ttvOut).filter((f) => f.endsWith(".js"))) {
  const at = new URL(file, ttvOut);
  writeFileSync(at, readFileSync(at, "utf8").replaceAll("adLogEnabled:!0", "adLogEnabled:!1").replaceAll("completedSetupVersion:0", "completedSetupVersion:1"));
}
const ttvWorker = readFileSync(new URL(ttvManifest.background.service_worker, ttvOut), "utf8");
if (!ttvWorker.includes("adLogEnabled:!1") || !ttvWorker.includes("completedSetupVersion:1")) throw new Error("TTV LOL PRO changed: its defaults were not found");
manifest.content_scripts = [...(manifest.content_scripts ?? []), ...ttvManifest.content_scripts.map((c) => ({ ...c, js: c.js.map((f) => `ttv/${f}`) }))];
manifest.web_accessible_resources.push(...ttvManifest.web_accessible_resources.filter((w) => w.matches.length)
  .map((w) => ({ ...w, resources: w.resources.map((f) => `ttv/${f}`) })));
manifest.permissions = [...new Set([...manifest.permissions, ...ttvManifest.permissions])];
manifest.host_permissions = [...new Set([...manifest.host_permissions, ...ttvManifest.host_permissions])];
manifest.background = { service_worker: "exo-background.js", type: "module" };
// The count beside the address in Exo Browser's Bar: what Exo Shield blocked on each tab's page. The worker hears
// each rule that matched (an unpacked extension with declarativeNetRequestFeedback) and counts those that block: a
// request stopped, or a script swapped for its harmless stand-in. Exceptions and header changes block nothing and don't
// count (Chromium's own badge counted them, and the page before's last
// beacons), nor do tracking parameters taken off a link (the request still goes). exo-count.js hands each new count
// to that page's browser (chrome.webview): only the number goes.
manifest.permissions = [...new Set([...manifest.permissions, "declarativeNetRequestFeedback"])];
const blocks = (x) => x.action.type === "block" || (x.action.type === "redirect" && !x.action.redirect?.transform);
const notCounted = {};
for (const r of manifest.declarative_net_request.rule_resources) {
  const ids = JSON.parse(readFileSync(new URL(r.path, out), "utf8")).filter((x) => !blocks(x)).map((x) => x.id);
  if (ids.length) notCounted[r.id] = ids;
}
writeFileSync(new URL("exo-count-skip.json", out), JSON.stringify(notCounted));
writeFileSync(new URL("exo-count.js", out), `// Exo Shield's count for Exo Browser's Bar (tools/build-shield.mjs): what it blocked on the page in each tab.
const dnr = chrome.declarativeNetRequest;
const skip = new Set(), counts = new Map(), sent = new Map(), due = new Map();
const ready = fetch("/exo-count-skip.json").then((r) => r.json()).then((lists) => {
  for (const [ruleset, ids] of Object.entries(lists)) for (const id of ids) skip.add(ruleset + "#" + id);
}).catch(() => {});
// uBlock Origin Lite's own rules (dynamic, and per session) change as it runs: read again at most once a minute.
let ownRead = 0;
async function readOwn() {
  if (Date.now() - ownRead < 60000) return;
  ownRead = Date.now();
  try {
    for (const [ruleset, rules] of [["_dynamic", await dnr.getDynamicRules()], ["_session", await dnr.getSessionRules()]])
      for (const r of rules) if (r.action.type !== "block" && (r.action.type !== "redirect" || r.action.redirect?.transform)) skip.add(ruleset + "#" + r.id);
  } catch {}
}
function report(tabId) {
  due.delete(tabId);
  const n = counts.get(tabId) ?? 0;
  if (sent.get(tabId) === n) return;
  sent.set(tabId, n);
  chrome.scripting.executeScript({
    target: { tabId }, world: "MAIN", injectImmediately: true, args: [n],
    func: (n) => { try { window.chrome?.webview?.postMessage("exo-shield\t" + n); } catch {} },
  }).catch(() => {});
}
dnr.onRuleMatchedDebug?.addListener(async ({ request, rule }) => {
  const tabId = request.tabId;
  if (tabId < 0) return;
  await ready;
  if (rule.rulesetId.startsWith("_")) await readOwn();
  if (skip.has(rule.rulesetId + "#" + rule.ruleId)) return;
  counts.set(tabId, (counts.get(tabId) ?? 0) + 1);
  // A burst is one report, 300 ms after its first.
  if (!due.has(tabId)) due.set(tabId, setTimeout(() => report(tabId), 300));
});
// A new page in the tab counts from zero.
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.status === "loading") { counts.set(tabId, 0); sent.delete(tabId); } });
chrome.tabs.onRemoved.addListener((tabId) => { clearTimeout(due.get(tabId)); due.delete(tabId); counts.delete(tabId); sent.delete(tabId); });
`);
writeFileSync(new URL("exo-background.js", out), `import "/js/background.js";\nimport "/ttv/${ttvManifest.background.service_worker}";\nimport "/exo-count.js";\n`);
// Each build is its own version (uBlock Origin Lite's, then the hours since 2026 began) and its own stamp (version_name,
// to the minute). WebView2 keeps running the service worker an extension was added with, new files and version or not,
// so the browser removes and adds Exo Shield again whenever the stamp it was added with isn't this one (main.cpp).
const ubolVersion = manifest.version;
manifest.version = `${ubolVersion}.${Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 3600000)}`;
manifest.version_name = `${ubolVersion} (Exo ${new Date().toISOString().slice(0, 16)})`;
writeFileSync(new URL("manifest.json", out), JSON.stringify(manifest, null, 2));

const details = JSON.parse(readFileSync(new URL("rulesets/ruleset-details.json", out), "utf8"));
for (const d of details) if (ON.has(d.id)) d.enabled = true;
details.splice(4, 0, {
  id: "hagezi-pro", name: "HaGeZi – Multi PRO", group: "default", enabled: true,
  homeURL: "https://github.com/hagezi/dns-blocklists",
  filters: { total: domains.length, accepted: domains.length, rejected: 0 },
  rules: { total: rules.length, plain: rules.length, regex: 0, strictblock: 0, rejected: 0 },
  css: { generic: 0, specific: 0 },
});
writeFileSync(new URL("rulesets/ruleset-details.json", out), JSON.stringify(details));
// What it is made of, for the browser's About: versions, how many filters and listed sites, and when.
writeFileSync(new URL("exo-shield.json", out), JSON.stringify({
  ubol: ubolVersion, ttv: ttvManifest.version, hagezi: domains.length,
  filters: details.filter((d) => d.enabled).reduce((n, d) => n + (d.filters?.accepted ?? 0), 0), built: new Date().toISOString(),
}));

// Exo's icon, and a dimmed one for sites where it is off.
for (const s of [16, 32, 64, 128]) {
  copyFileSync(new URL(`brand/shield/icon_${s}.png`, root), new URL(`img/icon_${s}.png`, out));
  copyFileSync(new URL(`brand/shield/icon_${s}_off.png`, root), new URL(`img/icon_${s}_off.png`, out));
}
copyFileSync(new URL("brand/exo-shield.svg", root), new URL("img/ublock.svg", out));

// Complete filtering everywhere by default: specific and generic cosmetic filters and scriptlets on every
// site (uBlock Origin Lite ships "optimal", which skips generic cosmetics).
const modes = new URL("js/mode-manager.js", out);
const modeSource = readFileSync(modes, "utf8");
const completeByDefault = modeSource.replace(/optimal: \[ 'all-urls' \],(\s*)complete: \[\],/, "optimal: [],$1complete: [ 'all-urls' ],");
if (completeByDefault === modeSource) throw new Error("uBlock Origin Lite changed: default filtering mode not found");
writeFileSync(modes, completeByDefault);

// Every start puts Exo's settings back, whatever an older install or anything else changed: exactly Exo's
// rulesets, and Complete filtering on every site with no site left out.
const bg = new URL("js/background.js", out);
const bgSource = readFileSync(bg, "utf8");
const startHook = "    if ( process.wakeupRun === false ) {\n        await startSession();\n    }\n";
if (!bgSource.includes(startHook)) throw new Error("uBlock Origin Lite changed: start() not found");
// TTV LOL PRO's messages carry no "what": uBlock's listener leaves them to it.
const onMessageHook = "    if ( request.what.includes(':') ) { return; }";
if (!bgSource.includes(onMessageHook)) throw new Error("uBlock Origin Lite changed: onMessage not found");
writeFileSync(bg, bgSource.replace(onMessageHook, "    if ( typeof request?.what !== 'string' || request.what.includes(':') ) { return; }").replace(startHook, startHook + `
    // Exo Shield: always Exo's rulesets and Complete filtering everywhere, put back on every start.
    await applyRulesets(await getDefaultRulesetsFromEnv());
    await setFilteringModeDetails({ none: [], basic: [], optimal: [], complete: [ 'all-urls' ] });
    await setDefaultFilteringMode(3);
    await registerContentScripts();
`));

// The GPL's notice of what changed, and where this build's source is.
writeFileSync(new URL("NOTICE.txt", out), NOTICE(ubolVersion, ttvManifest.version, domains.length));

console.log(`Exo Shield ${manifest.version}: ${domains.length} HaGeZi domains in ${rules.length} rules`);

function NOTICE(ubol, ttv, sites) {
  return `Exo Shield, Exo Browser's built-in blocker
Copyright (C) Raymond Hill and contributors (uBlock Origin Lite), Younes Aassila and contributors (TTV LOL PRO),
HaGeZi (HaGeZi DNS blocklists), and Erix (UhhErix) for the changes below.

Exo Shield is a modified version of uBlock Origin Lite ${ubol}, combined with TTV LOL PRO ${ttv} and HaGeZi's
Multi PRO list (${sites} sites). It is free software under the GNU General Public License version 3 (LICENSE.txt),
with no warranty.

Changes, made by tools/build-shield.mjs (October 2026 and later):
- Named Exo Shield, with Exo's icons.
- HaGeZi's Multi PRO list added as an always-on ruleset (hagezi-pro.json), with TTV LOL PRO's two rules.
- uBlock Origin Lite's annoyance lists and tracking-parameter list on by default, and Complete filtering on every
  site; both put back on every start (js/background.js, js/mode-manager.js).
- No popup, options page or keyboard shortcuts.
- TTV LOL PRO merged in (ttv/), with ad reports off and no first-run page; one service worker runs both
  (exo-background.js).
- How many requests it blocked on each tab's page (exceptions and header changes left out), handed to that page's
  Exo Browser for the count beside its address (exo-count.js and exo-count-skip.json, with the
  declarativeNetRequestFeedback permission).

Source for this build, with the script that makes it: https://github.com/UhhErix/exo-shield
uBlock Origin Lite: https://github.com/uBlockOrigin/uBOL-home  TTV LOL PRO: https://github.com/younesaassila/ttv-lol-pro
HaGeZi: https://github.com/hagezi/dns-blocklists
`;
}
