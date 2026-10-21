// Real native action-popup QA. The example site is pre-granted only in a test copy.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(process.env.COPILOT_TEST_REQUIRE_FROM || import.meta.url)("playwright");
const root = mkdtempSync(path.join(tmpdir(), "copilot-launcher-qa-"));
const extension = path.join(root, "extension");
cpSync(fileURLToPath(new URL("../extension/", import.meta.url)), extension, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(extension, "manifest.json"), "utf8"));
manifest.host_permissions = ["https://board.example/*"];
writeFileSync(path.join(extension, "manifest.json"), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(path.join(root, "profile"), { headless: true, executablePath: process.env.COPILOT_TEST_BROWSER_PATH || chromium.executablePath(), args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let n = 0; n < 100; n++) { const value = await check(); if (value) return value; await delay(50); } throw Error("UI state did not appear"); }
async function attach(client, targetId) {
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: false });
  let sequence = 0; const pending = new Map(), events = new Map();
  client.on("Target.receivedMessageFromTarget", event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.method) { events.get(message.method)?.(message.params); return; }
    const request = pending.get(message.id);
    if (!request) return; pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(Error(message.error.message)); else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject, timer: setTimeout(() => { pending.delete(id); reject(Error("CDP timed out: " + method)); }, 10000) });
    void client.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  return { send, evaluate, on(method, callback) { events.set(method, callback); } };
}
try {
  context.setDefaultTimeout(10000);
  await context.route("https://board.example/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Taskboard fixture</h1>" }));
  await context.route("https://m365.cloud.microsoft/**", route => route.fulfill({ contentType: "text/html", body: '<h1>Copilot fixture</h1><textarea aria-label="Message Copilot"></textarea>' }));
  const source = context.pages()[0];
  await source.goto("https://board.example/");
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).hostname;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByLabel("Taskboard website").fill("https://board.example");
  await options.getByRole("button", { name: "Connect Taskboard", exact: true }).click();
  await options.locator("#connection[data-state=connected]").waitFor();
  const optionsBox = await options.locator("#connection").boundingBox();
  assert.ok(optionsBox.y < 200, "Connected confirmation must be near the top");
  await options.screenshot({ path: path.join(root, "settings-connected.png"), fullPage: true });
  const sourceTab = await worker.evaluate(async () => (await chrome.tabs.query({})).find(tab => tab.url === "https://board.example/"));
  await worker.evaluate(async tab => { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }, sourceTab);
  await source.bringToFront();
  const client = await context.newCDPSession(source);
  await worker.evaluate(windowId => chrome.action.openPopup({ windowId }), sourceTab.windowId);
  const target = await until(async () => (await client.send("Target.getTargets")).targetInfos.find(item => item.url.endsWith("/launcher.html")));
  const popup = await attach(client, target.targetId);
  await until(() => popup.evaluate('document.querySelector("#connection").dataset.state === "connected" && !document.querySelector("#split").disabled'));
  const metrics = await popup.evaluate('({body:parseFloat(getComputedStyle(document.body).fontSize),settings:parseFloat(getComputedStyle(document.querySelector("#settings")).fontSize),label:document.querySelector("#settings").textContent,bottom:document.querySelector("#settings").getBoundingClientRect().bottom,height:innerHeight,split:document.querySelector("#split-label").textContent,site:document.querySelector("[data-connection-site]").textContent})');
  assert.ok(metrics.body >= 16 && metrics.settings >= 16, JSON.stringify(metrics));
  assert.ok(metrics.bottom <= metrics.height, "Connection button must be visible in native popup");
  assert.equal(metrics.label, "Manage Taskboard connection");
  assert.equal(metrics.site, "board.example");
  const automatic = await worker.evaluate(() => typeof chrome.tabs.createSplit === "function");
  assert.equal(metrics.split, automatic ? "Open Split View" : "Prepare Split View");
  for (const theme of ["light", "dark"]) {
    await popup.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    const shot = await popup.send("Page.captureScreenshot"); writeFileSync(path.join(root, `native-popup-${theme}.png`), Buffer.from(shot.data, "base64"));
  }
  await popup.evaluate('globalThis.fixtureSavePreference = chrome.storage.local.set; chrome.storage.local.set = async () => { throw Error("Fixture save failure"); }; document.querySelector("#preferred").value = "popup"; document.querySelector("#preferred").dispatchEvent(new Event("change", {bubbles:true}));');
  await until(() => popup.evaluate('document.querySelector("#status").textContent.includes("Preference could not be saved") && !document.querySelector("#preferred").disabled'));
  assert.equal(await popup.evaluate('document.querySelector("#preferred").value'), "split");
  await popup.evaluate('chrome.storage.local.set = globalThis.fixtureSavePreference; document.querySelector("#preferred").value = "popup"; document.querySelector("#preferred").dispatchEvent(new Event("change", {bubbles:true}));');
  await until(() => popup.evaluate('document.querySelector("#status").textContent === "Keyboard shortcut preference saved."'));
  assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get("preferredMode")).preferredMode), "popup");
  await popup.evaluate('globalThis.fixtureOpenOptions = chrome.runtime.openOptionsPage; chrome.runtime.openOptionsPage = async () => { throw Error("Fixture unavailable"); }; document.querySelector("#settings").click();');
  await until(() => popup.evaluate('document.querySelector("#status").textContent.includes("Settings could not be opened")'));
  await popup.evaluate('chrome.runtime.openOptionsPage = globalThis.fixtureOpenOptions;');
  const position = await popup.evaluate('(()=>{const r=document.querySelector("#split").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await popup.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...position });
  await popup.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...position });
  if (!automatic) {
    await until(async () => (await worker.evaluate(() => chrome.tabs.query({ highlighted: true, windowType: "normal" }))).length === 2);
    assert.equal((await worker.evaluate(() => chrome.windows.getAll({ windowTypes: ["normal"] }))).length, 1);
  }
  // Browser-created tabs can be absent from Playwright's page inventory too.
  const copilotTarget = await until(async () => (await client.send("Target.getTargets")).targetInfos.find(item => item.type === "page" && /https:\/\/(m365\.cloud\.microsoft|login\.microsoftonline\.com)\//.test(item.url)));
  const copilot = await attach(client, copilotTarget.targetId);
  copilot.on("Fetch.requestPaused", event => {
    void copilot.send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html" }], body: Buffer.from('<h1>Copilot fixture</h1><textarea aria-label="Message Copilot"></textarea>').toString("base64") });
  });
  await copilot.send("Fetch.enable", { patterns: [{ urlPattern: "https://m365.cloud.microsoft/*", resourceType: "Document" }] });
  await copilot.send("Page.navigate", { url: "https://m365.cloud.microsoft/chat" });
  await until(() => copilot.evaluate('document.getElementById("taskboard-copilot-prompts")?.shadowRoot?.getElementById("connection-control")?.dataset.connected === "true"'));
  if (!automatic) {
    await until(() => copilot.evaluate('document.getElementById("taskboard-copilot-prompts").shadowRoot.getElementById("connection-preparation").textContent.includes("one browser step left")'));
  }
  await copilot.evaluate('document.getElementById("taskboard-copilot-prompts").shadowRoot.querySelector(".toggle").click()');
  const dockShot = await copilot.send("Page.captureScreenshot");
  writeFileSync(path.join(root, "copilot-connected-dock.png"), Buffer.from(dockShot.data, "base64"));
  console.log(JSON.stringify({ passed: true, nativePopup: true, automaticSplit: automatic, metrics, evidence: root }));
} finally { await context.close(); }
