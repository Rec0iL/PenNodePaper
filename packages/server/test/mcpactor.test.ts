import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { actorColor, actorName, isAiActor } from '@pnp/shared';
import { handleMcp, mcpIdentity } from '../src/mcp.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

const init = (name: string) => ({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name, version: '1' } } });

describe('who is calling', () => {
  it('?actor= of the apps this one runs is taken as it is', () => {
    expect(mcpIdentity('agy', init('whatever')).actor).toBe('agy');
    expect(mcpIdentity('codex', init('codex-mcp-client')).actor).toBe('codex');
    expect(mcpIdentity('claude', init('claude-code')).actor).toBe('claude');
    expect(mcpIdentity('claude', init('claude-code')).remember).toBeUndefined(); // nothing changes for the integrated runs
  });

  it('another client behind the documented ?actor=claude URL is shown under its own name', () => {
    expect(mcpIdentity('claude', init('opencode'))).toMatchObject({ actor: 'ext:opencode', remember: 'opencode' });
  });

  it('a plain URL: the client name decides; unknown stays "External AI"; nobody can claim to be the GM', () => {
    expect(mcpIdentity(null, init('opencode')).actor).toBe('ext:opencode');
    expect(mcpIdentity(null, init('Claude Code')).actor).toBe('claude');
    expect(mcpIdentity(null, init('codex-mcp-client')).actor).toBe('codex');
    expect(mcpIdentity(null, { jsonrpc: '2.0', id: 1, method: 'tools/call' }).actor).toBe('ext:External AI');
    expect(mcpIdentity('user', init('opencode')).actor).toBe('ext:opencode');
    expect(mcpIdentity('system', null).actor).toBe('ext:External AI');
    expect(mcpIdentity(null, init('<script>x</script> Cursor!')).actor).toBe('ext:scriptxscript Cursor');
    for (const a of ['ext:opencode', 'claude', 'agy', 'codex'] as const) expect(isAiActor(a)).toBe(true);
    expect(isAiActor('user') || isAiActor('system')).toBe(false);
  });

  it('a hand-made label in the URL is used as the name', () => {
    expect(mcpIdentity('Cursor', init('mcp-client')).actor).toBe('ext:Cursor');
  });

  it('names and colours', () => {
    expect(actorName('ext:opencode')).toBe('opencode');
    expect(actorName('codex')).toBe('Codex');
    expect(actorColor('ext:opencode')).toBe(actorColor('ext:opencode'));
    expect(actorColor('codex')).toBe('var(--codex)');
  });
});

describe('over HTTP, with the real MCP client', () => {
  let dir: string;
  let store: Store;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-mcpactor-'));
    store = new Store(new Persistence(dir));
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      await handleMcp(store, req, res, mcpIdentity(url.searchParams.get('actor'), body, req.headers['mcp-session-id'] as string | undefined), body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function createAs(clientName: string, query: string) {
    const client = new Client({ name: clientName, version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(base + query)));
    await client.callTool({ name: 'create_node', arguments: { id: `n-${clientName}`, type: 'scene', title: `By ${clientName}`, place: 'pool' } });
    await client.close();
    return store.history.filter((b) => b.events.some((e) => e.type === 'node.created' && e.node.id === `n-${clientName}`)).at(-1);
  }

  it('an outside client is recorded under its own name even with the claude URL', async () => {
    expect((await createAs('opencode', '?actor=claude'))?.actor).toBe('ext:opencode');
    expect((await createAs('cursor', ''))?.actor).toBe('ext:cursor');
  });

  it('the apps the app runs keep their own identity', async () => {
    expect((await createAs('claude-code', '?actor=claude'))?.actor).toBe('claude');
    expect((await createAs('some-agy-client', '?actor=agy'))?.actor).toBe('agy');
    expect((await createAs('codex-mcp-client', '?actor=codex'))?.actor).toBe('codex');
  });
});
