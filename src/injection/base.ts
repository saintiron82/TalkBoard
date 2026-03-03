/**
 * Base injection utilities — embedded as a string for executeJavaScript().
 * Uses window.__talkagentIPC.sendToMain() for IPC communication.
 *
 * Capture stabilization: multi-layer verification pipeline
 * [debounce 3s] → [streaming check] → [readySignals check] → [text stability 3x @500ms] → [post-capture delay 500ms] → [capture]
 */

export const BASE_INJECTION_CODE = `
var BASE_CONFIG = {
  mutationDebounceMs: 1500,
  responseTimeoutMs: 170000,
  stabilityCheckCount: 3,
  stabilityCheckIntervalMs: 1500,
  postCaptureDelayMs: 500,
};

function resolveSelector(selectors, context) {
  context = context || document;
  for (var i = 0; i < selectors.length; i++) {
    try {
      var el = context.querySelector(selectors[i]);
      if (el) return el;
    } catch (e) {}
  }
  return null;
}

function waitForElement(selectors, timeout) {
  timeout = timeout || 10000;
  return new Promise(function(resolve, reject) {
    var el = resolveSelector(selectors);
    if (el) return resolve(el);
    var observer = new MutationObserver(function() {
      var found = resolveSelector(selectors);
      if (found) { observer.disconnect(); clearTimeout(timer); resolve(found); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    var timer = setTimeout(function() {
      observer.disconnect();
      reject(new Error("Element not found within " + timeout + "ms"));
    }, timeout);
  });
}

function injectText(element, text) {
  element.focus();
  if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
    var nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    if (!nativeSetter) {
      nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    }
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(element, text);
    } else {
      element.value = text;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (element.contentEditable === "true") {
    // Clear existing content (TrustedHTML-safe, no innerHTML)
    while (element.firstChild) element.removeChild(element.firstChild);
    element.focus();

    // Strategy 1: execCommand (works on most sites)
    var inserted = false;
    try {
      var sel = window.getSelection();
      var rng = document.createRange();
      rng.selectNodeContents(element);
      sel.removeAllRanges();
      sel.addRange(rng);
      inserted = document.execCommand("insertText", false, text);
    } catch (e) { /* fall through */ }

    // Strategy 2: ClipboardEvent paste simulation
    if (!inserted || element.textContent.trim().length === 0) {
      try {
        var dt = new DataTransfer();
        dt.setData("text/plain", text);
        element.dispatchEvent(new ClipboardEvent("paste", {
          clipboardData: dt, bubbles: true, cancelable: true,
        }));
        inserted = element.textContent.trim().length > 0;
      } catch (e) { /* fall through */ }
    }

    // Strategy 3: Direct textContent (last resort)
    if (!inserted || element.textContent.trim().length === 0) {
      element.textContent = text;
    }

    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
  }
}

function clickButton(selectors) {
  var btn = resolveSelector(selectors);
  if (btn) { btn.click(); return true; }
  return false;
}

function pressEnter(element) {
  element.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true
  }));
}

function countMessages(selectors) {
  for (var i = 0; i < selectors.length; i++) {
    try {
      var elements = document.querySelectorAll(selectors[i]);
      if (elements.length > 0) return elements.length;
    } catch (e) {}
  }
  return 0;
}

/** Check if all readySignals conditions are met */
function checkReadySignals(readySignals) {
  if (!readySignals) return true;
  // Check 'present' selectors — must exist
  if (readySignals.present) {
    for (var i = 0; i < readySignals.present.length; i++) {
      try {
        if (!document.querySelector(readySignals.present[i])) return false;
      } catch (e) {}
    }
  }
  // Check 'absent' selectors — must NOT exist
  if (readySignals.absent) {
    for (var j = 0; j < readySignals.absent.length; j++) {
      try {
        if (document.querySelector(readySignals.absent[j])) return false;
      } catch (e) {}
    }
  }
  return true;
}

/** Verify text stability — sample N times at interval, all must match */
function verifyTextStability(getText, count, intervalMs) {
  return new Promise(function(resolve) {
    var samples = [];
    var idx = 0;
    function sample() {
      samples.push(getText());
      idx++;
      if (idx < count) {
        setTimeout(sample, intervalMs);
      } else {
        var allSame = samples.every(function(s) { return s === samples[0]; });
        resolve(allSame ? samples[0] : null);
      }
    }
    sample();
  });
}

/**
 * Observe response with multi-layer capture verification pipeline.
 * [debounce] → [streaming check] → [readySignals] → [text stability] → [post-delay] → [capture]
 */
function observeResponse(opts) {
  var responseSelectors = opts.responseSelectors;
  var streamingSelectors = opts.streamingSelectors || [];
  var readySignals = opts.readySignals || null;
  var initialCount = opts.initialCount;
  var debounceMs = opts.debounceMs || BASE_CONFIG.mutationDebounceMs;
  var timeoutMs = opts.timeoutMs || BASE_CONFIG.responseTimeoutMs;
  var excludeSelectors = opts.excludeSelectors || [];
  var minResponseLength = opts.minResponseLength || 0;
  var responseContentSelector = opts.responseContentSelector || [];
  var semiAuto = opts.semiAuto || false;

  return new Promise(function(resolve, reject) {
    var debounceTimer = null;
    var resolved = false;
    var observer;
    var hardTimeout;
    var hardCap;
    var streamPoll;
    var streamingAbsentCount = 0;

    function cleanup() {
      resolved = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      clearTimeout(hardTimeout);
      if (hardCap) clearTimeout(hardCap);
      if (streamPoll) clearInterval(streamPoll);
      observer.disconnect();
    }

    function getLatestText() {
      for (var i = 0; i < responseSelectors.length; i++) {
        try {
          var all = document.querySelectorAll(responseSelectors[i]);
          if (all.length > 0) {
            var el = all[all.length - 1];

            // If responseContentSelector is set, extract text only from that child
            // Skip elements inside excluded parents (thinking/reasoning blocks)
            if (responseContentSelector.length > 0) {
              var contentEl = null;
              for (var s = 0; s < responseContentSelector.length; s++) {
                try {
                  var allContent = el.querySelectorAll(responseContentSelector[s]);
                  // Iterate from last to first, skip elements inside thinking blocks
                  for (var ci = allContent.length - 1; ci >= 0; ci--) {
                    if (!isInsideExcluded(allContent[ci], excludeSelectors)) {
                      contentEl = allContent[ci];
                      break;
                    }
                  }
                  if (contentEl) break;
                } catch (e3) {}
              }
              if (contentEl) {
                var ctxt = contentEl.innerText || contentEl.textContent || "";
                if (ctxt.trim().length > minResponseLength) return ctxt.trim();
              }
              // responseContentSelector is set but no content child found yet
              // → response markdown not rendered, skip this element (don't fall through)
              continue;
            }

            // Fallback: clone and remove excluded content (e.g., thinking blocks)
            if (excludeSelectors.length > 0) {
              el = el.cloneNode(true);
              for (var j = 0; j < excludeSelectors.length; j++) {
                try {
                  var excluded = el.querySelectorAll(excludeSelectors[j]);
                  for (var k = 0; k < excluded.length; k++) {
                    excluded[k].parentNode.removeChild(excluded[k]);
                  }
                } catch (e2) {}
              }
            }
            var txt = el.innerText || el.textContent || "";
            if (txt.trim().length > minResponseLength) return txt.trim();
          }
        } catch (e) {}
      }
      return "";
    }

    function verifyAndCapture() {
      if (resolved) return;
      console.log("[TalkAgent:capture] verifyAndCapture triggered");

      // Layer 1: Streaming indicator check — must be absent consecutively
      var isStreaming = resolveSelector(streamingSelectors);
      if (isStreaming) {
        streamingAbsentCount = 0;
        console.log("[TalkAgent:capture] L1 WAIT — streaming active");
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(verifyAndCapture, 1000);
        return;
      }
      streamingAbsentCount++;
      if (streamingAbsentCount < 2) {
        console.log("[TalkAgent:capture] L1 WAIT — confirming streaming ended (" + streamingAbsentCount + "/2)");
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(verifyAndCapture, 1000);
        return;
      }
      console.log("[TalkAgent:capture] L1 PASS — streaming confirmed ended");

      // Layer 2: New message count check
      var currentCount = countMessages(responseSelectors);
      if (currentCount <= initialCount) {
        console.log("[TalkAgent:capture] L2 WAIT — no new msg (count: " + currentCount + ", initial: " + initialCount + ")");
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(verifyAndCapture, 1000);
        return;
      }
      console.log("[TalkAgent:capture] L2 PASS — new msg (count: " + currentCount + ")");

      // Layer 3: readySignals check
      if (!checkReadySignals(readySignals)) {
        console.log("[TalkAgent:capture] L3 WAIT — readySignals not met");
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(verifyAndCapture, 1000);
        return;
      }
      console.log("[TalkAgent:capture] L3 PASS — readySignals OK");

      // Layer 4: Text stability verification (3 samples @ 1500ms = 4.5s window)
      console.log("[TalkAgent:capture] L4 — starting stability check");
      verifyTextStability(
        getLatestText,
        BASE_CONFIG.stabilityCheckCount,
        BASE_CONFIG.stabilityCheckIntervalMs
      ).then(function(stableText) {
        if (resolved) return;

        if (stableText && stableText.length > 0) {
          console.log("[TalkAgent:capture] L4 PASS — text stable (" + stableText.length + " chars)");
          // Layer 5: Post-capture delay (React re-render buffer)
          setTimeout(function() {
            if (resolved) return;
            // Final text extraction after post-delay
            var finalText = getLatestText();
            console.log("[TalkAgent:capture] L5 PASS — captured (" + (finalText || stableText).length + " chars)");
            cleanup();
            resolve(finalText || stableText);
          }, BASE_CONFIG.postCaptureDelayMs);
        } else {
          // Text not stable yet, retry
          console.log("[TalkAgent:capture] L4 FAIL — text not stable, retry");
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(verifyAndCapture, 1000);
        }
      });
    }

    // Inactivity-based timeout: reset on every DOM mutation.
    // Semi-auto mode: no inactivity timeout (user sends manually)
    var INACTIVITY_TIMEOUT_MS = semiAuto ? 600000 : 30000;
    var HARD_CAP_MS = semiAuto ? 600000 : timeoutMs;

    function resetInactivityTimeout() {
      if (resolved) return;
      clearTimeout(hardTimeout);
      hardTimeout = setTimeout(function() {
        if (resolved) return;
        var text = getLatestText();
        cleanup();
        if (text) {
          resolve(text);
        } else {
          reject(new Error("Response timeout (inactivity " + (INACTIVITY_TIMEOUT_MS / 1000) + "s)"));
        }
      }, INACTIVITY_TIMEOUT_MS);
    }

    observer = new MutationObserver(function() {
      if (resolved) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(verifyAndCapture, debounceMs);
      // Reset streaming confirmation on new DOM activity
      streamingAbsentCount = 0;
      // Reset inactivity timeout + send heartbeat on every DOM change
      resetInactivityTimeout();
      if (typeof window !== "undefined" && window.__talkagentIPC) {
        try { window.__talkagentIPC.sendToMain("provider:heartbeat", { ts: Date.now() }); } catch(e) {}
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // Initial inactivity timeout
    resetInactivityTimeout();

    // Absolute hard cap (safety net — extends if streaming is still active)
    hardCap = setTimeout(function hardCapHandler() {
      if (resolved) return;
      var isStreaming = resolveSelector(streamingSelectors);
      if (isStreaming) {
        console.log("[TalkAgent:capture] Hard cap reached but streaming active — extending 30s");
        hardCap = setTimeout(hardCapHandler, 30000);
        return;
      }
      var text = getLatestText();
      console.log("[TalkAgent:capture] Hard cap — capturing (" + (text ? text.length + " chars" : "empty") + ")");
      cleanup();
      if (text) {
        resolve(text);
      } else {
        reject(new Error("Response timeout (hard cap " + (HARD_CAP_MS / 1000) + "s)"));
      }
    }, HARD_CAP_MS);

    // Active polling: check for streaming end every 2s (independent of MutationObserver)
    streamPoll = setInterval(function() {
      if (resolved) { clearInterval(streamPoll); return; }
      var isStreaming = resolveSelector(streamingSelectors);
      var currentCount = countMessages(responseSelectors);
      if (!isStreaming && currentCount > initialCount) {
        console.log("[TalkAgent:capture] Stream poll — streaming ended, triggering verify");
        if (debounceTimer) clearTimeout(debounceTimer);
        verifyAndCapture();
      }
    }, 2000);

    // Initial probe after 1s
    setTimeout(verifyAndCapture, 1000);
  });
}

/** Check if element is inside any of the excluded parent selectors */
function isInsideExcluded(el, excludeSelectors) {
  if (!excludeSelectors || excludeSelectors.length === 0) return false;
  var node = el.parentElement;
  while (node && node !== document.body) {
    for (var i = 0; i < excludeSelectors.length; i++) {
      try {
        if (node.matches && node.matches(excludeSelectors[i])) return true;
      } catch(e) {}
    }
    node = node.parentElement;
  }
  return false;
}

function isLoginRequired(loginSelectors) {
  return resolveSelector(loginSelectors) !== null;
}
`;
