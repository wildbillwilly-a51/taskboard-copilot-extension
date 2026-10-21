/* global chrome, document, navigator, window, TaskboardCopilotPrompts, TaskboardCopilotComposer */
(() => {
  if (document.getElementById("taskboard-copilot-prompts")) return;
  const host = document.createElement("div");
  host.id = "taskboard-copilot-prompts";
  const root = host.attachShadow({ mode: "open" });
  // Shadow DOM keeps the dock's layout independent of Microsoft's page styles.
  root.innerHTML = `
    <style>
      :host { all: initial; position: fixed; top: 72px; right: 16px; z-index: 2147483646; font: 14px/1.45 system-ui, sans-serif; color-scheme: light dark; color: #182233; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button, textarea { font: inherit; }
      button { cursor: pointer; min-height: 44px; border: 1px solid #d9e0ea; border-radius: 10px; background: #fff; color: inherit; padding: 10px 12px; text-align: left; }
      button:hover { background: #edf4ff; border-color: #8ca8d9; }
      button:disabled { opacity: .65; cursor: wait; }
      button:focus-visible, textarea:focus-visible { outline: 3px solid #5f7fed; outline-offset: 3px; }
      .toggle { box-shadow: 0 4px 18px #14243720; font-weight: 650; }
      .panel, .toggle { font: 14px/1.45 system-ui, sans-serif; }
      .panel { display: flex; flex-direction: column; width: min(350px, calc(100vw - 32px)); max-height: calc(100dvh - 88px); overflow: hidden; border: 1px solid #d9e0ea; border-radius: 16px; background: #f8faff; box-shadow: 0 12px 40px #14243730; }
      header { display: flex; flex-shrink: 0; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; }
      .body { min-height: 0; overflow-y: auto; padding: 0 16px 16px; }
      h2 { font-size: 17px; margin: 0; letter-spacing: -.3px; }
      .close { min-width: 44px; text-align: center; font-size: 20px; padding: 4px; }
      p { margin: 10px 0 14px; color: #536278; font-size: 12px; }
      .shortcuts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .shortcut { display: flex; flex-direction: column; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
      .shortcut[aria-pressed=true] { border-color: #5876d9; background: #edf2ff; }
      .shortcut strong { font-size: 13px; font-weight: 650; }
      .shortcut span { color: #536278; font-size: 11px; }
      label { display: block; font-weight: 650; font-size: 12px; margin: 16px 0 6px; }
      textarea { display: block; width: 100%; height: 190px; resize: vertical; border: 1px solid #c7d0df; border-radius: 8px; padding: 10px; background: #fff; color: inherit; font-size: 12px; line-height: 1.5; }
      .copy { margin-top: 10px; width: 100%; text-align: center; background: #354fb5; border-color: #354fb5; color: #fff; font-weight: 650; }
      .copy:hover { background: #284098; border-color: #284098; }
      .secondary { margin-top: 8px; width: 100%; text-align: center; }
      .draft-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .notice { display:flex; align-items:flex-start; gap:8px; font: 12px/1.45 system-ui, sans-serif; max-width: min(350px, calc(100vw - 32px)); padding: 10px; border-radius: 10px; background: #f8faff; box-shadow: 0 4px 18px #14243720; }
      .notice-text { flex:1; min-width:0; overflow-wrap:anywhere; }
      .notice-dismiss { flex-shrink:0; min-width:36px; min-height:36px; padding:4px; text-align:center; font-size:20px; }
      .status { min-height: 36px; margin: 10px 0 0; }
      @media (max-width: 280px) { .shortcuts { grid-template-columns: 1fr; } }
      @media (prefers-color-scheme: dark) {
        :host { color: #ecf0f8; }
        .panel, .notice { background: #1d2533; border-color: #43506a; }
        button, textarea { background: #263143; border-color: #526078; }
        button:hover, .shortcut[aria-pressed=true] { background: #303f60; border-color: #91a8f7; }
        p, .shortcut span { color: #bac7dc; }
        .copy { background: #9eb2ff; border-color: #9eb2ff; color: #152044; }
        .copy:hover { background: #b9c7ff; }
      }
    </style>
    <button class="toggle" aria-expanded="false" aria-controls="prompt-panel">Taskboard prompts</button>
    <div class="notice" role="status" aria-live="polite" hidden><span class="notice-text"></span><button class="notice-dismiss" aria-label="Dismiss Taskboard message">×</button></div>
    <section class="panel" id="prompt-panel" aria-labelledby="dock-title" hidden>
      <header><h2 id="dock-title">Taskboard prompts</h2><button class="close" aria-label="Collapse Taskboard prompts">×</button></header>
      <div class="body">
      <p class="split-guide" hidden></p>
      <p>Choose a shortcut to fill Copilot’s message box. Review the prompt there, then send it yourself.</p>
      <p>Ask Copilot for task changes, then use <strong>Review changes in Taskboard</strong> beside its proposal block. Your approval is required.</p>
      <div class="shortcuts"></div>
      <label for="prompt">Prompt preview · optional edits</label>
      <textarea id="prompt" spellcheck="false"></textarea>
      <button class="copy insert">Insert into Copilot</button>
      <button class="secondary copy-fallback">Copy prompt instead</button>
      <p class="status" role="status" aria-live="polite">Shortcuts fill the message box without sending.</p>
      <div class="draft-actions" hidden><button class="replace">Replace draft</button><button class="keep">Keep draft</button></div>
      </div>
    </section>`;
  document.documentElement.append(host);
  const toggle = root.querySelector(".toggle");
  const panel = root.querySelector(".panel");
  const prompt = root.querySelector("textarea");
  const status = root.querySelector(".status");
  const notice = root.querySelector(".notice");
  const draftActions = root.querySelector(".draft-actions");
  const buttons = [];
  function refreshGuide() {
    void chrome.runtime.sendMessage({ type: "split-guide" }).then((result) => {
      const guide = root.querySelector(".split-guide");
      guide.textContent = result?.guide || "";
      guide.hidden = !result?.guide;
    }).catch(() => {});
  }
  let interacted = false;
  let busy = false;
  let pending = null;
  let noticeTimer;
  let feedbackRevision = 0;
  const defaultStatus = "Shortcuts fill the message box without sending.";
  function clearNotice() {
    const returnFocus = notice.contains(root.activeElement);
    feedbackRevision++;
    window.clearTimeout(noticeTimer);
    notice.hidden = true;
    root.querySelector(".notice-text").textContent = "";
    if (returnFocus) toggle.focus();
  }
  function showNotice(message, warning = false) {
    clearNotice();
    root.querySelector(".notice-text").textContent = message;
    notice.hidden = false;
    const revision = feedbackRevision;
    noticeTimer = window.setTimeout(() => {
      if (revision === feedbackRevision) clearNotice();
    }, warning ? 10000 : 5000);
  }
  root.querySelector(".notice-dismiss").addEventListener("click", () => {
    clearNotice();
    toggle.focus();
  });
  function select(id) {
    clearNotice();
    prompt.value = TaskboardCopilotPrompts.buildPrompt(id);
    buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.id === id)));
    pending = null;
    draftActions.hidden = true;
    status.textContent = defaultStatus;
  }
  for (const shortcut of TaskboardCopilotPrompts.shortcuts) {
    const button = document.createElement("button");
    button.className = "shortcut";
    button.dataset.id = shortcut.id;
    const title = document.createElement("strong");
    title.textContent = shortcut.title;
    const detail = document.createElement("span");
    detail.textContent = shortcut.detail;
    button.append(title, detail);
    button.addEventListener("click", () => {
      if (busy) return;
      select(shortcut.id);
      void insert();
    });
    root.querySelector(".shortcuts").append(button);
    buttons.push(button);
  }
  function setOpen(open, focus = false) {
    clearNotice();
    panel.hidden = !open;
    toggle.hidden = open;
    toggle.setAttribute("aria-expanded", String(open));
    if (!open && pending) {
      pending = null;
      draftActions.hidden = true;
      status.textContent = defaultStatus;
    }
    if (focus) (open ? busy ? root.querySelector(".close") : buttons[0] : toggle).focus();
  }
  function changeOpen(open, focus = true) {
    interacted = true;
    setOpen(open, focus);
    if (open) refreshGuide();
    void chrome.storage.local.set({ dockOpen: open }).catch(() => {});
  }
  toggle.addEventListener("click", () => changeOpen(true));
  root.querySelector(".close").addEventListener("click", () => changeOpen(false));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (!panel.hidden || !notice.hidden)) {
      event.stopPropagation();
      changeOpen(false);
    }
  });
  function dismissOutside(event) {
    if (!event.isTrusted || event.composedPath().includes(host)) return;
    if (!panel.hidden) changeOpen(false, false);
    else clearNotice();
  }
  document.addEventListener("pointerdown", dismissOutside);
  document.addEventListener("click", dismissOutside);
  document.addEventListener("keydown", (event) => {
    if (!event.isTrusted || event.composedPath().includes(host)) return;
    if (event.key === "Escape") {
      if (!panel.hidden) changeOpen(false, false);
      else clearNotice();
    } else {
      const editor = TaskboardCopilotComposer.findComposer();
      if (editor && (event.target === editor || editor.contains(event.target))) clearNotice();
    }
  });
  document.addEventListener("input", (event) => {
    if (!event.isTrusted || busy) return;
    const editor = TaskboardCopilotComposer.findComposer();
    if (editor && (event.target === editor || editor.contains(event.target))) clearNotice();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) changeOpen(false, false);
  });
  async function insert(approved = null) {
    if (busy) return;
    clearNotice();
    const editor = TaskboardCopilotComposer.findComposer();
    if (!editor) {
      status.textContent = "Copilot’s message box is not ready or cannot be identified. Open a chat and try again, or copy the prompt instead.";
      pending = null;
      draftActions.hidden = true;
      status.scrollIntoView({ block: "nearest" });
      return;
    }
    const current = TaskboardCopilotComposer.snapshot(editor);
    if (approved && (approved.editor !== editor || approved.snapshot !== current || approved.text !== prompt.value)) {
      status.textContent = "The draft or prompt changed. Choose Insert into Copilot again to review replacement.";
      pending = null;
      draftActions.hidden = true;
      status.scrollIntoView({ block: "nearest" });
      return;
    }
    if (!approved && TaskboardCopilotComposer.hasDraft(editor)) {
      pending = { editor, snapshot: current, text: prompt.value };
      draftActions.hidden = false;
      status.textContent = "Copilot already has a draft. Replace it with this prompt, or keep your draft?";
      root.querySelector(".keep").focus();
      return;
    }
    busy = true;
    draftActions.hidden = true;
    const controls = [...buttons, root.querySelector(".insert"), root.querySelector(".replace")];
    controls.forEach((button) => { button.disabled = true; });
    // Close for the user's insertion action, not for the later editor check.
    // Copilot can replace its editor DOM while keeping the inserted draft.
    changeOpen(false, false);
    const revision = feedbackRevision;
    let result;
    try { result = await TaskboardCopilotComposer.insertPrompt(editor, prompt.value, current, () => revision === feedbackRevision); }
    catch { result = { state: "unconfirmed" }; }
    controls.forEach((button) => { button.disabled = false; });
    busy = false;
    pending = null;
    // A closed/reopened panel, typing or an outside click supersedes feedback
    // from an older operation. Its async completion must not resurrect a toast.
    if (revision !== feedbackRevision) return;
    if (result.state === "inserted") {
      status.textContent = "Prompt added. Review and send it in Copilot.";
      showNotice(status.textContent);
    } else {
      const message = result.state === "changed"
        ? "The draft changed before insertion. Your new draft was kept; try again when ready."
        : "Insertion could not be confirmed. Review the message box before trying again, or copy the prompt instead.";
      status.textContent = message;
      showNotice(message, true);
    }
  }
  root.querySelector(".insert").addEventListener("click", () => { void insert(); });
  root.querySelector(".replace").addEventListener("click", () => { if (pending) void insert(pending); });
  root.querySelector(".keep").addEventListener("click", () => {
    pending = null;
    draftActions.hidden = true;
    status.textContent = "Your draft was kept. The shortcut remains in the preview.";
  });
  root.querySelector(".copy-fallback").addEventListener("click", async () => {
    clearNotice();
    const revision = feedbackRevision;
    const text = prompt.value;
    const copy = root.querySelector(".copy-fallback");
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(text);
      if (revision !== feedbackRevision) return;
      status.textContent = "Copied. Paste into Copilot, review, then send.";
      changeOpen(false, false);
      showNotice(status.textContent);
    } catch {
      if (revision !== feedbackRevision) return;
      prompt.focus();
      prompt.select();
      status.textContent = "Clipboard unavailable. Press Ctrl+C (⌘C on Mac) to copy the selected prompt.";
    } finally { copy.disabled = false; }
  });
  select("snapshot");
  refreshGuide();
  void chrome.storage.local.get("dockOpen").then(({ dockOpen }) => {
    if (!interacted) setOpen(dockOpen === true);
  }).catch(() => {});
})();
