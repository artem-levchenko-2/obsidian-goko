import { describe, expect, it } from "vitest";
import {
  STRONG,
  THRESHOLD,
  appendRule,
  folderProfile,
  gridNameFor,
  gridProfile,
  proposeNewGrid,
  isAggregator,
  learnableRule,
  nameWords,
  proposeGrids,
  scoreGrid,
} from "../src/core/magnets";
import { parseRules } from "../src/core/rules";
import type { ClippingRecord } from "../src/core/scan";

function record(over: Partial<ClippingRecord> = {}): ClippingRecord {
  const title = over.title ?? "a";
  return {
    path: `Library/${title}.md`,
    title,
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
    properties: {},
    ...over,
  };
}

function tagged(tags: string[], over: Partial<ClippingRecord> = {}): ClippingRecord {
  return record({ ...over, properties: { categories: tags, ...(over.properties ?? {}) } });
}

const TAG_KEYS = ["categories", "tags"];

describe("nameWords", () => {
  it("keeps words worth matching and drops the short ones", () => {
    expect(nameWords("Payments & UX")).toEqual(["payment"]);
    expect(nameWords("Type foundry")).toEqual(["type", "foundry"]);
  });

  it("reads a Ukrainian name, since a grid can be called anything", () => {
    expect(nameWords("Шрифти")).toEqual(["шрифти"]);
  });

  it("drops a plural, so Portfolios and portfolio are one word", () => {
    expect(nameWords("Portfolios")).toEqual(["portfolio"]);
    expect(nameWords("Payments")).toEqual(nameWords("payment"));
    // Not blindly: a word that ends in a double s is not a plural.
    expect(nameWords("Glass")).toEqual(["glass"]);
  });
});

describe("gridProfile", () => {
  it("holds tags as the share of cards carrying them, not as counts", () => {
    const profile = gridProfile(
      "Payments",
      [tagged(["fintech", "checkout"]), tagged(["fintech"])],
      TAG_KEYS
    );
    expect(profile.tags.get("fintech")).toBe(1);
    expect(profile.tags.get("checkout")).toBe(0.5);
    expect(profile.size).toBe(2);
  });

  it("ignores a host that could be about anything", () => {
    const profile = gridProfile(
      "Payments",
      [record({ source: "https://x.com/a/status/1" }), record({ source: "https://stripe.com/x" })],
      TAG_KEYS
    );
    expect(profile.hosts.has("x.com")).toBe(false);
    expect(profile.hosts.get("stripe.com")).toBe(0.5);
  });

  it("is empty and harmless for a grid with nothing in it", () => {
    const profile = gridProfile("New", [], TAG_KEYS);
    expect(profile.size).toBe(0);
    expect(profile.tags.size).toBe(0);
  });
});

