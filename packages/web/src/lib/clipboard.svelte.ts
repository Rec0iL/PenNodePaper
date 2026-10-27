// The GM's clipboard on the story canvas: Ctrl+C copies the selected nodes (with the connections among them and their
// layout), Ctrl+X takes them off the canvas into the pool, Ctrl+V puts them down where the pointer is. A cut moves the
// SAME nodes (their ids, connections to the rest of the story, pictures and maps stay); a copy makes new ones.
// The copy also goes to the system clipboard, so it can be pasted in another tab or into another campaign.
import type { StoryNode } from '@pnp/shared';
import { NODE_H, NODE_W, app, cmd, say, screenToFlow, selectNode, viewCenter } from './app.svelte';

const MIME = 'application/x-pnp-nodes';

interface Clip {
  v: 1;
  nodes: { key: string; dx: number; dy: number; node: Partial<StoryNode> }[];
  edges: { from: string; to: string; kind: string; label?: string; noTrail?: boolean }[];
  /** ids of nodes that were cut: the first paste puts these very nodes back down */
  cut?: string[];
}

export const clip = $state({ count: 0, cut: false });
let current: Clip | null = null;
/** where the pointer last was over the canvas (screen px), so a paste lands under it */
let pointer: { x: number; y: number; at: number } | null = null;
let lastAnchor = '';
let repeat = 0;

export const notePointer = (e: PointerEvent) => (pointer = { x: e.clientX, y: e.clientY, at: Date.now() });

/** What a copy / cut acts on: the multi-selection, else the selected node. */
export function selection(): string[] {
  const ids = app.multi.length > 1 ? app.multi : app.selectedId ? [app.selectedId] : [];
  return ids.filter((id) => app.nodes[id] && !app.nodes[id].trashed);
}

function build(ids: string[]): Clip {
  const placed = ids.map((id) => app.graph.placements[id]).filter(Boolean);
  const x0 = placed.length ? Math.min(...placed.map((p) => p.x)) : 0;
  const y0 = placed.length ? Math.min(...placed.map((p) => p.y)) : 0;
  const set = new Set(ids);
  return {
    v: 1,
    nodes: ids.map((id, i) => {
      const p = app.graph.placements[id];
      const { id: _id, trashed: _t, createdAt: _c, updatedAt: _u, status: _s, ...node } = $state.snapshot(app.nodes[id]) as StoryNode;
      // a pool node has no place: it goes to the right of the others
      return { key: id, dx: p ? p.x - x0 : (placed.length ? NODE_W + 60 : 0) + i * 30, dy: p ? p.y - y0 : i * 30, node };
    }),
    edges: app.graph.edges.filter((e) => set.has(e.from) && set.has(e.to)).map((e) => ({ from: e.from, to: e.to, kind: e.kind, label: e.label, ...(e.noTrail ? { noTrail: true } : {}) })),
  };
}

function remember(c: Clip, data?: DataTransfer | null) {
  current = c;
  clip.count = c.nodes.length;
  clip.cut = !!c.cut;
  repeat = 0;
  data?.setData(MIME, JSON.stringify({ ...c, cut: undefined }));
  data?.setData('text/plain', c.nodes.map((n) => n.node.title).join('\n'));
}

export function copyNodes(ids = selection(), data?: DataTransfer | null): boolean {
  if (!ids.length) return false;
  remember(build(ids), data);
  say(ids.length === 1 ? `Copied “${app.nodes[ids[0]].title}”` : `Copied ${ids.length} nodes`, 'ok');
  return true;
}

export async function cutNodes(ids = selection(), data?: DataTransfer | null): Promise<boolean> {
  const onCanvas = ids.filter((id) => app.graph.placements[id]);
  if (!onCanvas.length) return copyNodes(ids, data);
  remember({ ...build(onCanvas), cut: onCanvas }, data);
  const r = await cmd('batch', { ops: onCanvas.map((id) => ({ command: 'move_to_pool', args: { id } })), label: onCanvas.length === 1 ? `Cut “${app.nodes[onCanvas[0]].title}”` : `Cut ${onCanvas.length} nodes` });
  if (r) {
    selectNode(null);
    app.multi = [];
    say(onCanvas.length === 1 ? 'Cut — it waits in the pool until you paste it' : `Cut ${onCanvas.length} nodes — they wait in the pool until you paste them`, 'ok');
  }
  return !!r;
}

/** Where a paste goes: the given flow point, else under the pointer (if it is over the canvas), else the middle of the view. */
function anchor(at?: { x: number; y: number }): { x: number; y: number } {
  if (at) return at;
  const r = document.querySelector('.canvas')?.getBoundingClientRect();
  if (pointer && r && Date.now() - pointer.at < 120_000 && pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom) {
    const p = screenToFlow(pointer);
    return { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - NODE_H / 3) };
  }
  return viewCenter();
}

