// Test-only event budget for the passive sidebar adapter; no shipped counters.
function observeIdleEvents() {
  let active = false;
  let events = 0;
  const own = node => {
    const element = node instanceof Element ? node : node?.parentElement;
    return Boolean(element?.closest("[data-chatgpt-desktop-usage-layer], [data-chatgpt-desktop-usage-percent], [data-chatgpt-desktop-usage-style]"));
  };
  const count = () => { if (active) events++; };
  const mutation = new MutationObserver(records => {
    for (const record of records) {
      const nodes = [...record.addedNodes, ...record.removedNodes];
      if (own(record.target) || (nodes.length > 0 && nodes.every(own))) continue;
      if (record.type === "attributes" || !(record.target instanceof Element) || !record.target.closest("main")) {
        count(); return;
      }
    }
  });
  mutation.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ["aria-description", "stroke-dashoffset"],
  });
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(count) : null;
  if (resize) {
    for (const meter of document.querySelectorAll("button[aria-description]")) {
      if (!meter.querySelector("path[pathLength='100']") || !/%/.test(meter.getAttribute("aria-description"))) continue;
      resize.observe(meter);
      resize.observe(meter.closest("#app-shell-sidebar, aside") || document.documentElement);
    }
  }
  window.addEventListener("resize", count);
  window.addEventListener("focus", count);
  document.addEventListener("visibilitychange", count);
  return {
    begin() { events = 0; active = true; },
    end() {
      active = false;
      mutation.disconnect(); resize?.disconnect();
      window.removeEventListener("resize", count);
      window.removeEventListener("focus", count);
      document.removeEventListener("visibilitychange", count);
      return events;
    },
  };
}

module.exports = { observeIdleEvents };
