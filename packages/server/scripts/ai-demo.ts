// A scripted "AI session", paced slowly so you can watch the animations:
//   npm run ai-demo -w @pnp/server
// It talks to the running server through the real MCP endpoint, exactly like Claude/agy would.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const port = process.env.PNP_PORT ?? '4317';
const actor = process.env.ACTOR ?? 'claude';
const cfgPath = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'pennodepaper', 'config.json');
const token = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).token as string;
const pause = Number(process.env.PAUSE ?? 3500);

const client = new Client({ name: 'ai-demo', version: '0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp?actor=${actor}`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);
const call = async (name: string, args: Record<string, unknown> = {}) => {
  console.log(`> ${name} ${JSON.stringify(args).slice(0, 110)}`);
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const text = r.content?.[0]?.text ?? '';
  if (r.isError) throw new Error(`${name}: ${text}`);
  await new Promise((res) => setTimeout(res, pause));
  return JSON.parse(text);
};

// 1. the tavern leaves the pool and lands in the story
await call('place_on_canvas', { id: 'rusty-anchor', nearNodeId: 'arrival' });
// 2. wire it in
const { edgeId } = await call('link', { from: 'arrival', to: 'rusty-anchor', kind: 'conditional', label: 'if they want a drink' });
// 3. new content appears
await call('create_node', { type: 'npc', title: 'Brenn the barkeep', summary: 'Knows the cult by their coin: black pennies.', fields: { tier: 'elite' }, place: 'canvas', nearNodeId: 'rusty-anchor', linkFrom: 'rusty-anchor', linkKind: 'belongs-to' });
// 4. an edit (watch the inspector flash)
await call('update_node', { id: 'missing-ledger', summary: 'The ledger is hidden in the tavern, behind the fireplace.', status: 'active' });
// 5. re-link: the edge end slides to a new target
await call('relink', { edgeId, to: 'smugglers-cove' });
// 6. delete + pool
await call('delete_node', { id: 'harbour-master' });
await call('move_to_pool', { id: 'rusty-anchor' });
await client.close();
console.log('done');
