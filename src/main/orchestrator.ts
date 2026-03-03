/**
 * Orchestration Engine — slot-based debate management.
 * Each slot can be an LLM (gpt/gemini/claude) or a user.
 * Duplicate slots of the same type are supported.
 * Each slot maps 1:1 to a visual panel via PanelManager.
 *
 * Resilience: retry with panel reload, Claude CLI fallback, failure tracking.
 * Resume: stop pauses state, resume continues from where it left off.
 */

import { ipcMain } from "electron";
import { runClaudeCLI } from "../lib/claude-bridge";
import { DebateLogger } from "../lib/debate-logger";
import { createTopic, createSession, createRound, saveCapture } from "../lib/vault-store";
import { buildChatGPTInjection } from "../injection/chatgpt";
import { buildGeminiInjection } from "../injection/gemini";
import { buildClaudeInjection } from "../injection/claude";
import {
  buildPrompt,
  getUnseenResponses,
} from "./context-builder";
import type { PanelManager } from "./panel-manager";
import type { Provider, SlotConfig, SlotId, DebateState, StartArgs } from "./types";

const INACTIVITY_TIMEOUT_MS = 30_000;   // fail after 30s of no DOM activity
const HARD_CAP_MS = 300_000;             // absolute max 5 minutes (safety net)
const MAX_CONSECUTIVE_FAILURES = 3;
const RELOAD_WAIT_MS = 5_000;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface PendingResolver {
  resolve: (content: string) => void;
  reject: (error: Error) => void;
}

export class Orchestrator {
  private state: DebateState | null = null;
  private pendingResponses = new Map<string, PendingResolver>();
  private pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private panelManager: PanelManager;
  private roundCounter = 0;
  private logger = new DebateLogger();

  constructor(panelManager: PanelManager) {
    this.panelManager = panelManager;
    this.registerIpcListeners();
  }

  private registerIpcListeners(): void {
    // SlotId-based response matching (supports duplicate providers)
    ipcMain.on("response:captured", (_event, data: { provider: Provider; content: string; roundId: string; slotId: string }) => {
      console.log(`[Orchestrator] ${data.slotId} (${data.provider}) captured: ${data.content?.length} chars`);
      const key = `${data.slotId}:${data.roundId}`;
      const pending = this.pendingResponses.get(key);
      if (pending) {
        this.pendingResponses.delete(key);
        pending.resolve(data.content);
      }
    });

    ipcMain.on("provider:error", (_event, data: { provider: Provider; error: string; roundId: string; slotId: string }) => {
      console.error(`[Orchestrator] ${data.slotId} (${data.provider}) error:`, data.error);
      const key = `${data.slotId}:${data.roundId}`;
      const pending = this.pendingResponses.get(key);
      if (pending) {
        this.pendingResponses.delete(key);
        pending.reject(new Error(`${data.provider}: ${data.error}`));
      }
    });

    // Heartbeat: reset inactivity timeout when injection script detects DOM activity
    ipcMain.on("provider:heartbeat", () => {
      // Reset all pending timeouts (activity detected = still streaming)
      for (const [key, timer] of this.pendingTimeouts) {
        if (this.pendingResponses.has(key)) {
          clearTimeout(timer);
          const newTimer = setTimeout(() => {
            if (this.pendingResponses.has(key)) {
              const pending = this.pendingResponses.get(key)!;
              this.pendingResponses.delete(key);
              this.pendingTimeouts.delete(key);
              pending.reject(new Error(`Inactivity timeout for ${key}`));
            }
          }, INACTIVITY_TIMEOUT_MS);
          this.pendingTimeouts.set(key, newTimer);
        }
      }
    });

    ipcMain.on("provider:waitingManualSend", (_event, data: { provider: string; slotId: string }) => {
      console.log(`[Orchestrator] Semi-auto: waiting for manual send on ${data.slotId}`);
      this.panelManager.setSlotHighlight(data.slotId, true, "#f59e0b");
      this.broadcastStatus({ slots: { [data.slotId]: "manual-send" } });
    });

    ipcMain.on("provider:notLoggedIn", (_event, data: { provider: Provider }) => {
      console.warn(`[Orchestrator] Not logged in: ${data.provider}`);
      for (const [key, pending] of this.pendingResponses) {
        if (key.includes(data.provider)) {
          this.pendingResponses.delete(key);
          pending.reject(new Error(`${data.provider}: Not logged in`));
        }
      }
    });
  }

