// Actual isolated content scripts and owned HTTPS fixtures; no tenant messages.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(process.env.COPILOT_TEST_REQUIRE_FROM || import.meta.url)("playwright");

test('Taskboard context accompanies the original Send without a setup prompt', async suite => {
  const evidence = mkdtempSync(path.join(tmpdir(), 'taskboard-auto-context-'));
  const extension = path.join(evidence, 'extension');
  cpSync(fileURLToPath(new URL('../extension/', import.meta.url)), extension, { recursive: true });
  const manifest = JSON.parse(readFileSync(path.join(extension, 'manifest.json')));
  manifest.host_permissions = ['https://board.example/*'];
  writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(path.join(evidence, 'profile'), {
    headless: true, executablePath: process.env.COPILOT_TEST_BROWSER_PATH || chromium.executablePath(),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(10000);
  const errors = [];
  let html;
  await context.route('https://m365.cloud.microsoft/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const configure = async () => {
    if (!manifest.options_ui) return;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    await options.getByLabel('Taskboard website').fill('https://board.example');
    await options.getByRole('button', { name: 'Connect Taskboard', exact: true }).click();
    await options.locator('#connection[data-state="connected"]').waitFor();
    await options.close();
  };
  const create = async (rich = false, initial = 'Create a Taskboard task from the server deployment emails.') => {
    html = `<meta charset="utf-8"><title>Taskboard automatic context fixture</title><style>body{font:16px system-ui;max-width:900px;margin:24px}textarea,[contenteditable=true]{display:block;width:100%;min-height:110px;box-sizing:border-box;font:14px/1.5 system-ui;margin-bottom:12px}button{padding:10px}pre{white-space:pre-wrap;max-height:310px;overflow:auto;border:1px solid #bbb;padding:12px;font:14px/1.5 system-ui}</style><h1>Copilot send adapter · test fixture</h1><form>${rich ? '<div id="m365-chat-editor-target-element" role="textbox" aria-label="Message Copilot" contenteditable="true"></div>' : '<textarea id="m365-chat-editor-target-element" aria-label="Message Copilot"></textarea>'}<button type="submit" aria-label="Send">Send</button><input id="attachment" type="file"></form><button id="cancel" type="button">Other action</button><h2 id="send-count">0 messages submitted</h2><pre id="sent-preview"></pre>`;
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://m365.cloud.microsoft/chat');
    await page.locator('#taskboard-copilot-prompts').waitFor({ state: 'attached' });
    await page.evaluate(({ initial, rich }) => {
      const editor = document.getElementById('m365-chat-editor-target-element');
      window.sent = []; window.enterSends = true;
      if (rich) editor.textContent = initial; else editor.value = initial;
      const send = () => { const current = document.getElementById('m365-chat-editor-target-element'); window.sent.push(current.tagName === 'TEXTAREA' ? current.value : current.innerText); document.getElementById('send-count').textContent = `${window.sent.length} message${window.sent.length === 1 ? '' : 's'} submitted`; document.getElementById('sent-preview').textContent = window.sent.at(-1); };
      document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); send(); });
      editor.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && event.ctrlKey === !window.enterSends) { event.preventDefault(); send(); }
      });
      editor.addEventListener('paste', event => {
        event.preventDefault();
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
      });
    }, { initial, rich });
    return page;
  };
  const sent = page => page.evaluate(() => window.sent);
  const check = async (page, original) => {
    await page.waitForFunction(() => window.sent.length > 0);
    const values = await sent(page);
    assert.equal(values.length, 1);
    assert.ok(values[0].startsWith(original));
    assert.match(values[0], /not Microsoft To Do, Planner, or a private Microsoft task/);
    assert.match(values[0], /Taskboard snapshot\.md/);
    assert.match(values[0], /taskboard-proposal/);
    assert.equal(values[0].split('[Taskboard request instructions]').length, 2);
  };
  try {
    await configure();
    await suite.test('a fresh-chat plain request needs only its original Send click', async () => {
      const initial = 'Create a Taskboard task from the server deployment emails.';
      const page = await create(false, initial);
      assert.deepEqual(await sent(page), []);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await check(page, initial);
      await page.screenshot({ path: path.join(evidence, 'one-send-context.png'), fullPage: true });
      await page.close();
    });
    await suite.test('rich-text formatting, reference chips and attachments survive append', async () => {
      const page = await create(true);
      await page.getByLabel('Message Copilot').evaluate(editor => { editor.innerHTML = '<b>Create a Taskboard task</b> for <span contenteditable="false" data-reference="fixture">Server email</span>'; });
      await page.locator('#attachment').setInputFiles({ name: 'example.txt', mimeType: 'text/plain', buffer: Buffer.from('owned fixture') });
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await check(page, 'Create a Taskboard task for Server email');
      assert.equal(await page.locator('[data-reference="fixture"]').count(), 1);
      assert.equal(await page.locator('#m365-chat-editor-target-element b').innerText(), 'Create a Taskboard task');
      assert.equal(await page.locator('#attachment').evaluate(input => input.files.length), 1);
      await page.close();
    });
    await suite.test('Enter and Ctrl+Enter preserve the app keyboard binding', async () => {
      for (const ctrl of [false, true]) {
        const page = await create(true);
        await page.evaluate(ctrl => { window.enterSends = !ctrl; }, ctrl);
        await page.getByLabel('Message Copilot').press(ctrl ? 'Control+Enter' : 'Enter');
        await check(page, 'Create a Taskboard task from the server deployment emails.');
        await page.close();
      }
    });
    await suite.test('ordinary Copilot messages and Shift+Enter stay native', async () => {
      const ordinary = await create(false, 'Summarize these emails.');
      await ordinary.getByRole('button', { name: 'Send', exact: true }).click();
      assert.deepEqual(await sent(ordinary), ['Summarize these emails.']);
      await ordinary.close();
      const multiline = await create(true);
      await multiline.getByLabel('Message Copilot').press('Shift+Enter');
      assert.deepEqual(await sent(multiline), []);
      assert.equal((await multiline.getByLabel('Message Copilot').innerText()).includes('[Taskboard request instructions]'), false);
      await multiline.close();
    });
    await suite.test('a different Send control never submits or rewrites the Copilot draft', async () => {
      const page = await create();
      await page.evaluate(() => { const other = document.createElement('button'); other.id = 'other-send'; other.textContent = 'Send'; other.onclick = () => { window.otherSent = true; }; document.body.append(other); });
      await page.locator('#other-send').click();
      assert.equal(await page.evaluate(() => window.otherSent), true);
      assert.deepEqual(await sent(page), []);
      assert.equal((await page.getByLabel('Message Copilot').inputValue()).includes('[Taskboard request instructions]'), false);
      await page.close();
    });
    await suite.test('rapid repeat clicks do not duplicate the send or instructions', async () => {
      const page = await create(true);
      await page.getByRole('button', { name: 'Send', exact: true }).dblclick();
      await check(page, 'Create a Taskboard task from the server deployment emails.');
      await page.close();
    });
    await suite.test('prepared shortcuts are not wrapped again', async () => {
      const page = await create();
      await page.getByRole('button', { name: 'Taskboard prompts', exact: true }).click();
      await page.locator('#taskboard-copilot-prompts [data-id="priorities"]').click();
      // Existing draft protection still asks before replacing this fixture draft.
      await page.getByRole('button', { name: 'Replace draft', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Prompt added.' }).waitFor();
      assert.deepEqual(await sent(page), []);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await check(page, 'Today is ');
      await page.close();
    });
    await suite.test('unconfirmed model insertion never continues the Send', async () => {
      const page = await create(false);
      await page.getByLabel('Message Copilot').evaluate(editor => { const original = editor.value; editor.addEventListener('input', () => { editor.value = original; }); });
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.locator('#taskboard-copilot-prompts .notice-text').filter({ hasText: 'Taskboard instructions could not be confirmed.' }).waitFor();
      assert.deepEqual(await sent(page), []);
      await page.close();
    });
    await suite.test('changing chat during preparation cancels the continuation', async () => {
      const page = await create(true);
      await page.getByLabel('Message Copilot').evaluate(editor => editor.addEventListener('paste', () => history.pushState(null, '', '/chat/conversation/another-fixture')));
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.locator('#taskboard-copilot-prompts .notice-text').filter({ hasText: 'Your message was not sent' }).waitFor();
      assert.deepEqual(await sent(page), []);
      await page.close();
    });
    await suite.test('a replacement editor retaining the complete request sends only once', async () => {
      const page = await create(true);
      await page.getByLabel('Message Copilot').evaluate(editor => editor.addEventListener('paste', () => setTimeout(() => editor.replaceWith(editor.cloneNode(true)), 30), { once: true }));
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await check(page, 'Create a Taskboard task from the server deployment emails.');
      await page.close();
    });
    await suite.test('continuous editor and Send replacement still confirms and submits once', async () => {
      const page = await create(true);
      await page.getByLabel('Message Copilot').evaluate(editor => editor.addEventListener('paste', () => {
        let replacements = 0;
        const timer = setInterval(() => {
          const current = document.getElementById('m365-chat-editor-target-element');
          current.replaceWith(current.cloneNode(true));
          const send = document.querySelector('button[aria-label="Send"]');
          send.replaceWith(send.cloneNode(true));
          if (++replacements >= 30) clearInterval(timer);
        }, 20);
      }, { once: true }));
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await check(page, 'Create a Taskboard task from the server deployment emails.');
      await page.close();
    });
    await suite.test('typing during preparation preserves the new text and cancels sending', async () => {
      const page = await create(true);
      await page.getByLabel('Message Copilot').evaluate(editor => editor.addEventListener('paste', () => setTimeout(() => { editor.append(document.createTextNode(' New user edit')); }, 30), { once: true }));
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.locator('#taskboard-copilot-prompts .notice-text').filter({ hasText: 'Your message was not sent' }).waitFor();
      assert.deepEqual(await sent(page), []);
      assert.match(await page.getByLabel('Message Copilot').innerText(), /New user edit/);
      await page.close();
    });
    if (manifest.options_ui) await suite.test('disconnected Taskboard blocks unprimed native-task routing', async () => {
      await worker.evaluate(() => chrome.storage.local.remove('taskboardReviewUrl'));
      const page = await create();
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.locator('#taskboard-copilot-prompts .notice-text').filter({ hasText: 'Connect Taskboard in extension Settings' }).waitFor();
      assert.deepEqual(await sent(page), []);
      await page.close(); await configure();
    });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, evidence, flow: 'plain Taskboard request → original Send → verified context → one native submission; no setup message' }));
  } finally { await context.close(); }
});
