// Electron main process for the signed-in DOM audit.
//
// Like warm-login-main.js this runs with NO debugger attached. A Playwright/CDP-attached launch is
// served Cloudflare's "Just a moment..." page by chatgpt.com itself, while the same warmed profile
// reaches the signed-in app when a plain Electron process runs the real main.js and inspects the
// window with executeJavaScript. Keys go through webContents.sendInputEvent so the page sees
// trusted input.
//
// The audit records structure only: tag names, roles, selector match counts and geometry. It never
// reads message text, titles, links or account identifiers, and it never sends a prompt. Opening an
// existing conversation is read-only navigation.
//
// Environment:
//   AUDIT_OUT        path of the JSON result (required)
//   AUDIT_CSS        optional stylesheet to apply on top of the app (same effect as a user custom.css)
//   AUDIT_THEMES     comma list of "light" / "dark" (default "light")
//   AUDIT_CONVERSATION  "1" to also audit an existing conversation page
//   XDG_*            the live profile paths, as for the live suite
const fs = require("fs");
const path = require("path");
const { app, nativeTheme } = require("electron");
const { REQUIRED_ANCHORS } = require("./live-anchors");

const projectRoot = path.join(__dirname, "..", "..");
const outPath = process.env.AUDIT_OUT;
const cssPath = process.env.AUDIT_CSS;
const themes = (process.env.AUDIT_THEMES || "light").split(",").map((t) => t.trim()).filter(Boolean);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- runs inside the page ---------------------------------------------------------------------
function auditPage(anchors, withCss) {
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 6 && r.height > 6 && cs.visibility !== "hidden" && cs.display !== "none" &&
      r.bottom >= 0 && r.top <= innerHeight && r.right >= 0 && r.left <= innerWidth;
  };
  const isAvatar = (el) => {
    if (el.tagName === "IMG") return true;
    const r = el.getBoundingClientRect();
    return Math.abs(r.width - r.height) <= 2 && r.width <= 64 && !!el.querySelector("img");
  };
  const landmark = (el) => {
    const parts = [];
    for (let c = el.parentElement; c && c !== document.body && parts.length < 3; c = c.parentElement) {
      if (c.id && !/^[_0-9a-f-]{8,}$|^radix|^--native/i.test(c.id)) parts.push("#" + c.id);
      else if (/^(MAIN|NAV|ASIDE|HEADER|FORM|DIALOG)$/.test(c.tagName)) parts.push(c.tagName.toLowerCase());
    }
    return parts.reverse().join(">");
  };

  const out = { dataTheme: document.documentElement.getAttribute("data-theme") };

  out.anchors = {};
  for (const [name, selector] of Object.entries(anchors)) {
    let count = -1;
    try { count = document.querySelectorAll(selector).length; } catch (e) { count = -1; }
    out.anchors[name] = count;
  }

  // Rounded survivors: visible, non-avatar elements that still have a corner radius.
  const groups = new Map();
  let total = 0;
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (!cs.borderTopLeftRadius || cs.borderTopLeftRadius === "0px") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 14 || r.height < 14 || cs.display === "none" || cs.visibility === "hidden") continue;
    if (isAvatar(el)) continue;
    total++;
    const key = el.tagName.toLowerCase() + (el.getAttribute("role") ? "[" + el.getAttribute("role") + "]" : "") +
      " " + cs.borderTopLeftRadius + " in " + (landmark(el) || "body");
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  out.rounded = { total, groups: Array.from(groups.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => n + "x " + k) };

  // Wide fade and shadow layers (gradient fills, masks, blurred shadows) on elements or their
  // pseudo-elements. Only layers at least 200px wide are considered, which leaves out the small
  // horizontal text-truncation masks and the shadows of small controls.
  const fadeLayers = [];
  const blurredShadow = /\)\s+-?[\d.]+px\s+-?[\d.]+px\s+([1-9][\d.]*)px/;
  const considerLayer = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo || null);
    if (pseudo && (cs.content === "none" || cs.content === "normal")) return;
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return;
    const r = el.getBoundingClientRect();
    const wide = pseudo ? parseFloat(cs.width) >= 200 : r.width >= 200;
    if (!wide || r.height < 4) return;
    const kinds = [];
    if (/gradient/.test(cs.backgroundImage)) kinds.push("gradient");
    const maskValue = cs.maskImage !== "none" ? cs.maskImage : cs.webkitMaskImage;
    // A short horizontal mask is a text-truncation fade (sidebar titles), not a layer over content.
    const truncationMask = /to (right|left)/.test(maskValue) && r.height <= 40;
    if (maskValue !== "none" && !truncationMask) kinds.push("mask");
    if (blurredShadow.test(cs.boxShadow)) kinds.push("shadow");
    if (cs.backdropFilter !== "none") kinds.push("backdrop-blur");
    if (!kinds.length) return;
    const slot = el.getAttribute("data-app-action-timeline-scroll") !== null ? "[timeline-scroll]" : "";
    fadeLayers.push(el.tagName.toLowerCase() + (pseudo || "") + slot + " " + kinds.join("+") + " in " + (landmark(el) || "body") +
      " [" + Math.round(r.left) + "," + Math.round(r.top) + " " + Math.round(r.width) + "x" + Math.round(r.height) + "]");
  };
  for (const el of document.querySelectorAll("#root *")) {
    considerLayer(el);
    considerLayer(el, "::before");
    considerLayer(el, "::after");
  }
  out.fadeLayers = fadeLayers.slice(0, 20);

  // Interactive elements in the sidebar, for comparison with the hint run.
  const interactive = "a[href],button,summary,[role='button'],[role='link'],[role='menuitem']";
  const sidebar = document.querySelector("#app-shell-sidebar");
  out.sidebarInteractive = sidebar ? Array.from(sidebar.querySelectorAll(interactive)).filter(visible).length : 0;
  out.sidebarList = (() => {
    const el = document.querySelector("#app-shell-sidebar [data-app-action-sidebar-scroll]");
    return el ? { rect: rect(el), scrollable: el.scrollHeight - el.clientHeight > 8 } : null;
  })();
  out.thread = (() => {
    const el = document.querySelector("main [role='main'], main [data-app-action-timeline-scroll]");
    return el ? { rect: rect(el), scrollable: el.scrollHeight - el.clientHeight > 8 } : null;
  })();
  // Surface colors, so a stylesheet palette rule that stopped matching shows up as a wrong color.
  const bg = (selector) => {
    const el = document.querySelector(selector);
    return el ? getComputedStyle(el).backgroundColor : null;
  };
  out.surfaces = {
    sidebar: bg("#app-shell-sidebar"),
    main: bg("main"),
    composer: bg("form[data-chatgpt-composer] > div"),
    // The solid cover the site paints below the composer; it must match the chat surface or it
    // shows as a band. Null when the page has no thread footer (new-chat page).
    footerCover: (() => {
      const footer = document.querySelector("[data-thread-scroll-footer]");
      const wrapper = footer && footer.parentElement;
      if (!wrapper) return null;
      const cover = getComputedStyle(wrapper, "::after");
      return cover.content === "none" || cover.content === "normal" ? null : cover.backgroundColor;
    })(),
  };
  out.withCss = withCss;
  return out;
}

