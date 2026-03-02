export type Provider = "gpt" | "gemini" | "claude";
export type SlotType = Provider | "user";
export type SlotId = string;
export type OrchestrationMode = "sequential" | "parallel" | "reactive";

export const PROVIDER_META: Record<Provider, { url: string; partition: string }> = {
  gpt: { url: "https://chat.openai.com/", partition: "persist:chatgpt" },
  gemini: { url: "https://gemini.google.com/app", partition: "persist:gemini" },
  claude: { url: "https://claude.ai/new", partition: "persist:claude" },
};

export interface PanelConfig {
  id: Provider;
  url: string;
  partition: string;
}

export interface SlotConfig {
  id: SlotId;
  type: SlotType;
  label: string;
  instruction: string;
}

export interface StartArgs {
  prompt: string;
  mode: OrchestrationMode;
  slots: SlotConfig[];
  maxRounds: number;
  useBridge?: boolean;
}

export interface RoundResponse {
  slotId: SlotId;
  type: SlotType;
  label: string;
  content: string;
}

export interface DebateState {
  mode: OrchestrationMode;
  slots: SlotConfig[];
  maxRounds: number;
  basePrompt: string;
  currentRound: number;
  /** All responses in chronological order (flat, index-based) */
  responses: RoundResponse[];
  /** Current round response count (for round completion tracking) */
  currentRoundCount: number;
  status: "running" | "paused" | "completed" | "error" | "waiting-for-user";
  abortController: AbortController;
  useBridge: boolean;
  /** Consecutive failure count per slot */
  failureCounts: Record<SlotId, number>;
  /** Which slot is currently waiting for user input */
  waitingSlotId: SlotId | null;
  /** When non-null, orchestrator is waiting for user input */
  userInputResolver: {
    resolve: (content: string) => void;
    reject: (error: Error) => void;
  } | null;
  /** Vault storage IDs for structured persistence */
  topicId?: string;
  sessionId?: string;
}
