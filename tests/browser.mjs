// COPILOT_TEST_REQUIRE_FROM must point to an external package.json with Playwright.
// Run: node tests/browser.mjs. Optional COPILOT_TEST_BROWSER_PATH selects Brave.
// A disposable extension copy pre-grants only the owned HTTPS fixture origin.
// This tests real registration/transfer/revocation, not the native grant dialog.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(process.env.COPILOT_TEST_REQUIRE_FROM || import.meta.url)("playwright");
const root = mkdtempSync(path.join(tmpdir(), "copilot-public-browser-"));
const extension = path.join(root, "extension");
cpSync(fileURLToPath(new URL("../extension/", import.meta.url)), extension, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(extension, "manifest.json"), "utf8"));
assert.equal(manifest.host_permissions, undefined);
manifest.host_permissions = ["https://board.example/*"];
writeFileSync(path.join(extension, "manifest.json"), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(path.join(root, "profile"), {
  headless: true, executablePath: process.env.COPILOT_TEST_BROWSER_PATH || chromium.executablePath(),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const errors = [];
try {
  context.setDefaultTimeout(10000);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).hostname;
  const options = await context.newPage();
  options.on("pageerror", error => errors.push(error.message));
  options.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await options.goto(`chrome-extension://${id}/options.html`);
  assert.equal(await options.title(), "Taskboard Copilot settings");
  await options.locator("#connection[data-state=disconnected]").waitFor();
  assert.equal(await options.getByRole("button", { name: "Disconnect", exact: true }).isDisabled(), true);
  await options.getByLabel("Taskboard website").fill("https://draft.example");
  await worker.evaluate(() => chrome.storage.local.set({ taskboardReviewUrl: "https://board.example/copilot-review" }));
  await options.locator("#connection[data-state=attention]").waitFor();
  assert.equal(await options.getByLabel("Taskboard website").inputValue(), "https://draft.example", "Background settings refresh must preserve an unsaved address");
  await worker.evaluate(() => chrome.storage.local.remove("taskboardReviewUrl"));
  await options.locator("#connection[data-state=disconnected]").waitFor();
  assert.equal(await options.getByLabel("Taskboard website").inputValue(), "https://draft.example");
  await options.getByLabel("Taskboard website").fill("https://board.example");
  await options.evaluate(() => {
    globalThis.fixturePermissions = chrome.permissions.request;
    chrome.permissions.request = async () => false;
  });
  await options.getByRole("button", { name: "Connect Taskboard", exact: true }).click();
  await options.locator("#status").filter({ hasText: "Site access was not granted" }).waitFor();
  await options.locator('button[type="submit"]:not([disabled])').waitFor();
  assert.equal(await options.getByRole("button", { name: "Disconnect", exact: true }).isDisabled(), true);
  assert.equal(await options.getByLabel("Taskboard website").inputValue(), "https://board.example");
  await options.evaluate(() => { chrome.permissions.request = globalThis.fixturePermissions; });
  await options.getByRole("button", { name: "Connect Taskboard", exact: true }).click();
  await options.locator("#connection[data-state=connected]").waitFor();
  await options.locator("#status").filter({ hasText: "Connection saved." }).waitFor();
  assert.equal(await options.locator("[data-connection-label]").textContent(), "Taskboard connected");
  await options.reload();
  await options.locator("#connection[data-state=connected]").waitFor();
  const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.deepEqual(scripts[0].matches, ["https://board.example/*"]);
  const proposal = { type: "taskboard-proposal", version: 1, snapshotId: "abcdef123456", requestId: "public-fixture-1", changes: [{ op: "note", task: "abc12345", text: "Fixture note", reason: "Fixture only" }] };
  const editorMode = process.env.COPILOT_TEST_CODE_EDITOR === "1";
  const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  function editor(value, attrs = 'aria-readonly="true"', skip = -1) {
    const lines = JSON.stringify(value, null, 2).split("\n").map((line, index) => index === skip ? "" : `<div data-line-number="${index + 1}">${index + 1}</div><div data-line-index="${index}">${escape(line)}</div>`).join("");
    return `<div class="scriptor-component-code-block"><div style="height:120px;overflow:hidden"><div role="textbox" aria-label="Code editor" ${attrs}>${lines}</div></div></div>`;
  }
  const code = editorMode ? editor(proposal) : `<pre><code>${JSON.stringify(proposal)}</code></pre>`;
  // Match the observed tenant markup without retaining any account content.
  const negatives = editorMode ? `<section id="negative-candidates">${editor(proposal, 'aria-readonly="false" contenteditable="true"')}${editor(proposal, 'aria-readonly="true"', 2)}${editor({ ...proposal, type: "unrelated" })}${editor({ ...proposal, changes: [{ text: "界".repeat(12000) }] })}<pre contenteditable="true">${JSON.stringify(proposal)}</pre><pre>{"type":"taskboard-proposal"</pre></section>` : "";
  await context.route("https://m365.cloud.microsoft/**", route => route.fulfill({ contentType: "text/html", body: `<h1>Copilot fixture</h1><section id="chosen-proposal">${code}</section>${negatives}<textarea aria-label="Message Copilot">Unsent draft</textarea>` }));
  await context.route("https://board.example/**", route => route.fulfill({ contentType: "text/html", body: '<h1>Review fixture</h1><div id="copilot-review-root" data-copilot-protocol="2"></div><p id="result">Waiting</p><pre id="received"></pre><script>window.addEventListener("message",e=>{if(e.source===window&&e.origin===location.origin&&e.data?.channel==="taskboard-copilot"&&e.data.type==="proposal"){document.getElementById("received").textContent=e.data.proposal;document.getElementById("result").textContent="Received selected proposal";window.fixtureTransfer=e.data}});setInterval(()=>window.postMessage({channel:"taskboard-copilot",type:"ready"},location.origin),100)</script>' }));
  const copilot = await context.newPage();
  copilot.on("pageerror", error => errors.push(error.message));
  await copilot.goto("https://m365.cloud.microsoft/chat");
  const dock = copilot.locator("#taskboard-copilot-prompts");
  const connection = dock.locator("#connection-control");
  const preparation = dock.locator("#connection-preparation");
  await dock.locator('#connection-control[data-connected="true"]').waitFor({ state: "attached" });
  assert.equal(await connection.isVisible(), false, "Connection banner must start inside the closed popup");
  // Refresh connection and Split View state while closed. Neither may reopen it.
  await copilot.bringToFront();
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.storage.session.set({ splitPairs: [{ sourceId: -1, tabId: tab.id }] });
    await chrome.storage.local.set({ dockFixtureRefresh: 1 });
  });
  await preparation.filter({ hasText: "one browser step left" }).waitFor({ state: "attached" });
  assert.equal(await preparation.isVisible(), false);
  for (const [width, height, colorScheme] of [[1280, 780, "light"], [390, 568, "dark"], [320, 568, "light"]]) {
    await copilot.setViewportSize({ width, height });
    await copilot.emulateMedia({ colorScheme });
    await dock.getByRole("button", { name: "Taskboard prompts", exact: true }).click();
    assert.equal(await connection.isVisible(), true);
    assert.equal(await preparation.isVisible(), true);
    const card = await connection.boundingBox();
    const panel = await dock.locator(".panel").boundingBox();
    assert.ok(card.x >= panel.x && card.x + card.width <= panel.x + panel.width, "Connection card must fit inside popup");
    await copilot.screenshot({ path: path.join(root, `dock-open-${width}.png`) });
    await dock.getByRole("button", { name: "Collapse Taskboard prompts", exact: true }).click();
    assert.equal(await connection.isVisible(), false);
    assert.equal(await preparation.isVisible(), false);
    await copilot.screenshot({ path: path.join(root, `dock-closed-${width}.png`) });
    await dock.getByRole("button", { name: "Taskboard prompts", exact: true }).click();
    await dock.getByRole("button", { name: "Collapse Taskboard prompts", exact: true }).press("Escape");
    assert.equal(await connection.isVisible(), false, "Escape must also hide the connection banner");
    assert.equal(await preparation.isVisible(), false);
  }
  await copilot.reload();
  await dock.locator('#connection-control[data-connected="true"]').waitFor({ state: "attached" });
  await dock.getByRole("button", { name: "Taskboard prompts", exact: true }).waitFor();
  assert.equal(await connection.isVisible(), false, "Reload must retain the closed popup without its banner");
  assert.equal(await preparation.isVisible(), false);
  await copilot.setViewportSize({ width: 1280, height: 780 });
  await copilot.emulateMedia({ colorScheme: "light" });
  await worker.evaluate(() => {
    globalThis.fixtureStatusUnavailable = true;
    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (globalThis.fixtureStatusUnavailable && message.type === "taskboard-status") respond(null);
      return false;
    });
    return chrome.storage.local.set({ dockFixtureRefresh: 2 });
  });
  await connection.filter({ hasText: "Connection status unavailable" }).waitFor({ state: "attached" });
  assert.equal(await connection.isVisible(), false, "Failed background refresh must remain inside the closed panel");
  await worker.evaluate(() => {
    globalThis.fixtureStatusUnavailable = false;
    return chrome.storage.local.set({ dockFixtureRefresh: 3 });
  });
  await dock.locator('#connection-control[data-connected="true"]').waitFor({ state: "attached" });
  await dock.locator(".toggle").click();
  await worker.evaluate(() => {
    globalThis.fixtureOpenOptions = chrome.runtime.openOptionsPage;
    chrome.runtime.openOptionsPage = async () => { throw Error("Fixture unavailable"); };
  });
  await connection.click();
  await dock.locator(".status").filter({ hasText: "Settings could not be opened" }).waitFor();
  assert.equal(await dock.locator(".panel").isVisible(), true);
  await worker.evaluate(() => { chrome.runtime.openOptionsPage = globalThis.fixtureOpenOptions; });
  await connection.click();
  await dock.locator(".panel").waitFor({ state: "hidden" });
  await copilot.bringToFront();
  await copilot.getByRole("button", { name: "Review details", exact: true }).waitFor();
  assert.equal(await copilot.getByRole("button", { name: "Review details", exact: true }).count(), 1);
  assert.equal(await copilot.locator("#negative-candidates .taskboard-copilot-proposal-review").count(), 0);
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.session.get("copilotReviewTransfers")).copilotReviewTransfers || {}), {});
  await copilot.getByRole("button", { name: "Review details", exact: true }).evaluate(button => button.click());
  await copilot.getByText("Click this button yourself to authorize the selected action.", { exact: true }).waitFor();
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.session.get("copilotReviewTransfers")).copilotReviewTransfers || {}), {});
  // Exercise streaming edits in place: invalid proposals explain recovery in
  // Copilot, never transfer, and become reviewable once corrected.
  const updateBlock = async value => {
    if (editorMode) {
      const html = JSON.stringify(value, null, 2).split("\n").map((line, index) => `<div data-line-index="${index}">${escape(line)}</div>`).join("");
      await copilot.locator('#chosen-proposal [role="textbox"]').evaluate((el, html) => { el.innerHTML = html; }, html);
    } else await copilot.locator("#chosen-proposal code").evaluate((el, text) => { el.textContent = text; }, JSON.stringify(value));
  };
  for (const [value, message] of [
    [{ ...proposal, changes: [] }, "No task changes were included."],
    [{ ...proposal, changes: Array(21).fill(proposal.changes[0]) }, "This proposal has 21 changes."],
    [{ ...proposal, changes: [{ ...proposal.changes[0], task: "bad" }] }, "Use a task ID from the snapshot."],
  ]) {
    await updateBlock(value);
    await copilot.getByText(message, { exact: false }).waitFor();
    assert.equal(await copilot.getByRole("button", { name: "Review details", exact: true }).count(), 0);
    assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.session.get("copilotReviewTransfers")).copilotReviewTransfers || {}), {});
  }
  await copilot.setViewportSize({ width: 390, height: 568 });
  await copilot.emulateMedia({ colorScheme: "dark" });
  await copilot.screenshot({ path: path.join(root, "invalid-proposal-mobile-dark.png"), fullPage: true });
  await updateBlock(proposal);
  await copilot.getByRole("button", { name: "Review details", exact: true }).waitFor();
  await copilot.setViewportSize({ width: 1280, height: 780 });
  await copilot.emulateMedia({ colorScheme: "light" });
  const proposalShot = path.join(root, `proposal-${editorMode ? "editor" : "legacy"}.png`);
  await copilot.screenshot({ path: proposalShot, fullPage: true });
  const created = context.waitForEvent("page");
  const applyMode = process.env.COPILOT_TEST_INTENT === "apply";
  await copilot.getByRole("button", { name: applyMode ? "Apply 1 change" : "Review details", exact: true }).click();
  const review = await created;
  await review.getByText("Received selected proposal", { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await review.locator("#received").textContent()), proposal);
  assert.equal(await review.evaluate(() => window.fixtureTransfer.intent || "review"), applyMode ? "apply" : "review");
  if (applyMode) await copilot.getByText("Taskboard is checking and applying your changes…", { exact: true }).waitFor();
  await review.evaluate(() => window.postMessage({ channel: "taskboard-copilot", type: "completed", transferId: window.fixtureTransfer.transferId, result: { ok: true, message: "Fixture confirmed the selected action." } }, location.origin));
  await copilot.getByText("Fixture confirmed the selected action.", { exact: true }).waitFor();
  assert.equal(await copilot.getByRole("button", { name: "Apply 1 change", exact: true }).isDisabled(), applyMode);
  assert.equal(new URL(review.url()).origin, "https://board.example");
  assert.equal(new URL(review.url()).searchParams.get("proposal"), null);
  assert.equal(await copilot.getByLabel("Message Copilot").inputValue(), "Unsent draft");
  if (editorMode) {
    const source = copilot.locator('#chosen-proposal [role="textbox"]');
    await source.evaluate(el => el.setAttribute("aria-readonly", "false"));
    await copilot.getByRole("button", { name: "Review details", exact: true }).waitFor({ state: "detached" });
    await source.evaluate(el => el.setAttribute("aria-readonly", "true"));
    await copilot.getByRole("button", { name: "Review details", exact: true }).waitFor();
    await source.locator('[data-line-index="2"]').evaluate(el => el.remove());
    await copilot.getByRole("button", { name: "Review details", exact: true }).waitFor({ state: "detached" });
  }
  await dock.getByRole("button", { name: "Taskboard prompts", exact: true }).click();
  await dock.getByRole("button", { name: "Read snapshot", exact: false }).click();
  await dock.getByRole("button", { name: "Replace draft", exact: true }).waitFor();
  assert.equal(await connection.isVisible(), true, "Draft replacement confirmation stays inside the open popup");
  assert.equal(await copilot.getByLabel("Message Copilot").inputValue(), "Unsent draft");
  await dock.getByRole("button", { name: "Replace draft", exact: true }).click();
  await dock.locator(".notice").filter({ hasText: "Prompt added" }).waitFor();
  assert.equal(await connection.isVisible(), false, "Prompt insertion must close the banner with the popup");
  assert.equal(await preparation.isVisible(), false);
  await options.bringToFront();
  await options.getByRole("button", { name: "Disconnect", exact: true }).click();
  await options.locator("#connection[data-state=disconnected]").waitFor();
  await options.locator('button[type="submit"]:not([disabled])').waitFor();
  assert.equal(await options.getByRole("button", { name: "Disconnect", exact: true }).isDisabled(), true, "Disconnect must remain disabled after a successful disconnect");
  await connection.filter({ hasText: "Taskboard not connected" }).waitFor({ state: "attached" });
  assert.equal(await connection.isVisible(), false, "A background connection change must not reveal the closed banner");
  await dock.getByRole("button", { name: "Taskboard prompts", exact: true }).click();
  await dock.getByRole("button", { name: /Taskboard not connected/ }).waitFor();
  assert.deepEqual(await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()), []);
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.session.get("copilotReviewTransfers")).copilotReviewTransfers), {});
  const evidence = path.join(root, "evidence"); mkdirSync(evidence);
  await options.setViewportSize({ width: 1000, height: 780 });
  await options.screenshot({ path: path.join(evidence, "settings-desktop.png"), fullPage: true });
  await options.setViewportSize({ width: 390, height: 844 });
  await options.emulateMedia({ colorScheme: "dark" });
  await options.screenshot({ path: path.join(evidence, "settings-mobile-dark.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, editorMode, flow: "settings → narrow bridge → trusted proposal transfer → acknowledgement → disconnect", evidence, proposalShot }));
} finally { await context.close(); }
