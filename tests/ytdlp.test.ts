import { describe, expect, it } from "vitest";
import { NEEDS_FFMPEG, isDeviceLimit, isTransient } from "../src/core/archive";
import {
  NO_FORMAT,
  NO_VIDEO,
  TIMED_OUT,
  classifyYtdlp,
  formatSelector,
  ytdlpArgs,
} from "../src/core/ytdlp";
import type { ProcessExit, YtdlpRequest } from "../src/core/ytdlp";

const DIR = "/tmp/goko-Qx7Lm2";
const MAX_BYTES = 26214400;

function request(overrides: Partial<YtdlpRequest> = {}): YtdlpRequest {
  return {
    url: "https://www.youtube.com/shorts/Ab3dEf6hIjK",
    dir: DIR,
    maxBytes: MAX_BYTES,
    ffmpeg: "/usr/local/bin/ffmpeg",
    ...overrides,
  };
}

function exit(overrides: Partial<ProcessExit> = {}): ProcessExit {
  return { code: 0, timedOut: false, stdout: "", stderr: "", ...overrides };
}

/** The value that follows a flag, as yt-dlp would read it. */
function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe("formatSelector", () => {
  it("asks for sound in every choice that could have a silent stream", () => {
    const choices = formatSelector(true).split("/");
    // The bare `mp4` that picked a silent AV1 stream is gone.
    expect(choices).not.toContain("mp4");
    expect(choices[0]).toBe("best[ext=mp4][acodec!=none][vcodec^=avc1][height<=1280]");
    for (const choice of choices.slice(0, -1)) {
      expect(choice).toMatch(/acodec!=\??none|\+ba\[ext=m4a\]/);
    }
  });

  it("prefers H.264 and caps the height", () => {
    const selector = formatSelector(true);
    expect(selector).toContain("[vcodec^=avc1]");
    expect(selector).toContain("[height<=1280]");
  });

  it("only asks for a pair of streams when ffmpeg can join them", () => {
    expect(formatSelector(true)).toContain("bv*[ext=mp4][vcodec^=avc1][height<=1280]+ba[ext=m4a]");
    expect(formatSelector(false)).not.toContain("+");
  });

  it("admits files whose codecs the extractor never named", () => {
    // Instagram's progressive files carry sound and report no codec, and the
    // strict filters alone would leave a reel with nothing to download.
    expect(formatSelector(false)).toContain("best[ext=mp4][acodec!=?none][height<=?1280]");
  });
});

describe("ytdlpArgs", () => {
  it("caps the size, both by what the site reports and by what the server sends", () => {
    const args = ytdlpArgs(request());
    expect(valueOf(args, "--max-filesize")).toBe(String(MAX_BYTES));
    expect(valueOf(args, "--match-filters")).toBe(
      `filesize <=? ${MAX_BYTES} & filesize_approx <=? ${MAX_BYTES}`
    );
  });

  it("passes the selector with sound in it", () => {
    const args = ytdlpArgs(request());
    expect(valueOf(args, "-f")).toBe(formatSelector(true, true));
    expect(valueOf(args, "-f")).toContain("acodec!=none");
  });

  it("adds a duration filter only when there is a cap", () => {
    expect(ytdlpArgs(request())).not.toContain("--break-match-filters");
    expect(ytdlpArgs(request({ maxSeconds: 0 }))).not.toContain("--break-match-filters");

    const args = ytdlpArgs(request({ maxSeconds: 600 }));
    // `?` lets a post with no reported duration through: Instagram reports
    // none, and a strict filter would refuse every reel as too long.
    expect(valueOf(args, "--break-match-filters")).toBe("duration <=? 600");
  });

  it("tells yt-dlp where ffmpeg is, and merges nothing without it", () => {
    expect(valueOf(ytdlpArgs(request()), "--ffmpeg-location")).toBe("/usr/local/bin/ffmpeg");

    const bare = ytdlpArgs(request({ ffmpeg: null }));
    expect(bare).not.toContain("--ffmpeg-location");
    expect(valueOf(bare, "-f")).toBe(formatSelector(false));
  });

  it("keeps the lines that say why nothing was downloaded", () => {
    const args = ytdlpArgs(request());
    // --print implies --quiet, which would swallow the size and filter notes.
    expect(args).toContain("--no-quiet");
    expect(valueOf(args, "--print")).toBe("after_move:filepath");
  });

  it("writes into the download's own directory and ends with the url", () => {
    const args = ytdlpArgs(request());
    expect(valueOf(args, "-o")).toBe(`${DIR}/media.%(ext)s`);
    expect(args[args.length - 1]).toBe("https://www.youtube.com/shorts/Ab3dEf6hIjK");
  });
});

