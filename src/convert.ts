import { FileSystemAdapter, Platform, TFile, Vault, normalizePath } from "obsidian";
import { nodeRequire } from "./core/system";
import { executableCandidates } from "./core/tools";
import type { ToolEnv } from "./core/tools";
import { NO_YTDLP } from "./core/archive";
import { NO_VIDEO, classifyYtdlp, ytdlpArgs } from "./core/ytdlp";
import type { ProcessExit, YtdlpLimits } from "./core/ytdlp";
import type { InstallPlan } from "./core/tool-install";

/**
 * Renders formats Chromium cannot decode into ones it can. `sips` ships with
 * macOS and reads every image format on Apple's list, which covers HEIC,
 * TIFF, RAW from every major camera vendor, EXR and Radiance HDR. `ffmpeg`
 * is user-installed on any desktop platform and pulls a frame out of a
 * container Chromium will not play.
 *
 * Everything here is best-effort and desktop-only. When a tool is missing
 * the original stays archived and the clipping simply has no tile, which is
 * the same outcome as before conversion existed.
 */

const SIPS = "/usr/bin/sips";
const TIMEOUT_MS = 30000;

/**
 * Paths from settings, "" meaning discover. Module state because the path
 * functions are called from deep inside conversion helpers that have no
 * settings in reach; main.ts sets this on load and on every settings change.
 */
let toolOverrides = { ytdlp: "", ffmpeg: "" };

export function setToolOverrides(next: { ytdlp: string; ffmpeg: string }): void {
  toolOverrides = next;
}

interface ProcessLike {
  env?: Record<string, string | undefined>;
  platform?: string;
}

/** Electron's process object, present on desktop and absent on mobile. */
function hostProcess(): ProcessLike | undefined {
  return (window as unknown as { process?: ProcessLike }).process;
}

function toolEnv(): ToolEnv {
  const proc = hostProcess();
  const windows = proc?.platform === "win32";
  return {
    pathVar: proc?.env?.PATH ?? proc?.env?.Path ?? "",
    delimiter: windows ? ";" : ":",
    windows,
  };
}

/**
 * Install locations that commonly sit off Obsidian's PATH: Electron carries
 * the desktop session's environment, which on macOS skips the shell profile
 * Homebrew edits, and on Windows a fresh install's PATH entry only reaches
 * apps started after it. Scanned after PATH, so PATH still wins when set.
 */
function fixedCandidates(name: string): string[] {
  const proc = hostProcess();
  const env = proc?.env ?? {};
  if (proc?.platform === "win32") {
    return [
      env.LOCALAPPDATA && `${env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\${name}.exe`,
      // Where winget itself lives, as an app alias.
      env.LOCALAPPDATA && `${env.LOCALAPPDATA}\\Microsoft\\WindowsApps\\${name}.exe`,
      env.USERPROFILE && `${env.USERPROFILE}\\scoop\\shims\\${name}.exe`,
      "C:\\ProgramData\\chocolatey\\bin\\" + name + ".exe",
    ].filter((p): p is string => Boolean(p));
  }
  return [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    env.HOME && `${env.HOME}/.local/bin/${name}`,
    `/snap/bin/${name}`,
  ].filter((p): p is string => Boolean(p));
}

/**
 * Where an external program is, or null when it is nowhere to be found: the
 * override from settings first, then PATH, then the install locations that
 * commonly sit off Obsidian's PATH. Shared by every tool the plugin runs.
 */
export function resolveTool(name: string, override: string): string | null {
  return firstExisting(executableCandidates(name, toolEnv(), fixedCandidates(name), override));
}

interface ChildProcessModule {
  execFile: (
    file: string,
    args: string[],
    options: { timeout: number },
    callback: (error: unknown) => void
  ) => void;
}

interface FsModule {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
  statSync: (path: string) => { size: number };
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
  mkdtempSync: (prefix: string) => string;
}

interface OsModule {
  tmpdir: () => string;
}



export function conversionAvailable(): boolean {
  return Platform.isDesktopApp && nodeRequire("child_process") !== null;
}

/**
 * A url the renderer can load for something in the vault, or the url itself
 * when the path is already remote. One definition, because every surface
 * that paints a clipping needs it: tiles, the detail stage, the palette and
 * the details panel.
 */
