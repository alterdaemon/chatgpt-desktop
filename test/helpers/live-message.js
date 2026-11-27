function getLiveAssistantMessage(page) {
  const labeledReply = page
    .getByRole("heading", { name: "ChatGPT said:", exact: true })
    .locator("xpath=ancestor::*[.//p][1]")
    .filter({ hasNot: page.getByRole("heading", { name: "You said:", exact: true }) });

  // Never fall back to the whole conversation: the user prompt contains the marker too.
  return page.locator("[data-message-author-role='assistant']").or(labeledReply).last();
}

module.exports = { getLiveAssistantMessage };
