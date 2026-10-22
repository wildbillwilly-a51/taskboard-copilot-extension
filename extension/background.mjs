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
    void reviews.begin(sender, message.proposal, message.intent, message.clientToken).then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "review-completed") {
    void reviews.complete(sender, message.transferId, message.result).then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }
  if (message?.type === "open-discussion") {
    void (async () => {
      if (!await reviews.canDiscuss(sender) || typeof message.prompt !== "string" || !message.prompt.trim() || message.prompt.length > 8192) throw Error("Open this task from your connected Taskboard.");
      const result = await open("split", sender.tab);
      const discussion = { id: crypto.randomUUID(), prompt: message.prompt, tabId: result.tabId, createdAt: Date.now() };
      await chrome.storage.session.set({ copilotDiscussion: discussion });
      try { await chrome.tabs.sendMessage(result.tabId, { type: "prepare-discussion", ...discussion }); } catch { /* Content script asks again when ready. */ }
      return { ok: true };
    })().then(respond, error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (["discussion-ready", "discussion-received"].includes(message?.type)) {
    void (async () => {
      if (!sender.tab || !["m365.cloud.microsoft", "copilot.cloud.microsoft"].includes(new URL(sender.url).hostname) || new URL(sender.url).protocol !== "https:") return null;
      const { copilotDiscussion } = await chrome.storage.session.get("copilotDiscussion");
      if (!copilotDiscussion || copilotDiscussion.tabId !== sender.tab.id || Date.now() - copilotDiscussion.createdAt > 15 * 60 * 1000) return null;
      if (message.type === "discussion-received") {
        if (message.id === copilotDiscussion.id) await chrome.storage.session.set({ copilotDiscussion: null });
        return null;
      }
      return copilotDiscussion;
    })().then(respond, () => respond(null));
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
