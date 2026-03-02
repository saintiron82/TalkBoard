/**
 * Debate Logger — append-only log file for debate I/O.
 * Logs: prompts sent (INPUT), responses received (OUTPUT), errors, events.
 * File: ~/DebateVault/logs/debate-YYYY-MM-DD-HHmmss.log
 */

import fs from "fs";
import path from "path";
import os from "os";

const LOG_DIR = path.join(os.homedir(), "DebateVault", "logs");

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export class DebateLogger {
  private logPath: string | null = null;
  private stream: fs.WriteStream | null = null;

  /** Start a new log file for this debate session */
  open(): void {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    this.logPath = path.join(LOG_DIR, `debate-${stamp}.log`);
    this.stream = fs.createWriteStream(this.logPath, { flags: "a" });
    console.log(`[Logger] ${this.logPath}`);
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }

  getPath(): string | null {
    return this.logPath;
  }

  /** Log debate start info */
  start(prompt: string, mode: string, providers: string[], maxRounds: number, instructions: Record<string, string>): void {
    this.write("========================================");
    this.write(`START  ${ts()}`);
    this.write(`MODE   ${mode}  ROUNDS ${maxRounds}`);
    this.write(`ORDER  ${providers.join(" → ")}`);
    this.write(`PROMPT ${prompt}`);
    for (const [p, inst] of Object.entries(instructions)) {
      if (inst) this.write(`INST:${p.toUpperCase()}  ${inst}`);
    }
    this.write("----------------------------------------");
  }

  /** Log a round header */
  round(num: number, total: number): void {
    this.write("");
    this.write(`── Round ${num}/${total} ── ${ts()} ──`);
  }

  /** Log prompt sent to a provider */
  input(provider: string, prompt: string): void {
    this.write(`[${ts()}] INPUT  → ${provider.toUpperCase()}`);
    this.write(prompt);
    this.write("");
  }

  /** Log response received from a provider */
  output(provider: string, response: string): void {
    this.write(`[${ts()}] OUTPUT ← ${provider.toUpperCase()}`);
    this.write(response);
    this.write("");
  }

  /** Log an error */
  error(provider: string, message: string): void {
    this.write(`[${ts()}] ERROR  ✕ ${provider.toUpperCase()} — ${message}`);
  }

  /** Log event (pause, resume, complete) */
  event(message: string): void {
    this.write(`[${ts()}] EVENT  ${message}`);
  }

  private write(line: string): void {
    this.stream?.write(line + "\n");
  }
}
