import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { createHostController, popupBounds, COPILOT_URL } from "../extension/host-controller.mjs";

function fixture() {
  const calls = [];
  const session = {}, local = {};
  const tabs = new Map([[1, { id: 1, windowId: 10, index: 0, groupId: -1, pinned: false, splitViewId: -1 }]]);
  const windows = new Map([[10, { id: 10, type: "normal", left: 0, top: 0, width: 1400, height: 900 }]]);
  const storage = (state) => ({ async get(key) { return { [key]: state[key] }; }, async set(value) { Object.assign(state, value); } });
  const api = {
    storage: { session: storage(session), local: storage(local) },
    windows: {
      WINDOW_ID_CURRENT: -2,
      async get(id) { if (!windows.has(id)) throw Error("Closed"); return windows.get(id); },
      async create(options) { calls.push({ createWindow: options }); const w = { ...options, id: 20, state: "normal" }; windows.set(20, w); return w; },
      async update(id, options) { calls.push({ updateWindow: { id, ...options } }); Object.assign(windows.get(id), options); },
    },
    tabs: {
      async get(id) { if (!tabs.has(id)) throw Error("Closed"); return { ...tabs.get(id) }; },
      async create(options) { calls.push({ createTab: options }); const t = { ...options, id: 2, groupId: -1, splitViewId: -1 }; tabs.set(2, t); return t; },
      async move(id, options) { calls.push({ move: { id, ...options } }); tabs.get(id).index = options.index; },
      async update(id, options) { calls.push({ updateTab: { id, ...options } }); },
      async group(options) { tabs.get(options.tabIds[0]).groupId = options.groupId; },
      async highlight(options) { calls.push({ highlight: options }); },
    },
  };
  return { api, calls, session, local, tabs, windows, source: tabs.get(1) };
}

test("popup is narrow, top-level and reused across simultaneous clicks / worker restart", async () => {
  const f = fixture();
  const controller = createHostController(f.api);
  await Promise.all([controller.open("popup", f.source), controller.open("popup", f.source)]);
  await createHostController(f.api).open("popup", f.source);
  const created = f.calls.filter(c => c.createWindow);
  assert.equal(created.length, 1);
  assert.equal(created[0].createWindow.width, 320);
  assert.equal(created[0].createWindow.url, COPILOT_URL);
  assert.equal(created[0].createWindow.type, "popup");
  assert.equal(f.calls.filter(c => c.updateWindow).length, 2);
});

test("minimized popup restores without navigation; closed popup recreates with saved bounds", async () => {
  const f = fixture();
  const controller = createHostController(f.api);
  await controller.open("popup", f.source);
  await controller.saveBounds({ id: 20, state: "normal", left: 800, top: 30, width: 260, height: 600 });
  await controller.saveBounds({ id: 10, state: "normal", width: 1000 });
  f.windows.get(20).state = "minimized";
  await controller.open("popup", f.source);
  assert.deepEqual(f.calls.at(-1), { updateWindow: { id: 20, state: "normal", focused: true } });
  f.windows.delete(20);
  await controller.open("popup", f.source);
  assert.deepEqual(f.calls.at(-1).createWindow, { url: COPILOT_URL, type: "popup", focused: true, left: 800, top: 30, width: 260, height: 600 });
});

test("bounds recover off-screen position and allow 240px width", () => {
  assert.deepEqual(popupBounds({ left: -5000, top: 5000, width: 240, height: 600 }, { left: 10, top: 20, width: 1000, height: 800 }), { left: 10, top: 220, width: 240, height: 600 });
});

test("a disconnected display retries once with OS placement; other failures stay visible", async () => {
  const f = fixture();
  f.local.popupBounds = { left: 9999, top: 9999, width: 280, height: 600 };
  const create = f.api.windows.create;
  let count = 0;
  f.api.windows.create = async options => {
    count++;
    if (options.left !== undefined) throw Error("Invalid bounds. Bounds must be within visible screen space.");
    return create(options);
  };
  await createHostController(f.api).open("popup", f.source);
  assert.equal(count, 2);
  assert.equal(f.calls.at(-1).createWindow.left, undefined);
  assert.equal(f.calls.at(-1).createWindow.width, 280);
  f.windows.delete(20);
  f.api.windows.create = async () => { throw Error("Blocked by browser policy"); };
  await assert.rejects(createHostController(f.api).open("popup", f.source), /Blocked/);
});