function auditHints() {
  const overlay = document.querySelector("[data-chatgpt-desktop-hints='true']");
  if (!overlay) return { total: 0, regions: {} };
  const regions = {};
  let total = 0;
  for (const marker of overlay.children) {
    if (marker.style.display === "none") continue;
    total++;
    const x = parseFloat(marker.style.left), y = parseFloat(marker.style.top);
    const el = document.elementsFromPoint(x + 8, y + 8).find((e) => !overlay.contains(e));
    const region = !el ? "none"
      : el.closest("#app-shell-sidebar, aside") ? "sidebar"
      : el.closest("main header") ? "header"
      : el.closest("form") ? "composer"
      : el.closest("main") ? "thread" : "other";
    regions[region] = (regions[region] || 0) + 1;
  }
  return { total, regions };
}
// -----------------------------------------------------------------------------------------------

const evaluate = (wc, fn, ...args) =>
  wc.executeJavaScript(`(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`, true);
const run = (wc, source) => wc.executeJavaScript(source, true);

async function press(wc, key) {
  wc.sendInputEvent({ type: "keyDown", keyCode: key });
  wc.sendInputEvent({ type: "char", keyCode: key });
  wc.sendInputEvent({ type: "keyUp", keyCode: key });
  await sleep(450);
}

async function probe(wc) {
  return run(wc, `(() => ({
    challenge: /just a moment/i.test(document.title),
    ready: !!document.querySelector("main") && !!document.querySelector("form")
  }))()`).catch(() => ({ challenge: false, ready: false }));
}

