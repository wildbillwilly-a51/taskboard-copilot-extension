/* global chrome, document */
import { reviewTarget } from "./target.mjs";
import { showConnection } from "./connection-view.mjs";
const input = document.querySelector("#address");
const status = document.querySelector("#status");
const buttons = [...document.querySelectorAll("button")];
let pending = false;
let configured = false;
let dirty = false;
let actionError = "";
let loadRevision = 0;
const busy = value => {
  pending = value;
  buttons.forEach(button => { button.disabled = value; });
  input.disabled = value;
  document.querySelector("#disconnect").disabled = value || !configured;
};
async function load(replaceInput = false) {
  const revision = ++loadRevision;
  const { taskboardReviewUrl } = await chrome.storage.local.get("taskboardReviewUrl");
  const state = await chrome.runtime.sendMessage({ type: "taskboard-status" });
  if (revision !== loadRevision) return;
  if (!state?.label) throw Error("Connection status is unavailable. Reload the extension.");
  configured = Boolean(taskboardReviewUrl);
  if (replaceInput || !dirty) {
    input.value = taskboardReviewUrl ? new URL(taskboardReviewUrl).origin : "";
    dirty = false;
  }
  showConnection(document.querySelector("#connection"), state);
  status.textContent = actionError || (dirty ? "Unsaved address. Choose Connect Taskboard to save it." : state.connected ? "Connection saved. Refresh your Taskboard and Copilot tabs." : state.detail);
  busy(pending);
}
input.addEventListener("input", () => {
  dirty = true;
  actionError = "";
  status.textContent = "Unsaved address. Choose Connect Taskboard to save it.";
});
document.querySelector("#setup").addEventListener("submit", async event => {
  event.preventDefault();
  actionError = "";
  try {
    const target = reviewTarget(input.value.trim());
    // Request directly from this user gesture, before any other async work.
    const permission = chrome.permissions.request({ origins: [target.origin] });
    busy(true);
    if (!await permission) throw Error("Site access was not granted. Taskboard was not connected.");
    const result = await chrome.runtime.sendMessage({ type: "configure-taskboard", url: target.url });
    if (!result?.ok) throw Error(result?.error || "The connection could not be saved.");
    dirty = false;
    await load(true);
  } catch (error) { actionError = error.message; status.textContent = actionError; }
  finally { busy(false); }
});
document.querySelector("#disconnect").addEventListener("click", async () => {
  actionError = "";
  busy(true);
  try {
    const result = await chrome.runtime.sendMessage({ type: "disconnect-taskboard" });
    if (!result?.ok) throw Error(result?.error || "The connection could not be removed.");
    dirty = false;
    await load(true);
  } catch (error) { actionError = error.message; status.textContent = actionError; }
  finally { busy(false); }
});
void load().catch(() => { status.textContent = "Settings could not be loaded. Reopen this page."; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.taskboardReviewUrl) void load().catch(() => {});
});