describe("scoreGrid: one signal at a time", () => {
  const payments = gridProfile(
    "Payments",
    [tagged(["fintech", "checkout"]), tagged(["fintech"]), tagged(["fintech"])],
    TAG_KEYS
  );

  it("scores a card whose tags characterise the grid, and names them", () => {
    const out = scoreGrid(tagged(["fintech"]), payments);
    expect(out.score).toBeGreaterThan(THRESHOLD);
    expect(out.why).toBe("tagged fintech");
  });

  it("names three shared tags and counts the rest", () => {
    const wide = gridProfile("Wide", [tagged(["a", "b", "c", "d", "e"])], TAG_KEYS);
    expect(scoreGrid(tagged(["a", "b", "c", "d", "e"]), wide).why).toBe("tagged a, b, c +2");
  });

  it("scores a tag that is rare in the grid far lower than one that is typical", () => {
    const rare = scoreGrid(tagged(["checkout"]), payments).score;
    const typical = scoreGrid(tagged(["fintech"]), payments).score;
    expect(rare).toBeLessThan(typical);
  });

  it("scores nothing for a card with no tags in common and no other signal", () => {
    expect(scoreGrid(tagged(["manga"]), payments).score).toBe(0);
  });

  it("scores the source when the grid is mostly that site", () => {
    const profile = gridProfile(
      "Stripe",
      [record({ source: "https://stripe.com/a" }), record({ source: "https://stripe.com/b" })],
      TAG_KEYS
    );
    const out = scoreGrid(record({ source: "https://stripe.com/c" }), profile);
    expect(out.why).toBe("stripe.com is usually filed here");
    expect(out.score).toBeGreaterThan(0);
  });

  it("scores the grid's own name found in the title, and quotes the word", () => {
    const profile = gridProfile("Typography", [], TAG_KEYS);
    const out = scoreGrid(record({ title: "A typography specimen" }), profile);
    expect(out.score).toBeGreaterThan(0);
    expect(out.why).toBe("“typography” in the title");
  });

  it("reads the reader's own note, since those are chosen words", () => {
    const profile = gridProfile("Typography", [], TAG_KEYS);
    const out = scoreGrid(
      record({ title: "Untitled", properties: { note: ["great typography here"] } }),
      profile
    );
    expect(out.score).toBeGreaterThan(0);
  });

  it("does not read the model's summary, which says every word about everything", () => {
    // A Gundam kit whose summary mentions its "design" is not a card for the
    // Design grid, and the summary is prose enough to say that about anything.
    const profile = gridProfile("Design", [], TAG_KEYS);
    const out = scoreGrid(
      record({ title: "Gundam RX-78", properties: { summary: ["a Guncannon-inspired design"] } }),
      profile
    );
    expect(out.score).toBe(0);
  });

  it("cannot place a card on its name alone", () => {
    const profile = gridProfile("Typography", [], TAG_KEYS);
    const out = scoreGrid(record({ title: "A typography specimen" }), profile);
    expect(out.score).toBeLessThan(THRESHOLD);
  });

  it("places a card whose tag is the grid's name, even on an empty grid", () => {
    const profile = gridProfile("Typography", [], TAG_KEYS);
    const out = scoreGrid(tagged(["typography"]), profile);
    expect(out.score).toBeGreaterThanOrEqual(THRESHOLD);
    expect(out.why).toBe("tagged typography, which names the grid");
  });

  it("counts a tag with the name inside it for less than the name itself", () => {
    const profile = gridProfile("Design", [], TAG_KEYS);
    const whole = scoreGrid(tagged(["design"]), profile).score;
    const part = scoreGrid(tagged(["poster-design"]), profile).score;
    expect(part).toBeLessThan(whole);
    expect(part).toBeGreaterThanOrEqual(THRESHOLD);
  });

  it("matches the name word by word, not as a substring", () => {
    const profile = gridProfile("Art", [], TAG_KEYS);
    expect(scoreGrid(tagged(["cartoon"]), profile).score).toBe(0);
    expect(scoreGrid(tagged(["pixel-art"]), profile).score).toBeGreaterThan(0);
  });

  it("settles the question outright when a rule names the grid", () => {
    const { rules } = parseRules("dribbble.com  grid: Inspiration");
    const profile = gridProfile("Inspiration", [], TAG_KEYS);
    const out = scoreGrid(record({ source: "https://dribbble.com/shots/1" }), profile, rules);
    expect(out.score).toBe(1);
    expect(out.why).toBe("rule for dribbble.com");
  });

  it("does not let a rule for another grid raise this one", () => {
    const { rules } = parseRules("dribbble.com  grid: Inspiration");
    const profile = gridProfile("Payments", [], TAG_KEYS);
    expect(scoreGrid(record({ source: "https://dribbble.com/shots/1" }), profile, rules).score).toBe(
      0
    );
  });
});

