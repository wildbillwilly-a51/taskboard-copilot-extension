/* global chrome, document, window */
(() => {
  const root = document.getElementById("taskboard-copilot-prompts")?.shadowRoot;
  if (!root || root.getElementById("connection-control")) return;
  const style = document.createElement("style");
  style.textContent = `
    :host { display:flex; flex-direction:column; align-items:flex-end; max-height:calc(100dvh - 88px); }
    .toggle,#connection-control,#connection-preparation { flex-shrink:0; }
    .panel { flex:1 1 auto; min-height:0; max-height:none; }
    .split-guide { display:none !important; }
    #connection-control { display:block; width:min(350px,calc(100vw - 32px)); min-height:56px; margin:8px 0; font:16px/1.4 system-ui,sans-serif; color:inherit; border:1px solid #b18a22; background:#fff7df; }
    #connection-control[data-connected=true] { border-color:#348364; background:#e9f8f0; }
    #connection-control strong { display:block; font-size:16px; }
    #connection-control small { display:block; font-size:14px; overflow-wrap:anywhere; margin-top:3px; }
    #connection-preparation { box-sizing:border-box; width:min(350px,calc(100vw - 32px)); padding:12px; font:14px/1.45 system-ui,sans-serif; background:#edf3ff; border:1px solid #7796d7; border-radius:10px; }
    @media(prefers-color-scheme:dark) { #connection-control { background:#3d341c; border-color:#d2af54; } #connection-control[data-connected=true] { background:#163d30; border-color:#64bc94; } #connection-preparation { background:#293c60; } }
  `;
  const control = document.createElement("button");
  control.id = "connection-control";
  control.innerHTML = "<strong>Checking Taskboard…</strong><small>Connection settings</small>";
  root.querySelector(".toggle").after(control);
  const preparation = document.createElement("p");
  preparation.id = "connection-preparation";
  preparation.hidden = true;
  preparation.setAttribute("role", "status");
  control.after(preparation);
  root.append(style);
  control.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "open-taskboard-settings" }).catch(() => {});
  });
  async function refresh() {
    const state = await chrome.runtime.sendMessage({ type: "taskboard-status" });
    if (!state?.label) return;
    control.dataset.connected = String(state.connected);
    control.querySelector("strong").textContent = `${state.connected ? "✓" : "!"} ${state.label}`;
    control.querySelector("small").textContent = state.site || "Connect Taskboard · open Settings";
    control.title = `${state.detail} Open connection settings.`;
    const result = await chrome.runtime.sendMessage({ type: "split-guide" });
    preparation.textContent = result?.guide || "";
    preparation.hidden = !result?.guide;
  }
  void refresh().catch(() => {});
  chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") void refresh().catch(() => {}); });
  window.addEventListener("focus", () => { void refresh().catch(() => {}); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh().catch(() => {}); });
})();
