import test from "node:test";
import assert from "node:assert/strict";
import { createTargetController, reviewTarget } from "../extension/target.mjs";
import { createReviewController } from "../extension/review-controller.mjs";

function fixture() {
  const local = {}, session = {}, grants = new Set(), scripts = new Map();
  const api = {
    storage: {
      local: { async get(key) { return { [key]: local[key] }; }, async set(value) { Object.assign(local, value); }, async remove(key) { delete local[key]; } },
      session: { async get(key) { return { [key]: session[key] }; }, async set(value) { Object.assign(session, value); } },
    },
    permissions: { async contains({ origins }) { return origins.every(origin => grants.has(origin)); }, async remove({ origins }) { origins.forEach(origin => grants.delete(origin)); return true; } },
    scripting: {
      async getRegisteredContentScripts() { return [...scripts.values()]; },
      async unregisterContentScripts({ ids }) { ids.forEach(id => scripts.delete(id)); },
      async registerContentScripts(values) { for (const value of values) { if (scripts.has(value.id)) throw Error("Duplicate script"); scripts.set(value.id, value); } },
    },
    windows: { async get() { return { type: "normal" }; } },
    tabs: { async create(value) { return { ...value, id: 10 }; } },
  };
  return { local, session, grants, scripts, api, targets: createTargetController(api) };
}
test("instance address is explicit, HTTPS-only and contains no credentials or payload", () => {
  assert.deepEqual(reviewTarget("https://board.example/"), { url: "https://board.example/copilot-review", origin: "https://board.example/*", match: "https://board.example/copilot-review*" });
  assert.equal(reviewTarget("https://board.example/copilot-review").url, "https://board.example/copilot-review");
  for (const value of ["", "http://board.example", "javascript:alert(1)", "https://*.example", "https://fixture@board.example", "https://board.example/?secret=1", "https://board.example/#token", "https://board.example/unrelated", "https://m365.cloud.microsoft/"]) assert.throws(() => reviewTarget(value));
});
test("no default host; denied grants cannot save or register anything", async () => {
  const f = fixture();
  assert.equal(await f.targets.getReviewUrl(), null);
  await assert.rejects(f.targets.save("https://board.example"), /Allow access/);
  assert.deepEqual(f.local, {});
  assert.equal(f.scripts.size, 0);
  const reviews = createReviewController(f.api, { getReviewUrl: f.targets.getReviewUrl });
  await assert.rejects(reviews.begin({ url: "https://m365.cloud.microsoft/chat", tab: { id: 1 } }, "{}"), /Settings/);
});
test("registration is narrow, persists, and retargeting invalidates old transfers", async () => {
  const f = fixture();
  f.grants.add("https://board.example/*");
  await f.targets.save("https://board.example");
  assert.equal(await f.targets.getReviewUrl(), "https://board.example/copilot-review");
  const script = f.scripts.get("taskboard-review");
  assert.deepEqual(script.matches, ["https://board.example/copilot-review*"]);
  assert.deepEqual(script.js, ["taskboard-review.js"]);
  assert.equal(script.persistAcrossSessions, true);
  f.session.copilotReviewTransfers = { private: { proposal: "pending" } };
  f.grants.add("https://second.example/*");
  await f.targets.save("https://second.example");
  assert.deepEqual(f.session.copilotReviewTransfers, {});
  assert.equal(f.grants.has("https://board.example/*"), false);
  assert.equal(await f.targets.getReviewUrl(), "https://second.example/copilot-review");
  await f.targets.clear();
  assert.deepEqual(f.local, {});
  assert.equal(f.scripts.size, 0);
  assert.equal(f.grants.size, 0);
});
test("revoked permissions and registration failures leave the bridge disconnected", async () => {
  const f = fixture();
  f.grants.add("https://board.example/*");
  await f.targets.save("https://board.example");
  f.grants.clear();
  assert.equal(await f.targets.getReviewUrl(), null);
  await f.targets.reconcile();
  assert.equal(f.scripts.size, 0);
  assert.deepEqual(f.local, {});
  f.grants.add("https://board.example/*");
  f.api.scripting.registerContentScripts = async () => { throw Error("Registration failed"); };
  await assert.rejects(f.targets.save("https://board.example"), /Registration failed/);
  assert.deepEqual(f.local, {});
  assert.equal(f.scripts.size, 0);
});
test("in-flight proposals remain tied to the configured origin", async () => {
  const f = fixture();
  f.grants.add("https://board.example/*");
  await f.targets.save("https://board.example");
  const reviews = createReviewController(f.api, { getReviewUrl: f.targets.getReviewUrl });
  const body = JSON.stringify({ type: "taskboard-proposal", version: 1, changes: [] });
  const { transferId } = await reviews.begin({ url: "https://m365.cloud.microsoft/chat", tab: { id: 1, windowId: 2 } }, body);
  const receiver = { url: "https://board.example/copilot-review", tab: { id: 10 } };
  assert.ok(await reviews.pending(receiver, transferId));
  f.local.taskboardReviewUrl = "https://second.example/copilot-review";
  f.grants.add("https://second.example/*");
  assert.equal(await reviews.pending({ ...receiver, url: "https://second.example/copilot-review" }, transferId), null);
  assert.equal(await reviews.pending(receiver, transferId), null);
});
