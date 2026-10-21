import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { actorFromClient, cleanClientName, type Actor } from '@pnp/shared';
import { aiCommands, runCommand } from './commands.js';
import type { Store } from './store.js';

const INSTRUCTIONS = `PenNodePaper: a node-based story & world builder for pen-and-paper GMs.
The campaign is a graph. Nodes live either on a canvas (placed in the story) or in the sidebar POOL (prepared, but no fixed place yet — e.g. a tavern scene that may happen whenever the players go there).
Call get_graph first to see the current state. Every tool call is animated live in the GM's UI, and each call (or batch) is one undo step, so prefer several small, clear actions over silent bulk rewrites.
A campaign can have several canvases (acts, chapters, side quests): get_active_canvas tells you which one the GM is looking at (new things land there when you give no canvas), create_canvas / rename_canvas / delete_canvas manage them, link also works between nodes on different canvases (shown to the GM as a jump marker on each side; get_graph flags those edges with crossCanvas), show_canvas moves the GM's view. To lead from one canvas into another (next act, side quest), just link the two nodes: no doorway node is needed.
A scene's music and sound effects belong on the node: set_node_sounds stores them (trackIds from list_vtt_tracks), play_node plays them and can hand out the node at the same time — do not invent a custom field for sounds.
Use 'batch' for compound edits. Give newly created nodes an explicit id when later steps in the same batch must reference them.`;

function buildServer(store: Store, actor: Actor): McpServer {
  const server = new McpServer({ name: 'pennodepaper', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  for (const c of aiCommands()) {
    server.registerTool(
      c.name,
      {
        description: c.description,
        inputSchema: c.shape,
        // honest hints for clients that gate tool calls on them (Codex does): reads are read-only, every change is one undo step
        annotations: { readOnlyHint: c.readOnly === true, destructiveHint: false, openWorldHint: c.async === true },
      },
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

// ---------------------------------------------------------------------------
// Who is calling? The apps this one runs itself say so in the URL (?actor=claude|agy|codex). Any other MCP client
// (opencode, Cursor, …) is recognised by the name it gives in the handshake. The endpoint is stateless, so that name
// travels in the session id we hand back on `initialize`: every client sends it with its next requests.
// ---------------------------------------------------------------------------

const SESSION = /^pnp\.([A-Za-z0-9_-]+)\.[0-9a-f]+$/;
const BUILTIN = new Set(['claude', 'agy', 'codex']);

const sessionIdFor = (client: string) => `pnp.${Buffer.from(client).toString('base64url')}.${randomBytes(6).toString('hex')}`;

/** The client name given in an `initialize` request, or carried by the session id we issued for it. */
function clientNameOf(body: unknown, sessionId: string | undefined): string {
  const b = body as { method?: unknown; params?: { clientInfo?: { name?: unknown } } } | null;
  if (b && !Array.isArray(b) && b.method === 'initialize') return cleanClientName(b.params?.clientInfo?.name);
  const m = SESSION.exec(sessionId ?? '');
  return m ? cleanClientName(Buffer.from(m[1], 'base64url').toString('utf8')) : '';
}

export interface McpIdentity {
  actor: Actor;
  /** the actor came from the client's own name: tell the client a session id that remembers it */
  remember?: string;
}

/**
 * `?actor=` is the deliberate choice of whoever set the URL up (the app itself, or a label typed by hand) and wins.
 * One exception: `?actor=claude` is what the setup docs used to show for any outside client, and Claude's own client
 * calls itself "claude-code" — so another client behind that URL (opencode) is shown under its own name.
 */
export function mcpIdentity(param: string | null, body: unknown, sessionId?: string): McpIdentity {
  const client = clientNameOf(body, sessionId);
  const wanted = (param ?? '').trim().toLowerCase();
  if (BUILTIN.has(wanted) && !(wanted === 'claude' && client && !/claude|anthropic/i.test(client))) return { actor: wanted as Actor };
  const label = BUILTIN.has(wanted) || wanted === 'user' || wanted === 'system' ? '' : cleanClientName(param);
  if (label) return { actor: `ext:${label}` };
  const actor = actorFromClient(client) ?? ('ext:External AI' as Actor);
  return { actor, ...(client ? { remember: client } : {}) };
}

/** Stateless streamable-HTTP MCP endpoint (one server+transport per request). */
export async function handleMcp(store: Store, req: IncomingMessage, res: ServerResponse, id: McpIdentity, body: unknown) {
  const server = buildServer(store, id.actor);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  if (id.remember && (body as { method?: unknown } | null)?.method === 'initialize') res.setHeader('Mcp-Session-Id', sessionIdFor(id.remember));
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
