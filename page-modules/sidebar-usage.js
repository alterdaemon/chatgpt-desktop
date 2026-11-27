(() => {
  const namespace = "__chatgptDesktopSidebarUsage";
  if (window[namespace]) {
    window[namespace].refresh();
    return;
  }
  const marker = "data-chatgpt-desktop-usage-percent";
  const labels = new Map();
  const percentage = value => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
    return `${Math.round(value)}%`;
  };
  const fromText = text => {
    const match = text.match(/(?:^|[^\d])([\d]+(?:[.,][\d]+)?)\s*%/);
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
        const found = fromProps(content);
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
    for (const [property, value, priority] of entry.styles) {
      if (value) trigger.style.setProperty(property, value, priority);
      else trigger.style.removeProperty(property);
    }
    labels.delete(trigger);
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
          label.style.cssText = "display:block!important;visibility:visible!important;opacity:1!important;pointer-events:none;white-space:nowrap;font:11px/14px monospace;font-variant-numeric:tabular-nums;color:inherit;flex-shrink:0";
          const layout = { display: "inline-flex", "flex-direction": "column", "align-items": "center", height: "auto", "min-height": "36px", "flex-shrink": "0" };
          const styles = Object.keys(layout).map(property => [property, trigger.style.getPropertyValue(property), trigger.style.getPropertyPriority(property)]);
          for (const [property, setting] of Object.entries(layout)) trigger.style.setProperty(property, setting, "important");
          entry = { label, styles };
          labels.set(trigger, entry);
          trigger.appendChild(label);
        } else if (entry.label.parentElement !== trigger) {
          trigger.appendChild(entry.label);
        }
        if (entry.label.textContent !== value) entry.label.textContent = value;
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
  window[namespace] = { refresh, destroy() {
    observer.disconnect();
    clearInterval(timer);
    if (frame !== null) cancelAnimationFrame(frame);
    for (const trigger of labels.keys()) remove(trigger);
    delete window[namespace];
  } };
  refresh();
})();
