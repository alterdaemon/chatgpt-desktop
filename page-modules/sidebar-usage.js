(() => {
  const namespace = "__chatgptDesktopSidebarUsage";
  if (window[namespace]) {
    window[namespace].refresh();
    return;
  }
  const marker = "data-chatgpt-desktop-usage-percent";
  const labels = new Map();
  const layer = document.createElement("div");
  layer.setAttribute("data-chatgpt-desktop-usage-layer", "");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none!important;z-index:2147483646";
  const percentage = value => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
    return `${Math.round(value)}%`;
  };
  const fromText = text => {
    const match = text.match(/(?:^|[^\d.,+-])([\d]+(?:[.,][\d]+)?)\s*%/);
    return match ? percentage(Number(match[1].replace(",", "."))) : null;
  };
  const usageText = text => /weekly|usage|remaining|left|limit/i.test(text) ? fromText(text) : null;

  // Read only tooltip/usage props already held by the website. Do not access an
  // account store, fetch usage, open a tooltip, or export any of its contents.
  function fromProps(value, depth = 0, seen = new Set()) {
    if (depth > 7 || value == null || seen.has(value)) return null;
    if (typeof value === "string") return usageText(value);
    if (typeof value !== "object") return null;
    seen.add(value);
    for (const key of ["remainingPercent", "remaining_percent"]) {
      const found = percentage(value[key]);
      if (found !== null) return found;
    }
    const children = Array.isArray(value) ? value : [value.props, value.values, value.tooltipContent, value.content, value.children];
    for (const child of children.slice(0, 40)) {
      const found = fromProps(child, depth + 1, seen);
      if (found !== null) return found;
    }
    return null;
  }

  // React/i18n commonly splits "Weekly · 3% left" across multiple children.
  // Joining only bounded tooltip children avoids mistaking each fragment for
  // an independent label, without invoking components or reading account stores.
  function tooltipPercentage(value) {
    const numeric = fromProps(value);
    if (numeric !== null) return numeric;
    const seen = new Set();
    let budget = 120;
    const text = (node, depth = 0) => {
      if (--budget < 0 || depth > 10 || node == null) return "";
      if (typeof node === "string" || typeof node === "number") return String(node).slice(0, 256);
      if (typeof node !== "object" || seen.has(node)) return "";
      seen.add(node);
      if (Array.isArray(node)) return node.slice(0, 40).map(child => text(child, depth + 1)).join("");
      return text(node.props?.children ?? node.children, depth + 1);
    };
    return usageText(text(value).slice(0, 2048));
  }

  function readPercentage(trigger, sidebar) {
    for (const attribute of ["interestfor", "aria-describedby"]) {
      for (const id of (trigger.getAttribute(attribute) || "").split(/\s+/).filter(Boolean)) {
        const tooltip = document.getElementById(id);
        const found = tooltip && usageText(tooltip.textContent || "");
        if (found) return found;
      }
    }
    const label = trigger.getAttribute("aria-label") || "";
    const labelled = usageText(label);
    if (labelled !== null) return labelled;
    if (/remaining|left/i.test(label)) {
      const now = trigger.getAttribute("aria-valuenow");
      const found = now !== null && now.trim() ? percentage(Number(now)) : null;
      if (found !== null) return found;
    }
    if (trigger.hasAttribute("data-ambient-usage-label")) {
      const clone = trigger.cloneNode(true);
      clone.querySelectorAll(`[${marker}]`).forEach(node => node.remove());
      const found = usageText(clone.textContent || "");
      if (found !== null) return found;
    }
    const key = Object.keys(trigger).find(key => key.startsWith("__reactFiber$"));
    let current = key ? trigger[key] : null;
    let root = current;
    for (let depth = 0; root?.return && depth < 100; depth++) root = root.return;
    // React may keep the DOM pointer on the previous alternate after a commit.
    // Prefer the branch belonging to the current root, not stale tooltip props.
    if (root?.stateNode?.current && root.stateNode.current !== root && current?.alternate) current = current.alternate;
    for (let fiber = current, depth = 0; fiber && depth < 12; fiber = fiber.return, depth++) {
      if (fiber.stateNode instanceof HTMLElement && !sidebar.contains(fiber.stateNode)) break;
      const props = fiber.memoizedProps;
      for (const content of [props?.tooltipContent, props?.content]) {
        const found = tooltipPercentage(content);
        if (found !== null) return found;
      }
      const found = percentage(props?.remainingPercent);
      if (found !== null) return found;
    }
    return null;
  }

  function remove(trigger) {
    const entry = labels.get(trigger);
    if (!entry) return;
    entry.label.remove();
    labels.delete(trigger);
  }

  function place(entry, trigger, sidebar) {
    const rect = trigger.getBoundingClientRect();
    const bounds = sidebar.getBoundingClientRect();
    const style = getComputedStyle(trigger);
    const visible = rect.width > 0 && rect.height > 0 && rect.right > bounds.left && rect.left < bounds.right &&
      rect.bottom > Math.max(0, bounds.top) && rect.top < Math.min(innerHeight, bounds.bottom) &&
      style.visibility !== "hidden" && style.display !== "none";
    entry.label.style.display = visible ? "block" : "none";
    if (!visible) return;
    entry.label.style.color = style.color;
    entry.label.style.backgroundColor = getComputedStyle(sidebar).backgroundColor;
    const width = entry.label.getBoundingClientRect().width;
    entry.label.style.left = `${Math.max(bounds.left, Math.min(rect.left + (rect.width - width) / 2, bounds.right - width))}px`;
    entry.label.style.top = `${Math.min(rect.bottom - 1, innerHeight - 12)}px`;
  }

  function refresh() {
    const active = new Set();
    for (const sidebar of document.querySelectorAll("aside, #app-shell-sidebar")) {
      const candidates = sidebar.querySelectorAll("[interestfor], [aria-describedby], [data-ambient-usage-label], [role='progressbar'][aria-label]");
      for (const candidate of candidates) {
        // Conversation/project hover text is not usage data, even if its title
        // happens to contain a percentage or words such as "weekly" or "left".
        if (candidate.closest("[data-sidebar-archive-chatgpt-id], [data-explore-row]")) continue;
        const trigger = candidate.closest("button, [role='button']") || candidate;
        if (active.has(trigger) || trigger.closest("[role='tooltip'], [popover]")) continue;
        const value = readPercentage(candidate, sidebar) ?? readPercentage(trigger, sidebar);
        if (value === null) continue;
        active.add(trigger);
        let entry = labels.get(trigger);
        if (!entry) {
          const label = document.createElement("span");
          label.setAttribute(marker, "");
          label.setAttribute("aria-hidden", "true");
          label.style.cssText = "position:absolute;visibility:visible!important;opacity:1!important;pointer-events:none!important;white-space:nowrap;font:10px/12px monospace;font-variant-numeric:tabular-nums;padding:0 1px";
          entry = { label };
          labels.set(trigger, entry);
        }
        // Never insert children or change geometry on the site's interest target.
        // Its native hover/React lifecycle must not depend on our label's presence.
        if (!layer.isConnected) document.documentElement.appendChild(layer);
        if (entry.label.parentElement !== layer) layer.appendChild(entry.label);
        if (entry.label.textContent !== value) entry.label.textContent = value;
        place(entry, trigger, sidebar);
      }
    }
    for (const trigger of labels.keys()) if (!active.has(trigger) || !trigger.isConnected) remove(trigger);
  }

  let frame = null;
  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; refresh(); });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-label", "aria-valuenow", "aria-describedby", "interestfor", "data-ambient-usage-label"] });
  const timer = setInterval(schedule, 1000); // React-only prop updates need not mutate the DOM.
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window[namespace] = { refresh, destroy() {
    observer.disconnect();
    clearInterval(timer);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, true);
    if (frame !== null) cancelAnimationFrame(frame);
    for (const trigger of labels.keys()) remove(trigger);
    layer.remove();
    delete window[namespace];
  } };
  refresh();
})();