  // === Public API ===

  async start(args: StartArgs): Promise<{ error?: string }> {
    const {
      prompt,
      mode = "reactive",
      slots = [],
      maxRounds = 1,
      useBridge = false,
      semiAuto = false,
    } = args;

    if (slots.length === 0) {
      return { error: "슬롯이 하나 이상 필요합니다" };
    }

    const failureCounts: Record<SlotId, number> = {};
    for (const slot of slots) {
      failureCounts[slot.id] = 0;
    }

    this.state = {
      mode,
      slots,
      maxRounds: Math.max(1, Math.min(maxRounds, 10)),
      basePrompt: prompt,
      currentRound: 0,
      responses: [],
      currentRoundCount: 0,
      status: "running",
      abortController: new AbortController(),
      useBridge,
      semiAuto,
      failureCounts,
      waitingSlotId: null,
      userInputResolver: null,
    };

    this.roundCounter = 0;
    this.logger.open();
    this.logger.start(
      prompt, mode,
      slots.map(s => s.label),
      this.state.maxRounds,
      Object.fromEntries(slots.filter(s => s.instruction).map(s => [s.label, s.instruction]))
    );

    // Create topic + session in vault for structured storage
    try {
      const topicTitle = prompt.slice(0, 100);
      const { topic_id } = await createTopic(topicTitle);
      const { session_id } = await createSession(topic_id, topicTitle, undefined, {
        mode,
        slots: slots.map(s => ({ id: s.id, type: s.type, label: s.label })),
        maxRounds: this.state.maxRounds,
      });
      this.state.topicId = topic_id;
      this.state.sessionId = session_id;
      console.log(`[Orchestrator] Vault: topic=${topic_id}, session=${session_id}`);
    } catch (err) {
      console.warn("[Orchestrator] Vault init failed (non-fatal):", (err as Error).message);
    }

    // Navigate all LLM panels to fresh chat (clear previous conversations)
    this.panelManager.reloadAllLLMPanels();
    console.log("[Orchestrator] Waiting for panels to load fresh chats...");
    await delay(RELOAD_WAIT_MS);

    this.broadcastStatus({ status: "running" });
    return this.runLoop();
  }

  /** Resume from paused or completed state */
  async resume(additionalRounds?: number): Promise<{ error?: string }> {
    if (!this.state || (this.state.status !== "paused" && this.state.status !== "completed")) {
      return { error: "재개할 토론이 없습니다" };
    }

    if (this.state.status === "completed" && additionalRounds) {
      this.state.maxRounds = this.state.currentRound + additionalRounds;
      this.logger.event(`EXTEND +${additionalRounds}R (total ${this.state.maxRounds})`);
    }

    this.state.abortController = new AbortController();
    this.state.status = "running";
    this.logger.event("RESUME");
    this.broadcastStatus({ status: "running" });

    return this.runLoop();
  }

  canResume(): boolean {
    const status = this.state?.status;
    return status === "paused" || status === "completed";
  }

  stop(): void {
    if (this.state && (this.state.status === "running" || this.state.status === "waiting-for-user")) {
      if (this.state.userInputResolver) {
        this.state.userInputResolver.reject(new Error("Debate stopped by user"));
        this.state.userInputResolver = null;
      }
      // Deactivate any waiting user panel
      if (this.state.waitingSlotId) {
        this.panelManager.sendToSlot(this.state.waitingSlotId, "user-panel:deactivate", {});
      }
      this.state.waitingSlotId = null;
      this.state.abortController.abort();
      this.state.status = "paused";
      this.logger.event(`PAUSED at round ${this.state.currentRound}`);
      this.broadcastStatus({ status: "paused", canResume: true });
      console.log(`[Orchestrator] Paused at round ${this.state.currentRound}`);
    }
  }

