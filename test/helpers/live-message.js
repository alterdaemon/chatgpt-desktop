function getLiveAssistantMessage(page) {
  const currentReply = page.locator("[data-chatgpt-search-message-ids]")
    .filter({ has: page.locator("[data-conversation-role='assistant']"), hasNot: page.locator("[data-conversation-role='user']") });
  const labeledReply = page
    .getByRole("heading", { name: "ChatGPT said:", exact: true })
    .locator("xpath=ancestor::*[.//p][1]")
    .filter({ hasNot: page.getByRole("heading", { name: "You said:", exact: true }) });

  // Never fall back to the whole conversation: the user prompt contains the marker too.
  return page.locator("[data-message-author-role='assistant']").or(currentReply).or(labeledReply).last();
}

// DOM counterpart of the locator above, for debugger-free main-process audits.
// Never match the whole conversation: the user's prompt contains the marker too.
function findLiveMessages(role = "assistant") {
  const kind = role === "user" ? "user" : "assistant";
  const tagged = [...document.querySelectorAll(`[data-message-author-role='${kind}'], [data-conversation-role='${kind}']`)];
  if (tagged.length) {
    if (kind === "user") return tagged;
    // On the rich front end data-conversation-role is on an h4 label, not
    // the reply body. Its message-search unit contains only that speaker.
    return [...new Set(tagged.map(element => {
      const unit = element.closest?.("[data-chatgpt-search-message-ids]");
      return unit && !unit.querySelector("[data-conversation-role='user'], [data-message-author-role='user']") ? unit : element;
    }))];
  }
  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role='heading']")];
  if (kind === "user") return headings.filter(heading => heading.textContent.trim() === "You said:");
  const replies = [];
  for (const heading of headings) {
    if (heading.textContent.trim() !== "ChatGPT said:") continue;
    for (let element = heading.parentElement; element && element !== document.body; element = element.parentElement) {
      if (!element.querySelector("p")) continue;
      if (!headings.some(other => element.contains(other) && other.textContent.trim() === "You said:")) replies.push(element);
      break;
    }
  }
  return [...new Set(replies)];
}

module.exports = { getLiveAssistantMessage, findLiveMessages };
