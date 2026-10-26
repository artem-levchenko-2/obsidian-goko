/**
 * The environment Claude Code is started with: Obsidian's own, minus what
 * would change how the run is authenticated or paid for. Pure, so the list
 * is tested; the caller in claude-cli.ts only hands it the host's variables.
 * The input is copied, never edited: it is the host's live environment.
 */
export function buildCliEnv(host: Record<string, string | undefined>): Record<string, string | undefined> {
  const env = { ...host };
  // The CLI refuses to start inside another Claude Code session, which it
  // detects by these. Obsidian is not a session, but an Obsidian launched
  // from a Claude Code terminal would have inherited them.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  // The subscription is the only way Goko means to pay for a description. An
  // Obsidian launched from a terminal that exports an API key would silently
  // switch the run to API billing, because the CLI prefers a key over the
  // login; the auth token is sent as a bearer ahead of the login too. A
  // CLAUDE_CODE_OAUTH_TOKEN is a subscription login, so it stays.
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}
