import { describe, expect, it } from "vitest";
import { describeVideoProblems, videoProblem } from "../src/core/video-problems";
import type { VideoProblem } from "../src/core/video-problems";
import { NO_VIDEO, TIMED_OUT, classifyYtdlp } from "../src/core/ytdlp";
import { NEEDS_FFMPEG, NO_YTDLP } from "../src/core/archive";

const MAX = 25 * 1048576;
const request = { url: "https://www.youtube.com/watch?v=Qx7Lm2Vb9Tc", dir: "/tmp/goko-1", ffmpeg: null, maxBytes: MAX };

/** The reason the archiver records for one run of yt-dlp. */
function recorded(stderr: string, code: number | null = 1): string {
  const outcome = classifyYtdlp({ code, timedOut: false, stdout: "", stderr }, request);
  return "failed" in outcome ? outcome.failed : "";
}

describe("videoProblem", () => {
  it("reads yt-dlp's 403 as the site refusing the download", () => {
    const failed = recorded("ERROR: [youtube] Qx7Lm2Vb9Tc: unable to download video data: HTTP Error 403: Forbidden\n");
    expect(videoProblem(failed)).toEqual({ kind: "refused" });
  });

  it("reads a run stopped by the clock as timed out", () => {
    expect(videoProblem(TIMED_OUT)).toEqual({ kind: "timed-out" });
  });

  it("keeps the size of a video that came out over the limit", () => {
    expect(videoProblem("too large (99022596 bytes)")).toEqual({ kind: "too-large", bytes: 99022596 });
  });

  it("knows no size for a video the site's own figure ruled out", () => {
    const failed = classifyYtdlp(
      { code: 0, timedOut: false, stderr: "", stdout: `[youtube] Qx7Lm2Vb9Tc: does not pass filter (filesize <=? ${MAX}), skipping ..\n` },
      request
    );
    expect("failed" in failed && videoProblem(failed.failed)).toEqual({ kind: "too-large" });
  });

  it("stays quiet about a post that simply has no video", () => {
    expect(videoProblem(NO_VIDEO)).toBeNull();
    expect(videoProblem(recorded("ERROR: [instagram] Ab3dE5fG7h: There is no video in this post\n"))).toBeNull();
  });

  it("stays quiet about what the device lacks and about the YouTube length setting", () => {
    expect(videoProblem(NO_YTDLP)).toBeNull();
    expect(videoProblem(NEEDS_FFMPEG)).toBeNull();
    expect(videoProblem("too long (over 600 seconds)")).toBeNull();
  });

  it("does not blame yt-dlp for a CDN that refused a plain request", () => {
    expect(videoProblem("HTTP 403")).toBeNull();
  });
});

describe("describeVideoProblems", () => {
  const refused: VideoProblem = {
    kind: "refused",
    source: "https://www.youtube.com/watch?v=Qx7Lm2Vb9Tc",
    title: "How to sharpen a chisel on a single water stone in ten minutes",
  };

  it("says nothing when nothing went wrong", () => {
    expect(describeVideoProblems([], MAX)).toEqual([]);
  });

  it("names the clipping, the site and the fix for a refused download", () => {
    const [message] = describeVideoProblems([refused], MAX);
    expect(message).toContain('"How to sharpen a chisel on a single…"');
    expect(message).toContain("youtube.com");
    expect(message).toContain("out of date");
    expect(message).toContain("Download all clipping media");
  });

  it("falls back to the site when there is no clipping title yet", () => {
    const [message] = describeVideoProblems([{ kind: "timed-out", source: refused.source, title: "" }], MAX);
    expect(message).toContain("the video from youtube.com");
  });

  it("names the site once when a refused video has no title", () => {
    const [message] = describeVideoProblems([{ ...refused, title: "" }], MAX);
    expect(message.match(/youtube\.com/g)).toHaveLength(1);
  });

  it("blames the sites together when refusals come from more than one", () => {
    const [message] = describeVideoProblems(
      [refused, { ...refused, source: "https://www.instagram.com/p/Ab3dE5fG7h/" }],
      MAX
    );
    expect(message).toContain("the sites");
    expect(message).not.toMatch(/,\./);
  });

  it("gives the size, the limit and where to change it for a video over the limit", () => {
    const [message] = describeVideoProblems(
      [{ kind: "too-large", source: refused.source, title: "Lesson", bytes: 99022596 }],
      MAX
    );
    expect(message).toContain("at 94 MB it's over your 25 MB limit");
    expect(message).toContain("Settings → Goko → Downloads");
    expect(message).toContain("To keep it,");
  });

  it("says only the limit when the size is not known", () => {
    const [message] = describeVideoProblems([{ kind: "too-large", source: refused.source, title: "Lesson" }], MAX);
    expect(message).toContain("because it's over your 25 MB limit");
  });

  it("says how long it waited for a download that ran out of time", () => {
    const [message] = describeVideoProblems([{ kind: "timed-out", source: refused.source, title: "Lesson" }], MAX);
    expect(message).toContain('"Lesson"');
    expect(message).toContain("3 minutes");
  });

  it("folds several problems of one kind into a single message", () => {
    const messages = describeVideoProblems([refused, { ...refused, title: "A second lesson" }], MAX);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("2 videos");
    expect(messages[0]).toContain("How to sharpen");
  });

  it("keeps the punctuation clean when several videos are over the limit", () => {
    const [message] = describeVideoProblems(
      [
        { kind: "too-large", source: refused.source, title: "Lesson one", bytes: 99022596 },
        { kind: "too-large", source: refused.source, title: "Lesson two", bytes: 132129559 },
      ],
      MAX
    );
    expect(message).toContain('2 videos, including "Lesson one",');
    expect(message).toContain("they're over");
    expect(message).toContain("To keep them,");
    expect(message).not.toMatch(/,\./);
  });

  it("gives each kind of problem its own message", () => {
    const messages = describeVideoProblems(
      [refused, { kind: "too-large", source: refused.source, title: "Lesson", bytes: 99022596 }],
      MAX
    );
    expect(messages).toHaveLength(2);
  });
});