describe("proposeGrids", () => {
  const profiles = [
    gridProfile("Payments", [tagged(["fintech"]), tagged(["fintech"])], TAG_KEYS),
    gridProfile("Manga", [tagged(["manga"]), tagged(["manga"])], TAG_KEYS),
  ];

  it("places each card on the grid that spoke loudest", () => {
    const cards = [tagged(["fintech"], { title: "a" }), tagged(["manga"], { title: "b" })];
    const out = proposeGrids(cards, profiles);
    expect(out.placed.get(cards[0].path)?.grid).toBe("Payments");
    expect(out.placed.get(cards[1].path)?.grid).toBe("Manga");
    expect(out.unsure).toEqual([]);
  });

  it("leaves a card nothing spoke for unsure, in the order it came", () => {
    const cards = [tagged(["fintech"]), tagged(["woodwork"], { title: "b" })];
    const out = proposeGrids(cards, profiles);
    expect(out.unsure).toEqual([cards[1].path]);
  });

  it("leaves everything unsure when there is nothing to learn from", () => {
    const cards = [tagged(["fintech"]), tagged(["manga"], { title: "b" })];
    const out = proposeGrids(cards, [gridProfile("Empty", [], TAG_KEYS)]);
    expect(out.placed.size).toBe(0);
    expect(out.unsure.length).toBe(2);
  });

  it("breaks a tie towards the smaller grid, where a card is one of a kind", () => {
    const small = gridProfile("Small", [tagged(["design"])], TAG_KEYS);
    const big = gridProfile("Big", Array.from({ length: 20 }, () => tagged(["design"])), TAG_KEYS);
    const card = tagged(["design"], { title: "c" });
    expect(proposeGrids([card], [big, small]).placed.get(card.path)?.grid).toBe("Small");
    expect(proposeGrids([card], [small, big]).placed.get(card.path)?.grid).toBe("Small");
  });
});

describe("proposeGrids: folders", () => {
  const design = gridProfile(
    "Design",
    [tagged(["design", "portfolio"]), tagged(["design"]), tagged(["design", "brand"])],
    TAG_KEYS
  );
  const portfolios = folderProfile("Design", "Portfolios", [tagged(["design", "portfolio"])], TAG_KEYS);

  it("proposes the folder when it says strictly more than the grid", () => {
    const card = tagged(["portfolio"], { title: "c" });
    const out = proposeGrids([card], [design, portfolios]);
    expect(out.placed.get(card.path)).toMatchObject({ grid: "Design", folder: "Portfolios" });
  });

  it("keeps a card on the grid when the folder only echoes it", () => {
    // Every Design card is tagged design, including the one in Portfolios, so
    // the folder has nothing of its own to say about a card that is just design.
    const card = tagged(["design"], { title: "c" });
    const out = proposeGrids([card], [design, portfolios]);
    expect(out.placed.get(card.path)).toMatchObject({ grid: "Design", folder: "" });
  });

  it("finds the grid through a folder that is the card's tag, plural and all", () => {
    const empty = gridProfile("Design", [], TAG_KEYS);
    const folder = folderProfile("Design", "Portfolios", [], TAG_KEYS);
    const card = tagged(["portfolio"], { title: "c" });
    const out = proposeGrids([card], [empty, folder]);
    expect(out.placed.get(card.path)).toMatchObject({ grid: "Design", folder: "Portfolios" });
    expect(out.placed.get(card.path)?.why).toBe("tagged portfolio, which names the folder");
  });

  it("lets a rule name a folder", () => {
    const { rules } = parseRules("behance.net  grid: Design, folder: Portfolios");
    const card = record({ source: "https://behance.net/x", title: "c" });
    const out = proposeGrids([card], [design, portfolios], rules);
    expect(out.placed.get(card.path)).toMatchObject({ grid: "Design", folder: "Portfolios", score: 1 });
  });
});

describe("learnableRule", () => {
  it("names the folder as well when the correction was into one", () => {
    expect(learnableRule({ source: "https://behance.net/x" }, "Design", "Portfolios")).toEqual({
      host: "behance.net",
      line: "behance.net  grid: Design, folder: Portfolios",
    });
  });

  it("writes a rule line for a domain that is about something", () => {
    expect(learnableRule({ source: "https://dribbble.com/shots/1" }, "Inspiration")).toEqual({
      host: "dribbble.com",
      line: "dribbble.com  grid: Inspiration",
    });
  });

  it("refuses a domain whose cards could be about anything", () => {
    expect(learnableRule({ source: "https://x.com/a/status/1" }, "Inspiration")).toBeNull();
    expect(isAggregator("instagram.com")).toBe(true);
  });

  it("refuses a card with no source, and a grid with no name", () => {
    expect(learnableRule({ source: "" }, "Inspiration")).toBeNull();
    expect(learnableRule({ source: "https://dribbble.com/x" }, "  ")).toBeNull();
  });
});

