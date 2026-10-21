/* global chrome, document, window */
import { showConnection } from "./connection-view.mjs";
const status = document.querySelector("#status");
const preferred = document.querySelector("#preferred");
const modes = [...document.querySelectorAll(".mode")];
const automatic = typeof chrome.tabs.createSplit === "function";
const guide = document.querySelector("#split-instructions");
const capability = document.querySelector("#capability");
const settings = document.querySelector("#settings");
let source;
function busy(value) { modes.forEach(button => { button.disabled = value; }); preferred.disabled = value; }
async function connection() {
  const state = await chrome.runtime.sendMessage({ type: "taskboard-status" });
  if (!state?.label) throw Error("Connection status is unavailable. Reload the extension.");
  showConnection(document.querySelector("#connection"), state);
  settings.textContent = state.connected ? "Manage Taskboard connection" : "Connect Taskboard";
}
settings.addEventListener("click", () => { void chrome.runtime.openOptionsPage(); });
document.querySelector("#split-label").textContent = automatic ? "Open Split View" : "Prepare Split View";
document.querySelector("#split-detail").textContent = automatic ? "Pair Taskboard and Copilot in one browser window." : "Select both tabs; finish with right-click → New Split View.";
guide.hidden = true;
capability.textContent = "This browser cannot pair tabs automatically through extensions. After preparing, right-click either selected tab and choose New Split View.";
try {
  [source] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { preferredMode = "split" } = await chrome.storage.local.get("preferredMode");
  preferred.value = preferredMode === "popup" ? "popup" : "split";
  if (!source) throw Error("Open the extension from your Taskboard tab.");
  busy(false);
} catch (error) { status.textContent = error.message; }
void connection().catch(error => { status.textContent = error.message; });
chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") void connection().catch(() => {}); });
preferred.addEventListener("change", () => { void chrome.storage.local.set({ preferredMode: preferred.value }); });
for (const button of modes) button.addEventListener("click", async () => {
  busy(true);
  status.textContent = "Opening Copilot…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "open-copilot", mode: button.id, tabId: source.id });
    if (!result?.ok) throw Error(result?.error || "Copilot could not be opened.");
    if (result.mode === "popup" || result.automatic) window.close();
    else {
      guide.hidden = false;
      document.querySelector("#split-step-title").textContent = "Tabs prepared — one step left";
      capability.textContent = "Right-click either selected tab and choose New Split View. Then drag the divider to resize.";
      status.textContent = result.detail || "Taskboard and Copilot are selected in this window.";
    }
  } catch (error) { status.textContent = error.message; }
  finally { busy(false); }
});
