/*
 * ChatGPT Desktop Wrapper
 * Developer: alter.daemon <alter.daemon.ivytq@passmail.com>
 * License: MIT
 */

(() => {
  if (window.__chatgptDesktopVimiumNavigation) {
    return;
  }

  const HINT_ALPHABET = "asdfghjklqwertyuiopzxcvbnm";
  const HINT_OVERLAY_SELECTOR = "[data-chatgpt-desktop-hints='true']";
  const VERTICAL_STEP = 72;
  const HORIZONTAL_STEP = 48;
  const MAX_HINT_CANDIDATES = 420;
  const KEY_SEQUENCE_TIMEOUT_MS = 1500;
  const MIN_VISIBLE_HINT_SIZE = 6;
  const MAIN_ROOT_SELECTOR = [
    "main",
    "[role='main']",
    "main[role='main']",
    "article"
  ].join(",");
  const SIDEBAR_ROOT_SELECTOR = [
    "aside",
    "nav[aria-label]",
    "nav",
    "[role='navigation']"
  ].join(",");
  const TOP_CHROME_ROOT_SELECTOR = [
    "header",
    "[role='banner']",
    "body > div:first-child",
    "body > div[style*='position: sticky']",
    "body > div[style*='position:fixed']"
  ].join(",");
  const INTERACTIVE_SELECTOR = [
    "a[href]",
    "button",
    "summary",
    "[role='button']",
    "[role='link']",
    "[role='menuitem']",
    "input[type='button']",
    "input[type='submit']",
    "input[type='reset']"
  ].join(",");
  const SUPPLEMENTAL_INTERACTIVE_SELECTOR = [
    INTERACTIVE_SELECTOR,
    "[tabindex]:not([tabindex='-1'])",
    "[aria-haspopup='menu']",
    "[aria-expanded]"
  ].join(",");
  const EDITABLE_SELECTOR = [
    "textarea",
    "input:not([type='button']):not([type='checkbox']):not([type='color']):not([type='file']):not([type='hidden']):not([type='image']):not([type='radio']):not([type='range']):not([type='reset']):not([type='submit'])",
    "[contenteditable='true']",
    "[contenteditable='']",
    "[role='textbox']"
  ].join(",");

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isEditableElement(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    if (element.closest("input, textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox']")) {
      return true;
    }

    if (element instanceof HTMLInputElement) {
      const inputType = (element.type || "text").toLowerCase();
      return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(inputType);
    }

    return element.isContentEditable;
  }

  function isEditableContext() {
    if (document.designMode === "on") {
      return true;
    }

    const activeElement = document.activeElement;
    if (isEditableElement(activeElement)) {
      return true;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const anchorNode = selection.anchorNode;
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode && anchorNode.parentElement;
    return isEditableElement(anchorElement);
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (!canInteractWithElement(element)) {
      return false;
    }

    const rects = Array.from(element.getClientRects()).filter((rect) => rect.width > MIN_VISIBLE_HINT_SIZE && rect.height > MIN_VISIBLE_HINT_SIZE);
    return rects.some((rect) => rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth);
  }

  function getVisibleHintMetrics(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    if (!canInteractWithElement(element)) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= MIN_VISIBLE_HINT_SIZE || rect.height <= MIN_VISIBLE_HINT_SIZE) {
      return null;
    }

    const intersectionArea = getViewportIntersectionArea(rect);
    if (intersectionArea <= 0) {
      return null;
    }

    return { rect, intersectionArea };
  }

  function hasVisibleRendering(element) {
    for (let current = element; current; current = current.parentElement) {
      const style = window.getComputedStyle(current);
      if (
        style.visibility === "hidden" ||
        style.display === "none" ||
        style.pointerEvents === "none" ||
        Number.parseFloat(style.opacity || "1") <= 0.01 ||
        current.hasAttribute("inert") ||
        current.getAttribute("aria-hidden") === "true"
      ) {
        return false;
      }
    }

    return true;
  }

  function hasVisibleRenderingCached(element, visibilityCache) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    if (!(visibilityCache instanceof Map)) {
      return hasVisibleRendering(element);
    }

    if (visibilityCache.has(element)) {
      return visibilityCache.get(element);
    }

    const parentVisible = element.parentElement ? hasVisibleRenderingCached(element.parentElement, visibilityCache) : true;
    if (!parentVisible) {
      visibilityCache.set(element, false);
      return false;
    }

    const style = window.getComputedStyle(element);
    const visible = !(
      style.visibility === "hidden" ||
      style.display === "none" ||
      style.pointerEvents === "none" ||
      Number.parseFloat(style.opacity || "1") <= 0.01 ||
      element.hasAttribute("inert") ||
      element.getAttribute("aria-hidden") === "true"
    );
    visibilityCache.set(element, visible);
    return visible;
  }

  function canInteractWithElement(element) {
    return hasVisibleRendering(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true";
  }

  function canInteractWithElementCached(element, visibilityCache) {
    return element instanceof HTMLElement && hasVisibleRenderingCached(element, visibilityCache) && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true";
  }

  function getHintRect(element) {
    const rects = Array.from(element.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    return rects.find((rect) => rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth) || null;
  }

  function getHintProbePoint(rect) {
    return {
      x: clamp(Math.round(rect.left + Math.min(Math.max(rect.width * 0.35, 8), rect.width / 2)), 0, Math.max(0, window.innerWidth - 1)),
      y: clamp(Math.round(rect.top + Math.min(Math.max(rect.height * 0.35, 8), rect.height / 2)), 0, Math.max(0, window.innerHeight - 1))
    };
  }

  function isSidebarSecondaryControl(element, rect, metricsCache, visibilityCache) {
    const sidebarRoot = element.closest("aside, nav, [role='navigation']");
    if (!(sidebarRoot instanceof HTMLElement)) {
      return false;
    }

    const row = element.closest("li, [role='listitem'], [role='treeitem'], [role='option']");
    if (!(row instanceof HTMLElement)) {
      return false;
    }

    if (rect.width > 72 || rect.height > 56) {
      return false;
    }

    const siblingTargets = Array.from(row.querySelectorAll(INTERACTIVE_SELECTOR)).filter((candidate) => {
      if (!(candidate instanceof HTMLElement) || candidate === element) {
        return false;
      }

      const metrics = metricsCache instanceof Map
        ? getVisibleHintMetricsWithCaches(candidate, metricsCache, visibilityCache)
        : getVisibleHintMetrics(candidate);
      if (!metrics) {
        return false;
      }

      const overlapsVertically = metrics.rect.bottom > rect.top && metrics.rect.top < rect.bottom;
      return overlapsVertically && metrics.rect.width >= Math.max(rect.width * 2, 120) && metrics.rect.left <= rect.left;
    });

    return siblingTargets.length > 0;
  }

  function isSidebarHintTarget(element) {
    return element instanceof HTMLElement && element.closest("aside, nav, [role='navigation']") instanceof HTMLElement;
  }

  function getInteractiveCandidate(element, selector) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    return element.matches(selector) ? element : element.closest(selector);
  }

  function isHintOverlayElement(element) {
    return element instanceof HTMLElement && element.closest(HINT_OVERLAY_SELECTOR) instanceof HTMLElement;
  }

  function getCandidatePriority(element) {
    if (!(element instanceof HTMLElement)) {
      return -1;
    }

    if (element instanceof HTMLAnchorElement && element.href) {
      return 6;
    }

    if (element instanceof HTMLButtonElement) {
      return 5;
    }

    if (element.matches("summary, input[type='button'], input[type='submit'], input[type='reset']")) {
      return 4;
    }

    if (element.getAttribute("role") === "button" || element.getAttribute("role") === "link" || element.getAttribute("role") === "menuitem") {
      return 3;
    }

    if (element.hasAttribute("aria-haspopup") || element.hasAttribute("aria-expanded")) {
      return 2;
    }

    if (element.hasAttribute("tabindex")) {
      return 1;
    }

    return 0;
  }

  function resolveInteractiveFromStack(nodes, selector) {
    let bestCandidate = null;
    let bestPriority = -1;

    for (const node of nodes) {
      if (!(node instanceof HTMLElement) || isHintOverlayElement(node)) {
        continue;
      }

      const candidate = getInteractiveCandidate(node, selector);
      if (!(candidate instanceof HTMLElement)) {
        continue;
      }

      const priority = getCandidatePriority(candidate);
      if (priority > bestPriority) {
        bestCandidate = candidate;
        bestPriority = priority;
      }

      if (priority >= 5) {
        break;
      }
    }

    return bestCandidate;
  }

  function resolveInteractiveAtPoint(x, y, selector) {
    return resolveInteractiveFromStack(document.elementsFromPoint(x, y), selector);
  }

  function resolveInteractiveAtRect(rect, selector) {
    if (!rect) {
      return null;
    }

    const probe = getHintProbePoint(rect);
    return resolveInteractiveAtPoint(probe.x, probe.y, selector);
  }

  function collectTopChromeCandidates(topChromeRoot) {
    const candidates = [];
    if (!(topChromeRoot instanceof HTMLElement)) {
      return candidates;
    }

    const rect = topChromeRoot.getBoundingClientRect();
    const startX = clamp(Math.round(Math.max(rect.left, window.innerWidth * 0.52)), 0, Math.max(0, window.innerWidth - 1));
    const endX = clamp(Math.round(rect.right), 0, Math.max(0, window.innerWidth - 1));
    const startY = clamp(Math.round(Math.max(rect.top, 0) + 8), 0, Math.max(0, window.innerHeight - 1));
    const endY = clamp(Math.round(Math.min(rect.bottom, 168)), 0, Math.max(0, window.innerHeight - 1));
    const stepX = 48;
    const stepY = 22;

    for (let y = startY; y <= endY; y += stepY) {
      for (let x = startX; x <= endX; x += stepX) {
        const candidate = resolveInteractiveAtPoint(x, y, SUPPLEMENTAL_INTERACTIVE_SELECTOR);
        if (candidate instanceof HTMLElement && topChromeRoot.contains(candidate) && !isSidebarHintTarget(candidate)) {
          candidates.push(candidate);
        }
      }
    }

    return candidates;
  }

  function isTopChromeHintTarget(element, rect) {
    if (!(element instanceof HTMLElement) || isSidebarHintTarget(element)) {
      return false;
    }

    if (element.closest("header, [role='banner']") instanceof HTMLElement) {
      return true;
    }

    return rect.top <= 140 && rect.right >= window.innerWidth * 0.55;
  }

  function getViewportIntersectionArea(rect) {
    const width = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
    const height = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    if (width <= 0 || height <= 0) {
      return 0;
    }

    return width * height;
  }

  function isScrollable(element, axis) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const overflow = axis === "x" ? style.overflowX : style.overflowY;
    const allowed = overflow === "auto" || overflow === "scroll" || overflow === "overlay";
    if (!allowed) {
      return false;
    }

    if (axis === "x") {
      return element.scrollWidth - element.clientWidth > 8;
    }

    return element.scrollHeight - element.clientHeight > 8;
  }

  function pickScrollTarget(axis) {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const ancestry = [];

    for (let current = activeElement; current; current = current.parentElement) {
      ancestry.push(current);
    }

    for (const element of ancestry) {
      if (isScrollable(element, axis)) {
        return element;
      }
    }

    const centerX = Math.round(window.innerWidth / 2);
    const centerY = Math.round(window.innerHeight / 2);
    const probePoints = [
      [centerX, centerY],
      [centerX, Math.round(window.innerHeight * 0.25)],
      [centerX, Math.round(window.innerHeight * 0.75)]
    ];

    for (const [x, y] of probePoints) {
      const stack = document.elementsFromPoint(x, y);
      for (const element of stack) {
        if (isScrollable(element, axis)) {
          return element;
        }
      }
    }

    return document.scrollingElement || document.documentElement;
  }

  function getNodeDepth(element) {
    let depth = 0;

    for (let current = element; current; current = current.parentElement) {
      depth += 1;
    }

    return depth;
  }

  function getMainInteractiveRoot() {
    const candidates = Array.from(document.querySelectorAll(MAIN_ROOT_SELECTOR)).filter((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return getViewportIntersectionArea(rect) > 0 && rect.width > 240 && rect.height > 240;
    });

    candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      const leftArea = getViewportIntersectionArea(leftRect);
      const rightArea = getViewportIntersectionArea(rightRect);

      if (rightArea !== leftArea) {
        return rightArea - leftArea;
      }

      return Math.abs(leftRect.left) - Math.abs(rightRect.left);
    });

    if (candidates[0]) {
      return candidates[0];
    }

    const probePoints = [
      [window.innerWidth * 0.5, window.innerHeight * 0.2],
      [window.innerWidth * 0.5, window.innerHeight * 0.5],
      [window.innerWidth * 0.5, window.innerHeight * 0.8]
    ];

    const fallbackRoots = new Map();
    for (const [x, y] of probePoints) {
      for (const node of document.elementsFromPoint(Math.round(x), Math.round(y))) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }

        for (let current = node; current && current !== document.body; current = current.parentElement) {
          const rect = current.getBoundingClientRect();
          const area = getViewportIntersectionArea(rect);

          if (area <= 0 || rect.width < 280 || rect.height < 280) {
            continue;
          }

          if (rect.left > window.innerWidth * 0.25) {
            fallbackRoots.set(current, area);
          }
        }
      }
    }

    return Array.from(fallbackRoots.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([element]) => element)[0] || null;
  }

  function getVisibleSidebarRoot() {
    const candidates = Array.from(document.querySelectorAll(SIDEBAR_ROOT_SELECTOR)).filter((element) => {
      if (!(element instanceof HTMLElement) || !canInteractWithElement(element)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width >= 180 && rect.left < window.innerWidth * 0.45 && getViewportIntersectionArea(rect) > 0;
    });

    candidates.sort((left, right) => getViewportIntersectionArea(right.getBoundingClientRect()) - getViewportIntersectionArea(left.getBoundingClientRect()));
    return candidates[0] || null;
  }

  function getTopChromeRoot(mainRoot, sidebarRoot) {
    const blockedRoots = new Set([mainRoot, sidebarRoot].filter((element) => element instanceof HTMLElement));
    const candidates = Array.from(document.querySelectorAll(TOP_CHROME_ROOT_SELECTOR)).filter((element) => {
      if (!(element instanceof HTMLElement) || blockedRoots.has(element) || !canInteractWithElement(element)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.height >= 36 && rect.top <= 24 && getViewportIntersectionArea(rect) > 0;
    });

    candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (getViewportIntersectionArea(rightRect) - rightRect.top) - (getViewportIntersectionArea(leftRect) - leftRect.top);
    });

    return candidates[0] || null;
  }

  function getCachedInteractiveRoots(rootCache) {
    if (
      rootCache &&
      rootCache.width === window.innerWidth &&
      rootCache.height === window.innerHeight &&
      rootCache.mainRoot instanceof HTMLElement
    ) {
      return rootCache;
    }

    const mainRoot = getMainInteractiveRoot();
    const sidebarRoot = getVisibleSidebarRoot();
    const topChromeRoot = getTopChromeRoot(mainRoot, sidebarRoot);
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      mainRoot,
      sidebarRoot,
      topChromeRoot
    };
  }

  function collectInteractiveElements(root, selector) {
    if (!(root instanceof HTMLElement)) {
      return [];
    }

    return root.matches(selector)
      ? [root, ...root.querySelectorAll(selector)]
      : Array.from(root.querySelectorAll(selector));
  }

  function getVisibleHintMetricsWithCaches(element, metricsCache, visibilityCache) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    if (metricsCache.has(element)) {
      return metricsCache.get(element);
    }

    if (!canInteractWithElementCached(element, visibilityCache)) {
      metricsCache.set(element, null);
      return null;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= MIN_VISIBLE_HINT_SIZE || rect.height <= MIN_VISIBLE_HINT_SIZE) {
      metricsCache.set(element, null);
      return null;
    }

    const intersectionArea = getViewportIntersectionArea(rect);
    const metrics = intersectionArea > 0 ? { rect, intersectionArea } : null;
    metricsCache.set(element, metrics);
    return metrics;
  }

  function getHintCandidates(rootCache) {
    const scoredCandidates = [];
    const seen = new Set();
    const visibilityCache = new Map();
    const metricsCache = new Map();
    const interactiveRoots = getCachedInteractiveRoots(rootCache);
    const { mainRoot, sidebarRoot, topChromeRoot } = interactiveRoots;
    const topChromeQueryCandidates = collectInteractiveElements(topChromeRoot, INTERACTIVE_SELECTOR);
    const topChromePriorityCount = topChromeQueryCandidates.reduce((count, element) => {
      const metrics = getVisibleHintMetricsWithCaches(element, metricsCache, visibilityCache);
      return metrics && isTopChromeHintTarget(element, metrics.rect) ? count + 1 : count;
    }, 0);
    const candidates = [
      ...collectInteractiveElements(mainRoot, INTERACTIVE_SELECTOR),
      ...collectInteractiveElements(sidebarRoot, INTERACTIVE_SELECTOR),
      ...topChromeQueryCandidates,
      ...(topChromePriorityCount >= 4 ? [] : collectTopChromeCandidates(topChromeRoot))
    ];

    for (const element of candidates) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      if (isHintOverlayElement(element)) {
        continue;
      }

      const metrics = getVisibleHintMetricsWithCaches(element, metricsCache, visibilityCache);
      if (!metrics) {
        continue;
      }

      const resolvedElement = resolveVisibleInteractiveElement(metrics.rect);
      if (!(resolvedElement instanceof HTMLElement) || seen.has(resolvedElement)) {
        continue;
      }

      const resolvedMetrics = getVisibleHintMetricsWithCaches(resolvedElement, metricsCache, visibilityCache);
      if (!resolvedMetrics) {
        continue;
      }

      if (isSidebarSecondaryControl(resolvedElement, resolvedMetrics.rect, metricsCache, visibilityCache)) {
        continue;
      }

      seen.add(resolvedElement);
      scoredCandidates.push({
        element: resolvedElement,
        rect: resolvedMetrics.rect,
        intersectionArea: resolvedMetrics.intersectionArea,
        depth: getNodeDepth(resolvedElement),
        sidebar: isSidebarHintTarget(resolvedElement),
        topChrome: isTopChromeHintTarget(resolvedElement, resolvedMetrics.rect)
      });
    }

    scoredCandidates.sort((left, right) => {
      if (left.topChrome !== right.topChrome) {
        return left.topChrome ? -1 : 1;
      }

      if (left.sidebar !== right.sidebar) {
        return left.sidebar ? 1 : -1;
      }

      if (left.rect.top !== right.rect.top) {
        return left.rect.top - right.rect.top;
      }

      if (left.rect.left !== right.rect.left) {
        return left.rect.left - right.rect.left;
      }

      if (right.intersectionArea !== left.intersectionArea) {
        return right.intersectionArea - left.intersectionArea;
      }

      return right.depth - left.depth;
    });

    return scoredCandidates.slice(0, MAX_HINT_CANDIDATES);
  }

  function createHintCodes(count) {
    const codes = [];
    let length = 1;

    while (codes.length < count) {
      const startCount = codes.length;

      const build = (prefix, remaining) => {
        if (codes.length >= count) {
          return;
        }

        if (remaining === 0) {
          codes.push(prefix);
          return;
        }

        for (const char of HINT_ALPHABET) {
          build(prefix + char, remaining - 1);
          if (codes.length >= count) {
            return;
          }
        }
      };

      build("", length);

      if (codes.length === startCount) {
        break;
      }

      length += 1;
    }

    return codes;
  }

  function isPrintableKey(event) {
    return event.key.length === 1 && !/\s/.test(event.key);
  }

  function resolveActivatableElement(hint) {
    const directElement = hint && hint.element;
    if (directElement instanceof HTMLElement && directElement.isConnected) {
      const directRect = directElement.getBoundingClientRect();
      if (getViewportIntersectionArea(directRect) > 0) {
        return directElement;
      }
    }

    const rect = hint && hint.rect;
    const candidate = resolveInteractiveAtRect(rect, SUPPLEMENTAL_INTERACTIVE_SELECTOR);
    if (candidate instanceof HTMLElement) {
      return candidate;
    }

    return directElement instanceof HTMLElement ? directElement : null;
  }

  function dispatchPointerActivation(element, rect) {
    if (!(element instanceof HTMLElement) || !rect) {
      return;
    }

    const probe = getHintProbePoint(rect);
    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: probe.x,
      clientY: probe.y,
      button: 0
    };

    for (const eventName of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      const EventCtor = eventName.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      element.dispatchEvent(new EventCtor(eventName, eventInit));
    }
  }

  function activateElement(element, hint, alternate) {
    if (!(element instanceof HTMLElement) || !element.isConnected) {
      return;
    }

    const anchor = element instanceof HTMLAnchorElement ? element : element.closest("a[href]");

    element.focus({ preventScroll: false });

    dispatchPointerActivation(element, hint && hint.rect);

    if (anchor instanceof HTMLAnchorElement && anchor.href) {
      if (alternate) {
        window.open(anchor.href, "_blank", "noopener");
        return;
      }

      anchor.click();
      return;
    }

    if (typeof element.click === "function") {
      element.click();
    }

    if (element.getAttribute("role") === "button" || element.getAttribute("role") === "link") {
      for (const key of ["Enter", " "]) {
        element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true, composed: true }));
      }
    }
  }

  function resolveVisibleInteractiveElement(rect) {
    const candidate = resolveInteractiveAtRect(rect, SUPPLEMENTAL_INTERACTIVE_SELECTOR);
    if (candidate instanceof HTMLElement) {
      return candidate;
    }

    return null;
  }

  class VimiumNavigationController {
    constructor() {
      this.enabled = false;
      this.historyPatched = false;
      this.originalHistoryMethods = {};
      this.hintMode = null;
      this.overlay = null;
      this.hints = [];
      this.hintCandidateCache = null;
      this.interactiveRootCache = null;
      this.pendingSequence = "";
      this.pendingSequenceTimer = null;
      this.boundKeydown = (event) => this.handleKeydown(event);
      this.boundPageCleanup = () => {
        this.clearHintCandidateCache();
        this.exitHintMode();
      };
      this.boundVisibilityCleanup = () => {
        if (document.hidden) {
          this.clearHintCandidateCache();
          this.exitHintMode();
        }
      };
      this.boundHintModeCleanup = () => {
        this.clearHintCandidateCache();
        this.exitHintMode();
      };
      this.boundRouteCleanup = () => {
        if (!this.enabled) {
          return;
        }

        this.clearHintCandidateCache();
        this.exitHintMode();
      };
    }

    enable() {
      if (this.enabled) {
        return;
      }

      this.enabled = true;
      window.addEventListener("keydown", this.boundKeydown, true);
      window.addEventListener("pagehide", this.boundPageCleanup);
      window.addEventListener("blur", this.boundVisibilityCleanup);
      document.addEventListener("visibilitychange", this.boundVisibilityCleanup);
      this.patchHistory();
      window.addEventListener("popstate", this.boundRouteCleanup);
      window.addEventListener("hashchange", this.boundRouteCleanup);
    }

    disable() {
      if (!this.enabled) {
        return;
      }

      this.enabled = false;
      window.removeEventListener("keydown", this.boundKeydown, true);
      window.removeEventListener("pagehide", this.boundPageCleanup);
      window.removeEventListener("blur", this.boundVisibilityCleanup);
      document.removeEventListener("visibilitychange", this.boundVisibilityCleanup);
      window.removeEventListener("popstate", this.boundRouteCleanup);
      window.removeEventListener("hashchange", this.boundRouteCleanup);
      this.restoreHistory();
      this.exitHintMode();
      this.clearHintCandidateCache();
      this.clearPendingSequence();
    }

    attachHintModeListeners() {
      window.addEventListener("resize", this.boundHintModeCleanup);
      window.addEventListener("scroll", this.boundHintModeCleanup, true);
      document.addEventListener("mousedown", this.boundHintModeCleanup, true);
    }

    detachHintModeListeners() {
      window.removeEventListener("resize", this.boundHintModeCleanup);
      window.removeEventListener("scroll", this.boundHintModeCleanup, true);
      document.removeEventListener("mousedown", this.boundHintModeCleanup, true);
    }

    patchHistory() {
      if (this.historyPatched) {
        return;
      }

      this.historyPatched = true;

      const wrap = (methodName) => {
        const original = history[methodName];
        if (typeof original !== "function") {
          return;
        }

        this.originalHistoryMethods[methodName] = original;

        history[methodName] = (...args) => {
          const result = original.apply(history, args);
          if (this.enabled) {
            this.clearHintCandidateCache();
            this.exitHintMode();
          }
          return result;
        };
      };

      wrap("pushState");
      wrap("replaceState");
    }

    restoreHistory() {
      if (!this.historyPatched) {
        return;
      }

      for (const methodName of ["pushState", "replaceState"]) {
        const original = this.originalHistoryMethods[methodName];
        if (typeof original === "function") {
          history[methodName] = original;
        }
      }

      this.originalHistoryMethods = {};
      this.historyPatched = false;
    }

    handleKeydown(event) {
      if (!this.enabled || event.defaultPrevented || event.isComposing || event.repeat) {
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (this.hintMode) {
        this.handleHintKeydown(event);
        return;
      }

      if (this.handlePendingSequence(event)) {
        return;
      }

      if (event.key === "Shift" || event.key === "CapsLock") {
        return;
      }

      if (event.key === "Escape" && this.exitEditableContext(event)) {
        this.clearPendingSequence();
        return;
      }

      if (isEditableContext()) {
        this.clearPendingSequence();
        return;
      }

      switch (event.key.toLowerCase()) {
        case "g":
          if (event.key === "G") {
            this.clearPendingSequence();
            event.preventDefault();
            event.stopPropagation();
            this.scrollToEdge("bottom");
            break;
          }

          this.startPendingSequence("g");
          event.preventDefault();
          event.stopPropagation();
          break;
        case "j":
          this.clearPendingSequence();
          this.scrollBy(0, VERTICAL_STEP, event);
          break;
        case "k":
          this.clearPendingSequence();
          this.scrollBy(0, -VERTICAL_STEP, event);
          break;
        case "h":
          this.clearPendingSequence();
          this.scrollBy(-HORIZONTAL_STEP, 0, event);
          break;
        case "l":
          this.clearPendingSequence();
          this.scrollBy(HORIZONTAL_STEP, 0, event);
          break;
        case "d":
          this.clearPendingSequence();
          this.scrollBy(0, Math.round(window.innerHeight * 0.5), event);
          break;
        case "u":
          this.clearPendingSequence();
          this.scrollBy(0, -Math.round(window.innerHeight * 0.5), event);
          break;
        case "f":
          this.clearPendingSequence();
          event.preventDefault();
          event.stopPropagation();
          this.enterHintMode(event.key === "F");
          break;
        default:
          if (isPrintableKey(event)) {
            event.preventDefault();
            event.stopPropagation();
          }
          this.clearPendingSequence();
          break;
      }
    }

    handlePendingSequence(event) {
      if (this.pendingSequence !== "g") {
        return false;
      }

      if (event.key === "Escape") {
        this.clearPendingSequence();
        return false;
      }

      if (event.key === "g") {
        event.preventDefault();
        event.stopPropagation();
        this.clearPendingSequence();
        this.scrollToEdge("top");
        return true;
      }

      if (event.key === "i") {
        event.preventDefault();
        event.stopPropagation();
        this.clearPendingSequence();
        this.focusPrimaryInput();
        return true;
      }

      if (isPrintableKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        this.clearPendingSequence();
        return true;
      }

      if (event.key === "Shift" || event.key === "CapsLock") {
        return false;
      }

      this.clearPendingSequence();
      return false;
    }

    startPendingSequence(sequence) {
      this.pendingSequence = sequence;

      if (this.pendingSequenceTimer) {
        window.clearTimeout(this.pendingSequenceTimer);
      }

      this.pendingSequenceTimer = window.setTimeout(() => {
        this.clearPendingSequence();
      }, KEY_SEQUENCE_TIMEOUT_MS);
    }

    clearPendingSequence() {
      this.pendingSequence = "";

      if (this.pendingSequenceTimer) {
        window.clearTimeout(this.pendingSequenceTimer);
        this.pendingSequenceTimer = null;
      }
    }

    clearHintCandidateCache() {
      this.hintCandidateCache = null;
      this.interactiveRootCache = null;
    }

    getCachedHintCandidates() {
      const cache = this.hintCandidateCache;
      if (
        cache &&
        cache.width === window.innerWidth &&
        cache.height === window.innerHeight &&
        cache.candidates.length > 0
      ) {
        return cache.candidates;
      }

      this.interactiveRootCache = getCachedInteractiveRoots(this.interactiveRootCache);
      const candidates = getHintCandidates(this.interactiveRootCache);
      this.hintCandidateCache = {
        width: window.innerWidth,
        height: window.innerHeight,
        candidates
      };
      return candidates;
    }

    exitEditableContext(event) {
      const activeElement = document.activeElement;
      if (!isEditableElement(activeElement)) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();

      if (typeof activeElement.blur === "function") {
        activeElement.blur();
      }

      if (document.activeElement === activeElement && document.body instanceof HTMLElement) {
        document.body.focus({ preventScroll: true });
      }

      const selection = window.getSelection();
      if (selection && typeof selection.removeAllRanges === "function") {
        selection.removeAllRanges();
      }

      return true;
    }

    handleHintKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.exitHintMode();
        return;
      }

      if (!/^[a-z]$/i.test(event.key)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (!HINT_ALPHABET.includes(key)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      this.hintMode.input += key;
      this.renderHints();

      const matches = this.hints.filter((hint) => hint.code.startsWith(this.hintMode.input));
      if (matches.length === 1 && matches[0].code === this.hintMode.input) {
        this.activateHint(matches[0]);
        return;
      }

      if (matches.length === 0) {
        this.exitHintMode();
      }
    }

    scrollBy(left, top, event) {
      event.preventDefault();
      event.stopPropagation();

      const verticalTarget = top !== 0 ? pickScrollTarget("y") : null;
      const horizontalTarget = left !== 0 ? pickScrollTarget("x") : null;
      const target = verticalTarget || horizontalTarget;

      if (target && typeof target.scrollBy === "function") {
        target.scrollBy({ left, top, behavior: "auto" });
        return;
      }

      window.scrollBy({ left, top, behavior: "auto" });
    }

    scrollToEdge(edge) {
      const target = pickScrollTarget("y");
      const top = edge === "top" ? 0 : target.scrollHeight;

      if (target && typeof target.scrollTo === "function") {
        target.scrollTo({ top, behavior: "auto" });
        return;
      }

      window.scrollTo({ top, behavior: "auto" });
    }

    focusPrimaryInput() {
      const activeElement = document.activeElement;
      if (isEditableElement(activeElement)) {
        if (typeof activeElement.focus === "function") {
          activeElement.focus({ preventScroll: false });
        }
        return;
      }

      const candidates = Array.from(document.querySelectorAll(EDITABLE_SELECTOR)).filter((element) => isVisible(element));
      const target = candidates.sort((left, right) => {
        const leftRect = getHintRect(left) || left.getBoundingClientRect();
        const rightRect = getHintRect(right) || right.getBoundingClientRect();

        if (leftRect.top !== rightRect.top) {
          return leftRect.top - rightRect.top;
        }

        return leftRect.left - rightRect.left;
      })[0];

      if (!target || typeof target.focus !== "function") {
        return;
      }

      target.focus({ preventScroll: false });
      if (target instanceof HTMLElement && target.isContentEditable) {
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(target);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }

    enterHintMode(alternate) {
      const candidates = this.getCachedHintCandidates();
      if (candidates.length === 0) {
        return;
      }

      this.exitHintMode();
      this.attachHintModeListeners();
      this.hintMode = { alternate, input: "" };
      this.overlay = document.createElement("div");
      this.overlay.setAttribute("data-chatgpt-desktop-hints", "true");
      Object.assign(this.overlay.style, {
        position: "fixed",
        inset: "0",
        pointerEvents: "none",
        zIndex: "2147483647",
        fontFamily: "ui-monospace, monospace"
      });
      document.documentElement.appendChild(this.overlay);

      const codes = createHintCodes(candidates.length);
      this.hints = candidates.map((candidate, index) => ({
        code: codes[index],
        element: candidate.element,
        rect: candidate.rect,
        marker: document.createElement("div")
      }));

      for (const hint of this.hints) {
        hint.marker.textContent = hint.code;
        hint.marker.setAttribute("data-hint-code", hint.code);
        Object.assign(hint.marker.style, {
          position: "fixed",
          padding: "1px 4px",
          border: "1px solid #5a4300",
          borderRadius: "4px",
          background: "#ffe38a",
          color: "#111111",
          fontSize: "12px",
          fontWeight: "700",
          lineHeight: "1.2",
          letterSpacing: "0.04em",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.28)",
          textTransform: "uppercase"
        });
        this.overlay.appendChild(hint.marker);
      }

      this.renderHints();
    }

    renderHints() {
      if (!this.hintMode || !this.overlay) {
        return;
      }

      const prefix = this.hintMode.input;
      let hasVisibleMatch = false;

      for (const hint of this.hints) {
        const rect = hint.rect;
        const matches = hint.code.startsWith(prefix);

        if (!rect || !matches) {
          hint.marker.style.display = "none";
          continue;
        }

        hasVisibleMatch = true;
        hint.marker.style.display = "block";
        hint.marker.style.left = `${clamp(rect.left + 4, 4, window.innerWidth - 80)}px`;
        hint.marker.style.top = `${clamp(rect.top + 4, 4, window.innerHeight - 24)}px`;
        hint.marker.style.opacity = hint.code === prefix ? "1" : "0.96";
        hint.marker.style.background = hint.code === prefix ? "#ffbf47" : "#ffe38a";
        hint.marker.textContent = prefix ? `${prefix}${hint.code.slice(prefix.length)}` : hint.code;
      }

      if (!hasVisibleMatch) {
        this.exitHintMode();
      }
    }

    activateHint(hint) {
      const element = resolveActivatableElement(hint);
      const alternate = this.hintMode && this.hintMode.alternate;
      this.exitHintMode();

      if (!(element instanceof HTMLElement) || !element.isConnected) {
        return;
      }

      activateElement(element, hint, alternate);
    }

    exitHintMode() {
      this.clearPendingSequence();
      this.detachHintModeListeners();
      this.hintMode = null;
      this.hints = [];

      if (this.overlay && this.overlay.isConnected) {
        this.overlay.remove();
      }

      this.overlay = null;
    }
  }

  const controller = new VimiumNavigationController();

  window.__chatgptDesktopVimiumNavigation = {
    isEnabled() {
      return controller.enabled;
    },
    setEnabled(enabled) {
      if (enabled) {
        controller.enable();
      } else {
        controller.disable();
      }
    }
  };
})();
