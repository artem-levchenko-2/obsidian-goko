import { describe, expect, it } from "vitest";
import {
  ARTICLE_BUDGET,
  CLI_MODELS,
  DEFAULT_EFFORT,
  DEFAULT_MODELS,
  EFFORTS,
  MIN_ARTICLE_CHARS,
  articleText,
  buildCliArgs,
  buildCliPrompt,
  buildPrompt,
  buildRequest,
  describeCliFailure,
  describeFailure,
  extractText,
  imageMime,
  isDescribed,
  parseCliResult,
  parseResponse,
  pickImage,
  toAnnotation,
  vocabularyOf,
} from "../src/core/vision";
import type { CliRun } from "../src/core/vision";
import type { ClippingRecord } from "../src/core/scan";
import type { TileModel } from "../src/core/tile";

function rec(over: Partial<ClippingRecord> = {}): ClippingRecord {
  return {
    path: "Clippings/a.md",
    title: "A",
    source: "https://x.com/a/1",
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

function tile(over: Partial<TileModel> = {}): TileModel {
  return {
    id: "Clippings/a.md",
    record: rec(),
    posterPath: "",
    filePath: "Attachments/a.jpg",
    remote: false,
    kind: "image",
    animated: false,
    width: 1,
    height: 1,
    provisional: false,
    signature: "s",
    ...over,
  };
}

describe("vocabularyOf", () => {
  it("counts every value across the vault, most used first", () => {
    const records = [
      rec({ properties: { categories: ["ui", "web"] } }),
      rec({ properties: { categories: ["ui"] } }),
      rec({ properties: { categories: [" ui ", "print"] } }),
    ];
    expect(vocabularyOf(records, "categories")).toEqual([
      { value: "ui", count: 3 },
      { value: "print", count: 1 },
      { value: "web", count: 1 },
    ]);
  });

  it("is empty for a key nothing holds", () => {
    expect(vocabularyOf([rec()], "categories")).toEqual([]);
  });
});

describe("buildPrompt", () => {
  it("offers the vault's own tags and asks the model to choose from them", () => {
    const prompt = buildPrompt(rec(), [{ value: "ui", count: 3 }, { value: "web", count: 1 }]);
    expect(prompt).toContain("chosen from this list");
    expect(prompt).toContain("ui, web");
  });

  it("asks for free tags when the vault has none yet", () => {
    const prompt = buildPrompt(rec(), []);
    expect(prompt).not.toContain("chosen from this list");
    expect(prompt).toContain("tags a designer would file this under");
  });

  it("carries what is known, including the reader's own note", () => {
    const prompt = buildPrompt(rec({ title: "Some screenshot", properties: { note: ["for the layout"] } }), []);
    expect(prompt).toContain("Title: Some screenshot");
    expect(prompt).toContain("Source: https://x.com/a/1");
    expect(prompt).toContain("wrote: for the layout");
  });

  it("asks for legible text in the summary, since that is what gets searched", () => {
    expect(buildPrompt(rec(), [])).toMatch(/legible/);
  });

  it("asks what an article is about, and sends its opening along", () => {
    const opening = "Grids are how a page holds together. ".repeat(20);
    const prompt = buildPrompt(rec({ title: "On grids" }), [{ value: "layout", count: 2 }], opening);
    expect(prompt).toContain("article");
    expect(prompt).toContain("The article begins:");
    expect(prompt).toContain("Grids are how a page holds together.");
    expect(prompt).toContain("what the article is about");
    expect(prompt).toContain("chosen from this list");
    expect(prompt).not.toContain("legible");
  });

  it("names the language, so every provider answers in the same one", () => {
    expect(buildPrompt(rec(), [])).toContain("English");
    expect(buildPrompt(rec(), [], "x".repeat(500))).toContain("English");
  });

  it("caps a huge vocabulary rather than pasting all of it", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ value: `t${i}`, count: 1 }));
    const prompt = buildPrompt(rec(), many);
    expect(prompt).toContain("t59");
    expect(prompt).not.toContain("t60,");
  });
});

