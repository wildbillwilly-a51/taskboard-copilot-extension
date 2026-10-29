import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(process.env.COPILOT_TEST_REQUIRE_FROM || import.meta.url)("playwright");
const extension = fileURLToPath(new URL("../extension/", import.meta.url));

test("proposal card leads with titles, hierarchy and reasons", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      globalThis.chrome = { runtime: { sendMessage: async () => ({ ok: true, transferId: "transfer" }), onMessage: { addListener() {} } } };
    });
    const proposal = { type: "taskboard-proposal", version: 1, snapshotId: "abcdef123456", requestId: "card-test-1", changes: [
      { op: "update", task: "12345678", target: { title: "Comact SmartVision", parentTitle: null }, set: { title: "RVL - Comact SmartVision" }, reason: "Requested rename" },
      { op: "create", ref: "project", set: { title: "SmarTech rollout", bucket: "RVL", labels: ["Server", "Vendor"] }, reason: "Requested project" },
      { op: "create", ref: "scope", parentRef: "project", set: { title: "Confirm server scope" }, reason: "Requested first step" },
      { op: "checklist", taskRef: "project", label: "Confirm access", done: false, reason: "Required verification" },
      { op: "note", taskRef: "scope", text: "Source-backed implementation context", reason: "Preserve context" },
      { op: "archive", task: "abcdef12", target: { title: "Finished rollout", parentTitle: null }, reason: "Work is complete" },
      { op: "restore", task: "fedcba98", target: { title: "Paused rollout", parentTitle: null }, reason: "Work resumed" },
    ] };
    await page.setContent(`<pre><code>${JSON.stringify(proposal)}</code></pre>`);
    await page.evaluate(() => {
      globalThis.chrome = { runtime: { sendMessage: async () => ({ ok: true, transferId: "transfer" }), onMessage: { addListener() {} } } };
    });
    await page.addScriptTag({ path: `${extension}/proposal-contract.js` });
    await page.addScriptTag({ path: `${extension}/proposals.js` });
    const host = page.locator(".taskboard-copilot-proposal-review");
    await host.waitFor();
    const text = await host.evaluate(element => element.shadowRoot.textContent);
    assert.match(text, /Update “Comact SmartVision”/);
    assert.match(text, /Create task: “SmarTech rollout”/);
    assert.match(text, /Set labels to: Server, Vendor/);
    assert.match(text, /Create subtask: “Confirm server scope”/);
    assert.match(text, /Under “SmarTech rollout”/);
    assert.match(text, /Add a checklist item to new task “SmarTech rollout”: Confirm access/);
    assert.match(text, /Add a working note to new task “Confirm server scope”: Source-backed implementation context/);
    assert.match(text, /New task in this proposal: “Confirm server scope”/);
    assert.match(text, /Archive “Finished rollout” and all of its subtasks/);
    assert.match(text, /Restore “Paused rollout” and all of its subtasks/);
    assert.match(text, /Why: Requested first step/);
    assert.match(text, /verifies them against the snapshot before changing anything/);
    assert.doesNotMatch(text, /Task 12345678/);

    const legacy = { type: "taskboard-proposal", version: 1, snapshotId: "abcdef123456", requestId: "legacy-card-1", changes: [
      { op: "update", task: "87654321", set: { status: "waiting" }, reason: "Older snapshot proposal" },
    ] };
    await page.evaluate(value => {
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = JSON.stringify(value); pre.append(code); document.body.append(pre);
    }, legacy);
    await page.waitForFunction(() => document.querySelectorAll(".taskboard-copilot-proposal-review").length === 2);
    const legacyText = await page.locator(".taskboard-copilot-proposal-review").nth(1).evaluate(element => element.shadowRoot.textContent);
    assert.match(legacyText, /Update an existing task/);
    assert.match(legacyText, /Existing task \(title and level not stated by Copilot\) · ID 87654321/);
    assert.match(legacyText, /may require a fresh proposal/);
    assert.doesNotMatch(legacyText, /Unknown task|verifies them against the snapshot/);
  } finally {
    await browser.close();
  }
});
