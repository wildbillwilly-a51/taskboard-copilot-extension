import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(process.env.COPILOT_TEST_REQUIRE_FROM || import.meta.url)("playwright");
const extension = fileURLToPath(new URL("../extension/", import.meta.url));

test("composer insertion through the actual isolated extension content scripts", async (suite) => {
  const context = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), "taskboard-composer-tests-")), {
    headless: true,
    executablePath: process.env.COPILOT_TEST_BROWSER_PATH || chromium.executablePath(),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(10000);
  let html = "";
  await context.route("https://m365.cloud.microsoft/**", (route) => route.fulfill({
    status: 200, contentType: "text/html; charset=utf-8", body: html,
    headers: { "Content-Security-Policy": "default-src 'self'; script-src 'none'; style-src 'self'" },
  }));
  const errors = [];
  const createPage = async (editor, initial = "") => {
    html = `<!doctype html><meta charset="utf-8"><title>Copilot composer fixture</title><h1>Copilot composer fixture</h1><form>${editor}<button type="submit">Send</button></form>`;
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("https://m365.cloud.microsoft/chat");
    await page.locator("#taskboard-copilot-prompts").waitFor({ state: "attached" });
    await page.evaluate((value) => {
      globalThis.sent = 0;
      globalThis.model = value;
      const editor = document.querySelector("#composer, #m365-chat-editor-target-element");
      if (editor?.tagName === "TEXTAREA") editor.value = value;
      else if (editor) editor.textContent = value;
      document.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); globalThis.sent++; });
      document.addEventListener("keydown", (event) => { if (event.key === "Enter") globalThis.sent++; });
    }, initial);
    const toggle = page.getByRole("button", { name: "Taskboard prompts", exact: true });
    if (await toggle.isVisible()) await toggle.click();
    return page;
  };
  const choose = (page, id) => page.locator(`#taskboard-copilot-prompts [data-id="${id}"]`).click();
  const inserted = (page) => page.getByRole("status").filter({ hasText: "Prompt added." }).waitFor();
  const textarea = '<textarea id="composer" aria-label="Message Copilot"></textarea>';
  try {
    await suite.test("every shortcut inserts without submitting or losing controlled-input state", async () => {
      const page = await createPage(textarea);
      await page.evaluate(() => {
        const editor = document.querySelector("#composer");
        const native = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
        let tracked = "";
        Object.defineProperty(editor, "value", {
          get() { return native.get.call(this); },
          set(value) { tracked = value; native.set.call(this, value); },
        });
        editor.addEventListener("input", () => {
          if (editor.value !== tracked) globalThis.model = editor.value;
          tracked = editor.value;
          setTimeout(() => { editor.value = globalThis.model; }, 20);
        });
      });
      for (const id of ["snapshot", "priorities", "meeting", "review"]) {
        await choose(page, id);
        await inserted(page);
        assert.equal(await page.locator("#prompt-panel").isVisible(), false);
        assert.match(await page.locator("#composer").inputValue(), /Taskboard snapshot\.md/);
        assert.equal(await page.locator("#composer").inputValue(), await page.evaluate(() => globalThis.model));
        assert.equal(await page.evaluate(() => document.activeElement.id), "composer");
        assert.equal(await page.evaluate(() => globalThis.sent), 0);
        await page.locator("#composer").fill("");
        await page.getByRole("button", { name: "Taskboard prompts", exact: true }).click();
      }
      await page.close();
    });
    await suite.test("existing drafts require confirmation and Keep draft preserves them", async () => {
      const page = await createPage(textarea, "My unfinished message");
      await choose(page, "priorities");
      await page.getByRole("button", { name: "Keep draft", exact: true }).click();
      assert.equal(await page.locator("#composer").inputValue(), "My unfinished message");
      await page.getByRole("button", { name: "Insert into Copilot", exact: true }).click();
      await page.getByRole("button", { name: "Replace draft", exact: true }).click();
      await inserted(page);
      assert.match(await page.locator("#composer").inputValue(), /up to five priorities/);
      assert.equal(await page.evaluate(() => globalThis.sent), 0);
      await page.close();
    });
    await suite.test("draft changes after confirmation is offered are preserved", async () => {
      const page = await createPage(textarea, "Original draft");
      await choose(page, "meeting");
      await page.locator("#composer").fill("A newer draft");
      await page.getByRole("button", { name: "Replace draft", exact: true }).click();
      assert.equal(await page.locator("#composer").inputValue(), "A newer draft");
      await page.getByRole("status").filter({ hasText: "draft or prompt changed" }).waitFor();
      await page.close();
    });
    await suite.test("preview edits after confirmation require a fresh replacement decision", async () => {
      const page = await createPage(textarea, "Original draft");
      await choose(page, "meeting");
      await page.getByRole("textbox", { name: "Prompt preview · optional edits" }).fill("Changed preview");
      await page.getByRole("button", { name: "Replace draft", exact: true }).click();
      assert.equal(await page.locator("#composer").inputValue(), "Original draft");
      await page.close();
    });
    await suite.test("missing or ambiguous composers fail visibly without changing fields", async () => {
      for (const markup of ["", '<textarea aria-label="Message Copilot"></textarea><textarea aria-label="Message Copilot"></textarea>']) {
        const page = await createPage(markup);
        await choose(page, "snapshot");
        await page.getByRole("status").filter({ hasText: "cannot be identified" }).waitFor();
        assert.deepEqual(await page.locator("form textarea").evaluateAll((elements) => elements.map((element) => element.value)), markup ? ["", ""] : []);
        assert.equal(await page.evaluate(() => globalThis.sent), 0);
        await page.close();
      }
    });
    await suite.test("hidden, read-only, disabled and search boxes are ignored", async () => {
      const page = await createPage('<textarea hidden aria-label="Message Copilot"></textarea><textarea readonly aria-label="Message Copilot"></textarea><textarea disabled aria-label="Message Copilot"></textarea><textarea aria-label="Search Copilot"></textarea>' + textarea);
      await choose(page, "snapshot");
      await inserted(page);
      const fields = await page.locator("form textarea").evaluateAll((elements) => elements.map((element) => element.value));
      assert.deepEqual(fields.slice(0, 4), ["", "", "", ""]);
      assert.match(fields[4], /Taskboard snapshot\.md/);
      await page.close();
    });
    const rich = '<div id="m365-chat-editor-target-element" role="textbox" aria-label="Message Copilot" contenteditable="true" data-lexical-editor="true"></div>';
    await suite.test("a model-owned rich editor accepts plain text through its paste handler", async () => {
      const page = await createPage(rich);
      await page.evaluate(() => {
        const editor = document.querySelector("#m365-chat-editor-target-element");
        editor.addEventListener("paste", (event) => {
          event.preventDefault();
          globalThis.model = event.clipboardData.getData("text/plain");
          editor.textContent = globalThis.model;
        });
        setInterval(() => { if (editor.textContent !== globalThis.model) editor.textContent = globalThis.model; }, 20);
      });
      const text = 'Review this literally: <img src=x onerror="bad()">\nSecond line & details';
      await page.getByRole("textbox", { name: "Prompt preview · optional edits" }).fill(text);
      await page.getByRole("button", { name: "Insert into Copilot", exact: true }).click();
      await inserted(page);
      assert.equal(await page.evaluate(() => globalThis.model), text);
      assert.equal(await page.locator("#m365-chat-editor-target-element img").count(), 0);
      assert.equal(await page.evaluate(() => globalThis.sent), 0);
      await page.close();
    });
    await suite.test("plain contenteditable uses native editing without a synthetic paste handler", async () => {
      const page = await createPage(rich);
      await choose(page, "snapshot");
      await inserted(page);
      assert.match(await page.locator("#m365-chat-editor-target-element").innerText(), /Taskboard snapshot\.md/);
      assert.equal(await page.evaluate(() => globalThis.sent), 0);
      await page.close();
    });
    await suite.test("rich draft replacement synchronizes select-all with the editor model before paste", async () => {
      const page = await createPage(rich, "Existing rich draft");
      await page.evaluate(() => {
        const editor = document.querySelector("#m365-chat-editor-target-element");
        globalThis.selectedDraft = "";
        document.addEventListener("selectionchange", () => {
          if (editor.contains(getSelection().anchorNode)) globalThis.selectedDraft = getSelection().toString();
        });
        editor.addEventListener("paste", (event) => {
          event.preventDefault();
          const incoming = event.clipboardData.getData("text/plain");
          globalThis.model = globalThis.selectedDraft === globalThis.model ? incoming : globalThis.model + incoming;
          editor.textContent = globalThis.model;
        });
      });
      await choose(page, "snapshot");
      await page.getByRole("button", { name: "Replace draft", exact: true }).click();
      await inserted(page);
      assert.match(await page.evaluate(() => globalThis.model), /^Today is /);
      assert.doesNotMatch(await page.evaluate(() => globalThis.model), /Existing rich draft/);
      assert.equal(await page.evaluate(() => globalThis.sent), 0);
      await page.close();
    });
    await suite.test("editor replacement keeps the inserted draft while the panel closes and a warning stays visible", async () => {
      const page = await createPage(textarea);
      await page.evaluate(() => {
        document.querySelector("#composer").addEventListener("input", event => {
          const replacement = event.target.cloneNode();
          replacement.value = event.target.value;
          event.target.replaceWith(replacement);
        }, { once: true });
      });
      await choose(page, "snapshot");
      await page.locator("#prompt-panel").waitFor({ state: "hidden" });
      await page.getByRole("status").filter({ hasText: "could not be confirmed" }).waitFor();
      assert.match(await page.locator("#composer").inputValue(), /Taskboard snapshot\.md/);
      assert.equal(await page.getByRole("button", { name: "Taskboard prompts", exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => globalThis.sent), 0);
      await page.close();
    });
    await suite.test("an editor rejecting paste is not falsely reported as populated", async () => {
      const page = await createPage(rich);
      await page.evaluate(() => document.querySelector("#m365-chat-editor-target-element").addEventListener("paste", (event) => event.preventDefault()));
      await choose(page, "snapshot");
      await page.getByRole("status").filter({ hasText: "could not be confirmed" }).waitFor();
      assert.equal(await page.locator("#m365-chat-editor-target-element").innerText(), "");
      await page.close();
    });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
