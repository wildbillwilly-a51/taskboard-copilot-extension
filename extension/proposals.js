/* global chrome, document, MutationObserver, window */
(() => {
  // Detect only small proposal code blocks. No conversation, mailbox, cookies
  // or tokens are collected. Transfer happens only on an explicit button click.
  const installed = new Map();
  let timer;
  function proposalText(element) {
    if (!element.isConnected || !element.getClientRects().length) return null;
    const text = (element.matches("code") ? element : element.querySelector("code") || element).textContent.trim();
    if (text.length > 32768 || !text.includes('"taskboard-proposal"')) return null;
    try {
      const value = JSON.parse(text);
      return value?.type === "taskboard-proposal" && value.version === 1 && Array.isArray(value.changes) ? text : null;
    } catch { return null; }
  }
  function scan() {
    for (const [element, widget] of installed) if (!element.isConnected || !widget.host.isConnected) {
      widget.host.remove();
      installed.delete(element);
    }
    const candidates = new Set([...document.querySelectorAll("pre, code")].slice(-200).map(element => element.closest("pre") || element));
    for (const element of candidates) {
      const text = proposalText(element);
      const old = installed.get(element);
      if (old && !text) { old.host.remove(); installed.delete(element); }
      if (!text || old) continue;
      const host = document.createElement("div");
      host.className = "taskboard-copilot-proposal-review";
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `<style>:host{all:initial;display:block;margin:10px 0;font:13px/1.5 system-ui;color-scheme:light dark}button{font:inherit;min-height:44px;padding:10px 14px;border:1px solid #5a73ba;border-radius:9px;background:#354fb5;color:#fff;cursor:pointer}button:focus-visible{outline:3px solid #92abff;outline-offset:3px}button:disabled{opacity:.6;cursor:wait}p{font:12px/1.5 system-ui;color:light-dark(#3c485e,#c9d5e9);margin:8px 0;max-width:480px}</style><button type="button">Review changes in Taskboard</button><p role="status">Transfers this proposal for review. Nothing applies until you approve.</p>`;
      element.insertAdjacentElement("afterend", host);
      installed.set(element, { host });
      const button = root.querySelector("button");
      const status = root.querySelector("p");
      button.addEventListener("click", async (event) => {
        if (!event.isTrusted) { status.textContent = "Click this button yourself to transfer the proposal."; return; }
        const proposal = proposalText(element);
        if (!proposal) { status.textContent = "This block changed or is incomplete. Wait for Copilot to finish, then try again."; return; }
        button.disabled = true;
        status.textContent = "Opening your Taskboard review…";
        try {
          const result = await chrome.runtime.sendMessage({ type: "review-proposal", proposal });
          if (!result?.ok) throw Error(result?.error || "Could not transfer the proposal.");
          status.textContent = "Opened in Taskboard for review. Your board has not changed.";
        } catch (error) { status.textContent = error.message; }
        finally { button.disabled = false; }
      });
    }
  }
  const observer = new MutationObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(scan, 150); });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  scan();
})();