describe("parseResponse", () => {
  it("reads clean JSON", () => {
    expect(parseResponse('{"summary": "A dark dashboard.", "tags": ["ui", "dark"]}')).toEqual({
      summary: "A dark dashboard.",
      tags: ["ui", "dark"],
    });
  });

  it("reads JSON wrapped in a code fence", () => {
    const text = '```json\n{"summary": "S", "tags": ["a"]}\n```';
    expect(parseResponse(text)).toEqual({ summary: "S", tags: ["a"] });
  });

  it("reads JSON with a sentence in front of it", () => {
    const text = 'Here is the description:\n{"summary": "S", "tags": []}';
    expect(parseResponse(text)?.summary).toBe("S");
  });

  it("lower-cases and dedupes tags", () => {
    expect(parseResponse('{"summary": "S", "tags": ["UI", "ui", " Web "]}')?.tags).toEqual(["ui", "web"]);
  });

  it("drops tags that are not strings", () => {
    expect(parseResponse('{"summary": "S", "tags": ["a", 3, null]}')?.tags).toEqual(["a"]);
  });

  it("returns null for something that is not JSON", () => {
    expect(parseResponse("I cannot see the image.")).toBeNull();
    expect(parseResponse("")).toBeNull();
  });

  it("returns null for JSON that says nothing useful", () => {
    expect(parseResponse('{"summary": "", "tags": []}')).toBeNull();
    expect(parseResponse("[1,2,3]")).toBeNull();
  });
});

describe("toAnnotation", () => {
  it("routes the summary to summary and the tags to the chosen property", () => {
    expect(toAnnotation({ summary: "S", tags: ["a", "b"] }, "categories")).toEqual({
      summary: ["S"],
      categories: ["a", "b"],
    });
  });

  it("omits what the answer did not have", () => {
    expect(toAnnotation({ summary: "", tags: ["a"] }, "tags")).toEqual({ tags: ["a"] });
    expect(toAnnotation({ summary: "S", tags: [] }, "tags")).toEqual({ summary: ["S"] });
  });
});

describe("isDescribed", () => {
  it("is true once a summary is there", () => {
    expect(isDescribed(rec({ properties: { summary: ["S"] } }))).toBe(true);
    expect(isDescribed(rec({ properties: { summary: ["  "] } }))).toBe(false);
    expect(isDescribed(rec())).toBe(false);
  });
});

describe("pickImage", () => {
  const thumbs = new Map([["Attachments/a.jpg", "Attachments/a.thumb.webp"]]);
  const thumbOf = (f: string) => thumbs.get(f);

  it("prefers the thumbnail, which is all a description needs", () => {
    expect(pickImage(tile(), thumbOf)).toBe("Attachments/a.thumb.webp");
  });

  it("falls back to the original when there is no thumbnail", () => {
    expect(pickImage(tile({ filePath: "Attachments/b.png" }), thumbOf)).toBe("Attachments/b.png");
  });

  it("sends a video's poster, never the video", () => {
    expect(pickImage(tile({ kind: "video", posterPath: "p.webp", filePath: "v.mp4" }), thumbOf)).toBe("p.webp");
    expect(pickImage(tile({ kind: "video", posterPath: "", filePath: "v.mp4" }), thumbOf)).toBeNull();
  });

  it("does not try to read a remote cover off the disk", () => {
    expect(pickImage(tile({ remote: true, filePath: "https://x/a.jpg" }), thumbOf)).toBeNull();
  });
});

describe("imageMime", () => {
  it("knows the formats providers accept", () => {
    expect(imageMime("a.jpg")).toBe("image/jpeg");
    expect(imageMime("a.thumb.webp")).toBe("image/webp");
    expect(imageMime("a.PNG")).toBe("image/png");
  });

  it("refuses one they do not", () => {
    expect(imageMime("a.avif")).toBeNull();
    expect(imageMime("a.svg")).toBeNull();
  });
});

