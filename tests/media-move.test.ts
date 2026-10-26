import { describe, expect, it } from "vitest";
import type { CacheEntry } from "../src/core/cache";
import { planFileMove } from "../src/core/media-refs";
import { normalizeUrl } from "../src/core/normalize";

const video = (key: string, file: string, thumb = ""): CacheEntry => ({
  key,
  file,
  thumb,
  kind: "video",
  width: 0,
  height: 0,
  bytes: 0,
});
const old = "Attachments/walk.mov";
const moved = "Video/walk.mov";
const onDisk =
  (...paths: string[]) =>
  (path: string): boolean =>
    paths.includes(path);

describe("planFileMove", () => {
  it("moves the key, the file and the still of an embedded video", () => {
    const plan = planFileMove(
      [video(normalizeUrl(old), old, "Attachments/walk.poster.webp")],
      old,
      moved,
      onDisk("Attachments/walk.poster.webp")
    );
    expect(plan.renames).toEqual([
      { from: "Attachments/walk.poster.webp", to: "Video/walk.poster.webp" },
    ]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].from).toBe(normalizeUrl(old));
    expect(plan.entries[0].entry).toMatchObject({
      key: normalizeUrl(moved),
      file: moved,
      thumb: "Video/walk.poster.webp",
    });
  });

  it("moves a file without a still and renames nothing", () => {
    const plan = planFileMove([video(normalizeUrl(old), old)], old, moved, onDisk());
    expect(plan.renames).toEqual([]);
    expect(plan.entries[0].entry).toMatchObject({
      key: normalizeUrl(moved),
      file: moved,
      thumb: "",
    });
  });

  it("does nothing for a file the cache does not know", () => {
    const plan = planFileMove([video("k", "Media/other.mov")], old, moved, onDisk());
    expect(plan).toEqual({ entries: [], renames: [] });
  });

  it("keeps the key of a downloaded file, which is its URL", () => {
    const url = "https://cdn.example.com/clip.mp4";
    const from = "Attachments/Clippings/0123456789ab-clip.mp4";
    const to = "Elsewhere/0123456789ab-clip.mp4";
    const plan = planFileMove(
      [video(normalizeUrl(url), from, "Attachments/Clippings/0123456789ab-clip.poster.webp")],
      from,
      to,
      onDisk("Attachments/Clippings/0123456789ab-clip.poster.webp")
    );
    expect(plan.entries[0].entry.key).toBe(normalizeUrl(url));
    expect(plan.entries[0].entry.file).toBe(to);
    expect(plan.entries[0].entry.thumb).toBe("Elsewhere/0123456789ab-clip.poster.webp");
  });

  it("only writes down a still that a folder move already carried over", () => {
    const plan = planFileMove(
      [video(normalizeUrl(old), old, "Attachments/walk.poster.webp")],
      old,
      moved,
      onDisk("Video/walk.poster.webp")
    );
    expect(plan.renames).toEqual([]);
    expect(plan.entries[0].entry.thumb).toBe("Video/walk.poster.webp");
  });

  it("forgets a still that is gone from both places", () => {
    const plan = planFileMove(
      [video(normalizeUrl(old), old, "Attachments/walk.poster.webp")],
      old,
      moved,
      onDisk()
    );
    expect(plan.renames).toEqual([]);
    expect(plan.entries[0].entry.thumb).toBe("");
  });

  it("leaves both files alone when the new still path is taken", () => {
    const plan = planFileMove(
      [video(normalizeUrl(old), old, "Attachments/walk.poster.webp")],
      old,
      moved,
      onDisk("Attachments/walk.poster.webp", "Video/walk.poster.webp")
    );
    expect(plan.renames).toEqual([]);
    expect(plan.entries[0].entry.thumb).toBe("Attachments/walk.poster.webp");
  });

  it("does nothing when a still alone is renamed", () => {
    const plan = planFileMove(
      [video(normalizeUrl(old), old, "Attachments/walk.poster.webp")],
      "Attachments/walk.poster.webp",
      "Video/walk.poster.webp",
      onDisk("Video/walk.poster.webp")
    );
    expect(plan).toEqual({ entries: [], renames: [] });
  });

  it("does not overwrite an entry that already stands at the new path", () => {
    const plan = planFileMove(
      [video(normalizeUrl(old), old), video(normalizeUrl(moved), "")],
      old,
      moved,
      onDisk()
    );
    expect(plan.entries).toEqual([]);
  });
});
