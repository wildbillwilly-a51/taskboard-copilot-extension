export function showConnection(root, state) {
  root.dataset.state = state.state || "attention";
  root.title = state.detail;
  root.querySelector("[data-connection-label]").textContent = state.label;
  root.querySelector("[data-connection-icon]").textContent = state.connected ? "✓" : "!";
  root.querySelector("[data-connection-site]").textContent = state.site || "No Taskboard website selected";
  root.querySelector("[data-connection-detail]").textContent = state.detail;
  const open = root.querySelector("[data-open-taskboard]");
  if (open) {
    open.hidden = !state.connected;
    if (state.connected) open.href = state.reviewUrl;
    else open.removeAttribute("href");
  }
}
