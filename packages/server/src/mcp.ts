import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Actor } from '@pnp/shared';
import { aiCommands, runCommand } from './commands.js';
import type { Store } from './store.js';

const INSTRUCTIONS = `PenNodePaper: a node-based story & world builder for pen-and-paper GMs.
The campaign is a graph. Nodes live either on a canvas (placed in the story) or in the sidebar POOL (prepared, but no fixed place yet — e.g. a tavern scene that may happen whenever the players go there).
Call get_graph first to see the current state. Every tool call is animated live in the GM's UI, and each call (or batch) is one undo step, so prefer several small, clear actions over silent bulk rewrites.
A campaign can have several canvases (acts, chapters, side quests): get_active_canvas tells you which one the GM is looking at (new things land there when you give no canvas), create_canvas / rename_canvas / delete_canvas manage them, link also works between nodes on different canvases (shown to the GM as a jump marker on each side; get_graph flags those edges with crossCanvas), create_portal puts a doorway node on one canvas that leads to another (the story flow continues through it), show_canvas moves the GM's view.
A scene's music and sound effects belong on the node: set_node_sounds stores them (trackIds from list_vtt_tracks), play_node plays them and can hand out the node at the same time — do not invent a custom field for sounds.
Use 'batch' for compound edits. Give newly created nodes an explicit id when later steps in the same batch must reference them.`;

function buildServer(store: Store, actor: Actor): McpServer {
  const server = new McpServer({ name: 'pennodepaper', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  for (const c of aiCommands()) {
    server.registerTool(
      c.name,
      { description: c.description, inputSchema: c.shape },
      async (args: Record<string, unknown>) => {
        try {
          const result = await runCommand(store, c.name, args, actor);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? { ok: true }) }] };
        } catch (err) {
          return { isError: true, content: [{ type: 'text' as const, text: err instanceof Error ? err.message : String(err) }] };
        }
      },
    );
  }
  return server;
}

/** Stateless streamable-HTTP MCP endpoint (one server+transport per request). */
export async function handleMcp(store: Store, req: IncomingMessage, res: ServerResponse, actor: Actor, body: unknown) {
  const server = buildServer(store, actor);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