export async function pasteNodes(data?: DataTransfer | null, at?: { x: number; y: number }): Promise<boolean> {
  let c = current;
  const raw = data?.getData(MIME);
  if (raw && !c?.cut) {
    try {
      const parsed = JSON.parse(raw) as Clip;
      if (parsed?.v === 1 && Array.isArray(parsed.nodes)) c = parsed;
    } catch {
      /* not ours */
    }
  }
  if (!c?.nodes.length) return false;
  const a = anchor(at);
  // pasting again on the same spot: each copy a little further, so they do not hide each other
  const key = `${a.x},${a.y}`;
  repeat = key === lastAnchor ? repeat + 1 : 0;
  lastAnchor = key;
  const x = a.x + repeat * 40, y = a.y + repeat * 40;

  const back = c.cut?.filter((id) => app.nodes[id] && !app.nodes[id].trashed && !app.graph.placements[id]) ?? [];
  if (c.cut && back.length) {
    // the cut nodes themselves go back down (their connections never left)
    const pos = new Map(c.nodes.map((n) => [n.key, n]));
    const r = await cmd('batch', {
      ops: back.map((id) => ({ command: 'place_on_canvas', args: { id, canvas: app.canvasId, x: x + (pos.get(id)?.dx ?? 0), y: y + (pos.get(id)?.dy ?? 0) } })),
      label: back.length === 1 ? `Pasted “${app.nodes[back[0]].title}”` : `Pasted ${back.length} nodes`,
    });
    if (!r) return false;
    current = { ...c, cut: undefined }; // from now on it is a copy
    clip.cut = false;
    app.multi = back.length > 1 ? back : [];
    selectNode(back.length === 1 ? back[0] : null);
    return true;
  }
  const r = await cmd<{ ids: string[] }>('paste_nodes', { nodes: c.nodes, edges: c.edges, canvas: app.canvasId, x, y });
  if (!r) return false;
  app.multi = r.ids.length > 1 ? r.ids : [];
  selectNode(r.ids.length === 1 ? r.ids[0] : null);
  return true;
}

/** Duplicate in place (menu): a copy next to the original, the clipboard is left alone. */
export async function duplicateNodes(ids = selection()) {
  if (!ids.length) return;
  const c = build(ids);
  const placed = ids.map((id) => app.graph.placements[id]).filter(Boolean);
  const x = placed.length ? Math.min(...placed.map((p) => p.x)) + 40 : viewCenter().x;
  const y = placed.length ? Math.min(...placed.map((p) => p.y)) + 40 : viewCenter().y;
  const r = await cmd<{ ids: string[] }>('paste_nodes', { nodes: c.nodes, edges: c.edges, canvas: app.canvasId, x, y });
  if (r) {
    app.multi = r.ids.length > 1 ? r.ids : [];
    selectNode(r.ids.length === 1 ? r.ids[0] : null);
  }
}

/** Only when nothing else wants the keys: no text field, no selected text, no editor or dialog on top. */
function ours(e: Event, text = true): boolean {
  const el = e.target as HTMLElement | null;
  if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return false;
  if (app.mapEditor || app.settingsOpen || app.paletteOpen || app.lightbox) return false;
  if (text && (window.getSelection()?.toString() ?? '').trim()) return false;
  return true;
}

/**
 * The keys do the work (a browser does not always send a copy / paste event when no text is selected); the clipboard
 * events, when they come, only carry the copy to the system clipboard and bring one in from another tab or campaign.
 */
export function installClipboard(): () => void {
  let keyedAt = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || !ours(e, e.key.toLowerCase() !== 'v')) return;
    const k = e.key.toLowerCase();
    if (k === 'c' && selection().length) {
      keyedAt = Date.now();
      copyNodes();
    } else if (k === 'x' && selection().length) {
      keyedAt = Date.now();
      void cutNodes();
    } else if (k === 'v' && current) {
      // wait a moment for the paste event: it may bring a copy from another tab; else the copy in memory is pasted
      clearTimeout(pending);
      pending = setTimeout(() => void pasteNodes(null), 60);
    }
  };
  const onCopy = (e: ClipboardEvent) => {
    if (!ours(e) || !current || Date.now() - keyedAt > 500) return;
    e.preventDefault();
    e.clipboardData?.setData(MIME, JSON.stringify({ ...current, cut: undefined }));
    e.clipboardData?.setData('text/plain', current.nodes.map((n) => n.node.title).join('\n'));
  };
  const onPaste = (e: ClipboardEvent) => {
    if (!ours(e, false)) return;
    const theirs = e.clipboardData?.types.includes(MIME);
    if (!theirs && !current) return;
    e.preventDefault();
    clearTimeout(pending);
    void pasteNodes(e.clipboardData);
  };
  window.addEventListener('keydown', onKey);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCopy);
  document.addEventListener('paste', onPaste);
  return () => {
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCopy);
    document.removeEventListener('paste', onPaste);
  };
}
