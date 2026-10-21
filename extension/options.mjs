/* global chrome, document */
import { reviewTarget } from "./target.mjs";
import { showConnection } from "./connection-view.mjs";
const input = document.querySelector("#address");
const status = document.querySelector("#status");
const buttons = [...document.querySelectorAll("button")];
const busy = value => buttons.forEach(button => { button.disabled = value; });
async function load() {
  const { taskboardReviewUrl } = await chrome.storage.local.get("taskboardReviewUrl");
  input.value = taskboardReviewUrl ? new URL(taskboardReviewUrl).origin : "";
  const state = await chrome.runtime.sendMessage({ type: "taskboard-status" });
  if (!state?.label) throw Error("Connection status is unavailable. Reload the extension.");
  showConnection(document.querySelector("#connection"), state);
  status.textContent = state.connected ? "Connection saved. Refresh your Taskboard and Copilot tabs." : state.detail;
  document.querySelector("#disconnect").disabled = !taskboardReviewUrl;
}
document.querySelector("#setup").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const target = reviewTarget(input.value.trim());
    // Request directly from this user gesture, before any other async work.
    const permission = chrome.permissions.request({ origins: [target.origin] });
    busy(true);
    if (!await permission) throw Error("Site access was not granted. Taskboard was not connected.");
    const result = await chrome.runtime.sendMessage({ type: "configure-taskboard", url: target.url });
    if (!result?.ok) throw Error(result?.error || "The connection could not be saved.");
    await load();
  } catch (error) { status.textContent = error.message; }
  finally { busy(false); }
});
document.querySelector("#disconnect").addEventListener("click", async () => {
  busy(true);
  try {
    const result = await chrome.runtime.sendMessage({ type: "disconnect-taskboard" });
    if (!result?.ok) throw Error(result?.error || "The connection could not be removed.");
    await load();
  } catch (error) { status.textContent = error.message; }
  finally { busy(false); }
});
void load().catch(() => { status.textContent = "Settings could not be loaded. Reopen this page."; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.taskboardReviewUrl) void load().catch(() => {});
});
