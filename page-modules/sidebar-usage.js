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

  function fromFormattedTooltip(props, numericOnly) {
    if (!props || typeof props.defaultMessage !== "string" || !props.values || typeof props.values !== "object") return null;
    const message = props.defaultMessage.slice(0, 2048);
    if (!/remaining|left/i.test(message)) return null;
    // Within conversation rows, only a usage-specific message descriptor may
    // supply an interpolated number; a formatted conversation title is not data.
    if (numericOnly && !/^(?:composer\.mode\.rateLimit\.|codex\.(?:rateLimit|usage)|sidebar\.usage\.)/.test(props.id || "")) return null;
    const matches = [...message.matchAll(/\{\s*(\w+)\s*(?:,\s*number\s*)?\}\s*%|\{\s*(\w+)\s*,\s*number\s*,\s*(?:::)?percent\s*\}/g)];
    if (matches.length !== 1) return null;
    const match = matches[0];
    const value = props.values[match[1] || match[2]];
    return typeof value === "number" ? percentage(match[2] ? value * 100 : value) : null;
  }

  // Read only tooltip/usage props already held by the website. Do not access an
  // account store, fetch usage, open a tooltip, or export any of its contents.
  function fromProps(value, depth = 0, seen = new Set(), numericOnly = false) {
    if (depth > 7 || value == null || seen.has(value)) return null;
    if (typeof value === "string") return numericOnly ? null : usageText(value);
    if (typeof value !== "object") return null;
    seen.add(value);
    for (const key of ["remainingPercent", "remaining_percent"]) {
      const found = percentage(value[key]);
      if (found !== null) return found;
    }
    const formatted = fromFormattedTooltip(value.props || value, numericOnly);
    if (formatted !== null) return formatted;
    const children = Array.isArray(value) ? value : [value.props, value.values, value.tooltipContent, value.tooltip, value.content, value.children];
    for (const child of children.slice(0, 40)) {
      const found = fromProps(child, depth + 1, seen, numericOnly);
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

  function readReactPercentage(trigger, sidebar, numericOnly) {
    const key = Object.keys(trigger).find(key => key.startsWith("__reactFiber$"));
    let current = key ? trigger[key] : null;
    let root = current;
    for (let depth = 0; root?.return && depth < 100; depth++) root = root.return;
    // React may keep the DOM pointer on the previous alternate after a commit.
    // Prefer the branch belonging to the current root, not stale tooltip props.
    if (root?.stateNode?.current && root.stateNode.current !== root && current?.alternate) current = current.alternate;
    for (let fiber = current, depth = 0; fiber && depth < 32; fiber = fiber.return, depth++) {
      if (fiber.stateNode instanceof HTMLElement && !sidebar.contains(fiber.stateNode)) break;
      const props = fiber.memoizedProps;
      for (const content of [props?.tooltipContent, props?.tooltip, props?.content]) {
        const found = numericOnly ? fromProps(content, 0, new Set(), true) : tooltipPercentage(content);
        if (found !== null) return found;
      }
      const found = percentage(props?.remainingPercent);
      if (found !== null) return found;
    }
    return null;
  }

  function readPercentage(trigger, sidebar, numericOnly = false) {
    // Persistent site props, not the mounted/open tooltip, are the primary
    // value source. Hovering must not select a different or stale percentage.
    const current = readReactPercentage(trigger, sidebar, numericOnly);
    if (current !== null) return current;
    const label = trigger.getAttribute("aria-label") || "";
    const labelled = numericOnly ? null : usageText(label);
    if (labelled !== null) return labelled;
    if (/remaining|left/i.test(label)) {
      const now = trigger.getAttribute("aria-valuenow");
      const found = now !== null && now.trim() ? percentage(Number(now)) : null;
      if (found !== null) return found;
    }
    if (trigger.hasAttribute("data-ambient-usage-label")) {
      const found = fromText(trigger.textContent || "");
      if (found !== null) return found;
    }
    for (const attribute of numericOnly ? [] : ["interestfor", "aria-describedby"]) {
      for (const id of (trigger.getAttribute(attribute) || "").split(/\s+/).filter(Boolean)) {
        const tooltip = document.getElementById(id);
        const found = tooltip && usageText(tooltip.textContent || "");
        if (found) return found;
      }
    }
    return null;
  }

  function remove(trigger) {
    const entry = labels.get(trigger);
    if (!entry) return;
    entry.label.remove();
    labels.delete(trigger);
  }

  function place(entry, trigger, sidebar, anchor) {
    const rect = anchor.getBoundingClientRect();
    const bounds = sidebar.getBoundingClientRect();
    const style = getComputedStyle(sidebar);
    const visible = rect.width > 0 && rect.height > 0 && rect.right > bounds.left && rect.left < bounds.right &&
      rect.bottom > Math.max(0, bounds.top) && rect.top < Math.min(innerHeight, bounds.bottom) &&
      style.visibility !== "hidden" && style.display !== "none";
    // The source glyph/trigger may use hover-only visibility. The independent
    // counter follows its reserved geometry and sidebar, not that hover state.
    entry.label.style.display = visible ? "flex" : "none";
    if (!visible) return;
    // Paint over the icon itself, not below the row where it can be clipped or
    // mistaken for tooltip text. The pointer still reaches the unchanged target.
    entry.label.style.width = "max-content";
    const width = Math.max(rect.width, Math.ceil(entry.label.getBoundingClientRect().width));
    const height = Math.max(rect.height, 24);
    entry.label.style.width = `${width}px`;
    entry.label.style.height = `${height}px`;
    entry.label.style.left = `${Math.max(bounds.left, Math.min(rect.left + (rect.width - width) / 2, bounds.right - width))}px`;
    entry.label.style.top = `${Math.max(0, Math.min(rect.top + (rect.height - height) / 2, innerHeight - height))}px`;
  }

  function refresh() {
    const active = new Set();
    for (const sidebar of document.querySelectorAll("aside, #app-shell-sidebar")) {
      const sidebarRect = sidebar.getBoundingClientRect();
      if (sidebarRect.width <= 0 || sidebarRect.height <= 0) continue;
      // Tooltip relationship attributes are transient: aria-describedby can be
      // absent at startup and removed on mouseleave. Discover the underlying
      // controls/glyphs independently so neither lifecycle can remove a counter.
      const candidates = sidebar.querySelectorAll("button, [role='button'], svg, [interestfor], [aria-describedby], [data-ambient-usage-label], [role='progressbar'][aria-label]");
      for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= sidebarRect.left || rect.left >= sidebarRect.right) continue;
        const trigger = candidate.closest("button, [role='button']") || candidate.querySelector("svg") || candidate;
        if (active.has(trigger) || trigger.closest("[role='tooltip'], [popover]")) continue;
        // A real usage control may be nested in a sidebar conversation row.
        // Reject title text there, not explicit remainingPercent/usage hooks.
        const row = candidate.closest("[data-sidebar-archive-chatgpt-id], [data-explore-row]");
        const usageHook = candidate.closest("[data-ambient-usage-label]") || trigger.querySelector("[data-ambient-usage-label]");
        const numericOnly = Boolean(row && !usageHook);
        const value = (usageHook && readPercentage(usageHook, sidebar)) ?? readPercentage(candidate, sidebar, numericOnly) ?? readPercentage(trigger, sidebar, numericOnly);
        if (value === null) continue;
        active.add(trigger);
        let entry = labels.get(trigger);
        if (!entry) {
          const label = document.createElement("span");
          label.setAttribute(marker, "");
          label.setAttribute("aria-hidden", "true");
          label.style.cssText = "position:absolute;align-items:center;justify-content:center;box-sizing:border-box;visibility:visible!important;opacity:1!important;pointer-events:none!important;white-space:nowrap;font:700 18px/24px monospace!important;font-variant-numeric:tabular-nums;color:#fff!important;background:#000!important;padding:0";
          entry = { label };
          labels.set(trigger, entry);
        }
        // Never insert children or change geometry on the site's interest target.
        // Its native hover/React lifecycle must not depend on our label's presence.
        if (!layer.isConnected) document.documentElement.appendChild(layer);
        if (entry.label.parentElement !== layer) layer.appendChild(entry.label);
        if (entry.label.textContent !== value) entry.label.textContent = value;
        // Some sidebar rows use the whole row as the interaction target. Cover
        // its usage glyph, never the neighboring conversation title.
        const triggerRect = trigger.getBoundingClientRect();
        const glyph = candidate.matches("svg") ? candidate : candidate.querySelector("svg") || usageHook?.querySelector("svg") || trigger.querySelector("svg");
        const anchor = triggerRect.width > 0 && triggerRect.width <= 64 && triggerRect.height > 0 ? trigger : glyph || usageHook || candidate;
        place(entry, trigger, sidebar, anchor);
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
