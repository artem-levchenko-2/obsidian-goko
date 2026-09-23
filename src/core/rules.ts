/**
 * Properties a clipping earns from where it came from.
 *
 * Most of what a tag would say about a saved page is already said by its
 * domain: a Dribbble shot is inspiration, a competitor's site is that
 * competitor. These rules write that down once so every clipping from there
 * carries it, deterministically, offline, and before anything costs a token.
 *
 * The rules are kept as text a person edits, one per line:
 *
 *     dribbble.com          categories: inspiration
 *     *.example.com         categories: payments, categories: competitors
 *     # a comment
 *
 * Text rather than a structure, because text is what the settings pane can
 * show in one box, what a diff can read, and what cannot be half-saved.
 * Parsing is here and tested; nothing else reads the raw lines.
 */

import type { Annotation } from "./annotate";

export interface DomainRule {
  /** As written, for showing a rule back. */
  pattern: string;
  /** What the rule writes. */
  annotation: Annotation;
  /** The line it came from, one-based, for pointing at a bad one. */
  line: number;
}

export interface ParsedRules {
  rules: DomainRule[];
  /** Lines that could not be read, with why. Kept rather than thrown: one bad
      line should not switch every good one off. */
  errors: Array<{ line: number; text: string; reason: string }>;
}

const COMMENT = /^\s*(#|\/\/)/;

/**
 * Splits a rule line into its pattern and its assignments.
 *
 * The pattern is the first token; everything after the first run of
 * whitespace is `key: value, key: value`. Values may contain spaces; keys may
 * not. A value list is split on commas only where a `key:` follows, so a value
 * with a comma in it survives as long as it is the last one.
 */
function parseLine(text: string, line: number): DomainRule | { reason: string } {
  const trimmed = text.trim();
  const gap = trimmed.search(/\s/);
  if (gap === -1) return { reason: "no properties after the domain" };

  const pattern = trimmed.slice(0, gap).toLowerCase();
  if (!/^(\*\.)?[a-z0-9.-]+$/.test(pattern)) return { reason: "domain is not a host name" };

  const rest = trimmed.slice(gap).trim();
  // Split before each `key:` that starts a new assignment. The lookahead keeps
  // the key with its value rather than eating it as the separator.
  const parts = rest.split(/,\s*(?=[A-Za-z0-9_-]+\s*:)/);
  const annotation: Annotation = {};

  for (const part of parts) {
    const colon = part.indexOf(":");
    if (colon === -1) return { reason: `"${part.trim()}" has no colon` };
    const key = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (!key) return { reason: "a property has no name" };
    if (!value) return { reason: `"${key}" has no value` };
    annotation[key] = [...(annotation[key] ?? []), value];
  }

  return { pattern, annotation, line };
}

export function parseRules(text: string): ParsedRules {
  const rules: DomainRule[] = [];
  const errors: ParsedRules["errors"] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim() || COMMENT.test(raw)) return;
    const result = parseLine(raw, index + 1);
    if ("reason" in result) errors.push({ line: index + 1, text: raw.trim(), reason: result.reason });
    else rules.push(result);
  });

  return { rules, errors };
}

/** The host of a URL, lower-cased and without a leading www., or "" if it is not one. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Whether a host is what a pattern names.
 *
 * `example.com` matches itself and, since www. is already stripped, the site
 * as people type it. `*.example.com` matches any subdomain and the bare
 * domain too: a rule about a company is a rule about all of it, and asking
 * for two lines to say so is how the second gets forgotten.
 */
export function hostMatches(host: string, pattern: string): boolean {
  if (!host) return false;
  if (pattern.startsWith("*.")) {
    const base = pattern.slice(2);
    return host === base || host.endsWith(`.${base}`);
  }
  return host === pattern;
}

/**
 * Everything the rules have to say about a URL, as one annotation.
 *
 * Every matching rule contributes; a bare-domain rule and a wildcard one for
 * the same site both apply. Order is the order written, which only matters
 * for a scalar key, where the merge keeps the last.
 */
export function applyRules(rules: DomainRule[], url: string): Annotation {
  const host = hostOf(url);
  const out: Annotation = {};
  if (!host) return out;

  for (const rule of rules) {
    if (!hostMatches(host, rule.pattern)) continue;
    for (const [key, values] of Object.entries(rule.annotation)) {
      out[key] = [...(out[key] ?? []), ...values];
    }
  }
  return out;
}

/**
 * The commented example earlier versions wrote into the rules box as its
 * value. Being a value, it hid the placeholder that now shows the shape, so
 * it is kept only to be recognised and cleared; see settledRules.
 */
export const SHIPPED_RULES_EXAMPLE = [
  "# One rule per line: a domain, then the properties it earns.",
  "# *.example.com also matches example.com itself.",
  "#",
  "# dribbble.com        category: inspiration",
  "# *.stripe.com        competitor: stripe, category: payments",
  "# x.com               source-type: social",
].join("\n");

/**
 * The rules text as the box should start with it: the shipped example, left
 * exactly as it came, is no rules at all, so the box is empty and shows its
 * placeholder. Anything edited is someone's own and is kept as it is.
 */
export function settledRules(text: string): string {
  return text.trim() === SHIPPED_RULES_EXAMPLE ? "" : text;
}
