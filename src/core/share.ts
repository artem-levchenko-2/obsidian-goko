/**
 * Handing archived files to the system's share sheet.
 *
 * A desktop exports into ~/Downloads through node's fs, which a phone does
 * not have, and an iPhone has no Downloads folder an app may write to
 * either. The share sheet is the phone's way out: the bytes go to the
 * system, and the person picks Save Image, Save to Files or anywhere else a
 * picture can go. Where the copy lands is theirs to choose, which is the only
 * shape "save a copy" can take inside a sandboxed app.
 *
 * Given its host rather than reaching for `navigator`, so the answers a host
 * can give, several of them unhelpful, are testable with a fake.
 */

import { mimeForPath } from "./file-clip";

/** What export is called where it goes through the share sheet. */
export const SAVE_A_COPY = "Save a copy";

/** The slice of `navigator` this needs, absent on a host without Web Share. */
export interface ShareHost {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[] }) => Promise<void>;
}

export type ShareOutcome =
  /** The sheet came up and the person saw it through. */
  | "shared"
  /** The sheet came up and the person dismissed it. Not a failure. */
  | "cancelled"
  /** No Web Share, or it refused these files. Nothing was offered. */
  | "unsupported"
  /**
   * The host would not take this as a person's tap.
   *
   * WebKit shares only inside the moment a tap grants, and reading the files
   * out of the vault comes between the tap and the share. The read is local
   * and quick, but a large video can outlast the moment; the files are kept
   * ready, so the next tap shares them at once.
   */
  | "blocked"
  /** It was offered and threw for some other reason. */
  | "failed"
  /** Nothing archived to share in the first place. */
  | "empty";

/**
 * Whether the host can share files at all.
 *
 * Both halves are needed. A host with `share` but no `canShare` has the first
 * version of Web Share, which takes a link and text and throws on files, so
 * offering the action there would promise something that cannot work. Asked
 * before any bytes are read, so nothing is loaded into memory to find out.
 */
export function canShareFiles(host: ShareHost | undefined): boolean {
  return typeof host?.share === "function" && typeof host?.canShare === "function";
}

/** A DOMException's name, which is all that tells one refusal from another. */
function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
}

/**
 * The type a shared file is announced as. The sheet chooses its actions by
 * it: iOS offers Save Image only for a type it knows to be a picture, and
 * Save Video only for a video.
 */
export function shareType(name: string): string {
  if (/\.pdf$/i.test(name)) return "application/pdf";
  return mimeForPath(name) ?? "application/octet-stream";
}

/**
 * Offers every file in one sheet, so a clipping with a video and three
 * pictures is one prompt rather than four.
 *
 * `canShare` is asked with the real files rather than a probe, because what
 * it refuses is the particular set: iOS turns some types away and a large
 * batch on its size, and both depend on what is being sent.
 */
export async function shareFiles(host: ShareHost | undefined, files: File[]): Promise<ShareOutcome> {
  if (files.length === 0) return "empty";
  if (!host?.share || !host.canShare) return "unsupported";
  if (!host.canShare({ files })) return "unsupported";

  try {
    await host.share({ files });
    return "shared";
  } catch (error) {
    // A dismissed sheet is an AbortError on every engine.
    const name = errorName(error);
    if (name === "AbortError") return "cancelled";
    return name === "NotAllowedError" ? "blocked" : "failed";
  }
}

/**
 * What to tell the person, or null when the outcome speaks for itself.
 *
 * A dismissed sheet says nothing: they closed it, they know. Nor does a
 * shared one, since the sheet is its own confirmation and where the copy
 * went is the system's to report, not Goko's: it is not told whether the
 * picture was saved or sent to someone.
 */
export function shareNotice(outcome: ShareOutcome): string | null {
  switch (outcome) {
    case "shared":
    case "cancelled":
      return null;
    case "empty":
      return "Goko: nothing archived to save yet";
    case "unsupported":
      return "Goko: this device cannot hand these files to another app";
    case "blocked":
      return `Goko: the files are ready, tap ${SAVE_A_COPY} again`;
    case "failed":
      return "Goko: could not save a copy";
  }
}