  /** Reset all state and reload LLM panels for a fresh topic. */
  reset(): void {
    if (this.state && (this.state.status === "running" || this.state.status === "waiting-for-user")) {
      this.stop();
    }
    for (const [, timer] of this.pendingTimeouts) clearTimeout(timer);
    this.pendingTimeouts.clear();
    this.pendingResponses.clear();
    this.state = null;
    this.logger.close();
    this.panelManager.reloadAllLLMPanels();
    this.broadcastStatus({ status: "idle" });
    console.log("[Orchestrator] Reset — ready for new topic");
  }

  submitUserInput(content: string): { error?: string } {
    if (!this.state || !this.state.userInputResolver) {
      return { error: "사용자 입력 대기 상태가 아닙니다" };
    }
    const resolver = this.state.userInputResolver;
    const waitingSlotId = this.state.waitingSlotId;
    this.state.userInputResolver = null;
    this.state.waitingSlotId = null;
    this.state.status = "running";

    // Deactivate the user panel
    if (waitingSlotId) {
      this.panelManager.sendToSlot(waitingSlotId, "user-panel:deactivate", {});
    }

    resolver.resolve(content);
    this.broadcastStatus({ status: "running" });
    return {};
  }

  // === Round Loop ===

  private async runLoop(): Promise<{ error?: string }> {
    const s = this.state!;

    try {
      const startRound = s.currentRound === 0 ? 1 : s.currentRound;

      for (let r = startRound; r <= s.maxRounds; r++) {
        if (s.abortController.signal.aborted) break;

        const isResuming = r === startRound && s.currentRound > 0;

        if (!isResuming) {
          s.currentRound = r;
          s.currentRoundCount = 0;
        }

        this.broadcastStatus({ roundNumber: s.currentRound });
        this.logger.round(s.currentRound, s.maxRounds);

        const roundPrompt = r === 1 ? s.basePrompt : "이어서 답하세요.";
        console.log(`[Orchestrator] Round ${s.currentRound}/${s.maxRounds}${isResuming ? " (resume)" : ""}`);

        // Create round in vault
        let vaultRoundId: string | undefined;
        if (s.topicId && s.sessionId && !isResuming) {
          try {
            const rm = await createRound(s.topicId, s.sessionId, roundPrompt);
            vaultRoundId = rm.round_id;
          } catch { /* non-fatal */ }
        }

        await this.runRound(roundPrompt, isResuming, vaultRoundId);

        console.log(`[Orchestrator] Round ${s.currentRound} done (${s.currentRoundCount} captures)`);

        if (r < s.maxRounds && !s.abortController.signal.aborted) {
          await delay(2000);
        }
      }

      if (s.abortController.signal.aborted) return {};

      s.status = "completed";
      this.logger.event("COMPLETED");
      this.broadcastStatus({ status: "completed", roundNumber: s.currentRound, canResume: true });
      return {};
    } catch (err) {
      console.error("[Orchestrator] Failed:", (err as Error).message);
      s.status = "error";
      this.logger.event(`ERROR — ${(err as Error).message}`);
      this.logger.close();
      this.broadcastStatus({ status: "error" });
      return { error: (err as Error).message };
    }
  }

  // === Round Execution ===

  private async runRound(prompt: string, isResuming: boolean, vaultRoundId?: string): Promise<void> {
    const s = this.state!;
    switch (s.mode) {
      case "parallel": return this.runParallel(prompt, vaultRoundId);
      case "sequential":
      case "reactive":
      default: return this.runSequential(prompt, isResuming, vaultRoundId);
    }
  }

