import { app, closeEnlarged, closeMenus, flow, selectNode } from '../app.svelte';

// What a tour step is, and the small helpers the steps share.

export interface TourAction {
  /** what to do, in a few words ("Double-click the card") */
  text: string;
  /** true once it is done (read live: the tour checks it whenever the app changes and a few times a second) */
  done: () => boolean;
  /** "Do it for me": does it, so nobody gets stuck on a gesture */
  auto?: { label: string; run: () => unknown };
}

export interface TourStep {
  id: string;
  chapter: string;
  title: string;
  /** paragraphs separated by a blank line; **bold**, `code`, [[Key]] */
  body: string;
  /** what the step is about: CSS selectors (data-tour anchors); the spotlight covers all of them */
  target?: string | string[];
  pad?: number;
  /** the lit part is ONE box around all targets, the area between them included (for gestures across several cards) */
  span?: boolean;
  /** where the card goes relative to the spotlight */
  side?: 'auto' | 'left' | 'right' | 'top' | 'bottom' | 'center';
  /** 'all' = the whole app stays usable (no dimming) — for "try it yourself" */
  free?: boolean;
  /** shown in place of the body once the action is done */
  after?: string;
  /** what the practice campaign must contain before this step (server recipes, see tutorial/ensure.ts) */
  need?: string[];
  /** put the screen in the state the step needs (select a node, open a tab…) */
  enter?: () => void | Promise<void>;
  action?: () => TourAction;
  /** while the AI or the image queue works the screen is shown undimmed and the card shrinks to a line, so you can watch */
  watch?: boolean;
  /** a wider card (for the welcome and the last step) */
  wide?: boolean;
  /** extra buttons on the card instead of Next */
  buttons?: { label: string; primary?: boolean; run: () => unknown }[];
}

export const el = (sel: string) => document.querySelector(sel) as HTMLElement | null;
export const click = (sel: string) => el(sel)?.click();
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait (up to `ms`) for something to be on screen. */
export async function waitFor(test: () => boolean, ms = 4000) {
  const t0 = Date.now();
  while (!test() && Date.now() - t0 < ms) await sleep(60);
  return test();
}

// ---- typing into the app (a prepared message, a prompt) ----------------------------------------------------------------

let fillRun = 0;
/** Type `text` into one of the app's inputs, letter by letter, as if the GM were writing it. */
export async function typeInto(target: 'chat' | 'image' | 'map' | 'guidance', text: string, nodeId?: string, speed = 11) {
  const run = ++fillRun;
  let cur = '';
  for (const ch of text) {
    if (run !== fillRun) return;
    cur += ch;
    app.fill = { target, text: cur, nodeId, nonce: run };
    await new Promise((r) => setTimeout(r, speed));
  }
}
export const stopTyping = () => {
  fillRun++;
};

// ---- helpers the steps share --------------------------------------------------------------------------------------------



/** The flow node of a card on the canvas. */
export const card = (id: string) => `.svelte-flow__node[data-id="${id}"]`;
export const pool = (id: string) => `[data-pool-id="${id}"]`;

/** A quiet screen: no menus, dialogs or enlarged cards from the step before (what a step wants open it opens itself, after this). */
export function calm(keep: { map?: boolean; settings?: boolean; enlarged?: boolean; lightbox?: boolean } = {}) {
  closeMenus();
  app.crossLink = null;
  app.paletteOpen = false;
  app.queueOpen = false;
  app.binderOpen = false;
  app.backupsOpen = false;
  app.editor = null;
  app.soundsOpen = false;
  app.fill = null;
  stopTyping();
  // the campaign menu keeps its own open/closed state: its backdrop closes it
  if (el('[data-tour="campaign-pop"]')) el('.cm .ctx-scrim')?.click();
  if (!keep.lightbox) app.lightbox = null;
  if (!keep.map) app.mapEditor = null;
  if (!keep.settings) app.settingsOpen = false;
  if (!keep.enlarged) closeEnlarged();
}

/** Select a node and show the Inspector (and, if it is on the canvas, its canvas). */
export function pick(id: string, tab: 'inspector' | 'story' | 'library' | 'chat' = 'inspector') {
  selectNode(id);
  app.tab = tab;
  const p = app.graph.placements[id];
  if (p && p.canvas !== app.canvasId) app.canvasId = p.canvas;
}

/** A camera move that is never waited for longer than it lasts (xyflow's promise does not settle when the view is interrupted). */
export async function camera(move: () => Promise<unknown> | undefined, ms = 700) {
  await Promise.race([Promise.resolve(move()).catch(() => {}), sleep(ms)]);
}
/** Show the whole canvas. */
export const fit = () => camera(() => flow()?.fit?.());

export const viewKey = () => {
  const v = flow()?.getViewport();
  return v ? `${Math.round(v.x)},${Math.round(v.y)},${v.zoom.toFixed(2)}` : '';
};

/** The flow nodes a step points at (card('x'), stub markers, frame bars). */
const flowTargets = (sels: string[]) =>
  sels.flatMap((q) => {
    try { return [...document.querySelectorAll(q)]; } catch { return []; }
  }).filter((e) => e.closest('.svelte-flow__node')) as HTMLElement[];

/** Make sure the cards a step is about are on the canvas' screen (and not under the bars on top of it): else the camera shows them. */
export async function reveal(sels: string[]) {
  const f = flow();
  const canvas = el('.canvas')?.getBoundingClientRect();
  if (!f || !canvas) return;
  const nodes = flowTargets(sels);
  if (!nodes.length) return;
  const margin = 40;
  const inside = (r: DOMRect) => r.left >= canvas.left + 12 && r.right <= canvas.right - 12 && r.top >= canvas.top + margin + 40 && r.bottom <= canvas.bottom - 60;
  if (nodes.every((n) => inside(n.getBoundingClientRect()))) return;
  // a box in flow coordinates around them, with room for the things that hang beside cards (jump markers, the frame's title)
  const pts = nodes.flatMap((n) => {
    const r = n.getBoundingClientRect();
    return [f.screenToFlow({ x: r.left, y: r.top }), f.screenToFlow({ x: r.right, y: r.bottom })];
  });
  const x0 = Math.min(...pts.map((p) => p.x)) - 60, y0 = Math.min(...pts.map((p) => p.y)) - 80;
  const x1 = Math.max(...pts.map((p) => p.x)) + 60, y1 = Math.max(...pts.map((p) => p.y)) + 80;
  await camera(() => f.fitBox({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, 450), 900);
  await sleep(120);
}
