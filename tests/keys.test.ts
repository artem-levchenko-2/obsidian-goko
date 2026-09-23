import { describe, expect, it } from "vitest";
import { keyIs } from "../src/core/keys";

describe("keyIs", () => {
  it("matches the letter on a Latin layout", () => {
    expect(keyIs({ key: "k", code: "KeyK" }, "k")).toBe(true);
    expect(keyIs({ key: "K", code: "KeyK" }, "k")).toBe(true);
  });

  it("matches the physical key when the layout produces another letter", () => {
    expect(keyIs({ key: "л", code: "KeyK" }, "k")).toBe(true);
    expect(keyIs({ key: "я", code: "KeyZ" }, "z")).toBe(true);
  });

  it("does not match a different key", () => {
    expect(keyIs({ key: "j", code: "KeyJ" }, "k")).toBe(false);
    expect(keyIs({ key: "л", code: "KeyL" }, "k")).toBe(false);
  });

  it("copes with an event that has no code, as a synthetic one may", () => {
    expect(keyIs({ key: "k" }, "k")).toBe(true);
    expect(keyIs({ key: "л" }, "k")).toBe(false);
  });
});
