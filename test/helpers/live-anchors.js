// Selectors that the example stylesheet and the Vimium module rely on in the signed-in app.
// They are the only place the live canary looks, so a site redesign fails one named assertion
// instead of silently disabling a feature. Never add generated ids or utility classes here.
const REQUIRED_ANCHORS = {
  // Present on every signed-in page.
  common: {
    "theme attribute": "html[data-theme]",
    "sidebar": "#app-shell-sidebar",
    "sidebar list scroller": "#app-shell-sidebar [data-app-action-sidebar-scroll]",
    "main region": "main",
    "main header": "main header",
    "composer form": "form[data-chatgpt-composer]",
    "composer input": "form [role='textbox'][contenteditable='true']",
  },
  // The new-chat page.
  home: {
    "home thread scroller": "main [role='main']",
  },
  // An existing conversation.
  conversation: {
    "message role marker": "[data-conversation-role]",
    "thread scroller": "main [data-app-action-timeline-scroll]",
  },
};

module.exports = { REQUIRED_ANCHORS };
