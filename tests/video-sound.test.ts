import { describe, expect, it } from "vitest";
import { startsMuted } from "../src/core/video-sound";

describe("startsMuted", () => {
  it("opens silent when the setting is on and nothing was unmuted", () => {
    expect(startsMuted(true, false)).toBe(true);
  });

  it("keeps the sound a person turned on for the next clip", () => {
    expect(startsMuted(true, true)).toBe(false);
  });

  it("opens with sound when the setting is off", () => {
    expect(startsMuted(false, false)).toBe(false);
    expect(startsMuted(false, true)).toBe(false);
  });
});