describe("buildRequest", () => {
  const base = { apiKey: "k", model: "m", tagProperty: "categories" } as const;
  const image = { base64: "AAA", mime: "image/png" };
  type Body = { messages: Array<{ content: Array<{ type: string; image_url?: { url: string; detail: string } }> }> };

  it("shapes an Anthropic messages call with the image first", () => {
    const req = buildRequest({ ...base, provider: "anthropic" }, "P", image);
    expect(req.url).toContain("anthropic.com");
    expect(req.headers["x-api-key"]).toBe("k");
    const body = req.body as Body;
    expect(body.messages[0].content[0].type).toBe("image");
    expect(body.messages[0].content[1].type).toBe("text");
  });

  it("shapes an OpenAI chat call with a data URL at low detail", () => {
    const req = buildRequest({ ...base, provider: "openai" }, "P", image);
    expect(req.url).toContain("openai.com");
    expect(req.headers.authorization).toBe("Bearer k");
    const body = req.body as Body;
    const picture = body.messages[0].content.find((c) => c.type === "image_url");
    expect(picture?.image_url?.url).toBe("data:image/png;base64,AAA");
    expect(picture?.image_url?.detail).toBe("low");
  });

  it("sends text alone when there is no picture, as an article with no cover goes", () => {
    const anthropic = buildRequest({ ...base, provider: "anthropic" }, "P", null).body as Body;
    expect(anthropic.messages[0].content.map((c) => c.type)).toEqual(["text"]);
    const openai = buildRequest({ ...base, provider: "openai" }, "P", null).body as Body;
    expect(openai.messages[0].content.map((c) => c.type)).toEqual(["text"]);
  });
});

describe("extractText", () => {
  it("reads an Anthropic reply", () => {
    expect(extractText("anthropic", { content: [{ type: "text", text: "hi" }] })).toBe("hi");
  });

  it("reads an OpenAI reply", () => {
    expect(extractText("openai", { choices: [{ message: { content: "hi" } }] })).toBe("hi");
  });

  it("is null for an envelope with nothing in it", () => {
    expect(extractText("openai", { choices: [] })).toBeNull();
    expect(extractText("anthropic", {})).toBeNull();
    expect(extractText("openai", null)).toBeNull();
  });
});

describe("describeFailure", () => {
  it("says what to do for the failures a person can fix", () => {
    expect(describeFailure(401, {})).toContain("API key");
    expect(describeFailure(429, {})).toContain("rate limited");
    expect(describeFailure(404, { error: { message: "no such model" } })).toContain("model");
    expect(describeFailure(500, {})).toContain("provider");
  });

  it("falls back to the provider's own message, then the status", () => {
    expect(describeFailure(400, { error: { message: "bad image" } })).toBe("bad image");
    expect(describeFailure(418, {})).toBe("HTTP 418");
  });
});

describe("articleText", () => {
  it("is empty for a note with only a caption", () => {
    expect(articleText("A poster I liked.")).toBe("");
    expect(articleText("")).toBe("");
  });

  it("keeps case and drops markdown, links and addresses", () => {
    const filler = "Design systems ".repeat(60);
    const text = articleText(`# Heading\n\nSee [Stripe](https://stripe.com) and https://cdn.x/y.png ${filler}`);
    expect(text.startsWith("Heading See Stripe and Design systems")).toBe(true);
    expect(text).not.toContain("https://");
    expect(text).not.toContain("#");
  });

  it("treats MIN_ARTICLE_CHARS as the line, and cuts at the budget", () => {
    expect(articleText("x".repeat(MIN_ARTICLE_CHARS - 1))).toBe("");
    expect(articleText("x".repeat(MIN_ARTICLE_CHARS))).toHaveLength(MIN_ARTICLE_CHARS);
    expect(articleText("word ".repeat(5000))).toHaveLength(ARTICLE_BUDGET);
  });
});

