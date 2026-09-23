import { describe, expect, it } from "vitest";
import { isSnoozed, laterDate, partitionSnoozed, remindOf } from "../src/core/remind";

/** Local midnight, since a bare date means that calendar day where you are. */
function at(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

function record(remind?: string): { properties: Record<string, string[]> } {
  return { properties: remind === undefined ? {} : { remind: [remind] } };
}

describe("remindOf", () => {
  it("reads the date, trimmed, and nothing from a note without one", () => {
    expect(remindOf(record(" 2026-09-17 "))).toBe("2026-09-17");
    expect(remindOf(record())).toBe("");
  });
});

describe("laterDate", () => {
  it("is a week ahead by default", () => {
    expect(laterDate(undefined, new Date(2026, 8, 10))).toBe("2026-09-17");
  });

  it("crosses a month and a year without arithmetic of its own", () => {
    expect(laterDate(7, new Date(2026, 8, 28))).toBe("2026-10-05");
    expect(laterDate(7, new Date(2026, 11, 29))).toBe("2027-01-05");
  });
});

describe("isSnoozed", () => {
  it("hides a card whose date has not arrived", () => {
    expect(isSnoozed(record("2026-09-17"), at("2026-09-10"))).toBe(true);
  });

  it("shows one whose date is today: the point is that it comes back", () => {
    expect(isSnoozed(record("2026-09-10"), at("2026-09-10"))).toBe(false);
  });

  it("shows one whose date has passed", () => {
    expect(isSnoozed(record("2026-09-01"), at("2026-09-10"))).toBe(false);
  });

  it("shows a card with no reminder at all", () => {
    expect(isSnoozed(record(), at("2026-09-10"))).toBe(false);
  });

  it("shows a card whose reminder is not a date, rather than hiding it forever", () => {
    // A key nothing can read is not grounds for taking a clipping out of the
    // inbox: it would be hidden with no date that could ever bring it back.
    expect(isSnoozed(record("next spring"), at("2026-09-10"))).toBe(false);
    expect(isSnoozed(record(""), at("2026-09-10"))).toBe(false);
  });
});

describe("partitionSnoozed", () => {
  it("splits the inbox from what it is holding back, keeping order", () => {
    const records = [record("2026-09-17"), record(), record("2026-09-01"), record("2026-12-01")];
    const { shown, snoozed } = partitionSnoozed(records, at("2026-09-10"));
    expect(shown).toEqual([records[1], records[2]]);
    expect(snoozed).toEqual([records[0], records[3]]);
  });
});
