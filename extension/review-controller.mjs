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
    begin(sender, proposal) { return serialized(async () => {
      if (!sender.tab || !isCopilotPage(sender.url)) throw Error("Open the proposal from the Copilot website.");
      const reviewUrl = await getReviewUrl();
      if (!reviewUrl) throw Error("Set your Taskboard address in the extension's Settings first.");
      if (typeof proposal !== "string" || new TextEncoder().encode(proposal).length > MAX_BYTES) throw Error("Proposal is missing or too large.");
      // Revalidate at the transfer boundary, even if the displayed block was
      // valid earlier. Never store or open a review for an invalid contract.
      globalThis.TaskboardCopilotProposal.parse(proposal);
      const pending = await transfers();
      for (const transfer of Object.values(pending)) if (transfer.proposal === proposal) {
        try {
          const tab = await api.tabs.get(transfer.tabId);
          const confirmation = await api.tabs.sendMessage(tab.id, { type: "review-ping" });
          if (confirmation?.transferId !== transfer.id || transfer.reviewUrl && transfer.reviewUrl !== reviewUrl || !isTaskboardReviewPage(confirmation.url, reviewUrl)) throw Error("Review tab navigated away.");
          await api.windows.update(tab.windowId, { focused: true });
          await api.tabs.update(tab.id, { active: true });
          return { transferId: transfer.id };
        } catch { delete pending[transfer.id]; }
      }
      if (Object.keys(pending).length >= 20) throw Error("Finish or close your existing reviews before transferring another proposal.");
      const window = await api.windows.get(sender.tab.windowId);
      if (window.type !== "normal") throw Error("Open Copilot in a normal browser tab or Split View before reviewing changes.");
      const id = crypto.randomUUID();
      // Record before creating the tab so its first handshake cannot race us.
      const transfer = { id, proposal, reviewUrl, createdAt: Date.now(), tabId: null };
      pending[id] = transfer;
      await save(pending);
      let tab;
      try {
        if (await getReviewUrl() !== reviewUrl) throw Error("Taskboard settings changed. Transfer the proposal again.");
        tab = await api.tabs.create({ windowId: sender.tab.windowId, url: `${reviewUrl}?transfer=${id}`, active: true });
      }
      catch (error) { delete pending[id]; await save(pending); throw error; }
      transfer.tabId = tab.id;
      await save(pending);
      return { transferId: id };
    }); },
    pending(sender, id) { return serialized(async () => {
      const reviewUrl = await getReviewUrl();
      if (!sender.tab || !isTaskboardReviewPage(sender.url, reviewUrl)) return null;
      const pending = await transfers();
      await save(pending);
      const transfer = pending[id];
      return transfer?.tabId === sender.tab.id && (!transfer.reviewUrl || transfer.reviewUrl === reviewUrl) ? { transferId: transfer.id, proposal: transfer.proposal } : null;
    }); },
    received(sender, id) { return serialized(async () => {
      const reviewUrl = await getReviewUrl();
      if (!sender.tab || !isTaskboardReviewPage(sender.url, reviewUrl)) return;
      const pending = await transfers();
      if (pending[id]?.tabId === sender.tab.id) delete pending[id];
      await save(pending);
    }); },
  };
}
