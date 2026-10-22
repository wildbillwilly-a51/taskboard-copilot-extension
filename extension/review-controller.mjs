export const TASKBOARD_REVIEW_URL = null;
import "./proposal-contract.js";
const MAX_BYTES = 32768;
const TTL = 15 * 60 * 1000;
export function isCopilotPage(url) {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && ["m365.cloud.microsoft", "copilot.cloud.microsoft"].includes(parsed.hostname); } catch { return false; }
}
export function isTaskboardReviewPage(url, reviewUrl = TASKBOARD_REVIEW_URL) {
  try { const parsed = new URL(url); const target = new URL(reviewUrl); return parsed.origin === target.origin && parsed.pathname === target.pathname; } catch { return false; }
}
export function isTaskboardPage(url, reviewUrl = TASKBOARD_REVIEW_URL) {
  try { const parsed = new URL(url); return parsed.origin === new URL(reviewUrl).origin && ["/", "/copilot-review"].includes(parsed.pathname); } catch { return false; }
}
export function createReviewController(api, { getReviewUrl = async () => TASKBOARD_REVIEW_URL } = {}) {
  let queue = Promise.resolve();
  const serialized = (run) => {
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
  };
  async function transfers() {
    const { copilotReviewTransfers = {} } = await api.storage.session.get("copilotReviewTransfers");
    return Object.fromEntries(Object.entries(copilotReviewTransfers).filter(([, transfer]) => Date.now() - transfer.createdAt < TTL));
  }
  const save = (value) => api.storage.session.set({ copilotReviewTransfers: value });
  return {
    begin(sender, proposal, intent = "review", clientToken = null) { return serialized(async () => {
      if (!sender.tab || !isCopilotPage(sender.url)) throw Error("Open the proposal from the Copilot website.");
      const reviewUrl = await getReviewUrl();
      if (!reviewUrl) throw Error("Set your Taskboard address in the extension's Settings first.");
      if (typeof proposal !== "string" || new TextEncoder().encode(proposal).length > MAX_BYTES) throw Error("Proposal is missing or too large.");
      // Revalidate at the transfer boundary, even if the displayed block was
      // valid earlier. Never store or open a review for an invalid contract.
      globalThis.TaskboardCopilotProposal.parse(proposal);
      if (!["review", "apply"].includes(intent)) throw Error("Choose Apply or Review details.");
      if (clientToken !== null && (typeof clientToken !== "string" || !/^[0-9a-f-]{36}$/i.test(clientToken))) throw Error("The approval token is invalid. Refresh Copilot.");
      const pending = await transfers();
      for (const transfer of Object.values(pending)) if (transfer.proposal === proposal && (transfer.intent || "review") === intent) {
        try {
          const tab = await api.tabs.get(transfer.tabId);
          const confirmation = await api.tabs.sendMessage(tab.id, { type: "review-ping" });
          if (confirmation?.transferId !== transfer.id || transfer.reviewUrl && transfer.reviewUrl !== reviewUrl || !isTaskboardPage(confirmation.url, reviewUrl)) throw Error("Review tab navigated away.");
          transfer.clientToken = clientToken; transfer.sourceTabId = sender.tab.id; await save(pending);
          if (intent === "review") await api.windows.update(tab.windowId, { focused: true });
          if (intent === "review") await api.tabs.update(tab.id, { active: true });
          return { transferId: transfer.id };
        } catch { delete pending[transfer.id]; }
      }
      if (Object.keys(pending).length >= 20) throw Error("Finish or close your existing reviews before transferring another proposal.");
      const window = await api.windows.get(sender.tab.windowId);
      if (window.type !== "normal") throw Error("Open Copilot in a normal browser tab or Split View before reviewing changes.");
      const id = crypto.randomUUID();
      // Record before creating the tab so its first handshake cannot race us.
      const transfer = { id, proposal, intent, clientToken, sourceTabId: sender.tab.id, reviewUrl, createdAt: Date.now(), tabId: null };
      pending[id] = transfer;
      await save(pending);
      let tab;
      try {
        if (await getReviewUrl() !== reviewUrl) throw Error("Taskboard settings changed. Transfer the proposal again.");
        // Reuse a cooperating Taskboard tab without changing its URL, selected
        // task, scroll position or unsaved work. Old servers get a separate tab.
        if (api.tabs.query) {
          const candidates = await api.tabs.query({ windowId: sender.tab.windowId });
          for (const candidate of candidates.filter(tab => !tab.url || isTaskboardPage(tab.url, reviewUrl))) {
            try {
              const capability = await api.tabs.sendMessage(candidate.id, { type: "review-capabilities" });
              if (capability?.protocol !== 2 || !isTaskboardPage(capability.url, reviewUrl)) continue;
              tab = candidate;
              transfer.tabId = tab.id;
              await save(pending);
              const offered = await api.tabs.sendMessage(tab.id, { type: "review-transfer", transferId: id });
              if (!offered?.ok) throw Error("Taskboard became busy. Open a separate activity tab.");
              if (intent === "review") await api.tabs.update(tab.id, { active: true });
              return { transferId: id };
            } catch { tab = null; }
          }
        }
        tab = await api.tabs.create({ windowId: sender.tab.windowId, url: `${reviewUrl}?transfer=${id}`, active: intent === "review" });
        transfer.backgroundApplyTab = intent === "apply";
      }
      catch (error) { delete pending[id]; await save(pending); throw error; }
      transfer.tabId = tab.id;
      await save(pending);
      return { transferId: id };
    }); },
    pending(sender, id) { return serialized(async () => {
      const reviewUrl = await getReviewUrl();
      if (!sender.tab || !isTaskboardPage(sender.url, reviewUrl)) return null;
      const pending = await transfers();
      await save(pending);
      const transfer = pending[id];
      return transfer?.tabId === sender.tab.id && (!transfer.reviewUrl || transfer.reviewUrl === reviewUrl) ? { transferId: transfer.id, proposal: transfer.proposal, ...(transfer.intent === "apply" ? { intent: "apply" } : {}) } : null;
    }); },
    async canDiscuss(sender) { return !!sender.tab && isTaskboardPage(sender.url, await getReviewUrl()); },
    complete(sender, id, result) { return serialized(async () => {
      const reviewUrl = await getReviewUrl();
      if (!sender.tab || !isTaskboardPage(sender.url, reviewUrl)) return;
      if (typeof result?.ok !== "boolean" || typeof result.message !== "string" || !result.message.trim() || result.message.length > 1000) return;
      const pending = await transfers();
      const transfer = pending[id];
      if (!transfer || transfer.tabId !== sender.tab.id || transfer.reviewUrl !== reviewUrl) return;
      try { await api.tabs.sendMessage(transfer.sourceTabId, { type: "proposal-result", transferId: id, requestId: JSON.parse(transfer.proposal).requestId, clientToken: transfer.clientToken, ok: result.ok, message: result.message }); } catch { /* Copilot may have closed. Activity remains on Taskboard. */ }
      delete pending[id]; await save(pending);
      // Only the temporary background Apply tab belongs to this transfer. Never
      // close a reused board, a tab the user activated, or one navigated elsewhere.
      if (result.ok && transfer.backgroundApplyTab) {
        try {
          const tab = await api.tabs.get(transfer.tabId);
          if (!tab.active) {
            // Chrome may redact Tab.url without tabs permission. The same
            // cooperating bridge used for reuse proves the receiver's identity.
            const receiver = await api.tabs.sendMessage(tab.id, { type: "review-ping" });
            if (receiver?.transferId === id && isTaskboardReviewPage(receiver.url, reviewUrl)) await api.tabs.remove(tab.id);
          }
        } catch { /* The user may already have closed the temporary tab. */ }
      }
    }); },
    received(sender, id) { return serialized(async () => {
      const reviewUrl = await getReviewUrl();
      if (!sender.tab || !isTaskboardPage(sender.url, reviewUrl)) return;
      const pending = await transfers();
      if (pending[id]?.tabId === sender.tab.id) delete pending[id];
      await save(pending);
    }); },
  };
}