export function resourceUrl(vault: Vault, path: string, remote = false): string {
  if (!path) return "";
  if (remote) return path;
  const file = vault.getAbstractFileByPath(normalizePath(path));
  return file instanceof TFile ? vault.getResourcePath(file) : "";
}

/** Absolute path for a vault-relative path, or null on a non-file vault. */
export function absolutePath(vault: Vault, relative: string): string | null {
  const adapter = vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  return adapter.getFullPath(relative);
}

/**
 * Where a file dropped from the desktop lives on disk, or "" where that
 * cannot be said: a phone, or a drag out of a browser, which has no path.
 */
export function droppedFilePath(file: File): string {
  const electron = nodeRequire("electron") as {
    webUtils?: { getPathForFile?: (file: File) => string };
  } | null;
  try {
    return electron?.webUtils?.getPathForFile?.(file) ?? "";
  } catch {
    return "";
  }
}

/** The vault's folder on disk, or null on a non-file vault. */
export function vaultRoot(vault: Vault): string | null {
  const adapter = vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) return null;
  return adapter.getBasePath();
}

function run(command: string, args: string[]): Promise<boolean> {
  const cp = nodeRequire("child_process") as ChildProcessModule | null;
  if (!cp) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    try {
      cp.execFile(command, args, { timeout: TIMEOUT_MS }, (error: unknown) =>
        resolve(!error)
      );
    } catch {
      resolve(false);
    }
  });
}

function firstExisting(paths: string[]): string | null {
  const fs = nodeRequire("fs") as FsModule | null;
  if (!fs) return null;
  for (const path of paths) {
    try {
      if (fs.existsSync(path)) return path;
    } catch {
      continue;
    }
  }
  return null;
}

export function ffmpegPath(): string | null {
  return resolveTool("ffmpeg", toolOverrides.ffmpeg);
}

export function sipsPath(): string | null {
  return firstExisting([SIPS]);
}

/** Converts any macOS-readable image to PNG at its native resolution. */
export async function convertImageToPng(
  absoluteSource: string,
  absoluteTarget: string
): Promise<boolean> {
  const sips = sipsPath();
  if (!sips) return false;
  return run(sips, ["-s", "format", "png", absoluteSource, "--out", absoluteTarget]);
}

/** Grabs one frame from a video container, for formats that cannot play inline. */
export async function extractVideoFrame(
  absoluteSource: string,
  absoluteTarget: string
): Promise<boolean> {
  const ffmpeg = ffmpegPath();
  if (!ffmpeg) return false;
  return run(ffmpeg, [
    "-y",
    "-loglevel",
    "error",
    "-i",
    absoluteSource,
    "-frames:v",
    "1",
    "-an",
    absoluteTarget,
  ]);
}

/**
 * One frame of a video as PNG bytes at its own size, or null when ffmpeg is
 * missing or could not read one. For a poster, which is scaled and encoded
 * by the webview like any other still; the frame goes through a temp
 * directory so nothing half-written ever lands in the vault.
 */
export async function extractVideoFrameData(absoluteSource: string): Promise<ArrayBuffer | null> {
  const fs = nodeRequire("fs") as FsModule | null;
  const os = nodeRequire("os") as OsModule | null;
  if (!ffmpegPath() || !fs || !os) return null;

  let dir: string | null = null;
  try {
    dir = fs.mkdtempSync(`${os.tmpdir()}/goko-`);
    const frame = `${dir}/frame.png`;
    if (!(await extractVideoFrame(absoluteSource, frame)) || !fs.existsSync(frame)) return null;
    const buffer = fs.readFileSync(frame);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  } catch {
    return null;
  } finally {
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Temp directory cleanup is best effort.
      }
    }
  }
}


export function ytdlpPath(): string | null {
  return resolveTool("yt-dlp", toolOverrides.ytdlp);
}

/** The package managers the Install button can run, where they are found. */
export function packageManagers(): { brew: string | null; winget: string | null } {
  const windows = hostProcess()?.platform === "win32";
  return {
    brew: windows ? null : resolveTool("brew", ""),
    winget: windows ? resolveTool("winget", "") : null,
  };
}

/**
 * Runs an install plan's steps in order and says how it went. Long, because
 * Homebrew builds or fetches ffmpeg's dependencies on a first install and
 * that alone can take minutes; the button stays off meanwhile.
 */
