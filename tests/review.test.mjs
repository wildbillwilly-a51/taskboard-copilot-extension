import assert from "node:assert/strict";
import test from "node:test";
import { createReviewController, isCopilotPage, isTaskboardReviewPage } from "../extension/review-controller.mjs";

const TASKBOARD_REVIEW_URL = "https://board.example/copilot-review";
const body = JSON.stringify({ type: "taskboard-proposal", version: 1, snapshotId: "abcdef123456", requestId: "test-request-1", changes: [] });
function fixture() {
  const data = {}, tabs = new Map(), calls = [];
  const api = {
    storage: { session: { async get(key) { return { [key]: data[key] }; }, async set(value) { Object.assign(data, value); } } },
    windows: { async get(id) { return { id, type: "normal" }; }, async update() {} },
    tabs: {
      async create(value) { const tab = { ...value, id: tabs.size + 10 }; tabs.set(tab.id, tab); calls.push(tab); return tab; },
      async get(id) { if (!tabs.has(id)) throw Error("Closed"); return tabs.get(id); },
      async update() {},
      async sendMessage(id) { const tab = tabs.get(id); return { transferId: new URL(tab.url).searchParams.get("transfer"), url: tab.url }; },
    },
  };
  const sender = { url: "https://m365.cloud.microsoft/chat", tab: { id: 1, windowId: 5 } };
  return { api, data, tabs, calls, sender, controller: createReviewController(api, { getReviewUrl: async () => TASKBOARD_REVIEW_URL }) };
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
