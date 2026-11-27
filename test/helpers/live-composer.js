const COMPOSER_SELECTOR = "#prompt-textarea, [role='textbox'][contenteditable='true']";

function getLiveComposer(page) {
  return page.locator(COMPOSER_SELECTOR).filter({ visible: true }).first();
}

module.exports = { COMPOSER_SELECTOR, getLiveComposer };
