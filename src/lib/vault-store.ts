/**
 * Vault Store — Direct filesystem operations for ~/DebateVault/
 * Replaces API calls (apiPost/apiGet) with direct FS I/O.
 * Clause C3: Atomic write — tmp file + rename
 */

import { readFile, writeFile, rename, mkdir, readdir, stat } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";

// === Vault Path ===

const DEFAULT_VAULT_PATH = path.join(os.homedir(), "DebateVault");

export function getVaultPath(): string {
  return process.env.DEBATE_VAULT_PATH ?? DEFAULT_VAULT_PATH;
}

// === ID Generation ===

export function generateTopicId(): string {
  return `topic_${randomUUID().slice(0, 8)}`;
}

export function generateSessionId(): string {
  return `sess_${randomUUID().slice(0, 8)}`;
}

export function generateRoundId(): string {
  return `rnd_${randomUUID().slice(0, 8)}`;
}

// === FS Utilities ===

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJSON<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, "utf-8");
  return JSON.parse(content) as T;
}

/** Clause C3: Atomic write — tmp file + rename */
async function writeJSON<T>(filePath: string, data: T): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await ensureDir(path.dirname(filePath));
  const content = JSON.stringify(data, null, 2) + "\n";
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, filePath);
}

async function writeMarkdown(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await ensureDir(path.dirname(filePath));
  await writeFile(tmpPath, content, "utf-8");
  await rename(tmpPath, filePath);
}

async function readMarkdown(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8");
}