  /**
   * Sequential/Reactive: one slot at a time.
   * Each slot gets responses it hasn't seen (index-based by slotId).
   */
  private async runSequential(prompt: string, isResuming: boolean, vaultRoundId?: string): Promise<void> {
    const s = this.state!;

    // When resuming, figure out which slots already responded this round
    const respondedSlots = new Set<SlotId>();
    if (isResuming) {
      const roundStart = s.responses.length - s.currentRoundCount;
      for (let i = roundStart; i < s.responses.length; i++) {
        respondedSlots.add(s.responses[i].slotId);
      }
    }

    for (const slot of s.slots) {
      if (s.abortController.signal.aborted) break;
      if (isResuming && respondedSlots.has(slot.id)) continue;

      // User turn: pause and wait for human input
      if (slot.type === "user") {
        this.panelManager.setSlotHighlight(slot.id, true);
        this.broadcastStatus({ slots: { [slot.id]: "working" } });
        try {
          const userContent = await this.waitForUserInput(slot.id);
          s.responses.push({ slotId: slot.id, type: "user", label: slot.label, content: userContent });
          s.currentRoundCount++;
          this.logger.output(slot.label, userContent);
          console.log(`[Orchestrator] ${slot.label} → #${s.responses.length}: ${userContent.length} chars`);
          // Save user input to vault
          if (s.topicId && s.sessionId && vaultRoundId) {
            saveCapture(s.topicId, s.sessionId, vaultRoundId, "user", userContent).catch(() => {});
          }
          this.broadcastStatus({ slots: { [slot.id]: "ready" } });
        } catch (err) {
          this.logger.error(slot.label, (err as Error).message);
          this.broadcastStatus({ slots: { [slot.id]: "error" } });
        }
        this.panelManager.setSlotHighlight(slot.id, false);
        continue;
      }

      // LLM turn
      const provider = slot.type as Provider;
      if (this.shouldSkipSlot(slot.id)) continue;

      this.panelManager.setSlotHighlight(slot.id, true);
      this.broadcastStatus({ slots: { [slot.id]: "working" } });

      try {
        const inst = slot.instruction || undefined;
        const slotOrder = s.slots.map(sl => sl.id);
        const unseen = getUnseenResponses(s.responses, slot.id, slotOrder);
        const fullPrompt = buildPrompt(prompt, unseen, inst);
        this.logger.input(slot.label, fullPrompt);
        console.log(`[Orchestrator] ${slot.label} prompt (${fullPrompt.length} chars, ${unseen.length} unseen)`);

        const response = await this.injectWithRetry(slot.id, provider, fullPrompt);

        s.failureCounts[slot.id] = 0;
        s.responses.push({ slotId: slot.id, type: provider, label: slot.label, content: response });
        s.currentRoundCount++;
        this.logger.output(slot.label, response);
        console.log(`[Orchestrator] ${slot.label} → #${s.responses.length}: ${response.length} chars`);
        // Save to vault
        if (s.topicId && s.sessionId && vaultRoundId) {
          saveCapture(s.topicId, s.sessionId, vaultRoundId, slot.label.toLowerCase(), response).catch(() => {});
        }
        this.broadcastStatus({ slots: { [slot.id]: "ready" } });
      } catch (err) {
        s.failureCounts[slot.id]++;
        this.logger.error(slot.label, (err as Error).message);
        console.warn(`[Orchestrator] ${slot.label} failed (${s.failureCounts[slot.id]}x):`, (err as Error).message);
        this.broadcastStatus({ slots: { [slot.id]: "error" } });
      }
      this.panelManager.setSlotHighlight(slot.id, false);
    }
  }

