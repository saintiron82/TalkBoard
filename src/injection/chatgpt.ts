/**
 * ChatGPT injection script builder.
 */

import { BASE_INJECTION_CODE } from "./base";

const CHATGPT_SELECTORS = {
  input: [
    '#prompt-textarea',
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"][data-placeholder]',
    'textarea[placeholder]',
    'div[contenteditable="true"]',
  ],
  sendButton: [
    'button[data-testid="send-button"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Send message"]',
    'main form button[type="button"]:last-child',
    'form button:not([aria-label="Attach files"])',
  ],
  assistantMessage: [
    '[data-message-author-role="assistant"]',
    'div[data-message-id] .markdown',
    '.agent-turn .markdown',
    'article[data-testid*="conversation-turn"] .markdown',
  ],
  // Selectors for thinking/reasoning blocks to EXCLUDE (o1/o3 models)
  thinkingExclude: [
    'details',                             // Collapsible reasoning blocks
    '[data-testid="reasoning-content"]',   // Reasoning content container
    '.reasoning-content',                  // Reasoning content class
    'summary',                             // Summary element of details
  ],
  streamingIndicator: [
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[data-testid="stop-button"]',
    'button[aria-label="Stop reasoning"]', // o1/o3 reasoning phase
  ],
  loginRequired: [
    'button[data-testid="login-button"]',
    '[data-testid="auth-page"]',
  ],
  readySignals: {
    present: ['#prompt-textarea'],
    absent: [
      'button[aria-label="Stop generating"]',
      'button[data-testid="stop-button"]',
      'button[aria-label="Stop reasoning"]',
    ],
  },
};

export function buildChatGPTInjection(prompt: string, roundId: string, slotId: string, semiAuto = false): string {
  const selectors = JSON.stringify(CHATGPT_SELECTORS);
  const escapedPrompt = JSON.stringify(prompt);

  return `(async function() {
${BASE_INJECTION_CODE}

var SELECTORS = ${selectors};
var prompt = ${escapedPrompt};
var roundId = ${JSON.stringify(roundId)};
var slotId = ${JSON.stringify(slotId)};
var PROVIDER = "gpt";
var semiAuto = ${semiAuto};

function step(msg) {
  console.log("[TalkAgent:gpt] " + msg);
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
  step("Input found: " + input.tagName + " " + (input.id || input.className));

  injectText(input, prompt);
  step("Text injected, length: " + prompt.length);
  await new Promise(function(r) { setTimeout(r, 500); });

  step("Input content after inject: " + (input.textContent || input.value || "").slice(0, 50));

  if (semiAuto) {
    step("Semi-auto mode — waiting for manual send");
    window.__talkagentIPC.sendToMain("provider:waitingManualSend", { provider: PROVIDER, slotId: slotId });
  } else {
    var sent = clickButton(SELECTORS.sendButton);
    step("Send button clicked: " + sent);
    if (!sent) {
      step("Trying Enter key...");
      pressEnter(input);
    }
  }

  step("Waiting for response...");
  var responseText = await observeResponse({
    responseSelectors: SELECTORS.assistantMessage,
    streamingSelectors: SELECTORS.streamingIndicator,
    readySignals: SELECTORS.readySignals,
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
