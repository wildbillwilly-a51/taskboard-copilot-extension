import assert from "node:assert/strict";
import test from "node:test";
import { createReviewController, isCopilotPage, isTaskboardReviewPage } from "../extension/review-controller.mjs";

const TASKBOARD_REVIEW_URL = "https://board.example/copilot-review";
const body = JSON.stringify({ type: "taskboard-proposal", version: 1, snapshotId: "abcdef123456", requestId: "test-request-1", changes: [{ op: "update", task: "12345678", set: { title: "Updated title" }, reason: "Requested rename" }] });
function fixture() {
  const data = {}, tabs = new Map(), calls = [], removed = [];
  const api = {
    storage: { session: { async get(key) { return { [key]: data[key] }; }, async set(value) { Object.assign(data, value); } } },
    windows: { async get(id) { return { id, type: "normal" }; }, async update() {} },
    tabs: {
      async create(value) { const tab = { ...value, id: tabs.size + 10 }; tabs.set(tab.id, tab); calls.push(tab); return tab; },
      async get(id) { if (!tabs.has(id)) throw Error("Closed"); return tabs.get(id); },
      async update() {},
      async remove(id) { removed.push(id); tabs.delete(id); },
      async sendMessage(id) { const tab = tabs.get(id); return { transferId: new URL(tab.url).searchParams.get("transfer"), url: tab.url }; },
    },
  };
  const sender = { url: "https://m365.cloud.microsoft/chat", tab: { id: 1, windowId: 5 } };
  return { api, data, tabs, calls, removed, sender, controller: createReviewController(api, { getReviewUrl: async () => TASKBOARD_REVIEW_URL }) };
}
test("proposal transport is explicit, tab-bound, session-only and cleared on acknowledgement", async () => {
  const f = fixture();
  const result = await f.controller.begin(f.sender, body);
  const tab = f.calls[0];
  assert.equal(new URL(tab.url).origin, new URL(TASKBOARD_REVIEW_URL).origin);
  assert.equal(new URL(tab.url).searchParams.get("proposal"), null);
  assert.equal(tab.windowId, 5);
  const receiver = { tab: { id: tab.id }, url: tab.url };
  assert.deepEqual(await f.controller.pending(receiver, result.transferId), { transferId: result.transferId, proposal: body });
  assert.equal(await f.controller.pending({ ...receiver, tab: { id: 123 } }, result.transferId), null);
  assert.equal(await f.controller.pending({ ...receiver, url: "https://other.example/copilot-review" }, result.transferId), null);
  await f.controller.received({ ...receiver, tab: { id: 123 } }, result.transferId);
  assert.ok(await f.controller.pending(receiver, result.transferId));
  await f.controller.received(receiver, result.transferId);
  assert.equal(await f.controller.pending(receiver, result.transferId), null);
  assert.equal(Object.keys(f.data.copilotReviewTransfers).length, 0);
});
test("concurrent transfer clicks reuse a live review, but never send data to a navigated tab", async () => {
  const f = fixture();
  await Promise.all([f.controller.begin(f.sender, body), f.controller.begin(f.sender, body)]);
  assert.equal(f.calls.length, 1);
  f.tabs.get(f.calls[0].id).url = "https://other.example/";
  await f.controller.begin(f.sender, body);
  assert.equal(f.calls.length, 2);
});
test("untrusted origins, unsupported payloads, oversized blocks and expired handoffs fail closed", async () => {
  const f = fixture();
  for (const url of ["http://m365.cloud.microsoft/chat", "https://m365.cloud.microsoft.evil.test/", "https://example.test/"]) await assert.rejects(f.controller.begin({ ...f.sender, url }, body));
  for (const value of [null, "broken", "{}", "x".repeat(32769)]) await assert.rejects(f.controller.begin(f.sender, value));
  assert.equal(f.calls.length, 0);
  const result = await f.controller.begin(f.sender, body);
  const tab = f.calls[0];
  f.data.copilotReviewTransfers[result.transferId].createdAt = 0;
  assert.equal(await f.controller.pending({ tab: { id: tab.id }, url: tab.url }, result.transferId), null);
  assert.equal(isCopilotPage("https://copilot.cloud.microsoft/chat"), true);
  assert.equal(isTaskboardReviewPage("https://board.example/copilot-review-evil", TASKBOARD_REVIEW_URL), false);
});
test("invalid contracts never open a tab or persist a transfer; both count boundaries are enforced", async () => {
  const proposal = JSON.parse(body);
  const change = proposal.changes[0];
  const invalid = [
    { ...proposal, changes: [] },
    { ...proposal, changes: Array(21).fill({ op: "note", task: "12345678", text: "Follow up", reason: "Requested" }) },
    { ...proposal, changes: {} },
    { ...proposal, snapshotId: "unknown" },
    { ...proposal, requestId: "short" },
    { ...proposal, extra: "unsupported" },
    ...[
      null, { ...change, task: "bad" }, { ...change, reason: "" },
      { ...change, op: "delete" }, { ...change, set: {} },
      { ...change, set: { status: "completed" } },
      { ...change, set: { owner: "someone" } },
      { ...change, set: { dueAt: "2026-10-22" } },
      { ...change, set: { dueAt: "2026-02-30T12:00:00Z" } },
      { op: "create", set: { title: "Missing bucket" }, reason: "Requested" },
      { op: "note", task: "12345678", text: "", reason: "Requested" },
    ].map(item => ({ ...proposal, changes: [item] })),
    { ...proposal, changes: [change, { ...change, task: "1234-5678" }] },
  ];
  for (const value of invalid) {
    const f = fixture();
    await assert.rejects(f.controller.begin(f.sender, JSON.stringify(value)));
    assert.equal(f.calls.length, 0, JSON.stringify(value));
    assert.deepEqual(f.data, {}, "Invalid payloads must not reach session storage");
  }
  const f = fixture();
  const twenty = { ...proposal, changes: Array.from({ length: 20 }, (_, i) => ({ op: "note", task: "12345678", text: `Note ${i}`, reason: "Requested" })) };
  await f.controller.begin(f.sender, JSON.stringify(twenty));
  assert.equal(f.calls.length, 1, "20 real changes remain transferable");
});
test("Apply reuses a capable board tab without navigating, closing or focusing it", async () => {
  const f = fixture();
  const url = new URL(TASKBOARD_REVIEW_URL).origin + "/?taskId=selected";
  f.api.tabs.query = async () => [{ id: 45, url, windowId: 5 }];
  const messages = [];
  f.api.tabs.sendMessage = async (id, message) => { messages.push({ id, message }); return message.type === "review-capabilities" ? { protocol: 2, url } : { ok: true }; };
  let focused = false;
  f.api.tabs.update = async () => { focused = true; };
  const token = crypto.randomUUID();
  const { transferId } = await f.controller.begin(f.sender, body, "apply", token);
  assert.equal(f.calls.length, 0);
  assert.equal(focused, false);
  const receiver = { url, tab: { id: 45 } };
  assert.deepEqual(await f.controller.pending(receiver, transferId), { transferId, proposal: body, intent: "apply" });
  await f.controller.complete({ ...receiver, tab: { id: 99 } }, transferId, { ok: true, message: "Applied" });
  assert.ok(await f.controller.pending(receiver, transferId));
  await f.controller.complete(receiver, transferId, { ok: true, message: "Applied", type: "injected-type", prompt: "must not forward" });
  assert.deepEqual(messages.at(-1), { id: f.sender.tab.id, message: { type: "proposal-result", transferId, requestId: "test-request-1", clientToken: token, ok: true, message: "Applied" } });
  assert.equal(await f.controller.pending(receiver, transferId), null);
  assert.deepEqual(f.removed, [], "Reused board tabs must never close after Apply");
});
test("older or busy board tabs fall back to an isolated review tab", async () => {
  const f = fixture();
  f.api.tabs.query = async () => [{ id: 45, url: new URL(TASKBOARD_REVIEW_URL).origin, windowId: 5 }];
  f.api.tabs.sendMessage = async () => ({ protocol: 1 });
  await f.controller.begin(f.sender, body, "apply");
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /copilot-review\?transfer=/);
  assert.equal(f.calls[0].active, false, "Apply must not foreground another confirmation");
});

