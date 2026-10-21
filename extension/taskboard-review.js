/* global chrome, window, document */
(() => {
  if (window.location.pathname !== "/copilot-review") return;
  const transferId = new URLSearchParams(window.location.search).get("transfer");
  if (!transferId || !/^[0-9a-f-]{36}$/i.test(transferId)) return;
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "review-ping") respond({ transferId, url: window.location.href });
  });
  let finished = false;
  window.addEventListener("message", (event) => {
    if (finished || event.source !== window || event.origin !== window.location.origin || event.data?.channel !== "taskboard-copilot") return;
    if (event.data.type === "ready" && document.getElementById("copilot-review-root")) {
      void chrome.runtime.sendMessage({ type: "review-ready", transferId }).then(result => {
        if (result?.proposal && !finished) window.postMessage({ channel: "taskboard-copilot", type: "proposal", ...result }, window.location.origin);
      }).catch(() => {});
    }
    if (event.data.type === "received" && event.data.transferId === transferId) {
      finished = true;
      void chrome.runtime.sendMessage({ type: "review-received", transferId }).catch(() => {});
    }
  });
})();
