/**
 * Gemini injection script builder.
 */

import { BASE_INJECTION_CODE } from "./base";

const GEMINI_SELECTORS = {
  input: [
    '.ql-editor[contenteditable="true"]',
    'rich-textarea .ql-editor',
    'rich-textarea div[contenteditable="true"]',
    '.text-input-field_textarea-wrapper div[contenteditable="true"]',
    'div[contenteditable="true"][aria-label*="prompt" i]',
    'div[contenteditable="true"][aria-label*="message" i]',
    'div[contenteditable="true"][aria-label*="입력" i]',
    '.input-area div[contenteditable="true"]',
    'div[contenteditable="true"]',
  ],
  sendButton: [
    'button.send-button',
    'button[aria-label="Send message"]',
    'button[aria-label="보내기"]',
    'button[data-at="send"]',
    'button[mattooltip="Send message"]',
    'button[mattooltip="보내기"]',
    '.input-area button[mat-icon-button]',
    'button[aria-label="Send"]',
  ],
  assistantMessage: [
    'message-content.model-response-text',
    '.model-response-text',
    'model-response message-content',
    '.response-container-content',
    '.conversation-container model-response',
  ],
  // Target selectors within response element to extract ONLY response markdown
  // (skips thinking blocks / status text / buttons that live outside .markdown)
  responseContent: [
    '.markdown.markdown-main-panel',  // Main response markdown (Gemini 2025+)
    '.markdown',                       // Generic markdown container
  ],
  // Selectors for thinking/reasoning blocks to EXCLUDE
  thinkingExclude: [
    'thinking-content',                    // Gemini thinking content element
    '.thinking-content',                   // Thinking content class
    'thinking-tag',                        // Thinking tag element
    '.thinking-tag',                       // Thinking tag class
    'details',                             // Collapsible thinking blocks
    'summary',                             // Summary of details
    '.thought-process',                    // Thought process container
    '.thought-chip',                       // Thinking step chip
    'button',                              // UI buttons ("지금 답변하기" etc.)
  ],
  streamingIndicator: [
    '.loading-indicator:not(.hidden)',
    '.loading-indicator:not(.ng-hide)',
    'mat-progress-bar',
    '.response-container .loading',
    'model-response .loading',
    'button[aria-label="Stop"]',
    'button[aria-label="중지"]',
    'button[aria-label="중단"]',
    'button[mattooltip="Stop"]',
    'button[mattooltip="중지"]',
    'thinking-indicator:not(.hidden)',
    'thinking-indicator:not(.ng-hide)',
  ],
  loginRequired: [
    '[data-signin-btn]',
    'a[href*="accounts.google.com/signin"]',
    'a[href*="accounts.google.com/ServiceLogin"]',
  ],
  readySignals: {
    present: [
      'div[contenteditable="true"]',
    ],
    absent: [
      '.loading-indicator:not(.hidden)',
      '.loading-indicator:not(.ng-hide)',
      'mat-progress-bar',
      'button[aria-label="Stop"]',
      'button[aria-label="중지"]',
      'button[aria-label="중단"]',
      'thinking-indicator:not(.hidden)',
      'thinking-indicator:not(.ng-hide)',
    ],
  },
};

export function buildGeminiInjection(prompt: string, roundId: string, slotId: string, semiAuto = false): string {
  const selectors = JSON.stringify(GEMINI_SELECTORS);
  const escapedPrompt = JSON.stringify(prompt);

  return `(async function() {
${BASE_INJECTION_CODE}

var SELECTORS = ${selectors};
var prompt = ${escapedPrompt};
var roundId = ${JSON.stringify(roundId)};
var slotId = ${JSON.stringify(slotId)};
var PROVIDER = "gemini";
var semiAuto = ${semiAuto};

function step(msg) {
  console.log("[TalkAgent:gemini] " + msg);
}

try {
  step("Starting injection...");

  if (isLoginRequired(SELECTORS.loginRequired)) {
    window.__talkagentIPC.sendToMain("provider:notLoggedIn", { provider: PROVIDER });
    return;
  }

  // Diagnostic: log which selectors match
  for (var si = 0; si < SELECTORS.assistantMessage.length; si++) {
    try {
      var matched = document.querySelectorAll(SELECTORS.assistantMessage[si]);
      if (matched.length > 0) {
        step("assistantMessage selector [" + si + "] '" + SELECTORS.assistantMessage[si] + "' matched " + matched.length + " elements");
      }
    } catch(e) {}
  }

  var initialCount = countMessages(SELECTORS.assistantMessage);
  step("Initial model message count: " + initialCount);

  // DOM diagnostic: what input elements exist on this page?
  var allEditable = document.querySelectorAll('[contenteditable="true"]');
  step("contenteditable elements: " + allEditable.length);
  for (var ei = 0; ei < Math.min(allEditable.length, 5); ei++) {
    var ce = allEditable[ei];
    step("  [" + ei + "] " + ce.tagName + " class=" + (ce.className || "").slice(0, 80) + " aria-label=" + (ce.getAttribute("aria-label") || ""));
  }
  var allTextarea = document.querySelectorAll("textarea");
  step("textarea elements: " + allTextarea.length);
  var allInput = document.querySelectorAll('input[type="text"]');
  step("input[text] elements: " + allInput.length);
  step("URL: " + location.href);

  var input = resolveSelector(SELECTORS.input);
  if (!input) {
    step("Input not found immediately, waiting...");
    input = await waitForElement(SELECTORS.input, 10000);
  }
  step("Input found: " + input.tagName + " class=" + (input.className || "") + " aria-label=" + (input.getAttribute("aria-label") || ""));

  injectText(input, prompt);
  step("Text injected, length: " + prompt.length);
  await new Promise(function(r) { setTimeout(r, 800); });

  step("Input content after inject: '" + (input.textContent || "").slice(0, 80) + "'");

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
    responseContentSelector: SELECTORS.responseContent,
    excludeSelectors: SELECTORS.thinkingExclude,
    initialCount: initialCount,
    minResponseLength: 1,
    semiAuto: semiAuto,
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
