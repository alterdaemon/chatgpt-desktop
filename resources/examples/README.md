# Examples

This directory contains example customization files for ChatGPT Desktop.

Copy the stylesheet into your user config directory if you want a starting point:

- `resources/examples/styles/custom.css` -> `~/.config/chatgpt-desktop/styles/custom.css`

`custom.css` is a compact terminal-style theme with a performance-oriented bias. It switches the UI to monospace typography, removes rounded corners and blur-heavy styling, narrows the main chat column, tightens message spacing, simplifies the input area, hides the disclaimer row, reduces animation/streaming effects, and keeps external source links at their natural width.

For script examples, see:

- `chatgpt-lazy-chat-plusplus`: https://github.com/AlexSHamilton/chatgpt-lazy-chat-plusplus
- `chatGPT-plain-composer`: https://github.com/alberti42/chatGPT-plain-composer

Notes:

- Script files run in alphabetical order.
- Scripts should be safe to execute more than once because the app runs them after page load and in-page navigation.
- These examples are best-effort and may need updates when ChatGPT changes its DOM or class names.

Warning:

- Any `.js` file placed in `~/.config/chatgpt-desktop/scripts/` runs as code inside the ChatGPT page.
- A bad or outdated script can break typing, sending, navigation, copy/paste, scrolling, or other page behavior.
- Only run scripts you understand and trust, and expect to review or remove them when ChatGPT changes its UI.
- If something suddenly behaves strangely, disable your custom scripts first before assuming the app itself is broken.
