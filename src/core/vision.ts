/**
 * Asking a vision model what a picture is, and reading its answer.
 *
 * A saved screenshot often has no words of its own: no title worth the name,
 * no description, nothing in the body but the embed. It can still be found if
 * something writes down what it shows. That is what this asks for — a short
 * summary in plain words, and a few tags chosen from what the vault already
 * uses — and what parseResponse turns back into an Annotation the one door
 * (annotate-service.ts) can write.
 *
 * A clipped article is the other case: it has words, too many of them, and a
 * cover picture that says nothing about the argument. For those the prompt
 * carries the opening of the text and asks what the piece is about.
 *
 * Three ways to reach a model: OpenAI and Anthropic over HTTP with a key, and
 * Claude Code on this machine as a program to run, which needs no key because
 * the person already logged in to it. The request shapes differ; the prompt,
 * the answer and the write are the same.
 *
 * Pure: no network, no Obsidian, no processes. Building the request and
 * reading the reply are the parts that go wrong quietly, so they are the parts
 * under test. vision-service.ts is what carries bytes; claude-cli.ts is what
 * runs the program.
 */

import type { Annotation } from "./annotate";
import type { ClippingRecord } from "./scan";
import { NOTE_KEY, SUMMARY_KEY, plainProse } from "./scan";
import type { TileModel } from "./tile";

export type VisionProvider = "openai" | "anthropic" | "claude-cli";

/** How hard Claude Code thinks, as its --effort flag names the levels. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** The effort a summary and five tags need. Anything more is quota spent on nothing. */
export const DEFAULT_EFFORT: Effort = "low";

/**
 * Model aliases Claude Code resolves to its latest version of each, and how
 * the settings pane names them. A full model id works too, typed by hand.
 */
export const CLI_MODELS: Record<string, string> = {
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
  fable: "Fable",
};

export interface VisionSettings {
  provider: VisionProvider;
  apiKey: string;
  model: string;
  /** Which property receives the tags. `categories` by default; `tags` needs the licence. */
  tagProperty: string;
  /** Claude Code only: how hard it thinks. Ignored by the HTTP providers. */
  effort?: Effort;
  /** Claude Code only: an explicit path to the program, "" to find it. */
  cliPath?: string;
}

/** The model's answer, before it becomes an annotation. */
export interface VisionAnswer {
  summary: string;
  tags: string[];
}

/** One value and how many clippings hold it, most held first. */
export interface VocabularyEntry {
  value: string;
  count: number;
}

/**
 * Every value a property holds across the vault, most used first.
 *
 * This is what the model is asked to choose from. A tag it has to invent is a
 * tag nobody else has, and a vault where every clipping has its own tag has no
 * tags at all. Counted from records rather than tiles so it does not depend on
 * what happened to render.
 */
