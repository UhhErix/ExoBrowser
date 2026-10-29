// Exo Shield's count for Exo Browser's Bar (tools/build-shield.mjs): what it blocked on the page in each tab.
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
    func: (n) => { try { window.chrome?.webview?.postMessage("exo-shield	" + n); } catch {} },
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
