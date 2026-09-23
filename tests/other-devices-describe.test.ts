import { describe, expect, it } from "vitest";
import {
  ARRIVAL_MODES,
  ARRIVAL_NOTIFICATION_ID,
  DEFAULT_ARRIVAL_MODE,
  DESCRIBE_ACTION,
  DISMISS_ACTION,
  arrivalNotification,
  arrivedSince,
  describingNotice,
  describesOnLanding,
  isArrivalMode,
  planArrivals,
  readLastSeen,
} from "../src/core/arrivals";
import { DEFAULT_SETTINGS } from "../src/core/settings";
import { ARRIVAL_LABELS, COPY } from "../src/core/settings-copy";
import type { ClippingRecord } from "../src/core/scan";

function rec(path: string, summary?: string): ClippingRecord {
  return {
    path,
    title: path,
    source: "",
    description: "",
    categories: [],
    created: "",
    cover: "",
    grid: "",
    folder: "",
    media: [],
    excerpt: "",
    haystack: "",
    properties: summary === undefined ? {} : { summary: [summary] },
  };
}

/** The last time this device saw the library, and a clock either side of it. */
const SEEN = Date.UTC(2026, 8, 20, 18, 0, 0);
const BEFORE = SEEN - 3_600_000;
const AFTER = SEEN + 3_600_000;

function createdAt(times: Record<string, number>): (path: string) => number | undefined {
  return (path) => times[path];
}

describe("readLastSeen", () => {
  it("takes a stored time as it is", () => {
    expect(readLastSeen(SEEN)).toBe(SEEN);
  });

  it("treats nothing stored, or anything unreadable, as a device never seen", () => {
    expect(readLastSeen(null)).toBeNull();
    expect(readLastSeen(undefined)).toBeNull();
    expect(readLastSeen("1758390000000")).toBeNull();
    expect(readLastSeen(Number.NaN)).toBeNull();
    expect(readLastSeen(0)).toBeNull();
    expect(readLastSeen(-5)).toBeNull();
  });
});

describe("arrivedSince", () => {
  it("offers nothing on a device's first launch, however much is undescribed", () => {
    const records = [rec("Clippings/a.md"), rec("Clippings/b.md")];
    const times = createdAt({ "Clippings/a.md": AFTER, "Clippings/b.md": BEFORE });
    expect(arrivedSince(records, times, null)).toEqual([]);
  });

  it("counts clippings without a summary created after the mark, in order", () => {
    const records = [rec("Clippings/c.md"), rec("Clippings/a.md"), rec("Clippings/b.md")];
    const times = createdAt({
      "Clippings/a.md": AFTER,
      "Clippings/b.md": AFTER + 1,
      "Clippings/c.md": AFTER + 2,
    });
    expect(arrivedSince(records, times, SEEN)).toEqual(["Clippings/c.md", "Clippings/a.md", "Clippings/b.md"]);
  });

  it("leaves out what already has a summary, whenever it came", () => {
    const records = [rec("Clippings/a.md", "A hand-drawn map of a harbour."), rec("Clippings/b.md")];
    const times = createdAt({ "Clippings/a.md": AFTER, "Clippings/b.md": AFTER });
    expect(arrivedSince(records, times, SEEN)).toEqual(["Clippings/b.md"]);
  });

  it("counts a blank summary as none, as the describe command does", () => {
    const records = [rec("Clippings/a.md", "   ")];
    expect(arrivedSince(records, createdAt({ "Clippings/a.md": AFTER }), SEEN)).toEqual(["Clippings/a.md"]);
  });

  it("leaves out what was already here when this device last looked", () => {
    const records = [rec("Clippings/old.md"), rec("Clippings/new.md")];
    const times = createdAt({ "Clippings/old.md": BEFORE, "Clippings/new.md": AFTER });
    expect(arrivedSince(records, times, SEEN)).toEqual(["Clippings/new.md"]);
  });

  it("does not count a file created at the very moment of the mark", () => {
    const records = [rec("Clippings/a.md")];
    expect(arrivedSince(records, createdAt({ "Clippings/a.md": SEEN }), SEEN)).toEqual([]);
  });

  it("does not count a file whose creation time is unknown", () => {
    const records = [rec("Clippings/a.md")];
    expect(arrivedSince(records, createdAt({}), SEEN)).toEqual([]);
  });
});

describe("planArrivals", () => {
  const paths = ["Clippings/a.md", "Clippings/b.md", "Clippings/c.md"];

  it("describes them straight away when set to", () => {
    expect(planArrivals("describe", paths, true)).toEqual({ kind: "describe", paths });
  });

  it("posts a notification when set to", () => {
    expect(planArrivals("notify", paths, true)).toEqual({ kind: "notify", paths });
  });

  it("does nothing when told not to describe them", () => {
    expect(planArrivals("off", paths, true)).toEqual({ kind: "none" });
  });

  it("does nothing, in any mode, when nothing arrived", () => {
    for (const mode of ARRIVAL_MODES) expect(planArrivals(mode, [], true)).toEqual({ kind: "none" });
  });

  it("does nothing, in any mode, when there is no provider to describe with", () => {
    for (const mode of ARRIVAL_MODES) expect(planArrivals(mode, paths, false)).toEqual({ kind: "none" });
  });

  it("hands back its own list, so the caller's can change underneath it", () => {
    const given = [...paths];
    const plan = planArrivals("notify", given, true);
    given.push("Clippings/d.md");
    expect(plan).toEqual({ kind: "notify", paths });
  });
});

