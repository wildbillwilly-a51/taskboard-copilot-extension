/* global chrome, document, MutationObserver, window, TaskboardCopilotProposal */
(() => {
  // Detect only small proposal code blocks. No conversation, mailbox, cookies
  // or tokens are collected. Transfer happens only on an explicit button click.
  const installed = new Map();
  const editorSelector = '[role="textbox"][aria-readonly="true"]';
  let timer;
  function proposalText(element) {
    if (!element.isConnected || (!element.getClientRects().length && !(installed.get(element)?.collapsed && installed.get(element)?.host.getClientRects().length)) || element.isContentEditable || !element.matches(`pre, code, ${editorSelector}`)) return null;
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
  function restoreCode(widget) {
    for (const [key, value] of Object.entries(widget.originalStyle)) widget.anchor.style[key] = value;
  }
  function collapseCode(widget) {
    // Keep editor dimensions intact: display:none can make Copilot virtualize
    // away its JSON lines. Do not reparent React-owned response elements.
    const width = widget.anchor.getBoundingClientRect().width;
    widget.anchor.style.width = `${Math.min(width, window.innerWidth - 24)}px`;
    widget.anchor.style.position = "absolute";
    widget.anchor.style.visibility = "hidden";
    widget.anchor.style.pointerEvents = "none";
  }
  function remove(element, widget) {
    restoreCode(widget);
    window.clearTimeout(widget.timeout);
    widget.host.remove(); installed.delete(element);
  }
  function scan() {
    for (const [element, widget] of installed) if (!widget.host.isConnected || !proposalText(element)) remove(element, widget);
    const candidates = new Set([...document.querySelectorAll(`pre, code, ${editorSelector}`)].slice(-200).map(element => element.closest(editorSelector) || element.closest("pre") || element));
    for (const element of candidates) {
      const text = proposalText(element);
      const old = installed.get(element);
      if (!text) { if (old) remove(element, old); continue; }
      if (old && old.text === text) continue;
      if (old) remove(element, old);
      const host = document.createElement("div");
      host.className = "taskboard-copilot-proposal-review";
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `<style>:host{all:initial;display:block;margin:12px 0;max-width:640px;font:13px/1.5 system-ui;color-scheme:light dark;color:light-dark(#182233,#ecf0f8)}*{box-sizing:border-box}.card{padding:16px;border:1px solid light-dark(#c7d0df,#526078);border-radius:12px;background:light-dark(#f8faff,#1d2533)}h3{font-size:15px;margin:0 0 10px}ol{margin:0 0 12px;padding-left:22px;max-height:360px;overflow:auto}li{margin:0 0 12px;overflow-wrap:anywhere;white-space:pre-wrap}.target{font-size:11px;opacity:.75}button{font:inherit;min-height:44px;padding:10px 12px;border:1px solid #5a73ba;border-radius:8px;background:#354fb5;color:#fff;cursor:pointer}button.secondary{background:transparent;color:inherit}button:focus-visible{outline:3px solid #92abff;outline-offset:3px}button:disabled{opacity:.6;cursor:default}.actions{display:flex;flex-wrap:wrap;gap:8px}p{font:12px/1.5 system-ui;margin:10px 0 0;overflow-wrap:anywhere}</style><section class="card" aria-label="Proposed Taskboard changes"><h3>Proposed task changes</h3><ol></ol><div class="actions"><button class="apply" type="button"></button><button class="review secondary" type="button">Review details</button><button class="technical secondary" type="button" aria-expanded="false">Technical details</button></div><p role="status">Apply is your approval. Taskboard checks for conflicts before changing anything.</p></section>`;
      const anchor = element.matches(editorSelector) ? element.closest(".scriptor-component-code-block") || element : element;
      anchor.insertAdjacentElement("beforebegin", host);
      const widget = { host, root, anchor, originalStyle: Object.fromEntries(["width", "position", "visibility", "pointerEvents"].map(key => [key, anchor.style[key]])), text, collapsed: true, pending: false, intent: null, transferId: null, timeout: null };
      installed.set(element, widget); collapseCode(widget);
      const apply = root.querySelector(".apply");
      const review = root.querySelector(".review");
      const technical = root.querySelector(".technical");
      const status = root.querySelector("p");
      technical.addEventListener("click", () => {
        widget.collapsed = !widget.collapsed;
        if (widget.collapsed) collapseCode(widget); else restoreCode(widget);
        technical.setAttribute("aria-expanded", String(!widget.collapsed));
      });
      const error = validationError(text);
      if (error) { apply.remove(); review.remove(); root.querySelector("ol").remove(); status.textContent = error; continue; }
      const parsed = TaskboardCopilotProposal.parse(text);
      widget.requestId = parsed.requestId;
      apply.textContent = `Apply ${parsed.changes.length} change${parsed.changes.length === 1 ? "" : "s"}`;
      for (const change of parsed.changes) {
        const item = document.createElement("li");
        const lines = [];
        if (change.op === "note") lines.push(`Add working note: ${change.text}`);
        else {
          if (change.op === "create") lines.push("Create a task");
          for (const [field, value] of Object.entries(change.set)) {
            if (field === "title") lines.push(`${change.op === "create" ? "Title" : "Rename to"}: ${value}`);
            if (field === "summary") lines.push(value ? `Description: ${value}` : "Clear the description");
            if (field === "bucket") lines.push(`${change.op === "create" ? "Bucket" : "Move to bucket"}: ${value}`);
            if (field === "status") lines.push(`Set status to ${{todo:"To do",active:"In progress",waiting:"Waiting",done:"Done"}[value]}`);
            if (field === "dueAt") lines.push(value ? `Set due date to ${new Date(value).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})` : "Clear the due date");
          }
        }
        item.textContent = lines.join("\n");
        if (change.op !== "create") { const target = document.createElement("div"); target.className = "target"; target.textContent = `Task ${change.task}`; item.append(target); }
        root.querySelector("ol").append(item);
      }
      for (const [button, intent] of [[apply, "apply"], [review, "review"]]) button.addEventListener("click", async event => {
        if (!event.isTrusted) { status.textContent = "Click this button yourself to authorize the selected action."; return; }
        const proposal = proposalText(element);
        if (!proposal || proposal !== text) { status.textContent = "This proposal changed. Read the updated card before applying it."; return; }
        const error = validationError(proposal);
        if (error) { status.textContent = error; return; }
        widget.pending = true; widget.intent = intent; widget.clientToken = crypto.randomUUID();
        apply.disabled = true; review.disabled = true;
        status.textContent = intent === "apply" ? "Taskboard is checking and applying your changes…" : "Opening proposal details…";
        widget.timeout = window.setTimeout(() => {
          if (!widget.pending) return;
          widget.pending = false; apply.disabled = false; review.disabled = false;
          status.textContent = "Confirmation has not arrived. Check Copilot activity in Taskboard before trying again.";
        }, 30000);
        try {
          const result = await chrome.runtime.sendMessage({ type: "review-proposal", proposal, intent, clientToken: widget.clientToken });
          if (!result?.ok) throw Error(result?.error || "Could not transfer the proposal.");
          widget.transferId = result.transferId;
        } catch (error) {
          window.clearTimeout(widget.timeout); widget.pending = false;
          status.textContent = error.message; apply.disabled = false; review.disabled = false;
        }
      });
    }
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== "proposal-result" || typeof message.message !== "string") return;
    for (const widget of installed.values()) {
      if (widget.clientToken !== message.clientToken || widget.requestId !== message.requestId || widget.transferId && widget.transferId !== message.transferId || !widget.transferId && !widget.pending) continue;
      window.clearTimeout(widget.timeout); widget.pending = false;
      widget.root.querySelector("p").textContent = message.message;
      widget.root.querySelector(".apply").disabled = message.ok && widget.intent === "apply";
      widget.root.querySelector(".review").disabled = false;
    }
  });
  const observer = new MutationObserver(() => { window.clearTimeout(timer); timer = window.setTimeout(scan, 150); });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-readonly", "contenteditable", "data-line-index", "hidden"] });
  scan();
})();
