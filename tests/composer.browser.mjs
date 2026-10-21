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
  const evidence = mkdtempSync(path.join(tmpdir(), "taskboard-composer-tests-"));
  const context = await chromium.launchPersistentContext(evidence, {
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
      for (const id of ["snapshot", "priorities", "meeting", "review", "prepare"]) {
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
    await suite.test("Prepare changes is reachable in a narrow popup and requests a proposal without sending", async () => {
      const page = await createPage(textarea);
      await page.setViewportSize({ width: 320, height: 568 });
      await page.emulateMedia({ colorScheme: "dark" });
      const action = page.getByRole("button", { name: "Prepare changes Turn recommendations into a proposal", exact: true });
      await action.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(evidence, "prepare-changes-320-dark.png") });
      await action.click();
      await inserted(page);
      const text = await page.getByLabel("Message Copilot").inputValue();
      assert.match(text, /recommendations and my explicit change requests in this conversation/);
      assert.match(text, /ONE JSON code block/);
      assert.match(text, /missing decisions/);
      assert.equal(await page.locator("#prompt-panel").isVisible(), false);
      assert.equal(await page.evaluate(() => globalThis.sent), 0);
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
    await suite.test("editor replacement verifies the retained prompt without a false warning", async () => {
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
      await inserted(page);
      assert.equal(await page.locator(".notice").filter({ hasText: "could not be confirmed" }).count(), 0);
      assert.match(await page.locator("#composer").inputValue(), /Taskboard snapshot\.md/);
      assert.equal(await page.getByRole("button", { name: "Taskboard prompts", exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => globalThis.sent), 0);
      await page.close();
    });
    await suite.test("delayed Lexical span replacement is verified without inserting twice", async () => {
      const page = await createPage('<span id="m365-chat-editor-target-element" role="textbox" aria-label="Message Copilot" contenteditable="true" data-lexical-editor="true"><p><br></p></span>');
      await page.evaluate(() => {
        globalThis.pastes = 0;
        document.querySelector("#m365-chat-editor-target-element").addEventListener("paste", event => {
          event.preventDefault(); globalThis.pastes++;
          const value = event.clipboardData.getData("text/plain");
          setTimeout(() => {
            const replacement = event.target.cloneNode();
            const p = document.createElement("p"); p.textContent = value; replacement.append(p);
            event.target.replaceWith(replacement);
          }, 140);
        });
      });
      await choose(page, "snapshot");
      await inserted(page);
      assert.match(await page.getByLabel("Message Copilot").innerText(), /^Today is /);
      assert.equal(await page.evaluate(() => globalThis.pastes), 1);
      assert.equal(await page.evaluate(() => globalThis.sent), 0);
      await page.close();
    });
    await suite.test("different replacement text stays untouched and uncertain", async () => {
      const page = await createPage(textarea);
      await page.evaluate(() => document.querySelector("#composer").addEventListener("input", event => {
        const replacement = event.target.cloneNode(); replacement.value = "A newer draft";
        event.target.replaceWith(replacement);
      }, { once: true }));
      await choose(page, "snapshot");
      await page.locator(".notice").filter({ hasText: "could not be confirmed" }).waitFor();
      assert.equal(await page.getByLabel("Message Copilot").inputValue(), "A newer draft");
      await page.close();
    });
    await suite.test("popup close, Escape and click-away cancel pending draft confirmation", async () => {
      const page = await createPage(textarea, "Keep this draft");
      const dock = page.locator("#taskboard-copilot-prompts");
      for (const close of ["button", "escape", "outside"]) {
        await choose(page, "snapshot");
        await dock.getByRole("button", { name: "Replace draft", exact: true }).waitFor();
        if (close === "button") await dock.locator(".close").click();
        if (close === "escape") await dock.locator(".close").press("Escape");
        if (close === "outside") await page.getByRole("heading", { name: "Copilot composer fixture" }).click();
        await page.locator("#prompt-panel").waitFor({ state: "hidden" });
        await dock.locator(".toggle").click();
        assert.equal(await dock.locator(".draft-actions").isVisible(), false);
        assert.equal(await page.getByLabel("Message Copilot").inputValue(), "Keep this draft");
      }
      await page.close();
    });
    await suite.test("late insertion verification cannot reopen feedback or steal popup focus", async () => {
      const page = await createPage(textarea);
      await page.evaluate(() => document.querySelector("#composer").addEventListener("input", event => {
        const value = event.target.value;
        const replacement = event.target.cloneNode(); replacement.value = "";
        event.target.replaceWith(replacement);
        setTimeout(() => { replacement.value = value; }, 250);
      }, { once: true }));
      await choose(page, "snapshot");
      await page.locator("#taskboard-copilot-prompts .toggle").click();
      assert.equal(await page.locator('[data-id="snapshot"]').isDisabled(), true);
      await page.waitForTimeout(800);
      assert.equal(await page.locator("#prompt-panel").isVisible(), true);
      assert.equal(await page.locator(".notice").isVisible(), false);
      assert.equal(await page.locator("#taskboard-copilot-prompts").evaluate(host => host.shadowRoot.activeElement?.className), "close");
      await page.close();
    });
    await suite.test("warning dismissal works by button, Escape, click-away, typing and reopening", async () => {
      const page = await createPage(rich);
      await page.evaluate(() => document.querySelector("#m365-chat-editor-target-element").addEventListener("paste", event => event.preventDefault()));
      const dock = page.locator("#taskboard-copilot-prompts");
      for (const action of ["button", "escape", "outside", "typing", "reopen", "send"]) {
        await choose(page, "snapshot");
        await dock.locator(".notice").waitFor();
        if (action === "button") await dock.getByRole("button", { name: "Dismiss Taskboard message", exact: true }).click();
        if (action === "escape") await dock.getByRole("button", { name: "Dismiss Taskboard message", exact: true }).press("Escape");
        if (action === "outside") await page.getByRole("heading", { name: "Copilot composer fixture" }).click();
        if (action === "typing") await page.getByLabel("Message Copilot").press("a");
        if (action === "reopen") await dock.locator(".toggle").click();
        if (action === "send") await page.getByRole("button", { name: "Send", exact: true }).click();
        assert.equal(await dock.locator(".notice").isVisible(), false);
        await page.getByLabel("Message Copilot").fill("");
        if (await dock.locator(".toggle").isVisible()) await dock.locator(".toggle").click();
      }
      assert.equal(await page.evaluate(() => globalThis.sent), 1, "Only the explicit Send click may submit");
      await page.close();
    });
    await suite.test("success and warning feedback expire and warnings remain available inside the panel", async () => {
      const success = await createPage(textarea);
      await choose(success, "snapshot"); await inserted(success);
      await success.getByRole("button", { name: "Dismiss Taskboard message" }).focus();
      await success.locator(".notice").waitFor({ state: "hidden", timeout: 6500 });
      assert.equal(await success.locator("#taskboard-copilot-prompts").evaluate(host => host.shadowRoot.activeElement?.className), "toggle");
      await success.close();
      const page = await createPage(rich);
      await page.evaluate(() => document.querySelector("#m365-chat-editor-target-element").addEventListener("paste", event => event.preventDefault()));
      await page.setViewportSize({ width: 320, height: 568 });
      await page.emulateMedia({ colorScheme: "dark" });
      await choose(page, "snapshot");
      await page.locator(".notice").waitFor();
      const dismiss = await page.getByRole("button", { name: "Dismiss Taskboard message" }).boundingBox();
      assert.ok(dismiss.x >= 0 && dismiss.x + dismiss.width <= 320 && dismiss.y + dismiss.height <= 568);
      await page.screenshot({ path: path.join(evidence, "warning-dismissable-320-dark.png") });
      await page.locator(".notice").waitFor({ state: "hidden", timeout: 11500 });
      await page.locator("#taskboard-copilot-prompts .toggle").click();
      await page.locator("#taskboard-copilot-prompts .status").filter({ hasText: "could not be confirmed" }).waitFor();
      await page.screenshot({ path: path.join(evidence, "warning-expired-panel-320-dark.png") });
      await page.close();
    });
    await suite.test("copy fallback closes the popup and preserves the existing composer draft", async () => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://m365.cloud.microsoft" });
      const page = await createPage(textarea, "Preserve this draft");
      const expected = await page.getByRole("textbox", { name: "Prompt preview · optional edits" }).inputValue();
      await page.getByRole("button", { name: "Copy prompt instead", exact: true }).click();
      await page.locator(".notice").filter({ hasText: "Copied." }).waitFor();
      assert.equal(await page.locator("#prompt-panel").isVisible(), false);
      // Windows clipboard text uses CRLF; compare the copied text losslessly
      // apart from that platform newline representation.
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), expected);
      assert.equal(await page.getByLabel("Message Copilot").inputValue(), "Preserve this draft");
      assert.equal(await page.evaluate(() => globalThis.sent), 0);
      await page.getByRole("button", { name: "Dismiss Taskboard message" }).click();
      assert.equal(await page.locator(".notice").isVisible(), false);
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
    console.log("Composer lifecycle evidence: " + evidence);
  } finally { await context.close(); }
});
