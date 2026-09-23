import { Platform } from "obsidian";
import { resolveTool } from "./convert";
import { nodeRequire } from "./core/system";
import type { CliRun } from "./core/vision";

/**
 * Running Claude Code as a program, the way convert.ts runs ffmpeg.
 *
 * The person installed it and logged in to it; the plugin only starts it,
 * hands it a prompt and reads what it prints. No token is read, copied or
 * sent anywhere by this code — that is the whole reason a keyless provider
 * is allowed to exist. Desktop only, since a phone has neither the program
 * nor a way to run one; every caller treats null as "not here".
 *
 * What to run and how to read the result is decided in core/vision.ts, which
 * is pure and tested. This is the thin half that touches the OS.
 */

/** Long enough for a large picture on a slow day; a run past this is a hung one. */
const TIMEOUT_MS = 120_000;
/** The JSON envelope is a few kilobytes; this is headroom for a chatty stderr. */
const MAX_BUFFER = 4 * 1024 * 1024;

interface ExecError {
  code?: string | number;
  /** Set when the process was killed, which execFile does on timeout. */
  killed?: boolean;
}

interface ChildProcessModule {
  execFile: (
    file: string,
    args: string[],
    options: { cwd: string; timeout: number; maxBuffer: number; env: Record<string, string | undefined> },
    callback: (error: ExecError | null, stdout: string, stderr: string) => void
  ) => void;
}

export function claudeAvailable(): boolean {
  return Platform.isDesktopApp && nodeRequire("child_process") !== null;
}

/**
 * Where the claude program is, or null when it is not on this machine.
 * The override from settings wins, then PATH, then the install locations
 * that sit off Obsidian's PATH: the native installer's ~/.local/bin and
 * Homebrew's prefix among them.
 */
export function claudePath(override: string): string | null {
  return claudeAvailable() ? resolveTool("claude", override) : null;
}

/**
 * One run, start to finish, with the vault as the working directory so a
 * relative path in the prompt is one the program may read unasked.
 */
export function runClaude(binary: string, args: string[], cwd: string): Promise<CliRun> {
  const cp = nodeRequire("child_process") as ChildProcessModule | null;
  if (!cp) return Promise.resolve({ stdout: "", stderr: "", code: null, timedOut: false, missing: true });

  const host = (window as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
  const env = { ...(host?.env ?? {}) };
  // The CLI refuses to start inside another Claude Code session, which it
  // detects by these. Obsidian is not a session, but an Obsidian launched
  // from a Claude Code terminal would have inherited them.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  return new Promise<CliRun>((resolve) => {
    try {
      cp.execFile(binary, args, { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, env }, (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: error ? (typeof error.code === "number" ? error.code : null) : 0,
          timedOut: Boolean(error?.killed),
          missing: error?.code === "ENOENT",
        });
      });
    } catch (error) {
      resolve({ stdout: "", stderr: String(error), code: null, timedOut: false, missing: false });
    }
  });
}
