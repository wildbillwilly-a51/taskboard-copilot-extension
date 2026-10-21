/* global chrome, document, window */
import { SPLIT_GUIDE } from "./host-controller.mjs";
const status = document.querySelector("#status");
const preferred = document.querySelector("#preferred");
const buttons = [...document.querySelectorAll("button")];
const automatic = typeof chrome.tabs.createSplit === "function";
document.querySelector("#capability").textContent = automatic
  ? "Split View can pair the tabs automatically in this browser."
  : "Split View needs one tab-menu step in this browser. We prepare and select the two tabs; right-click either and choose New Split View.";
let source;
function busy(value) { buttons.forEach((button) => { button.disabled = value; }); preferred.disabled = value; }
try {
  [source] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { preferredMode = "split" } = await chrome.storage.local.get("preferredMode");
  preferred.value = preferredMode === "popup" ? "popup" : "split";
  if (!source) throw new Error("Open the extension from your Taskboard tab.");
  status.textContent = "";
  busy(false);
} catch (error) { status.textContent = error.message; }
preferred.addEventListener("change", () => {
  void chrome.storage.local.set({ preferredMode: preferred.value }).then(() => {
    status.textContent = "Keyboard preference saved.";
  }, () => { status.textContent = "Preference could not be saved. Try again."; });
});
for (const button of buttons) button.addEventListener("click", async () => {
  busy(true);
  status.textContent = button.id === "split" && !automatic ? SPLIT_GUIDE : "Opening Copilot…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "open-copilot", mode: button.id, tabId: source.id });
    if (!result?.ok) throw new Error(result?.error || "Copilot could not be opened. Try again.");
    if (result.mode === "popup" || result.automatic) window.close();
    else status.textContent = [result.detail, result.guide].filter(Boolean).join(" ");
  } catch (error) { status.textContent = error.message; }
  finally { busy(false); }
});
