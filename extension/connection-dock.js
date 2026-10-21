/* global chrome, document, window */
(() => {
  const root = document.getElementById("taskboard-copilot-prompts")?.shadowRoot;
  const body = root?.querySelector(".panel .body");
  if (!body || root.getElementById("connection-control")) return;
  const style = document.createElement("style");
  style.textContent = `
    :host { display:flex; flex-direction:column; align-items:flex-end; max-height:calc(100dvh - 88px); }
    .toggle { flex-shrink:0; }
    .panel { flex:1 1 auto; min-height:0; max-height:none; }
    .split-guide { display:none !important; }
    #connection-control { display:block; width:100%; min-height:56px; margin:0 0 12px; font:16px/1.4 system-ui,sans-serif; color:inherit; border:1px solid #b18a22; background:#fff7df; }
    #connection-control[data-connected=true] { border-color:#348364; background:#e9f8f0; }
    #connection-control strong { display:block; font-size:16px; }
    #connection-control small { display:block; font-size:14px; overflow-wrap:anywhere; margin-top:3px; }
    #connection-preparation { box-sizing:border-box; width:100%; padding:12px; font:14px/1.45 system-ui,sans-serif; background:#edf3ff; border:1px solid #7796d7; border-radius:10px; }
    @media(prefers-color-scheme:dark) { #connection-control { background:#3d341c; border-color:#d2af54; } #connection-control[data-connected=true] { background:#163d30; border-color:#64bc94; } #connection-preparation { background:#293c60; } }
  `;
  const control = document.createElement("button");
  control.id = "connection-control";
  control.innerHTML = "<strong>Checking Taskboard…</strong><small>Connection settings</small>";
  // Keep status and guidance in the panel's scroll body. Its existing close,
  // Escape and insertion paths then hide them together, including on refresh.
  body.prepend(control);
  const preparation = document.createElement("p");
  preparation.id = "connection-preparation";
  preparation.hidden = true;
  preparation.setAttribute("role", "status");
  control.after(preparation);
  root.append(style);
  control.addEventListener("click", async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: "open-taskboard-settings" });
      if (!result?.ok) throw Error("Settings unavailable");
      root.querySelector(".close").click();
    } catch {
      const status = root.querySelector(".status");
      status.textContent = "Settings could not be opened. Try again or open the extension's options from your browser.";
      status.scrollIntoView({ block: "nearest" });
    }
  });
  let refreshRevision = 0;
  async function refresh() {
    const revision = ++refreshRevision;
    try {
      const state = await chrome.runtime.sendMessage({ type: "taskboard-status" });
      if (revision !== refreshRevision) return;
      if (!state?.label) throw Error("Status unavailable");
      control.dataset.connected = String(state.connected);
      control.querySelector("strong").textContent = `${state.connected ? "✓" : "!"} ${state.label}`;
      control.querySelector("small").textContent = state.site || "Connect Taskboard · open Settings";
      control.title = `${state.detail} Open connection settings.`;
      const result = await chrome.runtime.sendMessage({ type: "split-guide" }).catch(() => null);
      if (revision !== refreshRevision) return;
      preparation.textContent = result?.guide || "";
      preparation.hidden = !result?.guide;
    } catch {
      if (revision !== refreshRevision) return;
      control.dataset.connected = "false";
      control.querySelector("strong").textContent = "! Connection status unavailable";
      control.querySelector("small").textContent = "Reload the extension and refresh Copilot, then try again.";
      control.title = "Connection status could not be checked.";
      preparation.hidden = true;
    }
  }
  void refresh().catch(() => {});
  chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") void refresh().catch(() => {}); });
  window.addEventListener("focus", () => { void refresh().catch(() => {}); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh().catch(() => {}); });
})();