describe("appendRule", () => {
  it("adds the line to an empty field without a leading blank line", () => {
    expect(appendRule("", "dribbble.com  grid: Inspiration")).toBe(
      "dribbble.com  grid: Inspiration\n"
    );
  });

  it("adds the line under what is already there", () => {
    expect(appendRule("stripe.com  grid: Payments\n", "dribbble.com  grid: Inspiration")).toBe(
      "stripe.com  grid: Payments\ndribbble.com  grid: Inspiration\n"
    );
  });

  it("leaves the text alone when the domain already has a rule", () => {
    const text = "dribbble.com  categories: inspiration\n";
    expect(appendRule(text, "dribbble.com  grid: Inspiration")).toBe(text);
  });
});

describe("STRONG", () => {
  it("is cleared by a rule and by a tag that is the grid's name, not by a name in a title", () => {
    const empty = gridProfile("Typography", [], TAG_KEYS);
    expect(scoreGrid(tagged(["typography"]), empty).score).toBeGreaterThanOrEqual(STRONG);
    expect(scoreGrid(record({ title: "A typography specimen" }), empty).score).toBeLessThan(STRONG);
    const { rules } = parseRules("dribbble.com  grid: Typography");
    expect(scoreGrid(record({ source: "https://dribbble.com/x" }), empty, rules).score).toBe(1);
  });
});

describe("gridNameFor", () => {
  it("turns a tag into a name in sentence case", () => {
    expect(gridNameFor("poster-design")).toBe("Poster design");
    expect(gridNameFor("typography")).toBe("Typography");
    expect(gridNameFor("шрифти")).toBe("Шрифти");
  });
});

describe("proposeNewGrid", () => {
  const pile = [
    tagged(["typography", "clippings"], { title: "a" }),
    tagged(["typography", "poster"], { title: "b" }),
    tagged(["typography"], { title: "c" }),
    tagged(["woodwork"], { title: "d" }),
  ];

  it("proposes the tag most of the pile shares, named as a grid", () => {
    const idea = proposeNewGrid(pile, pile, ["Design"], TAG_KEYS);
    expect(idea).toMatchObject({ name: "Typography", tag: "typography" });
    expect(idea?.paths).toHaveLength(3);
  });

  it("wants at least a few cards before it speaks", () => {
    expect(proposeNewGrid(pile.slice(0, 2), pile, [], TAG_KEYS)).toBeNull();
    expect(proposeNewGrid(pile, pile, [], TAG_KEYS, 4)).toBeNull();
  });

  it("does not propose a grid that already exists, plural or not", () => {
    expect(proposeNewGrid(pile, pile, ["Typography"], TAG_KEYS)).toBeNull();
    const plural = [tagged(["portfolio"]), tagged(["portfolio"], { title: "b" }), tagged(["portfolio"], { title: "c" })];
    expect(proposeNewGrid(plural, plural, ["Portfolios"], TAG_KEYS)).toBeNull();
  });

  it("ignores tags that say clipping rather than a subject", () => {
    const clipped = [tagged(["clippings"]), tagged(["clippings"], { title: "b" }), tagged(["clippings"], { title: "c" })];
    expect(proposeNewGrid(clipped, clipped, [], TAG_KEYS)).toBeNull();
  });

  it("ignores a tag most of what is already filed carries, which would be the library again", () => {
    const everywhere = Array.from({ length: 10 }, (_, i) => tagged(["design"], { title: `e${i}` }));
    const three = everywhere.slice(0, 3);
    expect(proposeNewGrid(three, everywhere, [], TAG_KEYS)).toBeNull();
  });

  it("measures against the filed cards, so a small vault that is mostly inbox still gets offers", () => {
    // Three of four cards in the vault are typography, but all three are in
    // the pile: nothing filed says the tag is general.
    expect(proposeNewGrid(pile, pile, [], TAG_KEYS)?.tag).toBe("typography");
  });
});
