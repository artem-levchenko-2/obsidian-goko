import { describe, expect, it } from "vitest";
import { buildCliEnv } from "../src/core/cli-env";

describe("buildCliEnv", () => {
  const host = {
    PATH: "/usr/bin:/bin",
    HOME: "/home/someone",
    ANTHROPIC_API_KEY: "sk-test-0000",
    ANTHROPIC_AUTH_TOKEN: "sk-test-1111",
    CLAUDECODE: "1",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    CLAUDE_CODE_OAUTH_TOKEN: "sk-test-oauth",
    ANTHROPIC_MODEL: "some-model",
    UNRELATED: "keep",
  };

  it("drops the API key and the auth token so the run bills the subscription", () => {
    const env = buildCliEnv(host);
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
  });

  it("drops the markers of a surrounding Claude Code session", () => {
    const env = buildCliEnv(host);
    expect(env).not.toHaveProperty("CLAUDECODE");
    expect(env).not.toHaveProperty("CLAUDE_CODE_ENTRYPOINT");
  });

  it("keeps everything else, the subscription login included", () => {
    const env = buildCliEnv(host);
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/home/someone");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-test-oauth");
    expect(env.ANTHROPIC_MODEL).toBe("some-model");
    expect(env.UNRELATED).toBe("keep");
  });

  it("leaves the host's own object untouched", () => {
    const copy = { ...host };
    buildCliEnv(host);
    expect(host).toEqual(copy);
  });
});
