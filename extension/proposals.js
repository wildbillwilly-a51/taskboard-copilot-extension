/* global chrome, document, MutationObserver, window, TaskboardCopilotProposal */
(() => {
  // Detect only small proposal code blocks. No conversation, mailbox, cookies
  // or tokens are collected. Transfer happens only on an explicit button click.
  const installed = new Map();
  const editorSelector = '[role="textbox"][aria-readonly="true"]';
  let timer;
  function proposalText(element) {
    if (!element.isConnected || !element.getClientRects().length || element.isContentEditable || !element.matches(`pre, code, ${editorSelector}`)) return null;
    let text;
    if (element.matches(editorSelector)) {
      // Copilot's virtualized Code editor uses numbered divs, not pre/code.
      // Read only a complete, contiguous rendered block; never the composer,
      // line-number gutters, editor internals or a partially virtualized value.
      const lines = [...element.querySelectorAll(":scope > [data-line-index]")];
      if (!lines.length || lines.some((line, index) => line.getAttribute("data-line-index") !== String(index))) return null;
      text = lines.map(line => line.textContent).join("\n").trim();
    } else {
      text = (element.matches("code") ? element : element.querySelector("code") || element).textContent.trim();
    }
    if (text.length > 32768 || new TextEncoder().encode(text).length > 32768 || !text.includes('"taskboard-proposal"')) return null;
    try {
      const value = JSON.parse(text);
      return value?.type === "taskboard-proposal" ? text : null;
    } catch { return null; }
  }
  function validationError(text) {
    try { TaskboardCopilotProposal.parse(text); return ""; }
    catch (error) {
      const value = JSON.parse(text);
      if (Array.isArray(value.changes) && value.changes.length === 0) return "No task changes were included. Ask Copilot to prepare 1â€“20 concrete changes from your request, or explain which decision is still needed. An empty proposal cannot be reviewed.";
      if (Array.isArray(value.changes) && value.changes.length > 20) return `This proposal has ${value.changes.length} changes. Ask Copilot for at most 20 changes, then refresh the snapshot after approval before preparing the next batch. Nothing has been transferred.`;
      return `${error.message} Ask Copilot to correct this proposal using the snapshot instructions. Nothing has been transferred.`;
    }
  }
  function scan() {
    for (const [element, widget] of installed) if (!widget.host.isConnected || !proposalText(element)) {
      widget.host.remove();
      installed.delete(element);
    }
    const candidates = new Set([...document.querySelectorAll(`pre, code, ${editorSelector}`)].slice(-200).map(element => element.closest(editorSelector) || element.closest("pre") || element));
    for (const element of candidates) {
      const text = proposalText(element);
      const old = installed.get(element);
      if (old && !text) { old.host.remove(); installed.delete(element); }
      if (!text) continue;
      if (old && old.text === text) continue;
      if (old) { old.host.remove(); installed.delete(element); }
      const host = document.createElement("div");
      host.className = "taskboard-copilot-proposal-review";
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `<style>:host{all:initial;display:block;margin:10px 0;font:13px/1.5 system-ui;color-scheme:light dark}button{font:inherit;min-height:44px;padding:10px 14px;border:1px solid #5a73ba;border-radius:9px;background:#354fb5;color:#fff;cursor:pointer}button:focus-visible{outline:3px solid #92abff;outline-offset:3px}button:disabled{opacity:.6;cursor:wait}p{font:12px/1.5 system-ui;color:light-dark(#3c485e,#c9d5e9);margin:8px 0;max-width:480px;padding:8px;border-radius:6px;background:light-dark(#f3f6fb,#202a3a);overflow-wrap:anywhere}</style><button type="button">Review changes in Taskboard</button><p role="status">Transfers this proposal for review. Nothing applies until you approve.</p>`;
      const anchor = element.matches(editorSelector) ? element.closest(".scriptor-component-code-block") || element : element;
      anchor.insertAdjacentElement("afterend", host);
      installed.set(element, { host, text });
      const button = root.querySelector("button");
      const status = root.querySelector("p");
      const error = validationError(text);
      if (error) { button.remove(); status.textContent = error; continue; }
      button.addEventListener("click", async (event) => {
        if (!event.isTrusted) { status.textContent = "Click this button yourself to transfer the proposal."; return; }
        const proposal = proposalText(element);
        if (!proposal) { status.textContent = "This block changed or is incomplete. Wait for Copilot to finish, then try again."; return; }
        const error = validationError(proposal);
        if (error) { button.remove(); status.textContent = error; return; }
        button.disabled = true;
        status.textContent = "Opening your Taskboard reviewâ€¦";
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
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-readonly", "contenteditable", "data-line-index", "hidden"] });
  scan();
})();