  /**
   * Parallel: group LLM slots by provider (same panel can't run concurrently).
   * Different provider groups run in parallel; within each group, slots run sequentially.
   * User slots run sequentially after all LLMs finish.
   */
  private async runParallel(prompt: string, vaultRoundId?: string): Promise<void> {
    const s = this.state!;

    // Group LLM slots by provider, collect user slots
    const providerGroups = new Map<Provider, SlotConfig[]>();
    const userSlots: SlotConfig[] = [];

    for (const slot of s.slots) {
      if (slot.type === "user") {
        userSlots.push(slot);
      } else {
        const provider = slot.type as Provider;
        if (!providerGroups.has(provider)) providerGroups.set(provider, []);
        providerGroups.get(provider)!.push(slot);
      }
    }

    // Run provider groups in parallel; within each group, slots run sequentially
    const groupPromises = Array.from(providerGroups.entries()).map(
      async ([_provider, groupSlots]) => {
        for (const slot of groupSlots) {
          if (s.abortController.signal.aborted) return;
          if (this.shouldSkipSlot(slot.id)) continue;

          const provider = slot.type as Provider;
          this.panelManager.setSlotHighlight(slot.id, true);
          this.broadcastStatus({ slots: { [slot.id]: "working" } });

          try {
            const inst = slot.instruction || undefined;
            const slotOrder = s.slots.map(sl => sl.id);
            const unseen = getUnseenResponses(s.responses, slot.id, slotOrder);
            const fullPrompt = buildPrompt(prompt, unseen, inst);
            this.logger.input(slot.label, fullPrompt);

            const response = await this.injectWithRetry(slot.id, provider, fullPrompt);

            s.failureCounts[slot.id] = 0;
            s.responses.push({ slotId: slot.id, type: provider, label: slot.label, content: response });
            s.currentRoundCount++;
            this.logger.output(slot.label, response);
            // Save to vault
            if (s.topicId && s.sessionId && vaultRoundId) {
              saveCapture(s.topicId, s.sessionId, vaultRoundId, slot.label.toLowerCase(), response).catch(() => {});
            }
            this.broadcastStatus({ slots: { [slot.id]: "ready" } });
          } catch (err) {
            s.failureCounts[slot.id]++;
            this.logger.error(slot.label, (err as Error).message);
            console.warn(`[Orchestrator] ${slot.label} failed (${s.failureCounts[slot.id]}x):`, (err as Error).message);
            this.broadcastStatus({ slots: { [slot.id]: "error" } });
          }
          this.panelManager.setSlotHighlight(slot.id, false);
        }
      }
    );

    await Promise.all(groupPromises);

    // Handle user slots sequentially after all LLMs
    for (const slot of userSlots) {
      if (s.abortController.signal.aborted) break;
      this.panelManager.setSlotHighlight(slot.id, true);
      this.broadcastStatus({ slots: { [slot.id]: "working" } });
      try {
        const userContent = await this.waitForUserInput(slot.id);
        s.responses.push({ slotId: slot.id, type: "user", label: slot.label, content: userContent });
        s.currentRoundCount++;
        this.logger.output(slot.label, userContent);
        // Save user input to vault
        if (s.topicId && s.sessionId && vaultRoundId) {
          saveCapture(s.topicId, s.sessionId, vaultRoundId, "user", userContent).catch(() => {});
        }
        this.broadcastStatus({ slots: { [slot.id]: "ready" } });
      } catch (err) {
        this.logger.error(slot.label, (err as Error).message);
        this.broadcastStatus({ slots: { [slot.id]: "error" } });
      }
      this.panelManager.setSlotHighlight(slot.id, false);
    }
  }

  // === Injection with Retry + Fallback ===

  private shouldSkipSlot(slotId: SlotId): boolean {
    const s = this.state!;
    if (s.failureCounts[slotId] >= MAX_CONSECUTIVE_FAILURES) {
      console.warn(`[Orchestrator] Skipping ${slotId} — ${s.failureCounts[slotId]} consecutive failures`);
      this.broadcastStatus({ slots: { [slotId]: "error" } });
      return true;
    }
    return false;
  }

  private async injectWithRetry(slotId: SlotId, provider: Provider, prompt: string): Promise<string> {
    const roundId = `r${this.state!.currentRound}-${++this.roundCounter}`;

    // Attempt 1
    try {
      return await this.injectAndCapture(slotId, provider, prompt, roundId);
    } catch (firstErr) {
      const errMsg = (firstErr as Error).message;
      console.warn(`[Orchestrator] ${slotId} (${provider}) attempt 1 failed: ${errMsg}`);

      // Timeout errors mean the message was already SENT to the LLM.
      // Re-injecting would cause duplicate input (2중입력). Just fail.
      if (errMsg.includes("timeout") || errMsg.includes("Timeout")) {
        console.warn(`[Orchestrator] ${slotId} (${provider}) — timeout = message already sent, skip retry to avoid 2중입력`);
        throw firstErr;
      }
    }

    // Only retry for non-timeout failures (injection failure = message was never sent)

    // Claude: CLI fallback
    if (provider === "claude") {
      try {
        console.log(`[Orchestrator] ${slotId} → Claude CLI fallback`);
        return await this.bridgeCapture(prompt);
      } catch (cliErr) {
        console.warn(`[Orchestrator] ${slotId} Claude CLI failed:`, (cliErr as Error).message);
      }
    }

    // Attempt 2: only for injection failures (input not found, inject error, etc.)
    console.log(`[Orchestrator] ${slotId} (${provider}) → retry (injection failure, no reload)`);
    await delay(3000);

    const retryRoundId = `r${this.state!.currentRound}-${++this.roundCounter}`;
    return await this.injectAndCapture(slotId, provider, prompt, retryRoundId);
  }

