import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMsg } from '@pnp/shared';
import { Chat } from '../src/chat.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

// A stand-in `codex` that records how it was called and replays a prepared `exec --json` stream.
let dir: string;
let oldPath: string | undefined;
let chat: Chat;
let version: [number, number, number] | null = [0, 160, 0];
const messages: ChatMsg[] = [];

const line = (o: unknown) => JSON.stringify(o);
const calls = () => fs.readdirSync(path.join(dir, 'calls')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, 'calls', f), 'utf8')) as { args: string[]; stdin: string; token: string });

function fakeCodex(lines: string[], exit = 0, stderr = '') {
  const script = `#!/bin/sh
n=$(ls "${dir}/calls" | wc -l)
f="${dir}/calls/$(printf %03d $n).json"
stdin=$(cat | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g' | awk '{printf "%s\\\\n", $0}')
args=""
for a in "$@"; do esc=$(printf %s "$a" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'); args="$args\\"$esc\\","; done
printf '{"args":[%s""],"stdin":"%s","token":"%s"}' "$args" "$stdin" "$PNP_MCP_TOKEN" > "$f"
cat <<'EOF_STREAM'
${lines.join('\n')}
EOF_STREAM
${stderr ? `echo '${stderr}' >&2\n` : ''}exit ${exit}
`;
  fs.writeFileSync(path.join(dir, 'bin', 'codex'), script, { mode: 0o755 });
}
const finals = () => [...new Map(messages.map((m) => [m.id, m])).values()];
const system = () => finals().filter((m) => m.role === 'system').map((m) => m.text);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-codexchat-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.mkdirSync(path.join(dir, 'calls'));
  oldPath = process.env.PATH;
  process.env.PATH = `${path.join(dir, 'bin')}:${oldPath}`;
  messages.length = 0;
  version = [0, 160, 0];
  const store = new Store(new Persistence(path.join(dir, 'camp')));
  // the stand-in `codex` records every call, so the version is given here instead of asked with `codex --version`
  chat = new Chat({ store, port: 4317, token: 'sekret', campaignDir: dir, codexVersion: () => version, broadcast: (m) => m.t === 'chat' && (messages.push({ ...m.msg }), undefined) });
});
afterEach(() => {
  process.env.PATH = oldPath;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('codex backend', () => {
  it('shows the answer and the tool calls, attaches this app\'s MCP server per run and keeps the thread for the next message', async () => {
    fakeCodex([
      line({ type: 'thread.started', thread_id: 't-1' }),
      line({ type: 'turn.started' }),
      line({ type: 'item.completed', item: { id: 'i0', type: 'reasoning', text: 'thinking…' } }),
      line({ type: 'item.started', item: { id: 'i1', type: 'mcp_tool_call', server: 'pennodepaper', tool: 'create_node', arguments: { title: 'The Inn', id: 'inn' }, status: 'in_progress' } }),
      line({ type: 'item.completed', item: { id: 'i1', type: 'mcp_tool_call', server: 'pennodepaper', tool: 'create_node', arguments: { title: 'The Inn', id: 'inn' }, status: 'completed' } }),
      line({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Ich habe das Gasthaus angelegt.' } }),
      line({ type: 'turn.completed', usage: {} }),
    ]);
    await chat.send({ text: 'Lege ein Gasthaus an', backend: 'codex', model: 'gpt-x' });
    const m = finals();
    expect(m.map((x) => [x.role, x.backend])).toEqual([['user', 'codex'], ['tool', 'codex'], ['assistant', 'codex']]);
    expect(m[1].tool).toEqual({ name: 'create_node', summary: 'title: The Inn · id: inn', status: 'ok' });
    expect(m[2].text).toBe('Ich habe das Gasthaus angelegt.');
    expect(system()).toEqual([]);

    const [first] = calls();
    expect(first.args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(first.args).toContain('read-only');
    expect(first.args).toEqual(expect.arrayContaining(['-m', 'gpt-x']));
    expect(first.args).toContain('mcp_servers.pennodepaper.url="http://127.0.0.1:4317/mcp?actor=codex"');
    expect(first.args).toContain('mcp_servers.pennodepaper.bearer_token_env_var="PNP_MCP_TOKEN"');
    expect(first.args.join(' ')).not.toContain('sekret'); // the token is not on the command line…
    expect(first.token).toBe('sekret'); // …but in the environment
    expect(first.stdin).toContain('Lege ein Gasthaus an');
    expect(first.stdin).toContain('co-GM assistant');
    expect(first.args).not.toContain('resume');

    fakeCodex([line({ type: 'thread.started', thread_id: 't-1' }), line({ type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: 'Weiter.' } })]);
    await chat.send({ text: 'und weiter', backend: 'codex' });
    const second = calls()[1];
    second.args = second.args.filter(Boolean); // the stand-in's JSON ends in a placeholder
    expect(second.args.slice(-2)).toEqual(['resume', 't-1']);
  });

  it('a failed tool call is marked and a failed turn is reported once, in Codex\'s words', async () => {
    fakeCodex([
      line({ type: 'thread.started', thread_id: 't-2' }),
      line({ type: 'item.started', item: { id: 'i1', type: 'mcp_tool_call', server: 'pennodepaper', tool: 'link', arguments: { from: 'a', to: 'b' }, status: 'in_progress' } }),
      line({ type: 'item.completed', item: { id: 'i1', type: 'mcp_tool_call', server: 'pennodepaper', tool: 'link', arguments: {}, status: 'failed', error: { message: 'Node "b" not found' } } }),
      line({ type: 'error', message: 'You exceeded your current quota.' }),
      line({ type: 'turn.failed', error: { message: 'You exceeded your current quota.' } }),
    ], 1, 'ERROR: You exceeded your current quota.');
    await chat.send({ text: 'x', backend: 'codex' });
    const tool = finals().find((x) => x.role === 'tool')!;
    expect(tool.tool?.status).toBe('error');
    expect(tool.text).toBe('Node "b" not found');
    expect(system()).toEqual(['Codex: You exceeded your current quota.']);
  });

  it('hands over the settings the installed Codex version understands', async () => {
    fakeCodex([line({ type: 'thread.started', thread_id: 't-3' })]);
    await chat.send({ text: 'x', backend: 'codex' });
    const modern = calls()[0].args.filter((a) => a.startsWith('mcp_servers.') || a.startsWith('experimental_'));
    expect(modern).toContain('mcp_servers.pennodepaper.default_tools_approval_mode="approve"');
    expect(modern.some((a) => a.startsWith('mcp_servers.pennodepaper.tools={') && a.includes('"get_graph"={approval_mode="approve"}'))).toBe(true);
    expect(modern).not.toContain('experimental_use_rmcp_client=true'); // gone in this Codex: it would only warn

    version = [0, 60, 0];
    fakeCodex([line({ type: 'thread.started', thread_id: 't-4' })]);
    await chat.send({ text: 'y', backend: 'codex' });
    const old = calls()[1].args.filter((a) => a.startsWith('mcp_servers.') || a.startsWith('experimental_'));
    expect(old).toContain('experimental_use_rmcp_client=true');
    expect(old.some((a) => /approval_mode|\.tools=/.test(a))).toBe(false); // it would refuse keys it does not know
  });

  it('explains it when Codex still stops a tool for an approval nobody can give', async () => {
    fakeCodex([
      line({ type: 'thread.started', thread_id: 't-5' }),
      line({ type: 'item.started', item: { id: 'i1', type: 'mcp_tool_call', server: 'pennodepaper', tool: 'get_graph', arguments: {}, status: 'in_progress' } }),
      line({ type: 'item.completed', item: { id: 'i1', type: 'mcp_tool_call', server: 'pennodepaper', tool: 'get_graph', arguments: {}, status: 'failed', error: { message: 'MCP tool call requires approval, but approval policy is never' } } }),
      line({ type: 'item.started', item: { id: 'i2', type: 'mcp_tool_call', server: 'pennodepaper', tool: 'list_nodes', arguments: {}, status: 'in_progress' } }),
      line({ type: 'item.completed', item: { id: 'i2', type: 'mcp_tool_call', server: 'pennodepaper', tool: 'list_nodes', arguments: {}, status: 'failed', error: { message: 'MCP tool call requires approval, but approval policy is never' } } }),
    ]);
    await chat.send({ text: 'x', backend: 'codex' });
    expect(system()).toHaveLength(1); // once per request, not once per blocked call
    expect(system()[0]).toMatch(/^Codex 0\.160\.0 stopped a campaign tool/);
    expect(system()[0]).toMatch(/npm i -g @openai\/codex/);
  });

  it('says what is wrong when codex is not installed', async () => {
    fs.rmSync(path.join(dir, 'bin', 'codex'), { force: true });
    process.env.PATH = path.join(dir, 'bin'); // nothing else on it
    await chat.send({ text: 'x', backend: 'codex' });
    expect(system()[0]).toMatch(/Could not start "codex"/);
  });
});
