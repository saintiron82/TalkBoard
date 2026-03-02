/**
 * Claude injection script builder.
 */

import { BASE_INJECTION_CODE } from "./base";

const CLAUDE_SELECTORS = {
  input: [
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"][data-placeholder]',
    'fieldset div[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]',
  ],
  sendButton: [
    'button[aria-label="Send Message"]',
    'button[aria-label="Send message"]',
    'button[aria-label="메시지 보내기"]',
    'fieldset button:last-of-type',
  ],
  assistantMessage: [
    '.font-claude-response',           // Current Claude.ai (2025-2026): response content div
    '.font-claude-message',            // Legacy fallback
    '[data-testid="chat-message-content"]',
    '.contents .grid .prose',
  ],
  // Target selectors within response element to extract ONLY response content
  // (skips thinking blocks that live outside these markdown containers)
  responseContent: [
    '.progressive-markdown',           // Streaming response content
    '.standard-markdown',              // Static/completed response content
    '.markdown',                       // Generic fallback
  ],
  // Selectors for thinking/reasoning blocks to EXCLUDE
  thinkingExclude: [
    'details',                         // Collapsible thinking blocks
    '[data-is-thinking]',              // Thinking attribute
    '.font-tiempos',                   // Thinking font style
    'summary',                         // Summary element of details
  ],
  streamingIndicator: [
    '[data-is-streaming="true"]',
    'button[aria-label="Stop Response"]',
    'button[aria-label="응답 중지"]',
    'details[open] .font-tiempos',         // Thinking block still expanding
    '[data-is-thinking="true"]',           // Thinking attribute active
  ],
  loginRequired: [
    'button[data-testid="login-button"]',
    'a[href="/login"]',
  ],
  readySignals: {
    present: ['div[contenteditable="true"]'],
    absent: [
      '[data-is-streaming="true"]',
      '[data-is-thinking="true"]',           // Thinking must be complete
    ],
  },
};

export function buildClaudeInjection(prompt: string, roundId: string, slotId: string): string {
  const selectors = JSON.stringify(CLAUDE_SELECTORS);
  const escapedPrompt = JSON.stringify(prompt);

  return `(async function() {
${BASE_INJECTION_CODE}

var SELECTORS = ${selectors};
var prompt = ${escapedPrompt};
var roundId = ${JSON.stringify(roundId)};
var slotId = ${JSON.stringify(slotId)};
var PROVIDER = "claude";

function step(msg) {
  console.log("[TalkAgent:claude] " + msg);
}

try {
  step("Starting injection...");

  if (isLoginRequired(SELECTORS.loginRequired)) {
    window.__talkagentIPC.sendToMain("provider:notLoggedIn", { provider: PROVIDER });
    return;
  }

  var initialCount = countMessages(SELECTORS.assistantMessage);
  step("Initial assistant message count: " + initialCount);

  var input = resolveSelector(SELECTORS.input);
  if (!input) {
    step("Input not found immediately, waiting...");
    input = await waitForElement(SELECTORS.input, 10000);
  }
  step("Input found: " + input.tagName + " " + (input.className || ""));

  injectText(input, prompt);
  step("Text injected, length: " + prompt.length);
  await new Promise(function(r) { setTimeout(r, 500); });

  step("Input content after inject: " + (input.textContent || "").slice(0, 50));

  var sent = clickButton(SELECTORS.sendButton);
  step("Send button clicked: " + sent);
  if (!sent) {
    step("Trying Enter key...");
    pressEnter(input);
  }

  step("Waiting for response...");

  var responseText = await observeResponse({
    responseSelectors: SELECTORS.assistantMessage,
    streamingSelectors: SELECTORS.streamingIndicator,
    readySignals: SELECTORS.readySignals,
    responseContentSelector: SELECTORS.responseContent,
    excludeSelectors: SELECTORS.thinkingExclude,
    initialCount: initialCount,
    minResponseLength: 1,
  });

  step("Response captured, length: " + responseText.length);
  window.__talkagentIPC.sendToMain("response:captured", {
    provider: PROVIDER, content: responseText, roundId: roundId, slotId: slotId,
  });
} catch (err) {
  step("ERROR: " + err.message);
  window.__talkagentIPC.sendToMain("provider:error", {
    provider: PROVIDER, error: err.message, roundId: roundId, slotId: slotId,
  });
}
})();`;
}