  /**
   * Inactivity-based timeout: resets on every heartbeat (DOM activity).
   * Only fails after INACTIVITY_TIMEOUT_MS of silence.
   * HARD_CAP_MS is an absolute safety net.
   */
  private injectAndCapture(
    slotId: SlotId,
    provider: Provider,
    prompt: string,
    roundId: string,
  ): Promise<string> {
    if (provider === "claude" && this.state?.useBridge) {
      return this.bridgeCapture(prompt);
    }

    return new Promise((resolve, reject) => {
      const key = `${slotId}:${roundId}`;

      const done = (fn: typeof resolve | typeof reject, val: string | Error) => {
        this.pendingResponses.delete(key);
        this.pendingTimeouts.delete(key);
        clearTimeout(hardCap);
        (fn as (v: unknown) => void)(val);
      };

      this.pendingResponses.set(key, {
        resolve: (content: string) => done(resolve, content),
        reject: (err: Error) => done(reject, err),
      });

      // Inactivity timeout — reset by heartbeat listener
      // Semi-auto: 10 min (user sends manually), Auto: 30s
      const isSemiAuto = this.state?.semiAuto ?? false;
      const inactivityMs = isSemiAuto ? 600_000 : INACTIVITY_TIMEOUT_MS;
      const hardCapMs = isSemiAuto ? 600_000 : HARD_CAP_MS;

      const inactivityTimer = setTimeout(() => {
        if (this.pendingResponses.has(key)) {
          done(reject, new Error(`Inactivity timeout ${slotId} (${provider}) (${inactivityMs / 1000}s no activity)`));
        }
      }, inactivityMs);
      this.pendingTimeouts.set(key, inactivityTimer);

      // Hard cap — absolute maximum wait
      const hardCap = setTimeout(() => {
        if (this.pendingResponses.has(key)) {
          done(reject, new Error(`Hard cap timeout ${slotId} (${provider}) (${hardCapMs / 1000}s)`));
        }
      }, hardCapMs);

      const script = this.buildScript(provider, prompt, roundId, slotId);
      this.panelManager.executeOnSlot(slotId, script)
        .catch((err) => {
          if (this.pendingResponses.has(key)) {
            done(reject, new Error(`Inject failed ${slotId} (${provider}): ${(err as Error).message}`));
          }
        });
    });
  }

  private async bridgeCapture(prompt: string): Promise<string> {
    return runClaudeCLI({
      prompt,
      topicId: "debate",
      sessionId: "current",
      timeoutMs: HARD_CAP_MS,
    });
  }

  private buildScript(provider: Provider, prompt: string, roundId: string, slotId: string): string {
    const semi = this.state?.semiAuto ?? false;
    switch (provider) {
      case "gpt": return buildChatGPTInjection(prompt, roundId, slotId, semi);
      case "gemini": return buildGeminiInjection(prompt, roundId, slotId, semi);
      case "claude": return buildClaudeInjection(prompt, roundId, slotId, semi);
    }
  }

  // === User Input ===

  private waitForUserInput(slotId: SlotId): Promise<string> {
    const s = this.state!;
    return new Promise<string>((resolve, reject) => {
      s.userInputResolver = { resolve, reject };
      s.waitingSlotId = slotId;
      s.status = "waiting-for-user";
      // Activate the user panel
      this.panelManager.sendToSlot(slotId, "user-panel:activate", { slotId });
      this.broadcastStatus({ status: "waiting-for-user", waitingSlotId: slotId });
      this.logger.event(`WAITING for user input (${slotId})`);
    });
  }

  // === Status ===

  private broadcastStatus(status: Record<string, unknown>): void {
    try {
      const controlBar = this.panelManager.getControlBarWebContents();
      if (controlBar && !controlBar.isDestroyed()) {
        controlBar.send("orchestrator:statusUpdate", status);
      }
    } catch { /* control bar unavailable */ }
  }
}