export async function runInstall(plan: InstallPlan): Promise<{ ok: boolean; detail: string }> {
  for (const step of plan.steps) {
    const exit = await runCapturing(plan.command, step.args, INSTALL_TIMEOUT_MS);
    if (exit.code !== 0) {
      const said = (exit.stderr || exit.stdout).trim().split("\n").slice(-1)[0] ?? "";
      const detail = exit.timedOut ? "it ran out of time" : said || "it stopped with an error";
      return { ok: false, detail };
    }
  }
  return { ok: true, detail: "" };
}

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Runs a command and resolves how it went. Never rejects: a command that
 * could not start comes back with no exit code and the reason on stderr.
 */
function runCapturing(
  command: string,
  args: string[],
  timeout = DOWNLOAD_TIMEOUT_MS
): Promise<ProcessExit> {
  const cp = nodeRequire("child_process") as
    | { execFile: (
        file: string,
        args: string[],
        options: { timeout: number; maxBuffer: number },
        callback: (error: unknown, stdout: string, stderr: string) => void
      ) => void }
    | null;
  if (!cp) return Promise.resolve({ code: null, timedOut: false, stdout: "", stderr: "" });

  return new Promise<ProcessExit>((resolve) => {
    try {
      cp.execFile(
        command,
        args,
        { timeout, maxBuffer: 8 * 1024 * 1024 },
        (error: unknown, stdout: string, stderr: string) => {
          const failure = error as { code?: unknown; killed?: boolean; message?: string } | null;
          // A numeric code is the program's own exit status. A string one
          // (ENOENT, a full buffer) means node gave up on it, and node's
          // message is the only account of why. Only the timeout kills.
          const status = typeof failure?.code === "number" ? failure.code : null;
          const system = typeof failure?.code === "string" ? failure.message ?? "" : "";
          resolve({
            code: failure ? status : 0,
            timedOut: failure?.killed === true,
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? "") || system,
          });
        }
      );
    } catch (error) {
      resolve({ code: null, timedOut: false, stdout: "", stderr: String(error) });
    }
  });
}

const DOWNLOAD_TIMEOUT_MS = 180000;

/**
 * Downloads a post's video with yt-dlp, which speaks these sites natively.
 *
 * This is why the plugin does not need an embed mirror for Instagram or X:
 * a local tool the user installed reaches the media directly, with no third
 * party in the path and nothing misrepresenting itself as another client.
 *
 * The file lands in a temp directory rather than straight into the vault,
 * so Obsidian never sees a half-written file and the bytes are handed to
 * the vault API like any other download.
 *
 * What yt-dlp is asked for, and what its output meant, are decided in
 * core/ytdlp.ts; this only runs it and reads the file back.
 */
export async function downloadSourceVideo(
  pageUrl: string,
  limits: YtdlpLimits
): Promise<{ data: ArrayBuffer; extension: string } | { failed: string }> {
  const ytdlp = ytdlpPath();
  const fs = nodeRequire("fs") as FsModule | null;
  const os = nodeRequire("os") as OsModule | null;
  if (!ytdlp || !fs || !os) return { failed: NO_YTDLP };

  let dir: string | null = null;
  try {
    dir = fs.mkdtempSync(`${os.tmpdir()}/goko-`);
    const request = { ...limits, url: pageUrl, dir, ffmpeg: ffmpegPath() };
    const outcome = classifyYtdlp(await runCapturing(ytdlp, ytdlpArgs(request)), request);
    if ("failed" in outcome) return outcome;

    const file = outcome.file;
    if (!fs.existsSync(file)) return { failed: NO_VIDEO };

    // The limits yt-dlp was given hold each file to a size the site reported
    // or the server announced. A stream fetched in fragments may have
    // neither, and two streams joined can each fit and together not. Asked
    // of the disk, so such a file is refused without being read into memory.
    const size = fs.statSync(file).size;
    if (size > limits.maxBytes) return { failed: `too large (${size} bytes)` };

    const buffer = fs.readFileSync(file);
    const data = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    const dot = file.lastIndexOf(".");
    return { data, extension: dot > 0 ? file.slice(dot + 1).toLowerCase() : "mp4" };
  } catch (error) {
    return { failed: `yt-dlp: ${String(error)}` };
  } finally {
    if (dir) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Temp directory cleanup is best effort.
      }
    }
  }
}
