import { describe, expect, it } from "vitest";
import { cleanUrl, instagramPost } from "../src/core/resolve";

// Invented values of the real shape: an 11-character post code, and the
// share token the Instagram app appends when a post is shared from it.
const CODE = "Cq7Lm2Xv9Tb";
const TOKEN = "Rk4TzQ8pWm1Ns6Yb3Hc0Vx";
const POST = `https://www.instagram.com/p/${CODE}/`;

describe("cleanUrl and Instagram's share token", () => {
  it("drops stkn from a post shared out of the app", () => {
    expect(cleanUrl(`${POST}?stkn=${TOKEN}`)).toBe(POST);
  });

  it("makes the shared link and the bare one the same address", () => {
    expect(cleanUrl(`${POST}?stkn=${TOKEN}`)).toBe(cleanUrl(POST));
  });

  it("drops it alongside the app's other sharer parameters", () => {
    const reel = `https://www.instagram.com/reel/${CODE}/`;
    expect(cleanUrl(`${reel}?igsh=${TOKEN}&stkn=${TOKEN}`)).toBe(reel);
  });

  it("keeps a parameter that says which picture of the post", () => {
    expect(cleanUrl(`${POST}?img_index=2&stkn=${TOKEN}`)).toBe(`${POST}?img_index=2`);
  });

  it("leaves parameters that only look like it", () => {
    const withQuery = "https://example.com/a?stk=1&token=2&stknx=3";
    expect(cleanUrl(withQuery)).toBe(withQuery);
  });

  it("still reads the post the cleaned address names", () => {
    expect(instagramPost(cleanUrl(`${POST}?stkn=${TOKEN}`))).toEqual({ kind: "p", code: CODE });
  });
});
