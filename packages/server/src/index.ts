import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Actor, Backend, CommandResult, ServerMsg } from '@pnp/shared';
import { spawnSync } from 'node:child_process';
import { Chat, listModels } from './chat.js';
import { imageSize, renderSvg } from './maps.js';
import { generateStyle } from './style.js';
import { ImageService } from './images.js';
import { listCommands, runCommand } from './commands.js';
import { CONFIG_PATH, REPO_ROOT, loadConfig, loadMapPaintMode, loadSaved, saveConfig } from './config.js';
import { estimatePaint } from './mappaint.js';
import { importArchive } from './backup.js';
import { thumbnail } from './thumbs.js';
import { extractText } from './imports.js';
import { createCampaign, listCampaigns, looksLikeCampaign, rememberCampaign } from './campaigns.js';
import { handleMcp } from './mcp.js';
import { Persistence } from './persistence.js';
import { seedDemo } from './seed.js';
import { Store } from './store.js';
import { watchCampaign } from './watcher.js';

const cfg = loadConfig();
let mapPaintMode = loadMapPaintMode();
const clients = new Set<WebSocket>();
const send = (ws: WebSocket, msg: ServerMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
const broadcast = (msg: ServerMsg) => {
  for (const ws of clients) send(ws, msg);
};

// The server works on ONE campaign at a time; openCampaign() swaps it (the GM's campaign menu).
let campaignDir = '';
let store!: Store;
let chat!: Chat;
let images!: ImageService;
let stopWatching: () => void = () => {};
let backupTimer: NodeJS.Timeout | undefined;

/** Automatic snapshot, but only when something changed since the last one and the interval has passed. */
function autoSnapshot(s: Store, force = false) {
  try {
    const cfgB = s.backups.config;
    if (!cfgB.auto) return;
    const last = s.backups.list().filter((x) => x.kind !== 'pre-restore')[0];
    const lastAt = last ? new Date(last.createdAt).getTime() : 0;
    if (s.backups.lastChange() <= lastAt) return;
    if (!force && Date.now() - lastAt < Math.max(5, cfgB.everyMinutes) * 60_000) return;
    const info = s.backups.create({ kind: 'auto' });
    console.log(`[backup] ${path.basename(s.persistence.dir)}: ${info.id}`);
  } catch (err) {
    console.warn(`[backup] failed: ${err instanceof Error ? err.message : err}`);
  }
}

function openCampaign(dir: string) {
  clearInterval(backupTimer);
  if (store) autoSnapshot(store, true); // leaving: save the state we leave behind if it changed
  stopWatching();
  store?.vtt.disconnect(); // the VTT reconnects by itself and lands on the new campaign
  campaignDir = path.resolve(dir);
  const isNew = !fs.existsSync(path.join(campaignDir, 'graph.json'));
  const next = new Store(new Persistence(campaignDir));
  if (isNew && path.basename(campaignDir) === 'demo' && !Object.keys(next.state.nodes).length) seedDemo(next);
  store = next;
  stopWatching = watchCampaign(next, (m) => console.log(`[watch] ${m}`));
  chat = new Chat({ store: next, port: cfg.port, token: cfg.token, campaignDir, broadcast });
  images = new ImageService(next, path.join(campaignDir, 'images'), (job) => broadcast({ t: 'image.job', job }), undefined, { mapMode: () => mapPaintMode });
  next.images = images;
  const live = () => store === next; // a campaign that was swapped out must not talk to the UI any more
  next.onMeta(() => live() && broadcast({ t: 'reload', state: next.state }));
  next.vtt.onStatus((status) => live() && broadcast({ t: 'vtt', status }));
  next.onMap((map, actor) => live() && broadcast({ t: 'map', map, actor }));
  next.subscribe((batch) => live() && (broadcast({ t: 'batch', batch, canUndo: next.canUndo, canRedo: next.canRedo }), broadcast({ t: 'proposals', list: next.proposals() })));
  rememberCampaign(campaignDir);
  backupTimer = setInterval(() => live() && autoSnapshot(next), 60_000);
  backupTimer.unref();
  setTimeout(() => live() && autoSnapshot(next), 5000).unref();
}

const explicit = process.env.PNP_CAMPAIGN ? path.join(cfg.campaignsDir, process.env.PNP_CAMPAIGN) : '';
const saved = loadSaved().lastCampaign;
openCampaign(explicit || (saved && fs.existsSync(saved) ? saved : path.join(cfg.campaignsDir, 'demo')));

const ACTORS: Actor[] = ['user', 'claude', 'agy', 'system'];
const asActor = (v: unknown, d: Actor): Actor => (ACTORS.includes(v as Actor) ? (v as Actor) : d);

// --- guard: localhost only, no foreign origins (DNS-rebinding / CSRF) -------
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function originOk(req: http.IncomingMessage): boolean {
  const host = req.headers.host ?? '';
  if (!LOCAL_HOST.test(host)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return LOCAL_HOST.test(new URL(origin).host);
  } catch {
    return false;
  }
}

// --- REST (for the UI) -------------------------------------------------------
const app = new Hono();

app.use('/api/*', async (c, next) => {
  const incoming = (c.env as { incoming?: http.IncomingMessage }).incoming;
  if (incoming && !originOk(incoming)) return c.json({ error: 'forbidden' }, 403);
  await next();
});

const helloMsg = (switched = false): ServerMsg => {
  const s = snapshot();
  return { t: 'hello', state: s.state, history: s.history, canUndo: s.canUndo, canRedo: s.canRedo, chat: chat.messages.slice(-200), chatStatus: chat.status, jobs: images.jobs, vtt: store.vtt.status(), proposals: store.proposals(), ...(switched ? { switched: true } : {}) };
};

// --- the GM's campaign menu: list, open, create ---------------------------------
function switchTo(dir: string): { ok: boolean; error?: string } {
  if (chat.status.busy) return { ok: false, error: 'The AI is still working — wait for it to finish (or stop it) before switching campaigns.' };
  if (images.jobs.some((j) => j.status === 'queued' || j.status === 'running')) return { ok: false, error: 'Images are still being generated — wait for them to finish (or stop the queue) before switching campaigns.' };
  openCampaign(dir);
  for (const ws of clients) send(ws, helloMsg(true));
  return { ok: true };
}

// --- imported notes (md / txt / docx / pdf -> plain text the AI reads in chunks) ------------------
app.get('/api/imports', (c) => c.json(store.imports.list()));
app.post('/api/imports', async (c) => {
  try {
    const name = String(c.req.query('name') ?? 'notes');
    const type = c.req.header('content-type') ?? '';
    const text = type.includes('json')
      ? String(((await c.req.json()) as { text?: string }).text ?? '')
      : extractText(Buffer.from(await c.req.arrayBuffer()), name);
    if (text.length > 4_000_000) return c.json({ ok: false, error: 'Too much text (4 MB max).' }, 413);
    return c.json({ ok: true, ...store.imports.save(name, text) });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
});
app.delete('/api/imports/:name', (c) => {
  store.imports.remove(c.req.param('name'));
  return c.json({ ok: true });
});

// --- backup & sync ---------------------------------------------------------------------
const backupState = () => ({
  settings: store.backups.config,
  snapshots: store.backups.list(),
  git: store.backups.gitInfo(),
  folder: campaignDir,
  lastChange: new Date(store.backups.lastChange()).toISOString(),
});
const failure = (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) });

