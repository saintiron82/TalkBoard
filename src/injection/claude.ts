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
    // 2025-2026 Claude.ai — try multiple patterns
    '.font-claude-response',
    '.font-claude-message',
    '[data-testid="chat-message-content"]',
    '[data-testid="chat-message-text"]',
    // Broader: any element with response-related data attributes
    '[data-is-streaming]',
    // Structural fallbacks
    '.contents .grid .prose',
    '.grid-cols-1 .prose',
  ],
  // Target selectors within response element to extract ONLY response content
  // (skips thinking blocks that live outside these markdown containers)
  responseContent: [
    '.progressive-markdown',           // Streaming response content
    '.standard-markdown',              // Static/completed response content
    '.markdown',                       // Generic fallback
    'p',                               // Ultimate fallback: paragraphs
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
    'button[aria-label="Stop response"]',
    'button[aria-label="응답 중지"]',
    'button[aria-label*="Stop"]',          // Broader stop button match
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

export function buildClaudeInjection(prompt: string, roundId: string, slotId: string, semiAuto = false): string {
  const selectors = JSON.stringify(CLAUDE_SELECTORS);
  const escapedPrompt = JSON.stringify(prompt);

  return `(async function() {
${BASE_INJECTION_CODE}

var SELECTORS = ${selectors};
var prompt = ${escapedPrompt};
var roundId = ${JSON.stringify(roundId)};
var slotId = ${JSON.stringify(slotId)};
var PROVIDER = "claude";
var semiAuto = ${semiAuto};

function step(msg) {
  console.log("[TalkAgent:claude] " + msg);
}

try {
  step("Starting injection...");
  step("URL: " + location.href);

  if (isLoginRequired(SELECTORS.loginRequired)) {
    window.__talkagentIPC.sendToMain("provider:notLoggedIn", { provider: PROVIDER });
    return;
  }

  // === DOM Diagnostic: enumerate what exists on the page ===
  step("=== DOM Diagnostic Start ===");

  // Check which assistantMessage selectors match
  for (var si = 0; si < SELECTORS.assistantMessage.length; si++) {
    try {
      var matched = document.querySelectorAll(SELECTORS.assistantMessage[si]);
      step("assistantMsg[" + si + "] '" + SELECTORS.assistantMessage[si] + "' → " + matched.length + " hits");
    } catch(e) { step("assistantMsg[" + si + "] error: " + e.message); }
  }

  // Check which responseContent selectors match
  for (var ri = 0; ri < SELECTORS.responseContent.length; ri++) {
    try {
      var rmatched = document.querySelectorAll(SELECTORS.responseContent[ri]);
      step("responseContent[" + ri + "] '" + SELECTORS.responseContent[ri] + "' → " + rmatched.length + " hits");
    } catch(e) {}
  }

  // Check data-testid elements (Claude uses these)
  var testIds = document.querySelectorAll("[data-testid]");
  var testIdMap = {};
  for (var ti = 0; ti < testIds.length; ti++) {
    var tid = testIds[ti].getAttribute("data-testid");
    testIdMap[tid] = (testIdMap[tid] || 0) + 1;
  }
  var testIdKeys = Object.keys(testIdMap);
  step("data-testid elements: " + testIdKeys.length + " unique IDs");
  for (var tki = 0; tki < Math.min(testIdKeys.length, 20); tki++) {
    step("  [data-testid=" + testIdKeys[tki] + "] × " + testIdMap[testIdKeys[tki]]);
  }

  // Check data-is-streaming, data-is-thinking
  var streamEls = document.querySelectorAll("[data-is-streaming]");
  step("data-is-streaming elements: " + streamEls.length);
  var thinkEls = document.querySelectorAll("[data-is-thinking]");
  step("data-is-thinking elements: " + thinkEls.length);

  // Check font-* classes (Claude-specific)
  var fontClasses = document.querySelectorAll("[class*='font-claude']");
  step("font-claude-* elements: " + fontClasses.length);
  for (var fi = 0; fi < Math.min(fontClasses.length, 5); fi++) {
    step("  font-claude: " + fontClasses[fi].tagName + " class=" + fontClasses[fi].className.slice(0, 100));
  }

  // Check markdown-related classes
  var mdEls = document.querySelectorAll("[class*='markdown']");
  step("markdown-* elements: " + mdEls.length);
  for (var mi = 0; mi < Math.min(mdEls.length, 5); mi++) {
    step("  markdown: " + mdEls[mi].tagName + " class=" + mdEls[mi].className.slice(0, 100));
  }

  // Check prose elements
  var proseEls = document.querySelectorAll(".prose");
  step(".prose elements: " + proseEls.length);

  // Check contenteditable elements
  var ceEls = document.querySelectorAll('[contenteditable="true"]');
  step("contenteditable elements: " + ceEls.length);
  for (var ci = 0; ci < Math.min(ceEls.length, 3); ci++) {
    step("  ce[" + ci + "] " + ceEls[ci].tagName + " class=" + (ceEls[ci].className || "").slice(0, 80));
  }

  step("=== DOM Diagnostic End ===");

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