test("guided split prepares one adjacent tab and highlights the pair without another window", async () => {
  const f = fixture();
  const controller = createHostController(f.api);
  const result = await controller.open("split", f.source);
  await controller.open("split", f.source);
  assert.equal(result.automatic, false);
  assert.match(result.guide, /Right-click/);
  assert.equal(f.calls.filter(c => c.createTab).length, 1);
  assert.equal(f.calls.filter(c => c.createWindow).length, 0);
  assert.deepEqual(f.calls.at(-1), { highlight: { windowId: 10, tabs: [0, 1] } });
  assert.match(await controller.guideFor(2), /Split View/);
});

test("supported split API pairs existing grouped tabs and repeat opening preserves the split", async () => {
  const f = fixture();
  f.source.groupId = 7;
  let count = 0;
  f.api.tabs.createSplit = async (ids) => { count++; ids.forEach(id => { f.tabs.get(id).splitViewId = 8; }); };
  const controller = createHostController(f.api);
  assert.equal((await controller.open("split", f.source)).automatic, true);
  assert.equal((await controller.open("split", f.tabs.get(2))).automatic, true);
  assert.equal(count, 1);
  assert.equal(f.tabs.get(2).groupId, 7);
  assert.equal(f.tabs.get(2).pinned, false);
  assert.equal(await controller.guideFor(2), null);
});

test("automatic split rejection offers guidance and reuses its tab instead of creating a window", async () => {
  const f = fixture();
  f.api.tabs.createSplit = async () => { throw Error("Disabled by browser"); };
  const controller = createHostController(f.api);
  const result = await controller.open("split", f.source);
  assert.equal(result.automatic, false);
  assert.match(result.detail, /unavailable/);
  await controller.open("split", f.source);
  assert.equal(f.calls.filter(c => c.createTab).length, 1);
});

test("existing unrelated split / popup source is rejected without rearranging it", async () => {
  const f = fixture();
  const controller = createHostController(f.api);
  f.source.splitViewId = 77;
  await assert.rejects(controller.open("split", f.source), /another Split View/);
  assert.equal(f.calls.length, 0);
  f.windows.get(10).type = "popup";
  await assert.rejects(controller.open("split", f.source), /normal browser window/);
  await assert.rejects(controller.open("bad", f.source), /Choose/);
});

const context = vm.createContext({ Intl, Date });
vm.runInContext(readFileSync(new URL("../extension/prompts.js", import.meta.url), "utf8"), context);
const prompts = context.TaskboardCopilotPrompts;

test("all four shortcuts ground in the named snapshot and preserve manual review", () => {
  assert.equal(prompts.shortcuts.length, 4);
  assert.equal(new Set(prompts.shortcuts.map((item) => item.id)).size, 4);
  for (const shortcut of prompts.shortcuts) {
    const text = prompts.buildPrompt(shortcut.id, new Date(2026, 9, 20, 12));
    assert.match(text, /Today is 2026-10-20/);
    assert.match(text, /Taskboard snapshot\.md/);
    assert.match(text, /Snapshot ID and Generated time/);
    assert.match(text, /cannot retrieve the file/);
    assert.match(text, /more than a day old/);
    assert.match(text, /same issue and compatible dates/);
    assert.match(text, /review and approve them in Taskboard/);
    assert.match(text, /before approval/);
  }
  assert.throws(() => prompts.buildPrompt("bad"), /Unknown/);
});

test("manifest has only scoped content scripts and local runtime resources", () => {
  const base = new URL("../extension/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", base), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ["storage", "clipboardWrite", "scripting"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.action.default_popup, "launcher.html");
  assert.equal(manifest.side_panel, undefined);
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://m365.cloud.microsoft/*", "https://copilot.cloud.microsoft/*"]);
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
  for (const path of [manifest.background.service_worker, manifest.action.default_popup, "launcher.mjs", "launcher.css", "host-controller.mjs", "review-controller.mjs", ...manifest.content_scripts.flatMap(script => script.js), ...Object.values(manifest.icons)]) {
    assert.ok(existsSync(new URL(path, base)), path);
  }
});
