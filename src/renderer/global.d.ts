interface SearchResult {
  topicId: string;
  topicTitle: string;
  sessionId?: string;
  roundNumber?: number;
  provider?: string;
  matchType: "topic" | "prompt" | "capture";
  snippet: string;
  createdAt: string;
}

interface TopicSummary {
  topic_id: string;
  title: string;
  description?: string;
  session_count: number;
  created_at: string;
  updated_at: string;
}

interface SessionSummary {
  session_id: string;
  topic_id: string;
  title: string;
  round_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Window {
  talkagent: {
    startOrchestration: (args: unknown) => Promise<unknown>;
    stop: () => Promise<void>;
    resume: (additionalRounds?: number) => Promise<unknown>;
    canResume: () => Promise<boolean>;
    reset: () => Promise<void>;
    configureSlots: (slots: unknown) => Promise<unknown>;
    googleLogin: () => Promise<{ ok: boolean; error?: string }>;
    searchVault: (query: string) => Promise<SearchResult[]>;
    listTopics: () => Promise<TopicSummary[]>;
    listSessions: (topicId: string) => Promise<SessionSummary[]>;
    onStatusUpdate: (callback: (status: unknown) => void) => void;
  };
  __userPanelIPC: {
    onActivate: (callback: (data: unknown) => void) => void;
    onDeactivate: (callback: () => void) => void;
    submitInput: (content: string) => Promise<unknown>;
  };
}