async function waitReady(wc, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let state = { challenge: false, ready: false };
  while (Date.now() < end) {
    await sleep(2000);
    state = await probe(wc);
    if (state.ready) return state;
  }
  return state;
}

function finish(result, code) {
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  app.exit(code);
}

// Audits the current page for every requested theme, then measures hints and scrolling once.
async function auditRoute(wc, route, css) {
  const anchors = route === "conversation"
    ? { ...REQUIRED_ANCHORS.common, ...REQUIRED_ANCHORS.conversation }
    : { ...REQUIRED_ANCHORS.common, ...REQUIRED_ANCHORS.home };
  const result = { route, themes: {} };

  for (const theme of themes) {
    nativeTheme.themeSource = theme;
    await sleep(2500);
    result.themes[theme] = await evaluate(wc, auditPage, anchors, Boolean(css));
  }

  // Hints, with Escape first so the composer does not hold editable context.
  await press(wc, "Escape");
  await press(wc, "f");
  result.hints = await evaluate(wc, auditHints);
  await press(wc, "Escape");

  // Scrolling by pointer: hover the sidebar list and press j, then check which region moved.
  const list = result.themes[themes[0]].sidebarList;
  if (list && list.scrollable) {
    const before = await run(wc, `(() => { const l = document.querySelector("#app-shell-sidebar [data-app-action-sidebar-scroll]"); const t = document.querySelector("main [role='main'], main [data-app-action-timeline-scroll]"); return { list: l.scrollTop, thread: t ? t.scrollTop : 0 }; })()`);
    wc.sendInputEvent({ type: "mouseMove", x: list.rect.x + Math.round(list.rect.w / 2), y: list.rect.y + Math.round(list.rect.h / 2) });
    await sleep(300);
    await press(wc, "j");
    await press(wc, "j");
    const after = await run(wc, `(() => { const l = document.querySelector("#app-shell-sidebar [data-app-action-sidebar-scroll]"); const t = document.querySelector("main [role='main'], main [data-app-action-timeline-scroll]"); return { list: l.scrollTop, thread: t ? t.scrollTop : 0 }; })()`);
    result.sidebarScroll = { before, after, sidebarMoved: after.list > before.list, threadMoved: after.thread !== before.thread };
  } else {
    result.sidebarScroll = null;
  }
  return result;
}

app.on("browser-window-created", (_event, win) => {
  const wc = win.webContents;
  (async () => {
    const result = { startedAt: new Date().toISOString(), routes: [] };
    try {
      await sleep(8000);
      const state = await waitReady(wc, 75000);
      if (!state.ready) {
        result.error = state.challenge
          ? "challenge page: a debugger is attached or the stored session is stale"
          : "the signed-in app never rendered";
        finish(result, state.challenge ? 3 : 2);
        return;
      }
      await sleep(3000);

      let css = "";
      if (cssPath) {
        css = fs.readFileSync(cssPath, "utf8");
        await wc.insertCSS(css);
        await sleep(600);
      }

      result.routes.push(await auditRoute(wc, "home", css));

      if (process.env.AUDIT_CONVERSATION === "1") {
        const href = await run(wc, `(() => { const a = document.querySelector("a[href^='/c/']"); return a ? a.getAttribute("href") : null; })()`);
        if (href) {
          await wc.loadURL("https://chatgpt.com" + href);
          await waitReady(wc, 45000);
          await sleep(4000);
          if (css) { await wc.insertCSS(css); await sleep(600); }
          result.routes.push(await auditRoute(wc, "conversation", css));
        }
      }
      finish(result, 0);
    } catch (error) {
      result.error = String(error && error.message ? error.message : error).slice(0, 300);
      finish(result, 1);
    }
  })();
});

require(path.join(projectRoot, "main.js"));
