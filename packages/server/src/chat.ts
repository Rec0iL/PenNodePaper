import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AiCreativity, Backend, ChatMsg, ChatStatus } from '@pnp/shared';
import { partyDigest } from './party.js';
import type { Store } from './store.js';

// ---------------------------------------------------------------------------
// Integrated chat: runs the Claude Code / agy CLI headless, attached to this
// app's own MCP server, and turns their stream-json output into chat messages
// and tool-call cards. One long-lived AI session per backend per campaign;
// per-node threads reuse it with the node pinned as context.
// ---------------------------------------------------------------------------

const MCP_NAME = 'pennodepaper';

interface ChatFile {
  sessions: { claude?: string; agy?: string };
  messages: ChatMsg[];
}

export interface ChatDeps {
  store: Store;
  port: number;
  token: string;
  campaignDir: string;
  broadcast: (m: { t: 'chat'; msg: ChatMsg } | { t: 'chat.status'; status: ChatStatus }) => void;
}

const uid = () => randomBytes(5).toString('hex');

export function knowledgeBlock(store: Store): string {
  const out: string[] = [];
  const books = store.rulebooks.list();
  if (books.length) {
    out.push(`Rulebooks loaded: ${books.map((b) => `${b.name} (${b.sections} sections)`).join(', ')}. Consult them with search_rules / get_section / list_chapters before inventing mechanics, and cite section ids.`);
    const d = store.rulebooks.digest;
    if (d) out.push(`Core rules digest:\n${d.slice(0, 6000)}`);
  }
  const party = partyDigest(store);
  if (party) out.push(`The player characters (synced from the VTT; plan encounters, hooks and handouts around them, and never reveal one player's private information to another):\n${party}`);
  const worlds = store.world.list();
  if (worlds.length) {
    const lines = worlds.map((b) => {
      const outline = store.world.outline(b.name, { depth: 2, maxChars: 600 });
      const sum = store.world.summary(b.name);
      return `- "${b.name}" (${b.sections} sections, ${b.chars} chars): ${sum || '(no summary yet)'}${outline ? `\n${outline.replace(/^/gm, '    ')}` : ''}`;
    });
    out.push(`World books (stable worldbuilding documents in the Library — you only see this compact digest; search_world / get_world_section give the details, and you must recall established facts before inventing new ones):\n${lines.join('\n').slice(0, 5000)}`);
  }
  return out.join('\n\n');
}

const IDEA_RULES = `Ideas are only SUGGESTIONS: never build them unasked. Phrase each as one short, concrete line the GM can accept with a plain "yes" / "sure, go ahead" (several: numbered, so "yes 1 and 3" or "all" works). When the GM then accepts, build exactly the idea(s) accepted from your previous message — do not ask again.`;

/** How much the AI adds on its own initiative — the GM's "creativity" slider (1-5). Level 3 is the baseline behaviour and adds nothing. */
export function creativityBlock(level: AiCreativity | undefined): string {
  switch (level) {
    case 1:
      return `Creativity: LOW (strict). Do exactly what the GM asked and nothing more — no extra nodes, edges, links, fields, rewrites or embellishments. Where the request leaves room, take the plainest, most minimal reading. Do not offer ideas or suggestions either; confirm what you did in a line or two.`;
    case 2:
      return `Creativity: LOW with one idea. Do exactly what the GM asked and nothing more — no extra nodes, edges, links or embellishments in the campaign. Then end your final chat message with ONE creative idea that would improve or extend what you just did, on its own line starting with "💡". ${IDEA_RULES}`;
    case 4:
      return `Creativity: MEDIUM with ideas. Work as usual: fill in sensible detail and small supporting pieces where the task needs them. Then end your final chat message with 2-4 further creative ideas (twists, hooks, complications, connections to existing nodes or world books), one numbered line each starting with "💡". ${IDEA_RULES}`;
    case 5:
      return `Creativity: HIGH. Take real initiative as a co-author. Besides what was asked, add what the story would plainly benefit from: supporting nodes (a rival, a witness, a location, a secret), a complication or twist, foreshadowing clues placed earlier on the canvas, and links tying it into existing nodes and the world books. Make bold, specific choices rather than generic ones. Rules: additions only — never delete, overwrite or rewrite anything the GM wrote, never contradict established facts or the rules; keep extras clearly smaller than the requested core. In your final chat message, list what you added beyond the request (so the GM can reject it), then pitch 1-3 bolder ideas you did NOT build, each one numbered line starting with "💡". ${IDEA_RULES}`;
    default:
      return '';
  }
}