/**
 * One note landing in the folder, followed through both doors: described as
 * it lands, or counted at the start of the session and handled by the mode.
 * A note Obsidian announces while it loads the vault is one that was already
 * on the disk when the session began; one announced after the layout is
 * ready came while it was open.
 */
function outcome(arrivedWhileOpen: boolean, mode: (typeof ARRIVAL_MODES)[number], autoDescribe: boolean): string {
  if (describesOnLanding(arrivedWhileOpen, autoDescribe)) return "described on landing";
  // The startup count only ever sees what was there before the layout was ready.
  if (arrivedWhileOpen) return "left";
  const plan = planArrivals(mode, ["Clippings/a.md"], true);
  return plan.kind === "describe" ? "described at startup" : plan.kind === "notify" ? "offered" : "left";
}

describe("describesOnLanding", () => {
  it("describes a note that came while the session was open only when the toggle is on", () => {
    expect(describesOnLanding(true, true)).toBe(true);
    expect(describesOnLanding(true, false)).toBe(false);
  });

  it("never describes what Obsidian announces while it loads the vault", () => {
    expect(describesOnLanding(false, true)).toBe(false);
    expect(describesOnLanding(false, false)).toBe(false);
  });

  it("leaves what was there before the layout to the mode, whatever the toggle says", () => {
    for (const autoDescribe of [true, false]) {
      expect(outcome(false, "describe", autoDescribe)).toBe("described at startup");
      expect(outcome(false, "notify", autoDescribe)).toBe("offered");
      expect(outcome(false, "off", autoDescribe)).toBe("left");
    }
  });

  it("leaves what came while open to the toggle, whatever the mode says", () => {
    for (const mode of ARRIVAL_MODES) {
      expect(outcome(true, mode, true)).toBe("described on landing");
      expect(outcome(true, mode, false)).toBe("left");
    }
  });
});

describe("the setting", () => {
  it("notifies by default", () => {
    expect(DEFAULT_ARRIVAL_MODE).toBe("notify");
    expect(DEFAULT_SETTINGS.aiArrivals).toBe("notify");
  });

  it("knows its three values and nothing else", () => {
    expect(ARRIVAL_MODES).toEqual(["describe", "notify", "off"]);
    for (const mode of ARRIVAL_MODES) expect(isArrivalMode(mode)).toBe(true);
    expect(isArrivalMode("ask")).toBe(false);
    expect(isArrivalMode("always")).toBe(false);
    expect(isArrivalMode("")).toBe(false);
    expect(isArrivalMode(undefined)).toBe(false);
  });

  it("offers every mode in the settings, under its own words", () => {
    expect(Object.keys(ARRIVAL_LABELS)).toEqual([...ARRIVAL_MODES]);
    expect(ARRIVAL_LABELS).toEqual({
      describe: "Describe automatically",
      notify: "Notify me",
      off: "Don't describe",
    });
    expect(COPY.arrivals.name).toBe("Clippings from other devices");
    expect(COPY.arrivalsCli.name).toBe(COPY.arrivals.name);
  });
});

describe("arrivalNotification", () => {
  it("puts the real number in the text and on the button", () => {
    expect(arrivalNotification(14)).toEqual({
      id: ARRIVAL_NOTIFICATION_ID,
      title: "New clippings from your other devices",
      body: "14 clippings arrived while this computer was away and don't have a description yet.",
      actions: [
        { id: DESCRIBE_ACTION, label: "Describe 14", primary: true },
        { id: DISMISS_ACTION, label: "Dismiss" },
      ],
    });
  });

  it("speaks of one clipping in the singular", () => {
    const one = arrivalNotification(1);
    expect(one.title).toBe("A new clipping from another device");
    expect(one.body).toBe("1 clipping arrived while this computer was away and doesn't have a description yet.");
    expect(one.actions[0].label).toBe("Describe 1");
  });

  it("uses the plural from two up", () => {
    expect(arrivalNotification(2).title).toBe("New clippings from your other devices");
    expect(arrivalNotification(2).body).toMatch(/^2 clippings arrived .* don't have /);
  });

  it("is posted under one id whatever the count, so a second post replaces the first", () => {
    expect(arrivalNotification(3).id).toBe(arrivalNotification(40).id);
  });
});

describe("describingNotice", () => {
  it("says how many the automatic path is describing, and why", () => {
    expect(describingNotice(14)).toBe("Goko: describing 14 clippings that arrived while this computer was away");
    expect(describingNotice(1)).toBe("Goko: describing 1 clipping that arrived while this computer was away");
  });
});
