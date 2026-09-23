import { describe, expect, it } from "vitest";
import { SHIPPED_RULES_EXAMPLE, applyRules, hostMatches, hostOf, parseRules, settledRules } from "../src/core/rules";
import { DEFAULT_SETTINGS } from "../src/core/settings";

describe("parseRules", () => {
  it("reads one rule per line", () => {
    const { rules, errors } = parseRules("dribbble.com  category: inspiration");
    expect(errors).toEqual([]);
    expect(rules).toEqual([
      { pattern: "dribbble.com", annotation: { category: ["inspiration"] }, line: 1 },
    ]);
  });

  it("reads several properties on one line, split on commas before a key", () => {
    const { rules } = parseRules("*.stripe.com competitor: stripe, category: payments");
    expect(rules[0].annotation).toEqual({ competitor: ["stripe"], category: ["payments"] });
  });

  it("lets a value carry spaces, and a comma when it is the last value", () => {
    const { rules } = parseRules("x.com  note: from the bird site, mostly threads");
    expect(rules[0].annotation).toEqual({ note: ["from the bird site, mostly threads"] });
  });

  it("collects the same key twice into two values", () => {
    const { rules } = parseRules("a.com category: ui, category: web");
    expect(rules[0].annotation).toEqual({ category: ["ui", "web"] });
  });

  it("skips blank lines and comments of either kind", () => {
    const text = ["", "# a comment", "// another", "a.com k: v", "   "].join("\n");
    const { rules, errors } = parseRules(text);
    expect(rules).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("lower-cases the pattern, since hosts are", () => {
    expect(parseRules("Dribbble.COM k: v").rules[0].pattern).toBe("dribbble.com");
  });

  it("reports a line with no properties, and keeps going", () => {
    const { rules, errors } = parseRules("just-a-domain.com\nb.com k: v");
    expect(rules).toHaveLength(1);
    expect(errors).toEqual([
      { line: 1, text: "just-a-domain.com", reason: "no properties after the domain" },
    ]);
  });

  it("reports a property with no colon", () => {
    const { errors } = parseRules("a.com nocolon");
    expect(errors[0].reason).toContain("no colon");
  });

  it("reports a property with no value", () => {
    const { errors } = parseRules("a.com key:");
    expect(errors[0].reason).toContain("no value");
  });

  it("reports a pattern that is not a host", () => {
    const { errors } = parseRules("https://a.com k: v");
    expect(errors[0].reason).toBe("domain is not a host name");
  });

  it("gives the one-based line for a bad rule, comments counted", () => {
    const { errors } = parseRules("# top\n\nbad line here");
    expect(errors[0].line).toBe(3);
  });
});

describe("hostOf", () => {
  it("lower-cases and drops www.", () => {
    expect(hostOf("https://WWW.Dribbble.com/shots/1")).toBe("dribbble.com");
  });

  it("is empty for text that is not a URL", () => {
    expect(hostOf("not a url")).toBe("");
    expect(hostOf("")).toBe("");
  });
});

describe("hostMatches", () => {
  it("matches a bare domain exactly", () => {
    expect(hostMatches("dribbble.com", "dribbble.com")).toBe(true);
    expect(hostMatches("cdn.dribbble.com", "dribbble.com")).toBe(false);
  });

  it("matches subdomains and the bare domain for a wildcard", () => {
    expect(hostMatches("docs.stripe.com", "*.stripe.com")).toBe(true);
    expect(hostMatches("stripe.com", "*.stripe.com")).toBe(true);
    expect(hostMatches("notstripe.com", "*.stripe.com")).toBe(false);
  });

  it("does not match an empty host", () => {
    expect(hostMatches("", "*.a.com")).toBe(false);
  });
});

describe("applyRules", () => {
  const { rules } = parseRules(
    [
      "dribbble.com   category: inspiration",
      "*.stripe.com   competitor: stripe, category: payments",
      "stripe.com     note: the main site",
    ].join("\n")
  );

  it("collects every rule that matches, in order", () => {
    expect(applyRules(rules, "https://stripe.com/pricing")).toEqual({
      competitor: ["stripe"],
      category: ["payments"],
      note: ["the main site"],
    });
  });

  it("matches a subdomain through the wildcard only", () => {
    expect(applyRules(rules, "https://docs.stripe.com/x")).toEqual({
      competitor: ["stripe"],
      category: ["payments"],
    });
  });

  it("says nothing about a host no rule names", () => {
    expect(applyRules(rules, "https://example.org")).toEqual({});
  });

  it("says nothing about a source that is not a URL", () => {
    expect(applyRules(rules, "")).toEqual({});
  });
});

describe("settledRules", () => {
  it("starts a fresh install with an empty box, so the placeholder shows", () => {
    expect(DEFAULT_SETTINGS.domainRules).toBe("");
  });

  it("clears the example earlier versions saved as the value", () => {
    expect(settledRules(SHIPPED_RULES_EXAMPLE)).toBe("");
    expect(settledRules(`${SHIPPED_RULES_EXAMPLE}\n`)).toBe("");
  });

  it("keeps anything someone has written, even beside the example", () => {
    const own = `example.org  category: reading\n\n${SHIPPED_RULES_EXAMPLE}`;
    expect(settledRules(own)).toBe(own);
    expect(settledRules("example.org  category: reading")).toBe("example.org  category: reading");
  });
});
