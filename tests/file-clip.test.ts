import { describe, expect, it } from "vitest";
import { mimeForPath, pathFromFileUrl, pathInsideVault, titleFromPath } from "../src/core/file-clip";

describe("pathFromFileUrl", () => {
  it("reads a Finder file URL into a path", () => {
    expect(pathFromFileUrl("file:///Users/a/Desktop/shot.png")).toBe("/Users/a/Desktop/shot.png");
  });

  it("undoes percent escapes, so a space reaches the disk as a space", () => {
    expect(pathFromFileUrl("file:///Users/a/My%20Shots/a%20b.png")).toBe("/Users/a/My Shots/a b.png");
  });

  it("takes the first of several files", () => {
    expect(pathFromFileUrl("file:///a.png\nfile:///b.png")).toBe("/a.png");
  });

  it("accepts localhost as the host", () => {
    expect(pathFromFileUrl("file://localhost/a.png")).toBe("/a.png");
  });

  it("refuses a network share and anything that is not a file URL", () => {
    expect(pathFromFileUrl("file://nas/share/a.png")).toBeNull();
    expect(pathFromFileUrl("https://x.com/a.png")).toBeNull();
    expect(pathFromFileUrl("shot.png")).toBeNull();
    expect(pathFromFileUrl("")).toBeNull();
  });
});

describe("mimeForPath", () => {
  it("knows pictures and videos by extension, any case", () => {
    expect(mimeForPath("/a/b.PNG")).toBe("image/png");
    expect(mimeForPath("/a/b.jpeg")).toBe("image/jpeg");
    expect(mimeForPath("/a/b.mov")).toBe("video/quicktime");
  });

  it("is null for what the wall cannot show, and for no extension", () => {
    expect(mimeForPath("/a/b.pdf")).toBeNull();
    expect(mimeForPath("/a/b")).toBeNull();
  });
});

describe("titleFromPath", () => {
  it("is the file name without its extension", () => {
    expect(titleFromPath("/Users/a/Desktop/Some screenshot.png")).toBe("Some screenshot");
  });

  it("keeps a dotfile's name whole", () => {
    expect(titleFromPath("/a/.hidden")).toBe(".hidden");
  });
});

describe("pathInsideVault", () => {
  it("gives the vault-relative path of a file inside the vault", () => {
    expect(pathInsideVault("/Users/sam/Vault", "/Users/sam/Vault/Clippings/a note.md")).toBe("Clippings/a note.md");
    expect(pathInsideVault("/Users/sam/Vault/", "/Users/sam/Vault/a.md")).toBe("a.md");
  });

  it("compares Windows paths by forward slashes", () => {
    expect(pathInsideVault("C:\\Notes\\Vault", "C:\\Notes\\Vault\\Clippings\\a.md")).toBe("Clippings/a.md");
  });

  it("says null for a file outside, a sibling with the same prefix, or no path", () => {
    expect(pathInsideVault("/Users/sam/Vault", "/Users/sam/Downloads/a.md")).toBeNull();
    expect(pathInsideVault("/Users/sam/Vault", "/Users/sam/Vault 2/a.md")).toBeNull();
    expect(pathInsideVault("/Users/sam/Vault", "")).toBeNull();
    expect(pathInsideVault("", "/a.md")).toBeNull();
  });
});
