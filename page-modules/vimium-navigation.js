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
  const CHAT_SCROLL_ROOT_SELECTOR = "[data-scroll-root]";
  const CHAT_MAIN_ROOT_SELECTOR = "main #thread, main";
  const CHAT_SIDEBAR_ROOT_SELECTOR = "#stage-slideover-sidebar, nav[aria-label='Chat history']";
  const CHAT_HEADER_ROOT_SELECTOR = "#page-header";
  const CHAT_TINY_BAR_SELECTOR = "#stage-sidebar-tiny-bar";
  const SIDEBAR_HINT_SELECTOR = "[data-sidebar-item='true'], [data-testid='close-sidebar-button'], #sidebar-header a, #sidebar-header button";
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
        Number.parseFloat(style.opacity || "1") <= 0.01 ||
        current.hasAttribute("inert") ||
        current.getAttribute("aria-hidden") === "true"
      ) {
        return false;
      }

      if (current === element && style.pointerEvents === "none") {
        return false;
      }
    }

    return true;
  }

  function canInteractWithElement(element) {
    return hasVisibleRendering(element) && !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true";
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
    for (const element of document.querySelectorAll(CHAT_MAIN_ROOT_SELECTOR)) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      if (getViewportIntersectionArea(rect) > 0 && rect.width > 240 && rect.height > 240) {
        return element;
      }
    }

    return null;
  }

  function getChatScrollRoot() {
    const element = document.querySelector(CHAT_SCROLL_ROOT_SELECTOR);
    return element instanceof HTMLElement ? element : null;
  }

  function getCachedMainRoot(rootCache) {
    if (
      rootCache &&
      rootCache.width === window.innerWidth &&
      rootCache.height === window.innerHeight &&
      rootCache.mainRoot instanceof HTMLElement
    ) {
      return rootCache;
    }

    const mainRoot = getMainInteractiveRoot();
    const sidebarRoot = document.querySelector(CHAT_SIDEBAR_ROOT_SELECTOR);
    const headerActionsRoot = document.querySelector(CHAT_HEADER_ROOT_SELECTOR);
    const tinyBarRoot = document.querySelector(CHAT_TINY_BAR_SELECTOR);
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      mainRoot,
      sidebarRoot: sidebarRoot instanceof HTMLElement ? sidebarRoot : null,
      headerActionsRoot: headerActionsRoot instanceof HTMLElement ? headerActionsRoot : null,
      tinyBarRoot: tinyBarRoot instanceof HTMLElement ? tinyBarRoot : null
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

  function pickHintTargetElement(element, mainRoot) {
    if (!(element instanceof HTMLElement) || !(mainRoot instanceof HTMLElement)) {
      return null;
    }

    const metrics = getVisibleHintMetrics(element);
    if (!metrics) {
      return null;
    }

    const resolvedElement = resolveVisibleInteractiveElement(metrics.rect);
    if (!(resolvedElement instanceof HTMLElement) || !mainRoot.contains(resolvedElement) || !areRelatedInteractiveElements(element, resolvedElement)) {
      return null;
    }

    const resolvedMetrics = getVisibleHintMetrics(resolvedElement);
    if (!resolvedMetrics) {
      return null;
    }

    return {
      element: resolvedElement,
      rect: resolvedMetrics.rect,
      intersectionArea: resolvedMetrics.intersectionArea,
      depth: getNodeDepth(resolvedElement)
    };
  }

  function collectHintCandidatesFromRoot(root, selector, seen) {
    if (!(root instanceof HTMLElement)) {
      return [];
    }

    const scoredCandidates = [];
    const candidates = collectInteractiveElements(root, selector);

    for (const element of candidates) {
      if (!(element instanceof HTMLElement) || seen.has(element) || isHintOverlayElement(element)) {
        continue;
      }

      const candidate = pickHintTargetElement(element, root);
      if (!candidate || seen.has(candidate.element)) {
        continue;
      }

      seen.add(candidate.element);
      scoredCandidates.push({
        ...candidate,
        root
      });
    }

    return scoredCandidates;
  }

  function getHintCandidates(rootCache) {
    if (!rootCache || !(rootCache.mainRoot instanceof HTMLElement)) {
      return [];
    }

    const seen = new Set();
    const scoredCandidates = [
      ...collectHintCandidatesFromRoot(rootCache.mainRoot, INTERACTIVE_SELECTOR, seen),
      ...collectHintCandidatesFromRoot(rootCache.headerActionsRoot, INTERACTIVE_SELECTOR, seen),
      ...collectHintCandidatesFromRoot(rootCache.sidebarRoot, SIDEBAR_HINT_SELECTOR, seen),
      ...collectHintCandidatesFromRoot(rootCache.tinyBarRoot, "button[aria-controls='stage-slideover-sidebar']", seen)
    ];

    scoredCandidates.sort((left, right) => {
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

    element.dispatchEvent(new MouseEvent("click", eventInit));
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

  function areRelatedInteractiveElements(left, right) {
    if (!(left instanceof HTMLElement) || !(right instanceof HTMLElement)) {
      return false;
    }

    return left === right || left.contains(right) || right.contains(left);
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
      this.mainRootCache = null;
      this.hintRefreshFrame = null;
      this.hintMutationObserver = null;
      this.hintLayoutDirty = false;
      this.pendingSequence = "";
      this.pendingSequenceTimer = null;
      this.boundViewportChange = (event) => {
        const chatScrollRoot = getChatScrollRoot();
        const target = event && event.target;
        if (event && event.type === "scroll" && chatScrollRoot instanceof HTMLElement && target instanceof Node && target !== chatScrollRoot && !chatScrollRoot.contains(target)) {
          return;
        }

        this.clearHintCandidateCache();
      };
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
      window.addEventListener("scroll", this.boundViewportChange, true);
      window.addEventListener("resize", this.boundViewportChange, true);
      document.addEventListener("mousedown", this.boundViewportChange, true);
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
      window.removeEventListener("scroll", this.boundViewportChange, true);
      window.removeEventListener("resize", this.boundViewportChange, true);
      document.removeEventListener("mousedown", this.boundViewportChange, true);
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

      const observedRoot = this.hintMode && this.hintMode.mainRoot;
      if (typeof MutationObserver === "function" && observedRoot instanceof HTMLElement) {
        this.hintMutationObserver = new MutationObserver(() => {
          this.markHintLayoutDirty();
        });
        this.hintMutationObserver.observe(observedRoot, {
          childList: true,
          subtree: true
        });
      }
    }

    detachHintModeListeners() {
      window.removeEventListener("resize", this.boundHintModeCleanup);
      window.removeEventListener("scroll", this.boundHintModeCleanup, true);
      document.removeEventListener("mousedown", this.boundHintModeCleanup, true);

      if (this.hintMutationObserver) {
        this.hintMutationObserver.disconnect();
        this.hintMutationObserver = null;
      }

      if (this.hintRefreshFrame) {
        window.cancelAnimationFrame(this.hintRefreshFrame);
        this.hintRefreshFrame = null;
      }
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
      this.mainRootCache = null;
    }

    markHintLayoutDirty() {
      if (!this.hintMode) {
        return;
      }

      this.hintLayoutDirty = true;
      this.scheduleHintRefresh();
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

      this.mainRootCache = getCachedMainRoot(this.mainRootCache);
      const candidates = getHintCandidates(this.mainRootCache);
      this.hintCandidateCache = {
        width: window.innerWidth,
        height: window.innerHeight,
        candidates
      };
      return candidates;
    }

    scheduleHintRefresh() {
      if (!this.hintMode || this.hintRefreshFrame) {
        return;
      }

      this.hintRefreshFrame = window.requestAnimationFrame(() => {
        this.hintRefreshFrame = null;

        if (!this.hintMode) {
          return;
        }

        this.updateHintLayout();
        this.renderHints();
      });
    }

    updateHintLayout() {
      if (!this.hintMode || !this.hintLayoutDirty) {
        return;
      }

      const mainRoot = this.hintMode.mainRoot;
      if (!(mainRoot instanceof HTMLElement)) {
        this.exitHintMode();
        return;
      }

      for (const hint of this.hints) {
        const candidate = pickHintTargetElement(hint.element, hint.root instanceof HTMLElement ? hint.root : mainRoot);
        hint.rect = candidate ? candidate.rect : null;
      }

      this.hintLayoutDirty = false;
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

      const promptTextarea = document.getElementById("prompt-textarea");
      if (promptTextarea instanceof HTMLElement && isVisible(promptTextarea) && typeof promptTextarea.focus === "function") {
        promptTextarea.focus({ preventScroll: false });
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
      this.hintMode = {
        alternate,
        input: "",
        mainRoot: this.mainRootCache && this.mainRootCache.mainRoot instanceof HTMLElement ? this.mainRootCache.mainRoot : null
      };
      this.hintLayoutDirty = false;
      this.attachHintModeListeners();
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
        root: candidate.root,
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

      this.hintLayoutDirty = true;
      this.updateHintLayout();
      this.renderHints();
    }

    renderHints() {
      if (!this.hintMode || !this.overlay) {
        return;
      }

      const prefix = this.hintMode.input;
      const occupiedPositions = [];
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
        const markerWidth = 80;
        const markerHeight = 24;
        let left = clamp(rect.left + 4, 4, window.innerWidth - markerWidth);
        let top = clamp(rect.top + 4, 4, window.innerHeight - markerHeight);

        for (const position of occupiedPositions) {
          const overlapsHorizontally = Math.abs(position.left - left) < markerWidth - 12;
          const overlapsVertically = Math.abs(position.top - top) < markerHeight - 4;
          if (overlapsHorizontally && overlapsVertically) {
            top = clamp(position.top + markerHeight, 4, window.innerHeight - markerHeight);
          }
        }

        occupiedPositions.push({ left, top });
        hint.marker.style.left = `${left}px`;
        hint.marker.style.top = `${top}px`;
        hint.marker.style.opacity = hint.code === prefix ? "1" : "0.96";
        hint.marker.style.background = hint.code === prefix ? "#ffbf47" : "#ffe38a";
        hint.marker.textContent = prefix ? `${prefix}${hint.code.slice(prefix.length)}` : hint.code;
      }
      if (!hasVisibleMatch) {
        this.exitHintMode();
      }
    }

    activateHint(hint) {
      this.hintLayoutDirty = true;
      this.updateHintLayout();
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
      this.hintLayoutDirty = false;
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