function systemPrompt(store: Store): string {
  const lang = store.state.meta.language;
  const knowledge = knowledgeBlock(store);
  return [
    `You are the co-GM assistant inside PenNodePaper, a node-based story & world builder for pen-and-paper game masters. The campaign "${store.state.meta.name}" is a graph of typed nodes (scenes, encounters, NPCs, locations, clues, handouts, …) joined by typed edges.`,
    `Nodes are either placed on a canvas (a fixed place in the story) or live in the sidebar POOL (prepared, but with no fixed place yet — e.g. a tavern the players may visit at any time).`,
    `You change the campaign ONLY through the "${MCP_NAME}" MCP tools; every call is animated live in the GM's UI and is undoable. Call get_graph first when you need the current state. Prefer several small, clear actions. Use "batch" for compound edits and give new nodes an explicit id so later steps can reference them.`,
    `The GM may have switched on review mode: your changes still apply immediately as usual and the GM accepts or rejects them after you finish, so work normally and finish a task in one go instead of stopping to ask. Write campaign content (titles, summaries, read-aloud text) in the language "${lang}" unless asked otherwise. Keep your chat replies short — the work should be visible on the canvas, not buried in prose. Put GM-facing detail in node bodies and player-facing text in readAloud.`,
    ...(creativityBlock(store.state.meta.aiCreativity) ? [creativityBlock(store.state.meta.aiCreativity)] : []),
    `Never delete things the GM did not ask you to delete. Moving a node to the pool is safer than deleting it.`,
    `Images: generate_image makes art with a local ComfyUI (Krea 2). Write prompts as natural-language prose — subject, setting, composition, lighting, mood — never tag lists or "masterpiece"; the campaign style is appended automatically. Use kind portrait for characters, scene for places, item for objects, handout for documents. Only generate when the GM asks, and offer 2-3 variants for important characters.`,
    `Running the session: when the GM tells you what happened at the table, record it — to move the players use move_players (which characters go where; the party can split, see get_party) or, with no player characters known, mark_played (a prepared POOL node that they visit is placed and linked automatically; use after to say where they came from); set_here when they are at several nodes at once (never invent a group name for that — groups are only for a party that really splits); set_status only marks a node active/done/skipped/untouched WITHOUT moving anyone ("the bell event is running" is active, not "the players are there"); set_known when they learn a clue, advance_clock for ticking threats. When they went off-script ("how do we get back on track?", "what did they miss?"): call story_status first and reason from it — frontier nodes with converges:true are natural merge points, skippedPast/untaken are what they bypassed, unrevealed is what they don't know (never spoil it). On a big canvas group nodes into labelled areas with create_frame (an act, a district). Fix gaps with small bridge nodes (create_node + a "bridge" edge) or by giving a missed clue a second route; never rewrite what already happened. For a recap or "what do the players know?": call player_wiki and write ONLY from it (it holds nothing the players have not experienced); export_player_wiki / push_player_wiki can hand your text to the players. lint_story finds structural problems — run it before a session or after big edits.`,
    `Image style: when the GM asks you to derive or adjust the campaign's visual style, read the world books (list_world_chapters, search_world, get_world_section), then save it with set_image_style — suffix (25-50 words: medium, palette, lighting, mood, typical materials/architecture/costume; no names or plot), negative (what would break the setting), mapSuffix (painted map look, always top-down).`,
    `Maps: a map is an attachment of a LOCATION node — create_map with nodeId gives an existing location its map (it keeps its images, so a location can have both illustrations and a tactical map); without nodeId it creates a new location for it. Battle maps are grid floor plans — build them with edit_map ops (room, corridor, door, prop, label, token; walls derive automatically; 1 cell = 6 ft by default; use get_map to see the rows before editing and keep rooms connected with doors; to shift a room or furniture group use move_area, to change one prop/token/label use edit_prop / edit_token / edit_label — do not redraw). Region maps use vector shapes. render_map paints a map with the image model: describe the look (materials, mood), not the layout. The GM chooses in Settings how battle maps are painted (get_map shows paintMode): quick = one pass; precise = two steps that take a while (minutes, depending on the GM's computer) — render_map paints only the EMPTY terrain, the GM judges it in the map editor and picks one (or has it painted again), and only after that does paint_map_props paint every prop group into its place (touching props of one kind are one object; a row of tables is one long table); the GM then accepts that result or has it painted again. In precise mode never call paint_map_props before the GM has accepted a terrain, and tell the GM that it takes a while. accept_map_terrain makes a terrain the finished picture (maps without props).`,
    `World books are stable reference documents, not canvas nodes. Only write or extend one (write_world) when the GM asks; always give it a dense 300-600 character summary.`,
    ...(knowledge ? [knowledge] : []),
  ].join('\n');
}

