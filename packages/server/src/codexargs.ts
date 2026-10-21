// ---------------------------------------------------------------------------
// How `codex exec` is handed this app's MCP server. What Codex understands depends on its version (found out with
// `codex --version`), checked against Codex's own config.schema.json at each release:
//   < 0.77   URL servers (streamable HTTP) only work with `experimental_use_rmcp_client=true`.
//   >= 0.77  that client is the only one; the flag is gone and Codex warns "unrecognized configuration setting".
//   >= 0.120 `mcp_servers.<id>.tools.<tool>.approval_mode`;   >= 0.130 `mcp_servers.<id>.default_tools_approval_mode`.
// A Codex that has MCP approvals stops every tool call in `exec` ("MCP tool call requires approval, but approval policy is
// never"): `approval_policy="never"` does not cover MCP, and nobody is there to click. Marking the tools as approved is the
// only way through short of dropping the read-only sandbox (openai/codex#24135, still open). The server's config rejects
// keys an older Codex does not know, so every key is only sent to a version that has it.
// ---------------------------------------------------------------------------

export type CodexVersion = [major: number, minor: number, patch: number];

/** `codex-cli 0.160.0` (or a bare `0.160.0`, or `codex 0.77.0-alpha.3`) -> [0, 160, 0]; null when there is no version in the text. */
export function parseCodexVersion(text: string | null | undefined): CodexVersion | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const atLeast = (v: CodexVersion, minor: number) => v[0] > 0 || v[1] >= minor;

/** What this Codex needs for the app's MCP server, as `-c key=value` pairs (a JSON string is a valid TOML basic string). */
export function codexMcpArgs(name: string, port: number, version: CodexVersion | null, tools: string[]): string[] {
  const toml = (v: string) => JSON.stringify(v);
  const out = [
    `mcp_servers.${name}.url=${toml(`http://127.0.0.1:${port}/mcp?actor=codex`)}`,
    `mcp_servers.${name}.bearer_token_env_var=${toml('PNP_MCP_TOKEN')}`,
    'approval_policy="never"',
  ];
  // an unknown version keeps what always worked: the flag (a newer Codex only warns about it)
  if (!version || !atLeast(version, 77)) out.push('experimental_use_rmcp_client=true');
  if (version && atLeast(version, 130)) out.push(`mcp_servers.${name}.default_tools_approval_mode="approve"`);
  // the per-tool form is what has been reported to work in `exec`; the server-wide one is the designed way — send both where both exist
  if (version && atLeast(version, 120) && tools.length) {
    out.push(`mcp_servers.${name}.tools={${tools.map((t) => `${toml(t)}={approval_mode="approve"}`).join(',')}}`);
  }
  return out.flatMap((kv) => ['-c', kv]);
}

/** Codex said a campaign tool needed approval it cannot get in `exec`: not a quirk of the request, but of this Codex. */
export const isApprovalBlock = (text: string): boolean => /requires approval|approval policy is (never|set)|user cancelled MCP tool call/i.test(text);
