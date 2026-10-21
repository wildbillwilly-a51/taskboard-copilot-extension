export const COPILOT_URL = "https://m365.cloud.microsoft/chat";
export const SPLIT_GUIDE = "Tabs prepared — one browser step left. Right-click either selected tab and choose New Split View. Then drag the divider to resize. If you clicked away, select both tabs again first.";

export function popupBounds(saved = {}, anchor = {}) {
  const area = { left: anchor.left ?? 0, top: anchor.top ?? 0, width: anchor.width ?? 1200, height: anchor.height ?? 900 };
  const width = Math.min(Math.max(240, Math.round(saved.width || 320)), Math.max(240, area.width));
  const height = Math.min(Math.max(400, Math.round(saved.height || 800)), Math.max(400, area.height));
  return { width, height,
    left: Math.round(Math.max(area.left, Math.min(saved.left ?? area.left + area.width - width, area.left + area.width - width))),
    top: Math.round(Math.max(area.top, Math.min(saved.top ?? area.top, area.top + area.height - height))),
  };
}

// One worker-owned queue prevents double clicks from creating duplicate hosts.
// Session IDs survive worker suspension, but cannot collide after browser restart.
export function createHostController(api) {
  let queue = Promise.resolve();
  const getTab = async (id) => {
    if (!Number.isInteger(id)) return null;
    try { return await api.tabs.get(id); } catch { return null; }
  };
  async function popup(source) {
    const { popupWindowId } = await api.storage.session.get("popupWindowId");
    let existing;
    if (Number.isInteger(popupWindowId)) {
      try { existing = await api.windows.get(popupWindowId); } catch { /* Closed by the owner. */ }
    }
    if (existing?.type === "popup") {
      await api.windows.update(existing.id, { ...(existing.state === "minimized" ? { state: "normal" } : {}), focused: true });
      return { mode: "popup", windowId: existing.id };
    }
    const { popupBounds: saved } = await api.storage.local.get("popupBounds");
    const anchor = await api.windows.get(source?.windowId ?? api.windows.WINDOW_ID_CURRENT);
    const bounds = popupBounds(saved, anchor);
    // Let the OS place a first window. Saved monitor coordinates may become
    // invalid after a display is disconnected; retry once with OS placement.
    if (!Number.isFinite(saved?.left) || !Number.isFinite(saved?.top)) { delete bounds.left; delete bounds.top; }
    let created;
    try { created = await api.windows.create({ url: COPILOT_URL, type: "popup", focused: true, ...bounds }); }
    catch (error) {
      if (!/bounds.*visible screen/i.test(error.message) || bounds.left === undefined) throw error;
      delete bounds.left; delete bounds.top;
      created = await api.windows.create({ url: COPILOT_URL, type: "popup", focused: true, ...bounds });
    }
    await api.storage.session.set({ popupWindowId: created.id });
    return { mode: "popup", windowId: created.id };
  }
  async function split(source) {
    const { splitPairs = [] } = await api.storage.session.get("splitPairs");
    let pair = splitPairs.find((item) => item.sourceId === source?.id || item.tabId === source?.id);
    if (pair?.tabId === source?.id) source = await getTab(pair.sourceId);
    if (!source?.id) throw new Error("Open the extension from the Taskboard tab first.");
    source = await api.tabs.get(source.id);
    const window = await api.windows.get(source.windowId);
    if (window.type !== "normal") throw new Error("Open Split View from Taskboard in a normal browser window.");
    let tab = pair && await getTab(pair.tabId);
    if (tab?.windowId !== source.windowId) { tab = null; pair = null; }
    const inSplit = (item) => Number.isInteger(item?.splitViewId) && item.splitViewId >= 0;
    if (tab && inSplit(source) && source.splitViewId === tab.splitViewId) {
      await api.tabs.update(tab.id, { active: true });
      return { mode: "split", automatic: true, tabId: tab.id };
    }
    if (inSplit(source) || inSplit(tab)) throw new Error("A tab is already in another Split View. Unsplit it yourself before pairing with Copilot.");
    if (tab && (tab.pinned !== source.pinned || tab.groupId !== source.groupId)) {
      throw new Error("The prepared Copilot tab changed its pin or group. Put both tabs in the same group and pin state, or close that Copilot tab to prepare another.");
    }
    if (!tab) {
      tab = await api.tabs.create({ url: COPILOT_URL, windowId: source.windowId, index: source.index + 1, pinned: source.pinned, active: false });
      pair = { sourceId: source.id, tabId: tab.id };
      // Record before grouping/pairing so failures can reuse the same draft tab.
      const live = [];
      for (const item of splitPairs) if (item.sourceId !== source.id && await getTab(item.tabId)) live.push(item);
      await api.storage.session.set({ splitPairs: [...live, pair] });
      if (source.groupId >= 0) await api.tabs.group({ tabIds: [tab.id], groupId: source.groupId });
    }
    // Only our own prepared tab moves; existing user tabs/drafts are never navigated.
    const currentTab = await api.tabs.get(tab.id);
    await api.tabs.move(tab.id, { index: source.index + (currentTab.index < source.index ? 0 : 1) });
    let automatic = false;
    let detail;
    if (typeof api.tabs.createSplit === "function") {
      try { await api.tabs.createSplit([source.id, tab.id]); automatic = true; }
      catch { detail = "Automatic pairing was unavailable. Finish with the tab menu."; }
    }
    if (automatic) await api.tabs.update(tab.id, { active: true });
    else {
      const currentSource = await api.tabs.get(source.id);
      const currentTab = await api.tabs.get(tab.id);
      await api.tabs.highlight({ windowId: source.windowId, tabs: [currentSource.index, currentTab.index] });
    }
    return { mode: "split", automatic, tabId: tab.id, guide: automatic ? null : SPLIT_GUIDE, detail };
  }
  return {
    open(mode, source) {
      const request = queue.then(async () => {
        if (!["popup", "split"].includes(mode)) throw new Error("Choose Split View or Separate window.");
        return mode === "popup" ? popup(source) : split(source);
      });
      queue = request.catch(() => {});
      return request;
    },
    async saveBounds(window) {
      const { popupWindowId } = await api.storage.session.get("popupWindowId");
      if (window.id === popupWindowId && window.state === "normal") {
        const { left, top, width, height } = window;
        await api.storage.local.set({ popupBounds: { left, top, width, height } });
      }
    },
    async guideFor(tabId) {
      const { splitPairs = [] } = await api.storage.session.get("splitPairs");
      if (!splitPairs.some((pair) => pair.tabId === tabId)) return null;
      const tab = await getTab(tabId);
      return tab && !(Number.isInteger(tab.splitViewId) && tab.splitViewId >= 0) ? SPLIT_GUIDE : null;
    },
  };
}