describe("classifyYtdlp", () => {
  it("returns the file yt-dlp printed", () => {
    const stdout = [
      "[youtube] Extracting URL: https://www.youtube.com/shorts/Ab3dEf6hIjK",
      "[info] Ab3dEf6hIjK: Downloading 1 format(s): 298+140",
      `[Merger] Merging formats into "${DIR}/media.mp4"`,
      `${DIR}/media.mp4`,
    ].join("\n");
    expect(classifyYtdlp(exit({ stdout }), request())).toEqual({ file: `${DIR}/media.mp4` });
  });

  it("recognises a Windows path printed with the other slashes", () => {
    const dir = "C:\\Users\\someone\\AppData\\Local\\Temp/goko-Qx7Lm2";
    const printed = "C:\\Users\\someone\\AppData\\Local\\Temp\\goko-Qx7Lm2\\media.mp4";
    expect(classifyYtdlp(exit({ stdout: `${printed}\r\n` }), request({ dir }))).toEqual({
      file: printed,
    });
  });

  it("calls a video refused for its duration too long", () => {
    const stdout = [
      "[download] Some long talk does not pass filter (duration <=? 600), skipping ..",
      "[info] Encountered a video that did not match filter, stopping due to --break-match-filter",
      "Aborting remaining downloads",
    ].join("\n");
    expect(classifyYtdlp(exit({ code: 101, stdout }), request({ maxSeconds: 600 }))).toEqual({
      failed: "too long (over 600 seconds)",
    });
  });

  it("calls a video refused for its reported size too large", () => {
    const stdout = [
      "[info] Ab3dEf6hIjK: Downloading 1 format(s): 18",
      `[download] A (bracketed) title does not pass filter (filesize <=? ${MAX_BYTES} & filesize_approx <=? ${MAX_BYTES}), skipping ..`,
    ].join("\n");
    expect(classifyYtdlp(exit({ stdout }), request({ maxSeconds: 600 }))).toEqual({
      failed: `too large (over ${MAX_BYTES} bytes)`,
    });
  });

  it("calls a download aborted at the server's length too large", () => {
    const stdout = `[download] File is larger than max-filesize (30561658 bytes > ${MAX_BYTES} bytes). Aborting.`;
    expect(classifyYtdlp(exit({ stdout }), request())).toEqual({
      failed: "too large (30561658 bytes)",
    });
  });

  it("calls a run the timeout killed timed out, not a post with no video", () => {
    const outcome = classifyYtdlp(
      exit({ code: null, timedOut: true, stdout: "[download] Destination: x" }),
      request()
    );
    expect(outcome).toEqual({ failed: TIMED_OUT });
  });

  it("says found no video only when the extractor says there is none", () => {
    for (const stderr of [
      "ERROR: [Instagram] AbCdEfGhIjK: There is no video in this post",
      "ERROR: [twitter] 1234567890123456789: No video could be found in this tweet",
      "ERROR: [Reddit] a1b2c3: No media found",
      "ERROR: [generic] example: No video formats found!",
    ]) {
      expect(classifyYtdlp(exit({ code: 1, stderr }), request())).toEqual({ failed: NO_VIDEO });
    }
    // A clean exit with nothing printed: the post held nothing to download.
    expect(classifyYtdlp(exit(), request())).toEqual({ failed: NO_VIDEO });
  });

  it("blames a missing ffmpeg when only separate streams have sound", () => {
    const stderr =
      "ERROR: [youtube] Ab3dEf6hIjK: Requested format is not available. Use --list-formats for a list of available formats";
    expect(classifyYtdlp(exit({ code: 1, stderr }), request({ ffmpeg: null }))).toEqual({
      failed: NEEDS_FFMPEG,
    });
    expect(classifyYtdlp(exit({ code: 1, stderr }), request())).toEqual({ failed: NO_FORMAT });
  });

  it("keeps yt-dlp's own words for anything else", () => {
    const stderr = [
      "WARNING: something minor",
      "ERROR: [Instagram] AbCdEfGhIjK: Requested content is not available, rate-limit reached or login required",
    ].join("\n");
    expect(classifyYtdlp(exit({ code: 1, stderr }), request())).toEqual({
      failed: "yt-dlp: Requested content is not available, rate-limit reached or login required",
    });
  });

  it("cuts a long complaint down to a readable length", () => {
    const stderr = `ERROR: ${"x".repeat(400)}`;
    const outcome = classifyYtdlp(exit({ code: 1, stderr }), request());
    expect("failed" in outcome && outcome.failed.length).toBeLessThanOrEqual(170);
  });

  it("says what it can when yt-dlp left no message", () => {
    expect(classifyYtdlp(exit({ code: 2 }), request())).toEqual({
      failed: "yt-dlp exited with code 2",
    });
    expect(classifyYtdlp(exit({ code: null, stderr: "spawn /x/yt-dlp ENOENT" }), request())).toEqual(
      { failed: "yt-dlp: spawn /x/yt-dlp ENOENT" }
    );
  });
});

describe("what the cache makes of each reason", () => {
  it("treats a missing ffmpeg as a fact about the device", () => {
    // Another device that shares the vault may have ffmpeg and should try.
    expect(isDeviceLimit(NEEDS_FFMPEG)).toBe(true);
  });

  it("keeps a timeout, and the limits, as facts about the post", () => {
    // A timeout that was retried on every pass would spend the full timeout
    // of traffic each time, on every device, for a video that is likely to
    // time out again.
    for (const reason of [
      TIMED_OUT,
      NO_VIDEO,
      NO_FORMAT,
      "too long (over 600 seconds)",
      `too large (over ${MAX_BYTES} bytes)`,
    ]) {
      expect(isDeviceLimit(reason)).toBe(false);
      expect(isTransient(reason)).toBe(false);
    }
  });
});
