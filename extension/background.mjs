import { createTargetController } from "./target.mjs";
/* global chrome */
import { createHostController } from "./host-controller.mjs";
import { createReviewController, isCopilotPage } from "./review-controller.mjs";
const hosts = createHostController(chrome);
const targets = createTargetController(chrome);
const reviews = createReviewController(chrome, { getReviewUrl: targets.getReviewUrl });
chrome.runtime.onInstalled.addListener(() => { void targets.reconcile().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { void targets.reconcile().catch(console.error); });
chrome.permissions.onRemoved.addListener(() => { void targets.reconcile().catch(console.error); });

async function reportError(error) {
  console.error("Could not open Copilot", error);
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setTitle({ title: `Copilot: ${error.message}. Click for options.` });
}

async function open(mode, tab) {
  const result = await hosts.open(mode, tab);
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setTitle({ title: "Taskboard Copilot · Split View / Separate window" });
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message?.type === "taskboard-status") {
    const trusted = ["options.html", "launcher.html"].some(page => sender.url === chrome.runtime.getURL(page)) || isCopilotPage(sender.url);
    if (!trusted) return false;
    void targets.status().then(respond, () => respond(null));
    return true;
  }
  if (message?.type === "open-taskboard-settings" && isCopilotPage(sender.url)) {
    void chrome.runtime.openOptionsPage().then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }
  if (["configure-taskboard", "disconnect-taskboard"].includes(message?.type)) {
    if (sender.url !== chrome.runtime.getURL("options.html")) return false;
    const action = message.type === "configure-taskboard" ? targets.save(message.url) : targets.clear();
    void action.then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "review-proposal") {
    void reviews.begin(sender, message.proposal).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "review-ready") {
    void reviews.pending(sender, message.transferId).then(respond, () => respond(null));
    return true;
  }
  if (message?.type === "review-received") {
    void reviews.received(sender, message.transferId).then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }
  if (message?.type === "split-guide" && sender.tab) {
    void hosts.guideFor(sender.tab.id).then((guide) => respond({ guide }), () => respond({ guide: null }));
    return true;
  }
  if (message?.type !== "open-copilot" || sender.url !== chrome.runtime.getURL("launcher.html")) return false;
  void chrome.tabs.get(message.tabId).then((tab) => open(message.mode, tab)).then(
    (result) => respond({ ok: true, ...result }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});
chrome.windows.onBoundsChanged.addListener((window) => { void hosts.saveBounds(window).catch(() => {}); });
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "open-copilot") return;
  void (async () => {
    const { preferredMode = "split" } = await chrome.storage.local.get("preferredMode");
    if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await open(preferredMode, tab);
  })().catch(reportError);
});
