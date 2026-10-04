// Smoke test: talk to a RUNNING server like Claude/agy would (real MCP client), and
// watch the same change events the UI receives over the websocket.
//   npm run smoke -w @pnp/server
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocket } from 'ws';

const port = process.env.PNP_PORT ?? '4317';
const cfgPath = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'pennodepaper', 'config.json');
const token = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).token as string;

const seen: string[] = [];
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
await new Promise((r) => ws.once('open', r));
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t === 'batch') seen.push(`${m.batch.actor}: ${m.batch.label} -> [${m.batch.events.map((e: any) => e.type).join(', ')}]`);
});

const client = new Client({ name: 'smoke', version: '0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp?actor=claude`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);
const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as any;
  const text = r.content?.[0]?.text ?? '';
  if (r.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
};

const g = await call('get_graph');
console.log(`graph: ${g.nodes.length} nodes (${g.nodes.filter((n: any) => n.where === 'pool').length} in pool), ${g.edges.length} edges`);

// the headline scenario: bring a pool node onto the canvas and wire it in
await call('place_on_canvas', { id: 'rusty-anchor', nearNodeId: 'arrival' });
const { edgeId } = await call('link', { from: 'arrival', to: 'rusty-anchor', kind: 'conditional', label: 'if they want a drink' });
await call('relink', { edgeId, to: 'smugglers-cove' });
await call('update_node', { id: 'rusty-anchor', status: 'active', fields: { barkeep: 'Brenn' } });
await call('move_to_pool', { id: 'rusty-anchor' });
await call('unlink', { edgeId });

await new Promise((r) => setTimeout(r, 300));
console.log('\nevents seen by the UI websocket:');
for (const s of seen) console.log('  ' + s);
await client.close();
ws.close();
