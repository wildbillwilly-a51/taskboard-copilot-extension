/* global chrome, window, document */
(() => {
  // Same connected site permission; activate only on the board/activity routes.
  if (!["/", "/copilot-review"].includes(window.location.pathname)) return;
  let transferId = new URLSearchParams(window.location.search).get("transfer");
  if (transferId && !/^[0-9a-f-]{36}$/i.test(transferId)) transferId = null;
  let finished = false;
  let delivering = false;
  const capable = () => document.getElementById("copilot-review-root")?.dataset.copilotProtocol === "2";
  async function deliver() {
    if (!transferId || finished || delivering || !document.getElementById("copilot-review-root")) return;
    delivering = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "review-ready", transferId });
      if (!result?.proposal || finished) return;
      if (result.intent === "apply" && !capable()) {
        await chrome.runtime.sendMessage({ type: "review-completed", transferId, result: { ok: false, message: "Update Taskboard before using single-click Apply. Review details remains available." } });
        finished = true;
        return;
      }
      window.postMessage({ channel: "taskboard-copilot", type: "proposal", ...result }, window.location.origin);
    } catch { /* The page can retry its ready handshake. */ }
    finally { delivering = false; }
  }
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "review-capabilities") respond({ protocol: capable() && document.getElementById("copilot-review-root")?.dataset.copilotBusy !== "true" && (!transferId || finished) ? 2 : 1, url: window.location.href });
    if (message?.type === "review-ping") respond({ transferId, url: window.location.href });
    if (message?.type === "review-transfer") {
      if (!capable() || document.getElementById("copilot-review-root")?.dataset.copilotBusy === "true" || transferId && !finished || !/^[0-9a-f-]{36}$/i.test(message.transferId)) { respond({ ok: false }); return; }
      transferId = message.transferId; finished = false;
      respond({ ok: true }); void deliver();
    }
  });
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== window.location.origin || event.data?.channel !== "taskboard-copilot") return;
    if (event.data.type === "ready") void deliver();
    if (event.data.transferId !== transferId || finished) return;
    if (event.data.type === "completed") {
      finished = true;
      void chrome.runtime.sendMessage({ type: "review-completed", transferId, result: event.data.result }).catch(() => {});
    } else if (event.data.type === "received") {
      finished = true;
      void chrome.runtime.sendMessage({ type: "review-received", transferId }).catch(() => {});
    }
  });
  // Only a real click on Taskboard's own visible context button opens Copilot.
  document.addEventListener("click", event => {
    const button = event.target.closest?.("button[data-copilot-prompt]");
    if (!event.isTrusted || !button || button.disabled || !button.getClientRects().length) return;
    const prompt = button.getAttribute("data-copilot-prompt");
    if (!prompt || prompt.length > 8192) return;
    void chrome.runtime.sendMessage({ type: "open-discussion", prompt }).then(result => {
      window.postMessage({ channel: "taskboard-copilot", type: "discussion-status", ok: !!result?.ok, message: result?.ok ? "Task context prepared in Copilot. Review the message there and send it." : result?.error || "Copilot could not be opened. Copy the task prompt instead." }, window.location.origin);
    }).catch(() => window.postMessage({ channel: "taskboard-copilot", type: "discussion-status", ok: false, message: "Extension unavailable. Copy the task prompt instead." }, window.location.origin));
  });
})();
