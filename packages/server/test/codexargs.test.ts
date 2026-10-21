import { describe, expect, it } from 'vitest';
import { codexMcpArgs, isApprovalBlock, parseCodexVersion } from '../src/codexargs.js';

const kv = (args: string[]) => args.filter((_, i) => i % 2 === 1); // the values after every -c
const tools = ['get_graph', 'create_node'];
const run = (v: string | null) => codexMcpArgs('pennodepaper', 4317, parseCodexVersion(v), tools);

describe('parseCodexVersion', () => {
  it('reads the version out of what `codex --version` prints', () => {
    expect(parseCodexVersion('codex-cli 0.160.0\n')).toEqual([0, 160, 0]);
    expect(parseCodexVersion('0.77.0')).toEqual([0, 77, 0]);
    expect(parseCodexVersion('codex 0.121.0-alpha.3')).toEqual([0, 121, 0]);
  });
  it('is null when there is none', () => {
    expect(parseCodexVersion('')).toBeNull();
    expect(parseCodexVersion('command not found')).toBeNull();
    expect(parseCodexVersion(undefined)).toBeNull();
  });
});

describe('codexMcpArgs', () => {
  it('always hands over the server, its token variable and the never-ask policy, every one behind its own -c', () => {
    for (const v of [null, '0.60.0', '0.160.0']) {
      const a = run(v);
      expect(a.filter((_, i) => i % 2 === 0).every((x) => x === '-c')).toBe(true);
      expect(kv(a)).toEqual(expect.arrayContaining([
        'mcp_servers.pennodepaper.url="http://127.0.0.1:4317/mcp?actor=codex"',
        'mcp_servers.pennodepaper.bearer_token_env_var="PNP_MCP_TOKEN"',
        'approval_policy="never"',
      ]));
    }
  });

  it('keeps the rmcp flag for a Codex that needs it (older than 0.77) and when the version is unknown, drops it for newer ones', () => {
    expect(kv(run('0.76.0'))).toContain('experimental_use_rmcp_client=true');
    expect(kv(run(null))).toContain('experimental_use_rmcp_client=true');
    expect(kv(run('0.77.0'))).not.toContain('experimental_use_rmcp_client=true');
    expect(kv(run('0.160.0'))).not.toContain('experimental_use_rmcp_client=true');
  });

  it('approves the tools only where Codex has a setting for it: per tool from 0.120, also server-wide from 0.130', () => {
    const perTool = 'mcp_servers.pennodepaper.tools={"get_graph"={approval_mode="approve"},"create_node"={approval_mode="approve"}}';
    const server = 'mcp_servers.pennodepaper.default_tools_approval_mode="approve"';
    for (const v of [null, '0.76.0', '0.119.9']) expect(kv(run(v)).filter((x) => /approval_mode|\.tools=/.test(x))).toEqual([]);
    expect(kv(run('0.120.0'))).toContain(perTool);
    expect(kv(run('0.120.0'))).not.toContain(server);
    expect(kv(run('0.129.0'))).not.toContain(server);
    expect(kv(run('0.130.0'))).toEqual(expect.arrayContaining([perTool, server]));
    expect(kv(run('1.0.0'))).toEqual(expect.arrayContaining([perTool, server]));
  });

  it('writes valid TOML: every value after the first = parses as a string, number-free inline table or boolean', () => {
    const a = kv(run('0.160.0'));
    const table = a.find((x) => x.includes('.tools='))!;
    expect(table.slice(table.indexOf('=') + 1)).toMatch(/^\{("[a-z_]+"=\{approval_mode="approve"\},?)+\}$/);
  });
});

describe('isApprovalBlock', () => {
  it('recognises the stop Codex reports for a tool that needs an approval nobody can give', () => {
    expect(isApprovalBlock('MCP tool call requires approval, but approval policy is never')).toBe(true);
    expect(isApprovalBlock('user cancelled MCP tool call')).toBe(true); // the same stop, worded by a slightly older Codex
    expect(isApprovalBlock('Operation timed out')).toBe(false);
    expect(isApprovalBlock('Node "b" not found')).toBe(false);
  });
});