describe("buildCliArgs", () => {
  const after = (args: string[], flag: string): string => args[args.indexOf(flag) + 1];

  it("puts the prompt first and the run's flags after it", () => {
    const args = buildCliArgs({ model: "sonnet", effort: "high" }, "P");
    expect(args.slice(0, 2)).toEqual(["-p", "P"]);
    expect(after(args, "--output-format")).toBe("json");
    expect(after(args, "--tools")).toBe("Read");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(after(args, "--model")).toBe("sonnet");
    expect(after(args, "--effort")).toBe("high");
  });

  it("never asks for bare mode, which would switch the login off", () => {
    expect(buildCliArgs({ model: "sonnet" }, "P")).not.toContain("--bare");
  });

  it("leaves the model to Claude Code when none is set, and effort defaults low", () => {
    const args = buildCliArgs({ model: "  " }, "P");
    expect(args).not.toContain("--model");
    expect(after(args, "--effort")).toBe(DEFAULT_EFFORT);
  });
});

describe("buildCliPrompt", () => {
  it("tells Claude Code where the picture is, relative to the vault", () => {
    const out = buildCliPrompt("P", "Attachments/Clippings/a b.jpg");
    expect(out).toContain("./Attachments/Clippings/a b.jpg");
    expect(out).toContain("Read tool");
    expect(out.endsWith("P")).toBe(true);
  });

  it("is the prompt itself when there is no picture", () => {
    expect(buildCliPrompt("P", null)).toBe("P");
  });
});

describe("parseCliResult", () => {
  it("reads the text out of the json envelope", () => {
    const stdout = JSON.stringify({ type: "result", is_error: false, result: '{"summary":"S","tags":[]}' });
    expect(parseCliResult(stdout)).toEqual({ text: '{"summary":"S","tags":[]}', error: null });
  });

  it("reports an error envelope as the error it carries", () => {
    const stdout = JSON.stringify({ type: "result", is_error: true, result: "Not logged in · Please run /login" });
    expect(parseCliResult(stdout)).toEqual({ text: null, error: "Not logged in · Please run /login" });
  });

  it("passes anything that is not an envelope through, for parseResponse to try", () => {
    expect(parseCliResult("plain words")).toEqual({ text: "plain words", error: null });
    expect(parseCliResult('{"summary": "S", "tags": ["a"]}')).toEqual({ text: '{"summary": "S", "tags": ["a"]}', error: null });
  });

  it("says so when nothing came back", () => {
    expect(parseCliResult("")).toEqual({ text: null, error: "Claude Code sent back nothing" });
    expect(parseCliResult(JSON.stringify({ type: "result", is_error: false, result: "" })).error).toMatch(/nothing readable/);
  });
});

describe("describeCliFailure", () => {
  const run = (over: Partial<CliRun> = {}): CliRun => ({
    stdout: "",
    stderr: "",
    code: 1,
    timedOut: false,
    missing: false,
    ...over,
  });

  it("says where to look when the program is missing or slow", () => {
    expect(describeCliFailure(run({ missing: true }), null)).toContain("Settings → Goko → AI");
    expect(describeCliFailure(run({ timedOut: true }), null)).toContain("too long");
  });

  it("recognises a login or a limit from what the program said", () => {
    expect(describeCliFailure(run(), "Not logged in · Please run /login")).toContain("log in");
    expect(describeCliFailure(run({ stderr: "Usage limit reached until 5pm" }), null)).toContain("usage limit");
  });

  it("falls back to the error, then stderr's first line, then the exit code", () => {
    expect(describeCliFailure(run(), "something odd")).toBe("something odd");
    expect(describeCliFailure(run({ stderr: "first\nsecond" }), null)).toBe("first");
    expect(describeCliFailure(run({ code: 7 }), null)).toBe("Claude Code exited with code 7");
    expect(describeCliFailure(run({ code: null }), null)).toBe("Claude Code did not finish");
  });
});

describe("DEFAULT_MODELS", () => {
  it("has a default for every provider, and Claude Code's is an alias it knows", () => {
    expect(DEFAULT_MODELS["claude-cli"]).toBe("sonnet");
    expect(Object.keys(CLI_MODELS)).toContain(DEFAULT_MODELS["claude-cli"]);
    expect(EFFORTS).toContain(DEFAULT_EFFORT);
  });
});
