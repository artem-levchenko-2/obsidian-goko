import { describe, expect, it } from "vitest";
import { offersCover } from "../src/core/cover-drop";
import { DRAG_TYPE } from "../src/core/drag";

// Every shape of drag the wall can be handed, as the drag's own type list and
// the MIME of each file item it carries.
const drags: { name: string; types: string[]; fileTypes: string[] }[] = [
  { name: "a picture", types: ["Files"], fileTypes: ["image/png"] },
  { name: "a video", types: ["Files"], fileTypes: ["video/mp4"] },
  { name: "a picture among documents", types: ["Files"], fileTypes: ["application/pdf", "image/webp"] },
  { name: "files of unread type", types: ["Files"], fileTypes: [] },
  { name: "a file of no stated type", types: ["Files"], fileTypes: [""] },
  { name: "a document", types: ["Files"], fileTypes: ["application/pdf"] },
  { name: "a link", types: ["text/uri-list", "text/plain"], fileTypes: [] },
  { name: "a card from the wall", types: ["Files", DRAG_TYPE], fileTypes: ["image/png"] },
];

describe("offersCover on a phone", () => {
  it.each(drags)("offers no band to $name", ({ types, fileTypes }) => {
    expect(offersCover(types, fileTypes, { phone: true })).toBe(false);
  });
});

describe("offersCover off a phone", () => {
  // A tablet and a desktop are both "not a phone", and must behave exactly as
  // the wall did before phones were told apart, whether they say so or not.
  it.each(drags)("decides $name as it always has", ({ types, fileTypes }) => {
    const before = offersCover(types, fileTypes);
    expect(offersCover(types, fileTypes, { phone: false })).toBe(before);
    expect(offersCover(types, fileTypes, {})).toBe(before);
  });

  it("still offers the band to a picture from outside", () => {
    expect(offersCover(["Files"], ["image/png"], { phone: false })).toBe(true);
    expect(offersCover(["Files"], [], { phone: false })).toBe(true);
  });

  it("still keeps out of a document, a link and a card from the wall", () => {
    expect(offersCover(["Files"], ["application/pdf"], { phone: false })).toBe(false);
    expect(offersCover(["text/uri-list"], [], { phone: false })).toBe(false);
    expect(offersCover(["Files", DRAG_TYPE], ["image/png"], { phone: false })).toBe(false);
  });
});