export function vocabularyOf(records: readonly ClippingRecord[], key: string): VocabularyEntry[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const value of record.properties[key] ?? []) {
      const clean = value.trim();
      if (clean) counts.set(clean, (counts.get(clean) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** How many existing values to offer. Past this the list is noise the model skims. */
const VOCABULARY_CAP = 60;

/**
 * Below this much prose a note is a picture with a caption, not an article.
 * A Web Clipper note carries the whole piece; a captured post carries a line.
 */
export const MIN_ARTICLE_CHARS = 400;

/**
 * How much of an article reaches the model. The opening carries the point —
 * what it is about, who it is for — and the tail is footers and related links.
 * Seven thousand characters is roughly the first thousand words.
 */
export const ARTICLE_BUDGET = 7000;

/**
 * A note's body as readable prose for the model, or "" when there is too
 * little of it to call an article. Case is kept, unlike the search index's
 * copy, because it is going to be read rather than matched.
 */
export function articleText(rest: string): string {
  const prose = plainProse(rest);
  return prose.length >= MIN_ARTICLE_CHARS ? prose.slice(0, ARTICLE_BUDGET) : "";
}

/**
 * The language every summary is written in, whatever the source speaks.
 *
 * Stated outright because the providers do not agree by default: an HTTP
 * model answers in English, while Claude Code follows whatever language the
 * person set for their own sessions. A library described in two languages is
 * searchable in neither.
 */
const SUMMARY_LANGUAGE = "English";

/**
 * What to say alongside the picture, or alongside the article's text.
 *
 * Written for a designer's reference library: the summary should say what the
 * picture is *of* — a checkout form, a pricing table, an illustration style —
 * in the words a person would search with later, and it should carry any text
 * visible in the picture, since that text is the most likely search of all.
 *
 * @param article the opening of the note's prose when there is enough of it
 * to be one (see articleText); "" for a picture with a caption. With an
 * article the question changes from "what does this show" to "what is this
 * about", and the picture, if one is sent along, is only its cover.
 */
export function buildPrompt(record: ClippingRecord, vocabulary: VocabularyEntry[], article = ""): string {
  const context: string[] = [];
  if (record.title) context.push(`Title: ${record.title}`);
  if (record.source) context.push(`Source: ${record.source}`);
  if (record.description) context.push(`Description from the source: ${record.description}`);
  const note = (record.properties[NOTE_KEY] ?? []).join(" ");
  if (note) context.push(`The person who saved it wrote: ${note}`);

  const offered = vocabulary.slice(0, VOCABULARY_CAP).map((entry) => entry.value);
  const tagsLine = offered.length
    ? `tags: two to five, chosen from this list wherever one fits: ${offered.join(", ")}. Add a tag that is not on the list only if nothing on it applies. Lower case, short, the way the list is written.`
    : "tags: two to five short lower-case tags a designer would file this under.";

  if (article) {
    return [
      "You are describing an article saved into a designer's reference library, so it can be found again by searching. If a picture is attached, it is the article's cover, not the subject.",
      "",
      context.length ? "What is known about it:" : "Nothing else is known about it.",
      ...context,
      "",
      "The article begins:",
      article,
      "",
      "Reply with JSON only, no prose around it, in exactly this shape:",
      '{"summary": "...", "tags": ["...", "..."]}',
      "",
      `summary: two or three sentences, plain and specific, saying what the article is about and what it argues, shows or teaches — the words a person would search with later. Write it in ${SUMMARY_LANGUAGE}, whatever language the article is in. No preamble like 'This article discusses'.`,
      "",
      tagsLine,
    ].join("\n");
  }

  return [
    "You are describing a picture saved into a designer's visual reference library, so it can be found again by searching.",
    "",
    context.length ? "What is known about it:" : "Nothing else is known about it.",
    ...context,
    "",
    "Reply with JSON only, no prose around it, in exactly this shape:",
    '{"summary": "...", "tags": ["...", "..."]}',
    "",
    `summary: one or two sentences, plain and specific, saying what the picture shows — the kind of thing (a checkout form, a pricing page, a poster, an illustration), its style, its notable parts. Include any words that are legible in the picture, since those are what someone will search for. Write it in ${SUMMARY_LANGUAGE}. No preamble like 'This image shows'.`,
    "",
    tagsLine,
  ].join("\n");
}

/**
 * The model's text, as an answer, or null when it cannot be read as one.
 *
 * Tolerant of the two things models do to JSON they were asked not to
 * decorate: wrap it in a code fence, or put a sentence before it. Anything
 * beyond that is a failure to report, not a thing to guess at.
 */
export function parseResponse(text: string): VisionAnswer | null {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const record = parsed as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const tags = Array.isArray(record.tags)
    ? record.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    : [];

  if (!summary && tags.length === 0) return null;
  return { summary, tags: [...new Set(tags)] };
}

/** An answer as what gets written. Tags go to the configured property. */
export function toAnnotation(answer: VisionAnswer, tagProperty: string): Annotation {
  const out: Annotation = {};
  if (answer.summary) out[SUMMARY_KEY] = [answer.summary];
  if (answer.tags.length) out[tagProperty] = answer.tags;
  return out;
}

/** True when a clipping has already been described, so a bulk run skips it. */
export function isDescribed(record: ClippingRecord): boolean {
  return (record.properties[SUMMARY_KEY] ?? []).some((v) => v.trim().length > 0);
}

/**
 * Which file to send. The thumbnail when there is one: it is a few hundred
 * pixels wide, which is all a description needs and a fraction of the tokens
 * the original would cost. A video sends its poster, never itself.
 */
export function pickImage(tile: TileModel, thumbOf: (file: string) => string | undefined): string | null {
  if (tile.kind === "video") return tile.posterPath || null;
  if (tile.remote) return null;
  return thumbOf(tile.filePath) || tile.filePath || null;
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/** The MIME type a provider expects for the bytes, or null for a format none of them takes. */
export function imageMime(path: string): string | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? null;
}

/** A picture ready for an HTTP request: its bytes and what they are. */
export interface VisionImage {
  base64: string;
  mime: string;
}

/**
 * The request body for an HTTP provider. Without a picture the message is
 * text alone, which is how an article with a remote or missing cover goes.
 */
export function buildRequest(
  settings: VisionSettings,
  prompt: string,
  image: VisionImage | null
): { url: string; headers: Record<string, string>; body: unknown } {
  if (settings.provider === "anthropic") {
    const content: unknown[] = [];
    if (image) {
      content.push({ type: "image", source: { type: "base64", media_type: image.mime, data: image.base64 } });
    }
    content.push({ type: "text", text: prompt });
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: settings.model,
        max_tokens: 400,
        messages: [{ role: "user", content }],
      },
    };
  }

  const content: unknown[] = [{ type: "text", text: prompt }];
  if (image) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${image.mime};base64,${image.base64}`, detail: "low" },
    });
  }
  return {
    url: "https://api.openai.com/v1/chat/completions",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: {
      model: settings.model,
      max_tokens: 400,
      messages: [{ role: "user", content }],
    },
  };
}

/** The model's text out of an HTTP provider's response envelope, or null. */
export function extractText(provider: VisionProvider, response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const r = response as Record<string, unknown>;

  if (provider === "anthropic") {
    const content = r.content;
    if (!Array.isArray(content)) return null;
    const texts = content
      .filter((c): c is { type: string; text: string } =>
        !!c && typeof c === "object" && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string"
      )
      .map((c) => c.text);
    return texts.length ? texts.join("\n") : null;
  }

  const choices = r.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  return typeof message?.content === "string" ? message.content : null;
}

/** What went wrong with an HTTP call, in the words a person can act on. */
export function describeFailure(status: number, body: unknown): string {
  const r = (body ?? {}) as Record<string, unknown>;
  const nested = (r.error ?? {}) as Record<string, unknown>;
  const message = typeof nested.message === "string" ? nested.message : "";
  if (status === 401 || status === 403) return "the API key was refused — check it in settings";
  if (status === 429) return "rate limited — try again in a moment";
  if (status === 404) return `the model "${message ? message.slice(0, 60) : "?"}" was not found — check the model name`;
  if (status >= 500) return "the provider is having trouble — try again later";
  return message ? message.slice(0, 120) : `HTTP ${status}`;
}

/**
 * The flags every Claude Code run gets, measured on 2026-09-10 against a
 * bare `claude -p`: the context fell from about 92k tokens to 22k and the
 * run from 11 s to 6 s.
 *
 * `--tools Read` leaves the model one tool, the one it needs to see the
 * picture. `--strict-mcp-config` skips the person's MCP servers, whose tool
 * schemas were most of those 70k tokens. `--no-session-persistence` keeps
 * a session file per picture out of ~/.claude. `--setting-sources user`
 * ignores whatever a CLAUDE.md or settings file in the vault would add.
 * `--bare` is deliberately absent: it also switches off the OAuth login,
 * and a keyless run is the whole point.
 */
const CLI_FLAGS: readonly string[] = [
  "--output-format",
  "json",
  "--tools",
  "Read",
  "--strict-mcp-config",
  "--no-session-persistence",
  "--setting-sources",
  "user",
  "--disable-slash-commands",
  "--no-chrome",
];

/** The argument list for one Claude Code run. The prompt rides as an argument, not on stdin. */
export function buildCliArgs(settings: Pick<VisionSettings, "model" | "effort">, prompt: string): string[] {
  const args = ["-p", prompt, ...CLI_FLAGS];
  const model = settings.model.trim();
  if (model) args.push("--model", model);
  args.push("--effort", settings.effort ?? DEFAULT_EFFORT);
  return args;
}

/**
 * The prompt with the one line Claude Code needs that an HTTP call does not:
 * where the picture is. The path is relative to the vault, which is the
 * program's working directory, so reading it needs no permission.
 */
export function buildCliPrompt(prompt: string, imagePath: string | null): string {
  if (!imagePath) return prompt;
  return [
    `First, look at the picture: read the file at ./${imagePath} with the Read tool. Then follow these instructions.`,
    "",
    prompt,
  ].join("\n");
}

/** What came back from running Claude Code, as claude-cli.ts reports it. */
export interface CliRun {
  stdout: string;
  stderr: string;
  /** The exit code, or null when the process never returned one. */
  code: number | null;
  timedOut: boolean;
  /** The program was not where it was expected. */
  missing: boolean;
}

/** The model's text out of Claude Code's `--output-format json` envelope, or why there is none. */
export function parseCliResult(stdout: string): { text: string | null; error: string | null } {
  const trimmed = stdout.trim();
  if (!trimmed) return { text: null, error: "Claude Code sent back nothing" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Not the envelope at all. Whatever this is, let parseResponse try it:
    // a model that answered in plain text still answered.
    return { text: trimmed, error: null };
  }
  if (!parsed || typeof parsed !== "object") return { text: trimmed, error: null };

  const r = parsed as Record<string, unknown>;
  // JSON, but not the envelope: a model's own answer printed bare. Let it through.
  if (!("result" in r) && !("is_error" in r)) return { text: trimmed, error: null };
  const result = typeof r.result === "string" ? r.result.trim() : "";
  if (r.is_error === true) return { text: null, error: result || "Claude Code reported an error" };
  return result ? { text: result, error: null } : { text: null, error: "Claude Code sent back nothing readable" };
}

/** What went wrong with a Claude Code run, in the words a person can act on. */
export function describeCliFailure(run: CliRun, error: string | null): string {
  if (run.missing) return "Claude Code was not found — install it, or set its path under Settings → Goko → AI descriptions";
  if (run.timedOut) return "Claude Code took too long — try again, or lower the effort";

  const said = `${error ?? ""}\n${run.stderr}`.toLowerCase();
  if (said.includes("not logged in") || said.includes("/login")) {
    return "Claude Code is not logged in — run claude in a terminal once and log in";
  }
  if (said.includes("usage limit") || said.includes("rate limit") || said.includes("limit reached")) {
    return "the Claude subscription's usage limit is reached — wait for the window to reset";
  }

  if (error) return error.slice(0, 120);
  const stderr = run.stderr.trim();
  if (stderr) return stderr.split("\n")[0].slice(0, 120);
  return run.code === null ? "Claude Code did not finish" : `Claude Code exited with code ${run.code}`;
}

/**
 * Whether a failure says the provider will refuse the rest of the batch too:
 * a subscription's window used up, or a rate limit. Read off the sentences
 * describeFailure and describeCliFailure write, which are the only ones the
 * queue sees.
 */
export function isLimitFailure(reason: string): boolean {
  const said = reason.toLowerCase();
  return said.includes("usage limit") || said.includes("rate limited");
}

/** How many clippings may be described at once. */
export const MAX_CONCURRENCY = 10;
export const DEFAULT_CONCURRENCY = 3;

/** A count of workers the queue can run, whatever the setting says. */
export function clampConcurrency(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(n)));
}

export const DEFAULT_MODELS: Record<VisionProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  "claude-cli": "sonnet",
};
