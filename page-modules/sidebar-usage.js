(() => {
  const namespace = "__chatgptDesktopSidebarUsage";
  if (window[namespace]) {
    window[namespace].refresh();
    return;
  }

  // Shows the remaining usage percentage in place of the sidebar usage meter's diamond.
  //
  // Value source: the meter is a button whose aria-description holds the current remaining
  // percentage ("Weekly usage: 1% left") for as long as it is rendered; its hover tooltip only has
  // text while open, so it is never used. No requests are made and nothing is written to the site's
  // own elements: the number is drawn in a separate pointer-transparent layer.
  //
  // Refresh is event-driven, with no timer: it runs only when the meter's own attributes change,
  // when nodes are added or removed outside the conversation, when the meter or its sidebar is
  // resized, and when the window is shown or focused again. The site refreshes its own usage data
  // (periodically, on focus and after each reply), which changes the meter's description and wakes
  // this module; it therefore never needs a timer or a request of its own. Streaming replies change only the conversation and never wake this module.
  const marker = "data-chatgpt-desktop-usage-percent";
  const SIDEBAR = "#app-shell-sidebar, aside";
  const ROW = "[data-sidebar-archive-chatgpt-id], [data-explore-row]";
  const RING = "path[pathLength='100']";
  const labels = new Map();
  let runs = 0;

  const layer = document.createElement("div");
  layer.setAttribute("data-chatgpt-desktop-usage-layer", "");
  layer.setAttribute("aria-hidden", "true");
  // Zero-sized: labels are positioned relative to the viewport origin, so there is no viewport-sized layer to composite.
  layer.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none!important;z-index:2147483646";

  // While a percentage is shown the site's own animated diamond/ring is hidden and its animations
  // are stopped, rather than merely covered: a covered animation still costs CPU (the meter pulses
  // when usage is low). Only the SVGs are hidden, so the meter keeps its size, its pointer
  // handling and its native tooltip. The style exists only while a percentage is displayed, so the
  // button is never left blank.
  const meterStyle = document.createElement("style");
  meterStyle.setAttribute("data-chatgpt-desktop-usage-style", "");
  const meterSelector = ":is(#app-shell-sidebar, aside) :is(button, [role=\"button\"]):has(path[pathLength=\"100\"][stroke=\"currentColor\"])";
  meterStyle.textContent = `${meterSelector} svg { visibility: hidden !important; }
${meterSelector}, ${meterSelector} *, ${meterSelector} *::before, ${meterSelector} *::after { animation: none !important; transition: none !important; }`;
  meterStyle.disabled = true;
  document.documentElement.appendChild(meterStyle);

  const percentage = value => `${Math.round(value)}%`;

  // Numbers only, so localized descriptions work, including "%1" style formats. With two windows
  // ("5-hour ... Weekly ...") the lower remaining value is the one that limits the user.
  const percentsFrom = text => {
    const found = [];
    for (const match of String(text).matchAll(/(\d+(?:[.,]\d+)?)\s*%|%\s*(\d+(?:[.,]\d+)?)/g)) {
      const value = Number(String(match[1] ?? match[2]).replace(",", "."));
      if (Number.isFinite(value) && value >= 0 && value <= 100) found.push(value);
    }
    return found;
  };

  const ringArcs = element => [...element.querySelectorAll(RING)].filter(path => path.getAttribute("stroke") === "currentColor");

  function readMeter(element) {
    if (!element.querySelector("svg")) return null;
    const values = percentsFrom(element.getAttribute("aria-description") || "");
    if (values.length) return percentage(Math.min(...values));
    // No description: the ring encodes it (dash offset = 100 - remaining).
    const arcs = ringArcs(element);
    const remaining = arcs.map(path => 100 - parseFloat(getComputedStyle(path).strokeDashoffset));
    return arcs.length && remaining.every(value => Number.isFinite(value) && value >= 0 && value <= 100)
      ? percentage(Math.min(...remaining)) : null;
  }

  function findMeters() {
    const found = new Set();
    for (const element of document.querySelectorAll("[aria-description]")) {
      if (element.closest("[role='tooltip'], [popover]")) continue;
      // Percent text elsewhere is not usage: outside a conversation row it needs the sidebar,
      // inside one it needs the meter's ring.
      if (element.querySelector(RING) || (element.closest(SIDEBAR) && !element.closest(ROW))) found.add(element);
    }
    for (const arc of document.querySelectorAll(`${RING}[stroke='currentColor']`)) {
      const element = arc.closest("button, [role='button']");
      if (element && element.closest(SIDEBAR)) found.add(element);
    }
    return found;
  }

  let resizeObserver = null;

  function remove(meter) {
    const entry = labels.get(meter);
    if (!entry) return;
    entry.label.remove();
    if (resizeObserver) { resizeObserver.unobserve(meter); resizeObserver.unobserve(entry.container); }
    labels.delete(meter);
  }

  // Typography follows the sidebar's own text so the number looks native: same family and size,
  // reduced only as far as needed for the whole text ("100%") to fit within the meter's width.
  // The backing hides the diamond and must blend with the sidebar: use the first opaque background
  // behind the meter, and white text on a dark one (near-black on a light one) so it stays readable.
  function surface(element) {
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const match = getComputedStyle(node).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (!match) continue;
      const [r, g, b, a = 1] = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      if (a >= 0.99) return { background: `rgb(${r}, ${g}, ${b})`, dark: 0.2126 * r + 0.7152 * g + 0.0722 * b < 140 };
    }
    return { background: "rgb(0, 0, 0)", dark: true };
  }

  const MAX_FONT = 16;
  const MIN_FONT = 10;

  function place(entry, meter) {
    const { label, container } = entry;
    const rect = meter.getBoundingClientRect();
    const bounds = container.getBoundingClientRect();
    const containerStyle = getComputedStyle(container);
    const visible = rect.width > 0 && rect.height > 0 && rect.right > bounds.left && rect.left < bounds.right &&
      rect.bottom > Math.max(0, bounds.top) && rect.top < Math.min(innerHeight, bounds.bottom) &&
      containerStyle.visibility !== "hidden" && containerStyle.display !== "none";
    label.style.display = visible ? "flex" : "none";
    if (!visible) return;
    const base = Math.min(MAX_FONT, parseFloat(containerStyle.fontSize) || 14);
    label.style.fontFamily = containerStyle.fontFamily;
    const { background, dark } = surface(meter.parentElement || container);
    label.style.setProperty("background", background, "important");
    label.style.setProperty("color", dark ? "#fff" : "#111", "important");
    label.style.width = "max-content";
    label.style.fontSize = `${base}px`;
    const natural = label.getBoundingClientRect().width;
    const room = Math.max(1, rect.width - 2);
    const size = natural > room ? Math.max(MIN_FONT, Math.floor(base * room / natural * 2) / 2) : base;
    label.style.fontSize = `${size}px`;
    const width = Math.max(rect.width, Math.ceil(label.getBoundingClientRect().width));
    const height = Math.max(rect.height, 20);
    label.style.width = `${width}px`;
    label.style.height = `${height}px`;
    label.style.lineHeight = `${height}px`;
    label.style.left = `${Math.max(bounds.left, Math.min(rect.left + (rect.width - width) / 2, bounds.right - width))}px`;
    label.style.top = `${Math.max(0, Math.min(rect.top + (rect.height - height) / 2, innerHeight - height))}px`;
  }

  function refresh() {
    runs++;
    const active = new Set();
    for (const meter of findMeters()) {
      const value = readMeter(meter);
      if (value === null) continue;
      active.add(meter);
      let entry = labels.get(meter);
      if (!entry) {
        const label = document.createElement("span");
        label.setAttribute(marker, "");
        label.setAttribute("aria-hidden", "true");
        label.style.cssText = "position:absolute;align-items:center;justify-content:center;box-sizing:border-box;visibility:visible!important;opacity:1!important;pointer-events:none!important;white-space:nowrap;font-weight:700;font-variant-numeric:tabular-nums;padding:0";
        entry = { label, container: meter.closest(SIDEBAR) || document.documentElement };
        labels.set(meter, entry);
        if (resizeObserver) { resizeObserver.observe(meter); resizeObserver.observe(entry.container); }
      }
      if (!layer.isConnected) document.documentElement.appendChild(layer);
      if (entry.label.parentElement !== layer) layer.appendChild(entry.label);
      if (entry.label.textContent !== value) entry.label.textContent = value;
      place(entry, meter);
    }
    for (const meter of [...labels.keys()]) if (!active.has(meter) || !meter.isConnected) remove(meter);
    const hide = labels.size > 0;
    if (meterStyle.disabled === hide) meterStyle.disabled = !hide;
  }

  let frame = null;
  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; refresh(); });
  };

  // Attribute records only arrive for the two filtered attributes. Added/removed nodes inside the
  // conversation (streaming) are ignored with one cheap ancestor check; everything else (sidebar,
  // tooltips and menus appended to the body) schedules a single coalesced refresh.
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") { schedule(); return; }
      const target = record.target;
      if (!(target instanceof Element) || !target.closest("main")) { schedule(); return; }
    }
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true, attributeFilter: ["aria-description", "stroke-dashoffset"],
  });
  resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
  window.addEventListener("resize", schedule, { passive: true });
  // A hidden or tray window pauses frame callbacks; re-check once when it is shown or focused again.
  // This is an event, not a timer: it costs nothing while the window sits unchanged.
  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("focus", schedule, { passive: true });

  window[namespace] = {
    refresh,
    get runs() { return runs; },
    destroy() {
      observer.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("focus", schedule);
      if (frame !== null) cancelAnimationFrame(frame);
      for (const meter of [...labels.keys()]) remove(meter);
      layer.remove();
      meterStyle.remove();
      delete window[namespace];
    },
  };
  refresh();
})();
