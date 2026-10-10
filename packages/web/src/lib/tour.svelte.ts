import { tick } from 'svelte';
import { app, remember, say } from './app.svelte';
import { CHAPTERS, STEPS } from './tour/steps';
import { reveal, type TourAction, type TourStep } from './tour/kit';

// ---------------------------------------------------------------------------
// The welcome tour: a coach that walks through the real app, in a practice campaign. It knows which part of the screen
// each step is about (data-tour anchors), waits for the thing you were asked to do (or does it for you), and heals the
// practice campaign when someone jumps ahead (the server's /api/tour/ensure).
// ---------------------------------------------------------------------------

export const tour = $state({
  /** the coach is on screen */
  open: false,
  idx: 0,
  /** what the current step asks for, built when the step is entered (it remembers the state it started from) */
  action: null as TourAction | null,
  done: false,
  /** a step is being set up (the card waits so it never shows a half-prepared screen) */
  busy: false,
  /** the help menu in the top bar */
  menu: false,
  /** how far the GM got, as a step id (null = never started) */
  saved: null as string | null,
  /** the shortcuts sheet */
  keys: false,
});

const key = () => `pnp.tour.${app.meta.name}`;
const ls = (k: string) => {
  try { return localStorage.getItem(k); } catch { return null; }
};

export const isPractice = () => app.meta.tutorial?.on === true;
export const step = () => STEPS[tour.idx] as TourStep | undefined;
export const chapterOf = (i: number) => CHAPTERS.find((c) => c.id === STEPS[i]?.chapter);
export const chapterRange = (id: string) => {
  const from = STEPS.findIndex((s) => s.chapter === id);
  const to = STEPS.length - 1 - [...STEPS].reverse().findIndex((s) => s.chapter === id);
  return { from, to };
};

export function loadSaved() {
  tour.saved = ls(key());
}

function persist() {
  const s = step();
  if (s) {
    remember(key(), s.id);
    tour.saved = s.id;
  }
}

// ---- what a step may ask the server for -------------------------------------------------------------------------------

async function ensure(need?: string[]) {
  if (!need?.length) return;
  try {
    await fetch('/api/tour/ensure', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ need }) });
  } catch { /* the step still works, it just may find less */ }
}

// ---- moving through the steps -----------------------------------------------------------------------------------------

let entering = 0;

/** Show step `i` (set the screen up first). */
export async function goTo(i: number) {
  const n = Math.max(0, Math.min(STEPS.length - 1, i));
  const token = ++entering;
  tour.busy = true;
  tour.done = false;
  tour.action = null;
  tour.idx = n;
  const s = STEPS[n];
  try {
    await ensure(s.need);
    if (token !== entering) return;
    // a step that cannot be prepared (something it waits for never shows) must not leave the card hidden
    await Promise.race([Promise.resolve(s.enter?.()).catch((e) => console.error('[tour] enter', s.id, e)), new Promise((r) => setTimeout(r, 7000))]);
    if (token !== entering) return;
    await tick();
    // the cards the step is about must be on screen, whatever the camera did before (the AI moves it, the GM may have panned)
    if (s.target) await reveal(Array.isArray(s.target) ? s.target : [s.target]);
    tour.action = s.action?.() ?? null;
  } catch (e) {
    console.error('[tour] step could not be prepared', s.id, e);
  } finally {
    if (token === entering) {
      tour.busy = false;
      persist();
    }
  }
}

export const next = () => (tour.idx >= STEPS.length - 1 ? finish() : goTo(tour.idx + 1));
export const back = () => goTo(tour.idx - 1);

/** The first step of the next chapter. */
export function skipChapter() {
  const c = step()?.chapter;
  const j = STEPS.findIndex((s, i) => i > tour.idx && s.chapter !== c);
  return j < 0 ? finish() : goTo(j);
}
export const jumpToChapter = (id: string) => {
  tour.menu = false;
  tour.open = true;
  return goTo(chapterRange(id).from);
};

export async function startTour(from = 0) {
  tour.menu = false;
  tour.open = true;
  await goTo(from);
}

export function resumeTour() {
  const i = STEPS.findIndex((s) => s.id === tour.saved);
  return startTour(i < 0 ? 0 : i);
}

/** Close the coach but keep the place (you can come back from the help menu). */
export function pauseTour() {
  entering++;
  tour.open = false;
  tour.busy = false;
  tour.action = null;
  app.fill = null;
}

/** The tour is over: the practice campaign becomes an ordinary one (real AI, real ComfyUI). */
export async function finish() {
  pauseTour();
  remember(key(), '');
  tour.saved = null;
  try {
    await fetch('/api/tour/finish', { method: 'POST' });
  } catch { /* ignore */ }
  say('The practice campaign is yours now — the AI buttons use your real AI from here on.', 'ok');
}

/** A fresh practice campaign (or a reset of this one) and the tour from its first step. */
export async function restartTour() {
  tour.menu = false;
  const r = await fetch('/api/tour/start', { method: 'POST' }).then((x) => x.json()).catch(() => ({ ok: false, error: 'The server did not answer' }));
  if (!r.ok) return say(r.error ?? 'Could not start the tour');
  remember(key(), '');
  tour.saved = null;
  // the server has opened the practice campaign: the page gets its state over the websocket
  const t0 = Date.now();
  while (!isPractice() && Date.now() - t0 < 5000) await new Promise((res) => setTimeout(res, 100));
  await new Promise((res) => setTimeout(res, 300));
  await startTour(0);
}

// ---- the first time ---------------------------------------------------------------------------------------------------

let offered = false;
/** A fresh practice campaign greets whoever opens it for the first time with the tour. */
export function offerTour() {
  if (offered || !app.loaded || !isPractice()) return;
  offered = true;
  loadSaved();
  const seen = ls(`pnp.tour.seen.${app.meta.name}`);
  if (seen || tour.saved) return; // already started once: it waits in the help menu
  remember(`pnp.tour.seen.${app.meta.name}`, '1');
  void startTour(0);
}