async function listDirs(parentPath: string): Promise<string[]> {
  try {
    const entries = await readdir(parentPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function now(): string {
  return new Date().toISOString();
}

// === Types (matching server-side structures) ===

interface Topic {
  topic_id: string;
  title: string;
  description?: string;
  created_at: string;
  updated_at: string;
  session_count: number;
  tags?: string[];
}

interface Round {
  round_id: string;
  session_id: string;
  round_number: number;
  prompt: string;
  created_at: string;
  updated_at: string;
  status: string;
  captures: string[];
}

interface RoundIndexEntry {
  round_id: string;
  round_number: number;
  prompt_preview: string;
  status: string;
  capture_count: number;
  created_at: string;
  updated_at: string;
  last_capture_at?: string;
}

export interface CaptureContext {
  provider: string;
  roundNumber: number;
  content: string;
}

const PROVIDERS = ["gpt", "gemini", "claude"] as const;

// === High-Level Operations ===

/**
 * Create a new topic in ~/DebateVault/topics/
 */
export async function createTopic(
  title: string,
  description?: string
): Promise<{ topic_id: string }> {
  const topicId = generateTopicId();
  const timestamp = now();

  const topic: Topic = {
    topic_id: topicId,
    title,
    description,
    created_at: timestamp,
    updated_at: timestamp,
    session_count: 0,
    tags: [],
  };

  const topicDir = path.join(getVaultPath(), "topics", topicId);
  await ensureDir(topicDir);
  await ensureDir(path.join(topicDir, "sessions"));
  await writeJSON(path.join(topicDir, "topic.json"), topic);

  return { topic_id: topicId };
}

/**
 * Create a new session under a topic.
 */
export async function createSession(
  topicId: string,
  title: string,
  description: string | undefined,
  config?: unknown
): Promise<{ session_id: string }> {
  const topicDir = path.join(getVaultPath(), "topics", topicId);
  const topicJsonPath = path.join(topicDir, "topic.json");

  if (!(await fileExists(topicJsonPath))) {
    throw new Error(`Topic not found: ${topicId}`);
  }

  const sessionId = generateSessionId();
  const timestamp = now();

  const session = {
    session_id: sessionId,
    topic_id: topicId,
    title,
    description,
    created_at: timestamp,
    updated_at: timestamp,
    round_count: 0,
    status: "active",
    config,
  };

  const sessionDir = path.join(topicDir, "sessions", sessionId);
  await ensureDir(sessionDir);
  await ensureDir(path.join(sessionDir, "rounds"));
  await writeJSON(path.join(sessionDir, "session.json"), session);

  // Update topic session count
  const topic = await readJSON<Topic>(topicJsonPath);
  topic.session_count += 1;
  topic.updated_at = timestamp;
  await writeJSON(topicJsonPath, topic);

  return { session_id: sessionId };
}

/**
 * Create a new round in a session.
 */
export async function createRound(
  topicId: string,
  sessionId: string,
  prompt: string
): Promise<{ round_id: string; round_number: number }> {
  const sessionDir = path.join(
    getVaultPath(), "topics", topicId, "sessions", sessionId
  );

  // Determine round number from index
  const indexPath = path.join(sessionDir, "rounds", "index.json");
  let existingEntries: RoundIndexEntry[] = [];
  if (await fileExists(indexPath)) {
    existingEntries = await readJSON<RoundIndexEntry[]>(indexPath);
  }
  const roundNumber = existingEntries.length + 1;

  const roundId = generateRoundId();
  const timestamp = now();

  const round: Round = {
    round_id: roundId,
    session_id: sessionId,
    round_number: roundNumber,
    prompt,
    created_at: timestamp,
    updated_at: timestamp,
    status: "pending",
    captures: [],
  };

  // Create round directory + files
  const roundDir = path.join(sessionDir, "rounds", roundId);
  await ensureDir(roundDir);
  await writeJSON(path.join(roundDir, "round.json"), round);

  // Add to index
  const indexEntry: RoundIndexEntry = {
    round_id: roundId,
    round_number: roundNumber,
    prompt_preview: prompt.slice(0, 100),
    status: "pending",
    capture_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
  existingEntries.push(indexEntry);
  await writeJSON(indexPath, existingEntries);

  return { round_id: roundId, round_number: roundNumber };
}

/**
 * Save a capture (provider response) as markdown.
 */
export async function saveCapture(
  topicId: string,
  sessionId: string,
  roundId: string,
  provider: string,
  content: string
): Promise<void> {
  const roundDir = path.join(
    getVaultPath(), "topics", topicId, "sessions", sessionId, "rounds", roundId
  );
  const capturePath = path.join(roundDir, `${provider}.md`);

  // Backup if overwriting
  if (await fileExists(capturePath)) {
    const existing = await readFile(capturePath, "utf-8");
    await writeFile(`${capturePath}.bak`, existing, "utf-8");
  }

  await writeMarkdown(capturePath, content);

  // Update index timestamp
  const sessionDir = path.join(
    getVaultPath(), "topics", topicId, "sessions", sessionId
  );
  const indexPath = path.join(sessionDir, "rounds", "index.json");
  if (await fileExists(indexPath)) {
    const entries = await readJSON<RoundIndexEntry[]>(indexPath);
    const idx = entries.findIndex((e) => e.round_id === roundId);
    if (idx !== -1) {
      const timestamp = now();
      entries[idx].last_capture_at = timestamp;
      entries[idx].updated_at = timestamp;
      entries[idx].capture_count = (entries[idx].capture_count || 0) + 1;
      await writeJSON(indexPath, entries);
    }
  }
}

/**
 * Load all previous captures for a session (for multi-round context).
 */
// === Listing / Browsing ===

export interface TopicSummary {
  topic_id: string;
  title: string;
  description?: string;
  session_count: number;
  created_at: string;
  updated_at: string;
}

export interface SessionSummary {
  session_id: string;
  topic_id: string;
  title: string;
  round_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * List all topics from ~/DebateVault/topics/.
 */
export async function listTopics(): Promise<TopicSummary[]> {
  const topicsDir = path.join(getVaultPath(), "topics");
  const topicIds = await listDirs(topicsDir);
  const topics: TopicSummary[] = [];

  for (const id of topicIds) {
    const topicPath = path.join(topicsDir, id, "topic.json");
    if (await fileExists(topicPath)) {
      try {
        const t = await readJSON<Topic>(topicPath);
        topics.push({
          topic_id: t.topic_id,
          title: t.title,
          description: t.description,
          session_count: t.session_count,
          created_at: t.created_at,
          updated_at: t.updated_at,
        });
      } catch { /* skip corrupted */ }
    }
  }

  topics.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return topics;
}

/**
 * List all sessions for a topic.
 */
export async function listSessions(topicId: string): Promise<SessionSummary[]> {
  const sessionsDir = path.join(getVaultPath(), "topics", topicId, "sessions");
  const sessionIds = await listDirs(sessionsDir);
  const sessions: SessionSummary[] = [];

  for (const id of sessionIds) {
    const sessionPath = path.join(sessionsDir, id, "session.json");
    if (await fileExists(sessionPath)) {
      try {
        const s = await readJSON<{
          session_id: string;
          topic_id: string;
          title: string;
          round_count: number;
          status: string;
          created_at: string;
          updated_at: string;
        }>(sessionPath);

        // Count actual rounds from index
        const indexPath = path.join(sessionsDir, id, "rounds", "index.json");
        let roundCount = s.round_count || 0;
        if (await fileExists(indexPath)) {
          const entries = await readJSON<RoundIndexEntry[]>(indexPath);
          roundCount = entries.length;
        }

        sessions.push({
          session_id: s.session_id,
          topic_id: s.topic_id,
          title: s.title,
          round_count: roundCount,
          status: s.status,
          created_at: s.created_at,
          updated_at: s.updated_at,
        });
      } catch { /* skip corrupted */ }
    }
  }

  sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return sessions;
}

export async function loadPreviousCaptures(
  topicId: string,
  sessionId: string
): Promise<CaptureContext[]> {
  const captures: CaptureContext[] = [];

  try {
    const sessionDir = path.join(
      getVaultPath(), "topics", topicId, "sessions", sessionId
    );
    const indexPath = path.join(sessionDir, "rounds", "index.json");

    if (!(await fileExists(indexPath))) return captures;

    const entries = await readJSON<RoundIndexEntry[]>(indexPath);

    for (const entry of entries) {
      const roundDir = path.join(sessionDir, "rounds", entry.round_id);

      for (const provider of PROVIDERS) {
        const capturePath = path.join(roundDir, `${provider}.md`);
        if (await fileExists(capturePath)) {
          try {
            const content = await readMarkdown(capturePath);
            if (content.trim()) {
              captures.push({
                provider,
                roundNumber: entry.round_number,
                content: content.trim(),
              });
            }
          } catch {
            // Skip failed reads
          }
        }
      }
    }
  } catch {
    // If loading fails, return empty — first round won't have context
  }

  return captures;
}

// === Search ===

export interface SearchResult {
  topicId: string;
  topicTitle: string;
  sessionId?: string;
  roundNumber?: number;
  provider?: string;
  matchType: "topic" | "prompt" | "capture";
  snippet: string;
  createdAt: string;
}

function extractSnippet(text: string, query: string, radius: number = 50): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, 100);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  let snippet = text.slice(start, end).replace(/\n+/g, " ").trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

/**
 * Full-text search across all topics, prompts, and captures.
 */
export async function searchVault(query: string): Promise<SearchResult[]> {
  if (!query || query.length < 2) return [];
  const results: SearchResult[] = [];
  const q = query.toLowerCase();

  const topicsDir = path.join(getVaultPath(), "topics");
  const topicIds = await listDirs(topicsDir);

  for (const tid of topicIds) {
    const topicPath = path.join(topicsDir, tid, "topic.json");
    if (!(await fileExists(topicPath))) continue;

    let topic: Topic;
    try { topic = await readJSON<Topic>(topicPath); } catch { continue; }

    // Search topic title/description
    const titleMatch = topic.title?.toLowerCase().includes(q);
    const descMatch = topic.description?.toLowerCase().includes(q);
    if (titleMatch || descMatch) {
      results.push({
        topicId: tid,
        topicTitle: topic.title,
        matchType: "topic",
        snippet: extractSnippet(titleMatch ? topic.title : (topic.description || ""), query),
        createdAt: topic.created_at,
      });
    }

    // Search sessions
    const sessionsDir = path.join(topicsDir, tid, "sessions");
    const sessionIds = await listDirs(sessionsDir);

    for (const sid of sessionIds) {
      const indexPath = path.join(sessionsDir, sid, "rounds", "index.json");
      if (!(await fileExists(indexPath))) continue;

      let entries: RoundIndexEntry[];
      try { entries = await readJSON<RoundIndexEntry[]>(indexPath); } catch { continue; }

      for (const entry of entries) {
        // Search prompt
        if (entry.prompt_preview?.toLowerCase().includes(q)) {
          results.push({
            topicId: tid,
            topicTitle: topic.title,
            sessionId: sid,
            roundNumber: entry.round_number,
            matchType: "prompt",
            snippet: extractSnippet(entry.prompt_preview, query),
            createdAt: entry.created_at,
          });
        }

        // Search capture files
        const roundDir = path.join(sessionsDir, sid, "rounds", entry.round_id);
        const allProviders = [...PROVIDERS, "user" as const];
        for (const prov of allProviders) {
          const capPath = path.join(roundDir, `${prov}.md`);
          if (!(await fileExists(capPath))) continue;
          try {
            const content = await readMarkdown(capPath);
            if (content.toLowerCase().includes(q)) {
              results.push({
                topicId: tid,
                topicTitle: topic.title,
                sessionId: sid,
                roundNumber: entry.round_number,
                provider: prov,
                matchType: "capture",
                snippet: extractSnippet(content, query),
                createdAt: entry.created_at,
              });
            }
          } catch { /* skip */ }
        }
      }
    }
  }

  // Sort by creation date (newest first)
  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return results;
}
