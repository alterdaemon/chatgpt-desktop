const COMPOSER_SELECTOR = "#prompt-textarea, [role='textbox'][contenteditable='true']";

function getLiveComposer(page) {
  return page.locator(COMPOSER_SELECTOR).filter({ visible: true }).first();
}

// Runs in the page. Only booleans leave the renderer, never page/account text.
function inspectLiveReadiness(composerSelector) {
  const visible = element => Boolean(element && element.getBoundingClientRect().width && element.getBoundingClientRect().height);
  const composer = [...document.querySelectorAll(composerSelector)].some(visible);
  const sidebar = Boolean(document.querySelector("#app-shell-sidebar"));
  const challenge = !composer && (/just a moment|verify you are human|checking your browser/i.test(document.title) ||
    Boolean(document.querySelector("#challenge-running, #cf-challenge-running")));
  const login = [...document.querySelectorAll("header button, nav button, #app-shell-sidebar button, button[data-testid='login-button']")]
    .some(element => visible(element) && /^(?:log in|sign in)$/i.test(element.textContent.trim()));
  const signInRequired = !challenge && (location.hostname === "auth.openai.com" || login);
  return { ready: composer && sidebar && !challenge && !signInRequired, composer, sidebar, challenge, signInRequired };
}

module.exports = { COMPOSER_SELECTOR, getLiveComposer, inspectLiveReadiness };
