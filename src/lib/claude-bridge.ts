/**
 * Claude CLI Bridge — spawn Claude Code CLI as subprocess.
 * Errata E5: cwd를 세션 디렉토리로 설정
 */

import { spawn } from "child_process";
import path from "path";
import { getVaultPath } from "./vault-store";

export interface BridgeOptions {
  prompt: string;
  topicId: string;
  sessionId: string;
  timeoutMs?: number;
  cliPath?: string;
}

/**
 * Run Claude CLI as a subprocess and capture stdout response.
 * Errata E5: cwd is set to the session directory.
 */
export async function runClaudeCLI(options: BridgeOptions): Promise<string> {
  const {
    prompt,
    topicId,
    sessionId,
    timeoutMs = 120_000,
    cliPath = "claude",
  } = options;

  const sessionDir = path.join(
    getVaultPath(), "topics", topicId, "sessions", sessionId
  );

  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, ["-p", prompt], {
      cwd: sessionDir,
      env: { ...process.env, DEBATE_SESSION_DIR: sessionDir },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Manual timeout
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Claude CLI timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(
          `Claude CLI exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`
        ));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Claude CLI spawn failed: ${err.message}`));
    });
  });
}
