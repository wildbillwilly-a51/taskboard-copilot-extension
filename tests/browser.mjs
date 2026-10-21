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
  await options.getByLabel("Taskboard website").fill("https://board.example");
  await options.getByRole("button", { name: "Connect Taskboard", exact: true }).click();
  await options.locator("#connection[data-state=connected]").waitFor();
  assert.equal(await options.locator("[data-connection-label]").textContent(), "Taskboard connected");
  await options.reload();
  await options.locator("#connection[data-state=connected]").waitFor();
  const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  assert.deepEqual(scripts[0].matches, ["https://board.example/copilot-review*"]);
  const proposal = { type: "taskboard-proposal", version: 1, snapshotId: "abcdef123456", requestId: "public-fixture-1", changes: [{ op: "note", task: "abc123", text: "Fixture note", reason: "Fixture only" }] };
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
  await context.route("https://board.example/**", route => route.fulfill({ contentType: "text/html", body: '<h1>Review fixture</h1><div id="copilot-review-root"></div><p id="result">Waiting</p><pre id="received"></pre><script>window.addEventListener("message",e=>{if(e.source===window&&e.origin===location.origin&&e.data?.channel==="taskboard-copilot"&&e.data.type==="proposal"){document.getElementById("received").textContent=e.data.proposal;document.getElementById("result").textContent="Received selected proposal";window.postMessage({channel:"taskboard-copilot",type:"received",transferId:e.data.transferId},location.origin)}});setInterval(()=>window.postMessage({channel:"taskboard-copilot",type:"ready"},location.origin),100)</script>' }));
  const copilot = await context.newPage();
  copilot.on("pageerror", error => errors.push(error.message));
  await copilot.goto("https://m365.cloud.microsoft/chat");
  await copilot.locator("#taskboard-copilot-prompts").getByRole("button", { name: /Taskboard connected/ }).waitFor();
  await copilot.getByRole("button", { name: "Review changes in Taskboard", exact: true }).waitFor();
  assert.equal(await copilot.getByRole("button", { name: "Review changes in Taskboard", exact: true }).count(), 1);
  assert.equal(await copilot.locator("#negative-candidates .taskboard-copilot-proposal-review").count(), 0);
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.session.get("copilotReviewTransfers")).copilotReviewTransfers || {}), {});
  await copilot.getByRole("button", { name: "Review changes in Taskboard", exact: true }).evaluate(button => button.click());
  await copilot.getByText("Click this button yourself to transfer the proposal.", { exact: true }).waitFor();
  assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.session.get("copilotReviewTransfers")).copilotReviewTransfers || {}), {});
  const proposalShot = path.join(root, `proposal-${editorMode ? "editor" : "legacy"}.png`);
  await copilot.screenshot({ path: proposalShot, fullPage: true });
  const created = context.waitForEvent("page");
  await copilot.getByRole("button", { name: "Review changes in Taskboard", exact: true }).click();
  const review = await created;
  await review.getByText("Received selected proposal", { exact: true }).waitFor();
  assert.deepEqual(JSON.parse(await review.locator("#received").textContent()), proposal);
  assert.equal(new URL(review.url()).origin, "https://board.example");
  assert.equal(new URL(review.url()).searchParams.get("proposal"), null);
  assert.equal(await copilot.getByLabel("Message Copilot").inputValue(), "Unsent draft");
  if (editorMode) {
    const source = copilot.locator('#chosen-proposal [role="textbox"]');
    await source.evaluate(el => el.setAttribute("aria-readonly", "false"));
    await copilot.getByRole("button", { name: "Review changes in Taskboard", exact: true }).waitFor({ state: "detached" });
    await source.evaluate(el => el.setAttribute("aria-readonly", "true"));
    await copilot.getByRole("button", { name: "Review changes in Taskboard", exact: true }).waitFor();
    await source.locator('[data-line-index="2"]').evaluate(el => el.remove());
    await copilot.getByRole("button", { name: "Review changes in Taskboard", exact: true }).waitFor({ state: "detached" });
  }
  await options.bringToFront();
  await options.getByRole("button", { name: "Disconnect", exact: true }).click();
  await options.locator("#connection[data-state=disconnected]").waitFor();
  await copilot.locator("#taskboard-copilot-prompts").getByRole("button", { name: /Taskboard not connected/ }).waitFor();
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