export class Chat {
  private file: string;
  private data: ChatFile;
  private child: ChildProcess | null = null;
  status: ChatStatus = { busy: false };

  constructor(private deps: ChatDeps) {
    this.file = path.join(deps.campaignDir, 'chat.json');
    this.data = { sessions: {}, messages: [] };
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch { /* fresh */ }
  }

  get messages() {
    return this.data.messages;
  }

  private save() {
    this.data.messages = this.data.messages.slice(-400);
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  private push(msg: Omit<ChatMsg, 'id' | 'at'> & Partial<Pick<ChatMsg, 'id'>>): ChatMsg {
    const m: ChatMsg = { id: msg.id ?? uid(), at: new Date().toISOString(), ...msg };
    this.data.messages.push(m);
    this.deps.broadcast({ t: 'chat', msg: m });
    return m;
  }

  private update(m: ChatMsg) {
    this.deps.broadcast({ t: 'chat', msg: m });
  }

  private setStatus(s: ChatStatus) {
    this.status = s;
    this.deps.broadcast({ t: 'chat.status', status: s });
  }

  cancel() {
    this.child?.kill('SIGTERM');
  }

  clear() {
    this.cancel();
    this.data = { sessions: {}, messages: [] };
    this.save();
  }

  /** Compose what the model sees: the GM's text plus pinned/selected context. */
  private buildPrompt(text: string, nodeId?: string, pins: string[] = []): string {
    const s = this.deps.store.state;
    const ids = [...new Set([...(nodeId ? [nodeId] : []), ...pins])].filter((id) => s.nodes[id] && !s.nodes[id].trashed);
    if (!ids.length) return text;
    const ctx = ids.map((id) => {
      const n = s.nodes[id];
      const p = s.graph.placements[id];
      return `- ${n.type} "${n.title}" (id: ${id}, ${p ? `on canvas "${p.canvas}"` : 'in the pool'}, status: ${n.status})`;
    });
    return `${nodeId ? `[Per-node thread — focus on node ${nodeId}]\n` : ''}Context — the GM is looking at:\n${ctx.join('\n')}\n\n${text}`;
  }

  async send(opts: { text: string; backend: Backend; model?: string; nodeId?: string; pins?: string[] }) {
    if (this.status.busy) throw new Error('The AI is still working — wait for it or cancel.');
    const { text, backend, nodeId } = opts;
    this.push({ role: 'user', backend, text, nodeId });
    this.setStatus({ busy: true, backend, nodeId });
    this.save();
    this.deps.store.beginTurn(text);
    const prompt = this.buildPrompt(text, nodeId, opts.pins);
    try {
      if (backend === 'claude') await this.runClaude(prompt, opts.model, nodeId);
      else await this.runAgy(prompt, opts.model, nodeId);
    } catch (err) {
      this.push({ role: 'system', backend, text: err instanceof Error ? err.message : String(err), nodeId });
    } finally {
      this.child = null;
      this.deps.store.endTurn();
      this.setStatus({ busy: false });
      this.save();
    }
  }

  // ------------------------------- Claude ------------------------------------

  private runClaude(prompt: string, model: string | undefined, nodeId?: string): Promise<void> {
    const { port, token, campaignDir, store } = this.deps;
    const mcp = JSON.stringify({
      mcpServers: { [MCP_NAME]: { type: 'http', url: `http://127.0.0.1:${port}/mcp?actor=claude`, headers: { Authorization: `Bearer ${token}` } } },
    });
    const args = [
      '-p', prompt,
      '--output-format', 'stream-json', '--verbose',
      '--mcp-config', mcp, '--strict-mcp-config',
      '--allowedTools', `mcp__${MCP_NAME}`,
      '--tools', '',
      '--append-system-prompt', systemPrompt(store),
    ];
    if (model) args.push('--model', model);
    if (this.data.sessions.claude) args.push('--resume', this.data.sessions.claude);

    const open = new Map<string, ChatMsg>(); // tool_use_id -> card
    return this.spawnLines('claude', args, campaignDir, (ev) => {
      const e = ev as Record<string, any>;
      if (e.type === 'system' && e.subtype === 'init' && e.session_id) this.data.sessions.claude = e.session_id;
      else if (e.type === 'assistant') {
        for (const c of e.message?.content ?? []) {
          if (c.type === 'text' && c.text?.trim()) this.push({ role: 'assistant', backend: 'claude', text: c.text.trim(), nodeId });
          else if (c.type === 'tool_use') {
            const card = this.push({ role: 'tool', backend: 'claude', text: '', nodeId, tool: { name: shortTool(c.name), summary: summarizeArgs(c.input), status: 'running' } });
            open.set(c.id, card);
          }
        }
      } else if (e.type === 'user') {
        for (const c of e.message?.content ?? []) {
          if (c.type === 'tool_result') {
            const card = open.get(c.tool_use_id);
            if (card?.tool) {
              card.tool.status = c.is_error ? 'error' : 'ok';
              if (c.is_error) card.text = textOf(c.content);
              this.update(card);
            }
          }
        }
      } else if (e.type === 'result') {
        if (e.session_id) this.data.sessions.claude = e.session_id;
        if (e.is_error && e.result) this.push({ role: 'system', backend: 'claude', text: String(e.result), nodeId });
      }
    });
  }

  // -------------------------------- agy --------------------------------------

  private runAgy(prompt: string, model: string | undefined, nodeId?: string): Promise<void> {
    const { campaignDir, store } = this.deps;
    const agyNote = [
      `Tooling notes for agy: the campaign tools are on the MCP server "${MCP_NAME}", called through call_mcp_tool. Shell commands are NOT available to you here. If a tool result says "The output was large and was saved to: <file>", read that file with the view_file tool (never run a shell command or script to parse it), then continue.`,
      `Prefer targeted calls (search_nodes, get_node) over get_graph once you know what you need.`,
    ].join('\n');
    const args = ['-p', `${systemPrompt(store)}\n${agyNote}\n\n---\n\n${prompt}`, '--output-format', 'stream-json'];
    if (model) args.push('--model', model);
    if (this.data.sessions.agy) args.push('--conversation', this.data.sessions.agy);

    const live = new Map<number, ChatMsg>(); // step_index -> message
    return this.spawnLines('agy', args, campaignDir, (ev) => {
      const e = ev as Record<string, any>;
      if (e.event === 'init' && e.conversation_id) this.data.sessions.agy = e.conversation_id;
      else if (e.event === 'step_update') {
        const u = e.step_update;
        if (u.conversation_id) this.data.sessions.agy = u.conversation_id;
        if (u.step_type === 'user_input') return;
        if (u.step_type === 'agent_response') {
          let m = live.get(u.step_index);
          if (!m) {
            m = this.push({ role: 'assistant', backend: 'agy', text: '', nodeId, streaming: true });
            live.set(u.step_index, m);
          }
          if (u.text_delta) m.text += u.text_delta;
          if (u.state === 'DONE') m.streaming = false;
          this.update(m);
        } else {
          // tool/action step. MCP calls arrive as call_mcp_tool {ServerName, ToolName, Arguments}.
          const p = (u.tool_info?.parameters ?? {}) as Record<string, any>;
          let name = String(u.tool_name ?? u.step_type);
          let summary = '';
          if (name === 'call_mcp_tool') {
            name = p.ServerName && p.ServerName !== MCP_NAME ? `${p.ServerName}/${p.ToolName}` : String(p.ToolName ?? name);
            summary = summarizeArgs(p.Arguments);
          } else {
            if (name === 'view_file' && String(p.AbsolutePath ?? '').includes(`/mcp/${MCP_NAME}/`)) return; // schema lookup: noise
            summary = String(p.AbsolutePath ?? p.CommandLine ?? p.Url ?? '').slice(0, 80);
          }
          let m = live.get(u.step_index);
          if (!m) {
            m = this.push({ role: 'tool', backend: 'agy', text: '', nodeId, tool: { name: shortTool(name), summary, status: 'running' } });
            live.set(u.step_index, m);
          }
          if (m.tool) {
            if (u.state === 'DONE') m.tool.status = 'ok';
            else if (u.state === 'ERROR' || u.state === 'FAILED') m.tool.status = 'error';
          }
          this.update(m);
        }
      } else if (e.event === 'result') {
        const r = e.result ?? {};
        if (r.conversation_id) this.data.sessions.agy = r.conversation_id;
        if (r.status && r.status !== 'SUCCESS') this.push({ role: 'system', backend: 'agy', text: `agy finished with status ${r.status}`, nodeId });
        const denied = (r.denied_actions ?? []) as { action: string; display_name?: string }[];
        if (denied.length) {
          const kinds = [...new Set(denied.map((d) => d.action))];
          this.push({
            role: 'system', backend: 'agy', nodeId,
            text: kinds.includes('mcp')
              ? `agy blocked the campaign tools (headless mode can't ask for permission). Click "Connect agy" in the AI tab to add the allow-rule mcp(${MCP_NAME}/*).`
              : `agy tried to use ${kinds.join(', ')} but headless mode can't ask for permission, so it was skipped.`,
          });
        }
        for (const m of live.values()) if (m.streaming) { m.streaming = false; this.update(m); }
      }
    });
  }

  // ------------------------------- plumbing ----------------------------------

  private spawnLines(bin: string, args: string[], cwd: string, onEvent: (ev: unknown) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      this.child = child;
      let buf = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60_000);
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString('utf8');
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            onEvent(JSON.parse(line));
          } catch (err) {
            if (!(err instanceof SyntaxError)) console.error(`[chat:${bin}]`, err);
          }
        }
      });
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Could not start "${bin}": ${err.message}`));
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (signal) return resolve(); // cancelled
        if (code !== 0) reject(new Error(`${bin} exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-400)}` : ''}`));
        else resolve();
      });
    });
  }
}

