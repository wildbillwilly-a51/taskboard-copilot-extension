/* global chrome, document, window, TaskboardCopilotPrompts, TaskboardCopilotComposer */
(() => {
  // This is a send-time adapter for the user's current request. It never reads
  // responses, queues follow-up prompts or initiates a send on load/input.
  const fixedConnection = false;
  const composer = TaskboardCopilotComposer;
  let busy = false;
  let cancelled = false;
  const feedback = message => globalThis.TaskboardCopilotFeedback?.(message);
  const sendButton = target => {
    const button = target?.closest?.('button');
    if (!button || button.disabled || !button.getClientRects().length) return null;
    const name = button.getAttribute('aria-label') || button.textContent.trim();
    return /^send(?: message)?$/i.test(name) ? button : null;
  };
  const ownsSend = (element, button) => {
    // Copilot's observed Send shares its composer container within two parents.
    // An unrelated Send in a generated mail card/modal must remain untouched.
    for (let scope = button?.parentElement, depth = 0; scope && scope !== document.body && depth < 3; scope = scope.parentElement, depth++) {
      if (scope.contains(element)) return true;
    }
    return false;
  };
  const liveSendButton = element => {
    const candidates = Array.from(document.querySelectorAll('button'))
      .map(button => sendButton(button))
      .filter(button => button && ownsSend(element, button));
    return candidates.length === 1 ? candidates[0] : null;
  };
  async function guide(element, continueSend) {
    if (busy) return;
    busy = true; cancelled = false;
    const url = window.location.href;
    const before = composer.snapshot(element);
    try {
      let timeout;
      let connected;
      try {
        connected = fixedConnection || (await Promise.race([
          chrome.runtime.sendMessage({ type: 'taskboard-status' }),
          new Promise((_, reject) => { timeout = window.setTimeout(() => reject(Error('Taskboard connection could not be checked. Your message was not sent; refresh Copilot and retry.')), 3000); }),
        ]))?.connected;
      } finally { window.clearTimeout(timeout); }
      if (!connected) throw Error('Connect Taskboard in extension Settings before sending a Taskboard request. Your message has not been sent.');
      if (url !== window.location.href || cancelled || composer.findComposer() !== element || composer.snapshot(element) !== before) throw Error('Your chat or draft changed. Review the message and press Send when ready.');
      const result = await composer.appendContext(element, TaskboardCopilotPrompts.buildContext(), before);
      if (result.state !== 'inserted' || url !== window.location.href || cancelled) throw Error('Taskboard instructions could not be confirmed. Your message was not sent; review the draft before retrying.');
      const current = composer.findComposer();
      if (!current || !composer.draftText(current).includes('[Taskboard request instructions]') || !composer.draftText(current).includes('[/Taskboard request instructions]')) throw Error('The message box changed. Review your draft before sending.');
      // Exactly one continuation of the trusted Send action, immediately after
      // verified insertion. No delayed retry or separate setup message.
      continueSend(current);
    } catch (error) { feedback(error.message || 'Taskboard could not prepare this request. Your message was not sent.'); }
    finally { busy = false; }
  }
  document.addEventListener('pointerdown', event => {
    if (busy && event.isTrusted && !ownsSend(composer.findComposer(), sendButton(event.target))) cancelled = true;
  }, true);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (busy && area === 'local' && changes.taskboardReviewUrl) cancelled = true;
  });
  document.addEventListener('keydown', event => {
    if (busy && event.isTrusted && event.key === 'Escape') cancelled = true;
    if (!event.isTrusted || event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    const element = composer.findComposer();
    if (!element || !element.contains(event.target) || !busy && !TaskboardCopilotPrompts.needsContext(composer.draftText(element))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const init = { key: event.key, code: event.code, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, shiftKey: event.shiftKey, bubbles: true, cancelable: true, composed: true };
    void guide(element, current => {
      // Preserve Copilot's own Enter/Ctrl+Enter preference. Do not turn a
      // newline shortcut into a click on Send.
      current.dispatchEvent(new window.KeyboardEvent('keydown', init));
    });
  }, true);
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const button = sendButton(event.target);
    const element = composer.findComposer();
    if (!button || !element || !ownsSend(element, button) || !busy && !TaskboardCopilotPrompts.needsContext(composer.draftText(element))) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void guide(element, current => {
      const liveButton = liveSendButton(current);
      if (!liveButton) throw Error('The Send control changed. Your prepared message is still in the draft.');
      liveButton.click();
    });
  }, true);
})();