test("successful fallback Apply closes only its own inactive receiver after reporting to Copilot", async () => {
  for (const scenario of ["success", "redacted", "failure", "activated", "navigated"]) {
    const f = fixture();
    const { transferId } = await f.controller.begin(f.sender, body, "apply");
    const tab = f.calls[0];
    const receiver = { url: tab.url, tab: { id: tab.id } };
    const messages = [];
    f.api.tabs.sendMessage = async (id, message) => { messages.push({ id, message }); if (message.type === "review-ping") return { transferId, url: tab.url }; };
    if (scenario === "activated") tab.active = true;
    if (scenario === "navigated") tab.url = "https://other.example/";
    if (scenario === "redacted") f.api.tabs.get = async id => ({ ...f.tabs.get(id), url: undefined });
    await f.controller.complete(receiver, transferId, { ok: scenario !== "failure", message: "Confirmed result" });
    assert.equal(messages[0].id, f.sender.tab.id);
    assert.equal(messages[0].message.type, "proposal-result");
    assert.deepEqual(f.removed, ["success", "redacted"].includes(scenario) ? [tab.id] : []);
  }
});

test("explicit Review details opens and retains its foreground review tab", async () => {
  const f = fixture();
  const { transferId } = await f.controller.begin(f.sender, body, "review");
  const tab = f.calls[0];
  assert.equal(tab.active, true);
  await f.controller.complete({ url: tab.url, tab: { id: tab.id } }, transferId, { ok: true, message: "Ready for review" });
  assert.deepEqual(f.removed, []);
});
test("approval tokens and task-discussion senders are bounded to the configured site", async () => {
  const f = fixture();
  await assert.rejects(f.controller.begin(f.sender, body, "apply", "x".repeat(40000)));
  assert.equal(f.calls.length, 0);
  assert.equal(await f.controller.canDiscuss({ url: new URL(TASKBOARD_REVIEW_URL).origin, tab: { id: 1 } }), true);
  assert.equal(await f.controller.canDiscuss({ url: new URL(TASKBOARD_REVIEW_URL).origin + "/api/tasks", tab: { id: 1 } }), false);
  assert.equal(await f.controller.canDiscuss({ url: "https://other.example/", tab: { id: 1 } }), false);
});