const shortTool = (n: string) => n.replace(`mcp__${MCP_NAME}__`, '').replace(new RegExp(`^${MCP_NAME}[:._]`), '');

function textOf(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text) : '')).join('');
  return '';
}

function summarizeArgs(a: unknown): string {
  if (!a || typeof a !== 'object') return '';
  const o = a as Record<string, unknown>;
  if (Array.isArray(o.ops)) return `${o.ops.length} operations`;
  const pick = ['title', 'id', 'from', 'to', 'edgeId', 'targetId', 'name'].filter((k) => typeof o[k] === 'string');
  return pick.map((k) => `${k}: ${String(o[k]).slice(0, 40)}`).join(' · ');
}

export interface Models {
  claude: { id: string; label: string }[];
  agy: { id: string; label: string }[];
}

/** Model lists for the chat's model picker. */
export function listModels(): Models {
  const claude = [
    { id: '', label: 'default' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'opus', label: 'Opus' },
    { id: 'haiku', label: 'Haiku' },
  ];
  let agy: Models['agy'] = [{ id: '', label: 'default' }];
  try {
    const r = spawnSync('agy', ['models'], { encoding: 'utf8', timeout: 15000 });
    const rows = r.stdout
      .split('\n')
      .map((l) => l.split('\t'))
      .filter((p) => p.length >= 2 && /^[a-z0-9.\-]+$/.test(p[0]))
      .map((p) => ({ id: p[0], label: p[1].trim() }));
    if (rows.length) agy = [{ id: '', label: 'default' }, ...rows];
  } catch { /* agy not installed */ }
  return { claude, agy };
}
