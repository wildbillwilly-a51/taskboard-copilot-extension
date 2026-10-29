/* global globalThis, document, setTimeout */
(() => {
  function ready(element) {
    if (!element?.isConnected || element.disabled || element.readOnly || element.matches(":disabled") ||
      element.getAttribute("aria-disabled") === "true" || element.getAttribute("aria-readonly") === "true") return false;
    if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return element.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function findComposer(doc = document) {
    const candidates = [];
    for (const element of doc.querySelectorAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) {
      if (!ready(element) || element.parentElement?.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')) continue;
      const labelledBy = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent ?? "").join(" ");
      const hint = [element.id, element.getAttribute("aria-label"), element.getAttribute("placeholder"),
        element.getAttribute("data-placeholder"), element.getAttribute("data-testid"), labelledBy,
        ...Array.from(element.labels ?? [], (label) => label.textContent)].filter(Boolean).join(" ");
      if (/search|feedback|rename|comment|conversation title/i.test(hint)) continue;
      const known = element.id === "m365-chat-editor-target-element";
      const message = /copilot|message|prompt|ask|chat[-_ ]?(?:input|editor|composer)/i.test(hint);
      if (known || message) candidates.push({ element, score: known ? 100 : 50 });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length || candidates[0].score === candidates[1]?.score) return null;
    return candidates[0].element;
  }

  function draftText(element) {
    return element.tagName === "TEXTAREA" ? element.value : element.innerText;
  }

  function snapshot(element) {
    return element.tagName === "TEXTAREA" ? element.value : element.innerHTML;
  }

  function hasDraft(element) {
    return Boolean(draftText(element).replace(/[\s\u200b]/g, "")) ||
      Boolean(element.querySelector('[contenteditable="false"], img, video, audio, [data-lexical-decorator]'));
  }

  const canonical = (value) => value.replace(/[\s\u200b]+/g, " ").trim();
  const pause = () => new Promise((resolve) => setTimeout(resolve, 60));

  async function insertPrompt(element, text, expectedSnapshot, canFocus = () => true, appendText = "") {
    if (!ready(element)) return { state: "unavailable" };
    if (snapshot(element) !== expectedSnapshot) return { state: "changed" };
    const doc = element.ownerDocument;
    const win = doc.defaultView;
    const selectContents = (target = element) => {
      target.focus();
      const range = doc.createRange();
      range.selectNodeContents(target);
      if (appendText) range.collapse(false);
      const selection = win.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const matches = (target) => ready(target) && canonical(draftText(target)) === canonical(text);
    try {
      if (element.tagName === "TEXTAREA") {
        // Use the native setter so controlled inputs observe the subsequent input
        // event. Never invoke form submission, Send, or an Enter key event.
        const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, "value").set;
        setter.call(element, text);
        element.dispatchEvent(new win.InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText", data: text }));
      } else {
        // Rich editors own their model. Let their paste handler insert plain
        // text rather than assigning innerHTML/textContent behind their back.
        selectContents();
        // Model editors consume selectionchange asynchronously. Let the native
        // select-all reach their model before pasting, then recheck the draft.
        await pause();
        if (!ready(element)) return { state: "unavailable" };
        if (snapshot(element) !== expectedSnapshot) return { state: "changed" };
        const transfer = new win.DataTransfer();
        transfer.setData("text/plain", appendText || text);
        const paste = new win.ClipboardEvent("paste", { bubbles: true, cancelable: true, composed: true, clipboardData: transfer });
        element.dispatchEvent(paste);
        await pause();
        if (!matches(element) && !paste.defaultPrevented && ready(element) && findComposer(doc) === element && snapshot(element) === expectedSnapshot) {
          // Plain contenteditables have no paste handler for synthetic events.
          // Chromium's editing command preserves native input/undo behavior.
          selectContents();
          doc.execCommand("insertText", false, appendText || text);
        }
      }
      // Copilot can replace the editor after handling paste/input. Reacquire
      // only its unique visible composer and verify the complete text twice.
      // Never retry insertion into a replacement or overwrite a changed draft.
      let consecutiveMatches = 0;
      for (let attempt = 0; attempt < 10; attempt++) {
        await pause();
        const current = findComposer(doc);
        if (matches(current)) {
          consecutiveMatches++;
        } else {
          consecutiveMatches = 0;
        }
        if (consecutiveMatches >= 2) {
          if (!canFocus()) return { state: "inserted" };
          current.focus();
          if (current.tagName === "TEXTAREA") current.setSelectionRange(current.value.length, current.value.length);
          else {
            selectContents(current);
            win.getSelection().collapseToEnd();
          }
          current.scrollIntoView({ block: "nearest" });
          return { state: "inserted" };
        }
      }
      return { state: "unconfirmed" };
    } catch {
      return { state: "unconfirmed" };
    }
  }
  function appendContext(element, context, expectedSnapshot) {
    const suffix = `\n\n${context}`;
    return insertPrompt(element, draftText(element) + suffix, expectedSnapshot, () => false, suffix);
  }
  globalThis.TaskboardCopilotComposer = { findComposer, snapshot, hasDraft, insertPrompt, draftText, appendContext };
})();
