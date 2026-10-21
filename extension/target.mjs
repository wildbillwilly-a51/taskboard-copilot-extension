// This module has no default instance, account or deployment address.
export const SCRIPT_ID = "taskboard-review";
export function reviewTarget(input) {
  let url;
  try { url = new URL(input); } catch { throw Error("Enter your Taskboard HTTPS address."); }
  if (url.protocol !== "https:" || url.hostname.includes("*") || url.username || url.password || url.search || url.hash || !["/", "/copilot-review"].includes(url.pathname)) {
    throw Error("Use an HTTPS Taskboard address without credentials, a query, or a fragment.");
  }
  if (["m365.cloud.microsoft", "copilot.cloud.microsoft"].includes(url.hostname)) throw Error("Enter your Taskboard address, not the Copilot address.");
  return { url: `${url.origin}/copilot-review`, origin: `${url.origin}/*`, match: `${url.origin}/copilot-review*` };
}
export function createTargetController(api) {
  let queue = Promise.resolve();
  function serialized(run) { const next = queue.then(run); queue = next.catch(() => {}); return next; }
  async function unregister() {
    const scripts = await api.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (scripts.length) await api.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  async function getReviewUrl() {
    const { taskboardReviewUrl } = await api.storage.local.get("taskboardReviewUrl");
    if (!taskboardReviewUrl) return null;
    try {
      const target = reviewTarget(taskboardReviewUrl);
      return await api.permissions.contains({ origins: [target.origin] }) ? target.url : null;
    } catch { return null; }
  }
  async function register(target) {
    await api.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: [target.match], js: ["taskboard-review.js"], runAt: "document_idle", persistAcrossSessions: true }]);
  }
  async function forget() {
    await api.storage.local.remove("taskboardReviewUrl");
    await api.storage.session.set({ copilotReviewTransfers: {} });
    await unregister();
  }
  return {
    getReviewUrl,
    save(input) { return serialized(async () => {
      const target = reviewTarget(input);
      if (!await api.permissions.contains({ origins: [target.origin] })) throw Error("Allow access to this Taskboard site before saving.");
      const previous = await getReviewUrl();
      await forget();
      try {
        await register(target);
        await api.storage.local.set({ taskboardReviewUrl: target.url });
      } catch (error) {
        await forget();
        throw error;
      }
      if (previous && previous !== target.url) await api.permissions.remove({ origins: [reviewTarget(previous).origin] });
      return target.url;
    }); },
    clear() { return serialized(async () => {
      const { taskboardReviewUrl } = await api.storage.local.get("taskboardReviewUrl");
      await forget();
      if (taskboardReviewUrl) try { await api.permissions.remove({ origins: [reviewTarget(taskboardReviewUrl).origin] }); } catch { /* Already revoked or invalid. */ }
    }); },
    reconcile() { return serialized(async () => {
      const url = await getReviewUrl();
      await unregister();
      if (url) await register(reviewTarget(url));
      else await forget();
    }); },
  };
}