app.get('/api/backups', (c) => c.json({ ok: true, ...backupState() }));
app.put('/api/backups/settings', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const cur = store.backups.config;
  const next = {
    auto: typeof b.auto === 'boolean' ? b.auto : cur.auto,
    everyMinutes: Math.max(5, Math.min(1440, Math.round(Number(b.everyMinutes ?? cur.everyMinutes)) || cur.everyMinutes)),
    keepAuto: Math.max(1, Math.min(200, Math.round(Number(b.keepAuto ?? cur.keepAuto)) || cur.keepAuto)),
    mirrorDir: typeof b.mirrorDir === 'string' ? b.mirrorDir.trim() : cur.mirrorDir,
    git: typeof b.git === 'boolean' ? b.git : cur.git,
  };
  if (next.mirrorDir) {
    try {
      fs.mkdirSync(next.mirrorDir.replace(/^~(?=$|\/)/, os.homedir()), { recursive: true });
    } catch (err) {
      return c.json(failure(`Cannot use that folder: ${err instanceof Error ? err.message : err}`), 400);
    }
  }
  store.state.meta.backup = next;
  store.persistence.writeMeta(store.state.meta);
  if (next.git && !cur.git) store.backups.gitCommit('PenNodePaper: git enabled');
  return c.json({ ok: true, ...backupState() });
});
app.post('/api/backups', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { label?: string; images?: boolean };
  try {
    return c.json({ ok: true, snapshot: store.backups.create({ kind: 'manual', label: b.label, images: b.images !== false }), ...backupState() });
  } catch (err) {
    return c.json(failure(err), 500);
  }
});
app.delete('/api/backups/:id', (c) => {
  try { store.backups.remove(c.req.param('id')); return c.json({ ok: true, ...backupState() }); } catch (err) { return c.json(failure(err), 404); }
});
app.get('/api/backups/:id/file', (c) => {
  try {
    const f = store.backups.pathOf(c.req.param('id'));
    return new Response(fs.readFileSync(f), { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${path.basename(f)}"` } });
  } catch { return c.notFound(); }
});
app.post('/api/backups/:id/restore', (c) => {
  if (chat.status.busy) return c.json(failure('The AI is still working — wait for it to finish before restoring.'), 409);
  try {
    const { safety } = store.backups.restore(c.req.param('id'));
    openCampaign(campaignDir); // reload everything from disk
    for (const ws of clients) send(ws, helloMsg(true));
    return c.json({ ok: true, safety });
  } catch (err) {
    return c.json(failure(err), 400);
  }
});
app.post('/api/backups/export', (c) => {
  try {
    const f = store.backups.exportArchive(store.exportsDir);
    return c.json({ ok: true, file: path.basename(f), url: `/api/exports/${path.basename(f)}` });
  } catch (err) { return c.json(failure(err), 500); }
});
app.post('/api/backups/import', async (c) => {
  const tmp = path.join(os.tmpdir(), `pnp-upload-${process.pid}-${Date.now()}.tar.gz`);
  try {
    fs.writeFileSync(tmp, Buffer.from(await c.req.arrayBuffer()));
    const dir = importArchive(tmp, cfg.campaignsDir, String(c.req.query('name') ?? 'imported'));
    const r = switchTo(dir);
    return c.json({ ...r, dir }, r.ok ? 200 : 409);
  } catch (err) {
    return c.json(failure(err), 400);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});
app.post('/api/backups/git-commit', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { message?: string };
  const r = store.backups.gitCommit(b.message?.trim() || 'Manual commit');
  return c.json({ ok: true, ...r, ...backupState() });
});

app.get('/api/campaigns', (c) => c.json(listCampaigns(cfg.campaignsDir, campaignDir)));
app.post('/api/campaigns/open', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { dir?: string };
  const dir = path.resolve(String(b.dir ?? ''));
  if (!b.dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return c.json({ ok: false, error: `Folder not found: ${b.dir ?? ''}` }, 400);
  if (!looksLikeCampaign(dir)) return c.json({ ok: false, error: 'That folder is not a PenNodePaper campaign (no graph.json, campaign.json or nodes/ folder).' }, 400);
  const r = dir === campaignDir ? { ok: true } : switchTo(dir);
  return c.json(r, r.ok ? 200 : 409);
});
// "what if": a full copy of the open campaign under a new name, opened right away (the original stays as it was)
app.post('/api/campaigns/branch', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { name?: string };
  const title = String(b.name ?? '').trim();
  if (!title) return c.json({ ok: false, error: 'Give the branch a name.' }, 400);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-branch-'));
  try {
    const archive = store.backups.exportArchive(tmp);
    const dir = importArchive(archive, cfg.campaignsDir, title);
    const metaFile = path.join(dir, 'campaign.json');
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(metaFile, JSON.stringify({ ...meta, name: title, branchOf: store.state.meta.name, createdAt: new Date().toISOString() }, null, 2));
    const r = switchTo(dir);
    return c.json({ ...r, dir }, r.ok ? 200 : 409);
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
app.post('/api/campaigns/create', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { name?: string; language?: string };
  try {
    const dir = createCampaign(cfg.campaignsDir, String(b.name ?? ''), b.language === 'en' ? 'en' : 'de');
    const r = switchTo(dir);
    return c.json({ ...r, dir }, r.ok ? 200 : 409);
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

const snapshot = () => ({ state: store.state, history: store.history.slice(-100), canUndo: store.canUndo, canRedo: store.canRedo });

app.get('/api/state', (c) => c.json(snapshot()));

app.get('/api/info', (c) => {
  const url = `http://127.0.0.1:${cfg.port}/mcp`;
  return c.json({
    campaign: path.basename(campaignDir),
    mcpUrl: url,
    configPath: CONFIG_PATH,
    commands: listCommands().map((x) => ({ name: x.name, description: x.description, readOnly: !!x.readOnly })),
    connect: {
      agy: `agy mcp add --header "Authorization: Bearer ${cfg.token}" pennodepaper ${url}?actor=agy`,
      claude: `claude mcp add --transport http pennodepaper ${url}?actor=claude --header "Authorization: Bearer ${cfg.token}"`,
    },
  });
});

app.post('/api/command', async (c) => {
  const body = (await c.req.json()) as { name: string; args?: unknown; actor?: Actor };
  const res: CommandResult = { ok: true };
  try {
    res.result = await runCommand(store, body.name, body.args ?? {}, asActor(body.actor, 'user'));
    if (body.name === 'accept_proposal' || body.name === 'reject_proposal') broadcast({ t: 'proposals', list: store.proposals() });
  } catch (err) {
    res.ok = false;
    res.error = err instanceof Error ? err.message : String(err);
  }
  return c.json(res, res.ok ? 200 : 400);
});

// --- chat ---------------------------------------------------------------------
let modelsCache: ReturnType<typeof listModels> | null = null;
app.get('/api/models', (c) => c.json((modelsCache ??= listModels())));

app.post('/api/chat', async (c) => {
  const b = (await c.req.json()) as { text: string; backend: Backend; model?: string; nodeId?: string; pins?: string[] };
  if (!b.text?.trim()) return c.json({ ok: false, error: 'empty message' }, 400);
  if (chat.status.busy) return c.json({ ok: false, error: 'The AI is still working.' }, 409);
  void chat.send({ ...b, text: b.text.trim() }); // streams back over the websocket
  return c.json({ ok: true });
});
app.post('/api/chat/cancel', (c) => {
  chat.cancel();
  return c.json({ ok: true });
});
app.post('/api/chat/clear', (c) => {
  chat.clear();
  broadcast({ t: 'reload', state: store.state });
  return c.json({ ok: true });
});

// agy keeps MCP servers in its own global config, so registering ours is an
// explicit, user-triggered action (button in the AI tab).
const mcpUrl = `http://127.0.0.1:${cfg.port}/mcp?actor=agy`;
const AGY_SETTINGS = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
const AGY_RULE = 'mcp(pennodepaper/*)'; // scoped to our server only, never mcp(*)
const readAgySettings = (): { permissions?: { allow?: string[] } } & Record<string, unknown> => {
  try {
    return JSON.parse(fs.readFileSync(AGY_SETTINGS, 'utf8'));
  } catch {
    return {};
  }
};
// `agy mcp list` is a blocking child process: ask it at most every 30 s (and again right after a setup), not on every click
let agyCache: { at: number; value: { installed: boolean; registered: boolean; permitted: boolean } } | null = null;
const agyStatus = (fresh = false) => {
  if (!fresh && agyCache && Date.now() - agyCache.at < 30_000) return agyCache.value;
  const r = spawnSync('agy', ['mcp', 'list'], { encoding: 'utf8', timeout: 15000 });
  const value = {
    installed: !r.error,
    registered: /\bpennodepaper\b/.test(r.stdout ?? ''),
    permitted: !!readAgySettings().permissions?.allow?.includes(AGY_RULE),
  };
  agyCache = { at: Date.now(), value };
  return value;
};
app.get('/api/agy/status', (c) => c.json(agyStatus()));
app.post('/api/agy/setup', (c) => {
  let output = '';
  if (!agyStatus(true).registered) {
    const r = spawnSync('agy', ['mcp', 'add', '--header', `Authorization: Bearer ${cfg.token}`, 'pennodepaper', mcpUrl], { encoding: 'utf8', timeout: 20000 });
    output += `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  }
  // Headless agy auto-denies MCP calls unless an allow-rule exists in its settings.json.
  if (!agyStatus().permitted && fs.existsSync(AGY_SETTINGS)) {
    const backup = `${AGY_SETTINGS}.pnp-backup`;
    if (!fs.existsSync(backup)) fs.copyFileSync(AGY_SETTINGS, backup);
    const s = readAgySettings();
    s.permissions = { ...s.permissions, allow: [...(s.permissions?.allow ?? []), AGY_RULE] };
    fs.writeFileSync(AGY_SETTINGS, JSON.stringify(s, null, 2));
  }
  const st = agyStatus(true);
  return c.json({ ok: st.registered && st.permitted, output, ...st });
});

// --- library: rulebooks + world books (stable reference documents) -------------
type Kind = 'rules' | 'world';
const setFor = (kind: string) => (kind === 'world' ? store.world : store.rulebooks);
const kindOk = (k: string): k is Kind => k === 'rules' || k === 'world';

app.get('/api/library', (c) =>
  c.json({
    rules: store.rulebooks.list(),
    digest: store.rulebooks.digest,
    world: store.world.list().map((b) => ({ ...b, summary: store.world.summary(b.name) })),
  }),
);

app.get('/api/library/search', (c) => {
  const q = c.req.query('q') ?? '';
  const scope = c.req.query('scope') ?? 'all';
  const rules = scope === 'world' ? [] : store.rulebooks.search(q, 12).map((h) => ({ ...h, kind: 'rules' as const }));
  const world = scope === 'rules' ? [] : store.world.search(q, 12).map((h) => ({ ...h, kind: 'world' as const }));
  return c.json([...rules, ...world].sort((a, b) => b.score - a.score).slice(0, 16));
});

app.get('/api/library/section', (c) => {
  try {
    return c.json(setFor(c.req.query('kind') ?? '').section(c.req.query('id') ?? '', c.req.query('children') !== '0'));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
  }
});

const MAX_BOOK = 8_000_000;
const stem = (n: string) => n.replace(/\.(md|markdown|txt)$/i, '');

// upload / create (also used by the in-app editor: same name replaces, old version is backed up)
app.post('/api/library/:kind', async (c) => {
  const kind = c.req.param('kind');
  if (!kindOk(kind)) return c.notFound();
  const b = (await c.req.json()) as { name: string; content: string; summary?: string; autosave?: boolean };
  if (!b.name?.trim()) return c.json({ error: 'name required' }, 400);
  if ((b.content ?? '').length > MAX_BOOK) return c.json({ error: 'file too large (8 MB max)' }, 413);
  const set = setFor(kind);
  const book = set.add(stem(b.name), b.content ?? '', { backup: b.autosave ? 'throttled' : 'always' });
  if (b.summary !== undefined) set.setSummary(book.name, b.summary);
  return c.json({ ok: true, name: book.name, sections: book.sections.length });
});

app.post('/api/library/:kind/import-path', async (c) => {
  const kind = c.req.param('kind');
  if (!kindOk(kind)) return c.notFound();
  const b = (await c.req.json()) as { path: string; name?: string };
  const p = path.resolve(b.path.replace(/^~(?=\/)/, os.homedir()));
  if (!/\.(md|markdown|txt)$/i.test(p)) return c.json({ error: 'only .md / .markdown / .txt files' }, 400);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return c.json({ error: `file not found: ${p}` }, 404);
  if (fs.statSync(p).size > MAX_BOOK) return c.json({ error: 'file too large (8 MB max)' }, 413);
  const book = setFor(kind).add(b.name?.trim() || stem(path.basename(p)), fs.readFileSync(p, 'utf8'));
  return c.json({ ok: true, name: book.name, sections: book.sections.length });
});

app.get('/api/library/:kind/:name', (c) => {
  const kind = c.req.param('kind');
  if (!kindOk(kind)) return c.notFound();
  try {
    const set = setFor(kind);
    const name = c.req.param('name');
    return c.json({ name, text: set.text(name), summary: set.summary(name), outline: set.outline(name, { maxChars: 1800 }) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
  }
});

app.put('/api/library/:kind/:name/summary', async (c) => {
  const kind = c.req.param('kind');
  if (!kindOk(kind)) return c.notFound();
  try {
    setFor(kind).setSummary(c.req.param('name'), ((await c.req.json()) as { summary: string }).summary ?? '');
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
  }
});

app.delete('/api/library/:kind/:name', (c) => {
  const kind = c.req.param('kind');
  if (!kindOk(kind)) return c.notFound();
  setFor(kind).remove(c.req.param('name'));
  return c.json({ ok: true });
});

app.put('/api/library/rules-digest', async (c) => {
  store.rulebooks.setDigest(((await c.req.json()) as { text: string }).text ?? '');
  return c.json({ ok: true });
});

app.post('/api/undo', (c) => c.json({ ok: !!store.undo('user') }));
app.post('/api/redo', (c) => c.json({ ok: !!store.redo('user') }));

// ?w=<px> asks for a small copy (cards, tiles, avatars); without it the original comes back (lightbox, map editor, PDFs)
app.get('/api/images/:file', async (c) => {
  const file = path.basename(c.req.param('file'));
  const dir = path.join(campaignDir, 'images');
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return c.notFound();
  const want = Number(c.req.query('w'));
  if (want > 0 && want < 1400) {
    const t = await thumbnail(dir, file, want);
    if (t) return new Response(await fs.promises.readFile(t), { headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=31536000, immutable' } });
  }
  const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return new Response(await fs.promises.readFile(p), { headers: { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' } });
});

// --- maps ---------------------------------------------------------------------------
const mapNode = (id: string) => Object.values(store.state.nodes).find((n) => !n.trashed && n.fields.mapId === id)?.id ?? null;
app.get('/api/maps', (c) => c.json(store.maps.list().map((m) => ({ id: m.id, name: m.name, kind: m.kind, nodeId: mapNode(m.id) }))));
app.get('/api/maps/:id', (c) => {
  try {
    const m = store.maps.get(c.req.param('id'));
    return c.json({ map: m, nodeId: mapNode(m.id), imageSize: imageSize(m) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
  }
});
app.get('/api/maps/:id/svg', (c) => {
  try {
    const m = store.maps.get(c.req.param('id'));
    return new Response(renderSvg(m, c.req.query('style') === 'control' ? 'control' : 'preview'), { headers: { 'content-type': 'image/svg+xml' } });
  } catch {
    return c.notFound();
  }
});
// how this map would be painted right now, and roughly how long that takes on this computer
app.get('/api/maps/:id/paint', (c) => {
  try {
    const m = store.maps.get(c.req.param('id'));
    return c.json(estimatePaint(images, m));
  } catch {
    return c.notFound();
  }
});
// full-document save from the editor (autosave: history snapshots are throttled)
app.put('/api/maps/:id', async (c) => {
  const doc = (await c.req.json()) as import('@pnp/shared').MapDoc;
  const id = c.req.param('id');
  if (doc.id !== id || !store.maps.has(id)) return c.json({ error: 'unknown map' }, 404);
  // painting results belong to the server (jobs finish while the editor is open): an autosave of a stale copy must not wipe them
  const cur = store.maps.get(id);
  doc.renders = cur.renders;
  doc.terrains = cur.terrains;
  doc.terrainPick = cur.terrainPick;
  doc.paintPrompt = cur.paintPrompt;
  doc.updatedAt = new Date().toISOString();
  store.maps.save(doc, { backup: 'throttled' });
  store.emitMap(doc, 'user');
  return c.json({ ok: true });
});

// --- VTT bridge ---------------------------------------------------------------------
app.get('/api/vtt', (c) => c.json({ status: store.vtt.status(), bridgeUrl: `ws://127.0.0.1:${cfg.port}/bridge`, token: cfg.token }));
app.get('/api/exports/:file', (c) => {
  const file = path.basename(c.req.param('file'));
  const p = path.join(store.exportsDir, file);
  if (!fs.existsSync(p)) return c.notFound();
  return new Response(fs.readFileSync(p), { headers: { 'content-type': file.endsWith('.md') ? 'text/markdown; charset=utf-8' : file.endsWith('.tar.gz') ? 'application/gzip' : file.endsWith('.pdf') ? 'application/pdf' : 'application/json', 'content-disposition': `attachment; filename="${file}"` } });
});

app.get('/api/images-meta', (c) => c.json(images.meta()));

// --- settings: ComfyUI connection + campaign image style ---------------------------------
app.get('/api/settings', async (c) => {
  const alive = await images.comfy.alive();
  return c.json({
    comfy: images.comfyConfig(),
    style: images.style(),
    language: store.state.meta.language,
    aiMode: store.state.meta.aiMode ?? 'live',
    mapPaintMode,
    alive,
    options: alive ? await images.comfy.options() : null,
  });
});

app.put('/api/settings', async (c) => {
  const b = (await c.req.json()) as { comfy?: Record<string, unknown>; style?: Record<string, unknown>; language?: string; aiMode?: string; mapPaintMode?: string };
  const m = store.state.meta;
  if (b.mapPaintMode === 'quick' || b.mapPaintMode === 'staged') {
    mapPaintMode = b.mapPaintMode; // this computer's setting, kept in the user's config (not in the campaign)
    saveConfig({ mapPaintMode });
  }
  if (b.comfy) m.comfy = { ...m.comfy, ...(b.comfy as object) };
  if (b.style) m.style = { ...m.style, ...(b.style as object) };
  if (typeof b.language === 'string' && b.language.trim()) m.language = b.language.trim();
  if (b.aiMode === 'live' || b.aiMode === 'review') m.aiMode = b.aiMode;
  store.persistence.writeMeta(m);
  broadcast({ t: 'reload', state: store.state });
  return c.json({ ok: true });
});

// art-director pass: world books -> image style (returned for review; the client autosaves it like any edit)
app.post('/api/settings/generate-style', async (c) => {
  const b = (await c.req.json().catch(() => ({}))) as { backend?: Backend; model?: string };
  try {
    const style = await generateStyle(store, images.style(), b.backend === 'agy' ? 'agy' : 'claude', b.model || undefined);
    return c.json({ ok: true, style });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 422);
  }
});

app.post('/api/images/cancel', async (c) => {
  images.cancel(((await c.req.json().catch(() => ({}))) as { jobId?: string }).jobId);
  return c.json({ ok: true });
});


// --- static web build (production) ------------------------------------------
const webDist = path.join(REPO_ROOT, 'packages/web/dist');
if (fs.existsSync(webDist)) {
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };
  app.get('*', (c) => {
    const rel = c.req.path === '/' ? 'index.html' : c.req.path.slice(1);
    let p = path.join(webDist, rel);
    if (!p.startsWith(webDist) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(webDist, 'index.html');
    return new Response(fs.readFileSync(p), { headers: { 'content-type': mime[path.extname(p)] ?? 'application/octet-stream' } });
  });
}

const listener = getRequestListener(app.fetch);

// --- server: /mcp (raw node), /ws (websocket), everything else -> hono -------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/mcp') {
    if (!LOCAL_HOST.test(req.headers.host ?? '')) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (req.headers.authorization !== `Bearer ${cfg.token}`) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('unauthorized');
      return;
    }
    let body: unknown;
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const ch of req) chunks.push(ch as Buffer);
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        res.writeHead(400).end('bad json');
        return;
      }
    }
    try {
      await handleMcp(store, req, res, asActor(url.searchParams.get('actor'), 'claude'), body);
    } catch (err) {
      console.error('[mcp]', err);
      if (!res.headersSent) res.writeHead(500).end('mcp error');
    }
    return;
  }
  void listener(req, res);
});

const wss = new WebSocketServer({ noServer: true });
const bridgeWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
bridgeWss.on('connection', (ws) => store.vtt.accept(ws));

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/bridge') {
    // VTT pages live on other origins (e.g. GitHub Pages), so no Origin check here: the secret token authenticates.
    if (!LOCAL_HOST.test(req.headers.host ?? '') || url.searchParams.get('token') !== cfg.token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    bridgeWss.handleUpgrade(req, socket, head, (ws) => bridgeWss.emit('connection', ws, req));
    return;
  }
  if (url.pathname !== '/ws' || !originOk(req)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    send(ws, helloMsg());
  });
});


server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`PenNodePaper server  http://127.0.0.1:${cfg.port}   campaign: ${path.basename(campaignDir)}`);
  console.log(`MCP endpoint         http://127.0.0.1:${cfg.port}/mcp   (Bearer token in ${CONFIG_PATH})`);
});
