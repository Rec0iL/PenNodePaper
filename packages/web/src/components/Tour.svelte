<script lang="ts">
  // The welcome tour's coach: dims everything but what the current step is about, explains it in a card, waits for
  // what it asked you to do (or does it for you), and keeps out of the way while the AI or the image queue works.
  import { onMount } from 'svelte';
  import { activeJobs, app } from '../lib/app.svelte';
  import { CHAPTERS, STEPS } from '../lib/tour/steps';
  import { back, finish, goTo, next, pauseTour, skipChapter, tour } from '../lib/tour.svelte';

  const step = $derived(STEPS[tour.idx]);
  const chapter = $derived(CHAPTERS.find((c) => c.id === step?.chapter));
  const inChapter = $derived(STEPS.filter((s) => s.chapter === step?.chapter));
  const nth = $derived(inChapter.findIndex((s) => s.id === step?.id) + 1);
  const last = $derived(tour.idx >= STEPS.length - 1);
  // while the AI works (whatever the step is about) or a picture is made in a step that waits for it, the screen is shown as it is:
  // dimming the chat would hide exactly what there is to see
  const watching = $derived(app.chatStatus.busy || (!!step?.watch && activeJobs().length > 0));

  // ---- where the lit parts are -----------------------------------------------------------------------------------------
  interface Box { x: number; y: number; w: number; h: number }
  let holes = $state<Box[]>([]);
  /** menus and dialogs the GM opened meanwhile (a node menu, the connect dialog): lit as well, and kept clear of the card */
  let popups = $state<Box[]>([]);
  let vw = $state(typeof window === 'undefined' ? 1200 : window.innerWidth);
  let vh = $state(typeof window === 'undefined' ? 800 : window.innerHeight);
  let cardW = $state(400);
  let cardH = $state(240);

  const sels = (): string[] => {
    const t = step?.target;
    return !t ? [] : Array.isArray(t) ? t : [t];
  };

  const same = (a: Box[], b: Box[]) => a.length === b.length && a.every((x, i) => x.x === b[i].x && x.y === b[i].y && x.w === b[i].w && x.h === b[i].h);
  const near = (a: Box, b: Box, gap: number) => a.x - gap < b.x + b.w && a.x + a.w + gap > b.x && a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;
  const union = (a: Box, b: Box): Box => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  /** boxes that touch (or nearly) become one */
  function merge(list: Box[], gap = 20): Box[] {
    const out = [...list];
    for (let again = true; again; ) {
      again = false;
      for (let i = 0; i < out.length && !again; i++)
        for (let k = i + 1; k < out.length && !again; k++)
          if (near(out[i], out[k], gap)) {
            out[i] = union(out[i], out[k]);
            out.splice(k, 1);
            again = true;
          }
    }
    return out;
  }

  const visible = (r: DOMRect) => r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
  const boxOf = (r: DOMRect, pad: number): Box => {
    const x0 = Math.max(4, r.left - pad), y0 = Math.max(4, r.top - pad), x1 = Math.min(vw - 4, r.right + pad), y1 = Math.min(vh - 4, r.bottom + pad);
    return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  };

  function measure() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    const pad = step?.pad ?? 8;
    const rects = sels().flatMap((q) => {
      let els: Element[] = [];
      try { els = [...document.querySelectorAll(q)]; } catch { /* bad selector */ }
      return els.map((e) => e.getBoundingClientRect()).filter(visible);
    });
    let next = rects.map((r) => boxOf(r, pad));
    // a step about a gesture over several cards needs the area between them as well: one box
    if (step?.span && next.length > 1) next = [next.reduce(union)];
    else next = merge(next);
    if (!same(holes, next)) holes = next;

    const pops: Box[] = [];
    // what happens in the AI tab while the AI works stays uncovered by the (small) card
    if (app.chatStatus.busy) { const c = document.querySelector('[data-tour="dock"]')?.getBoundingClientRect(); if (c && visible(c)) pops.push(boxOf(c, 0)); }
    for (const q of ['.cmenu', '[data-tour="crosslink-modal"]', '[data-tour="campaign-pop"]']) {
      const e = document.querySelector(q);
      const r = e?.getBoundingClientRect();
      if (r && visible(r)) pops.push(boxOf(r, 4));
    }
    if (!same(popups, pops)) popups = pops;
  }

  let raf = 0;
  onMount(() => {
    const loop = () => {
      if (tour.open) measure();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // a page that is not being painted (a background tab) gets no animation frames: the timer keeps the lit part and the checks going
    const tick250 = setInterval(() => {
      if (tour.open) measure();
      const a = tour.action;
      if (tour.open && a && !tour.done && !tour.busy) check();
    }, 250);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(tick250);
    };
  });

  // the first look at targets that sit outside what their scroll container shows (the pool list, the Inspector): bring them into view
  let scrolledFor = '';
  $effect(() => {
    const id = step?.id;
    if (!tour.open || tour.busy || !id || scrolledFor === id) return;
    const els = sels().map((q) => { try { return document.querySelector(q) as HTMLElement | null; } catch { return null; } }).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    scrolledFor = id;
    for (const t of els) {
      if (t.closest('.svelte-flow')) continue; // the canvas is moved by the camera, not by scrolling
      const r = t.getBoundingClientRect();
      let p = t.parentElement;
      while (p && !(p.scrollHeight > p.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
      const c = p?.getBoundingClientRect();
      if (c && (r.top < c.top + 4 || r.bottom > c.bottom - 4)) t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  // ---- the card's place: its size is bound (clientWidth / clientHeight), so it follows whatever the card shows ---------------

  const hits = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const pos = $derived.by(() => {
    const m = 14;
    const W = cardW, H = cardH;
    const clampX = (x: number) => Math.max(m, Math.min(vw - W - m, x));
    const clampY = (y: number) => Math.max(m, Math.min(vh - H - m, y));
    const center = { x: Math.round((vw - W) / 2), y: Math.round(Math.max(m, (vh - H) / 2.2)) };
    if (!holes.length || step?.side === 'center') return center;
    const all = holes.reduce(union);
    // what the card must not cover: the lit parts, and every menu or dialog that is open
    const avoid = [...holes, ...popups];
    const gap = 18;
    const c = (name: string, x: number, y: number) => ({ name, x: Math.round(clampX(x)), y: Math.round(clampY(y)) });
    const cand = [
      c('right', all.x + all.w + gap, all.y),
      c('bottom', all.x, all.y + all.h + gap),
      c('left', all.x - W - gap, all.y),
      c('top', all.x, all.y - H - gap),
      c('br', vw - W - m, vh - H - m),
      c('bl', m, vh - H - m),
      c('tr', vw - W - m, 56),
      c('tl', m, 56),
    ];
    const pref = step?.side && step.side !== 'auto' ? step.side : '';
    cand.sort((a, b) => Number(b.name === pref) - Number(a.name === pref));
    const free = cand.find((k) => !avoid.some((o) => hits({ x: k.x, y: k.y, w: W, h: H }, o)));
    // nothing is free (a big lit area): over its lower corner
    return free ?? c('over', all.x + 24, all.y + all.h - H - 24);
  });

  // ---- doing what was asked -------------------------------------------------------------------------------------------
  let advancing: ReturnType<typeof setTimeout> | undefined;
  function check() {
    const a = tour.action;
    if (!a || tour.done) return;
    let ok = false;
    try { ok = a.done(); } catch { /* not ready yet */ }
    if (!ok) return;
    tour.done = true;
    clearTimeout(advancing);
    if (!step?.after && !last) {
      const idx = tour.idx;
      advancing = setTimeout(() => { if (tour.open && tour.idx === idx) void next(); }, 1100);
    }
  }
  $effect(() => {
    // re-evaluated whenever anything the condition reads changes
    if (tour.open && tour.action && !tour.done && !tour.busy) check();
  });
  $effect(() => {
    void step?.id;
    clearTimeout(advancing);
  });

  const para = (s: string) =>
    s.split(/\n\n+/).map((p) =>
      p
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[\[([^\]]+)\]\]/g, '<kbd>$1</kbd>')
        .replace(/\n/g, '<br>'),
    );

  // The dimmed layer sits just under the app's menus and dialogs (z 90+), so a node menu or the connect dialog that a step
  // opens is never greyed out or blocked. Only while a big window (map editor, settings …) is open it goes above it.
  const bigWindow = $derived(!!(app.mapEditor || app.settingsOpen || app.binderOpen || app.backupsOpen || app.editor));
  const layerZ = $derived(bigWindow ? 8900 : 85);
  // an explain step blocks the whole screen; an action step leaves the lit parts usable
  const interactive = $derived(!!step?.action && holes.length > 0);
  const shade = $derived(!step?.free && !watching);
  /** the dimmed rectangles: the screen minus the lit parts */
  const cells = $derived.by(() => {
    if (!shade) return [] as Box[];
    if (!holes.length) return [{ x: 0, y: 0, w: vw, h: vh }];
    const xs = [...new Set([0, vw, ...holes.flatMap((h) => [h.x, h.x + h.w])])].filter((x) => x >= 0 && x <= vw).sort((a, b) => a - b);
    const ys = [...new Set([0, vh, ...holes.flatMap((h) => [h.y, h.y + h.h])])].filter((y) => y >= 0 && y <= vh).sort((a, b) => a - b);
    const out: Box[] = [];
    for (let j = 0; j < ys.length - 1; j++) {
      let run: Box | null = null;
      for (let i = 0; i < xs.length - 1; i++) {
        const c = { x: xs[i], y: ys[j], w: xs[i + 1] - xs[i], h: ys[j + 1] - ys[j] };
        const lit = holes.some((h) => c.x >= h.x && c.x + c.w <= h.x + h.w && c.y >= h.y && c.y + c.h <= h.y + h.h);
        if (lit) { if (run) out.push(run); run = null; }
        else if (run) run.w += c.w;
        else run = c;
      }
      if (run) out.push(run);
    }
    return out;
  });
</script>

<svelte:window onresize={measure} />

{#if tour.open && step}
  <div class="tour" class:quiet={watching}>
    {#each cells as c}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="cell" style="left:{c.x}px;top:{c.y}px;width:{c.w}px;height:{c.h}px;z-index:{layerZ}"></div>
    {/each}
    {#if shade && !interactive}
      <!-- an explain step: even the lit parts are only to look at -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="cell clear" style="inset:0;z-index:{layerZ}"></div>
    {/if}
    {#each holes as h, i (i)}
      <div class="ring" class:free={step.free || watching} style="left:{h.x}px;top:{h.y}px;width:{h.w}px;height:{h.h}px"></div>
    {/each}
    {#if !watching}
      {#each popups as p, i (i)}
        <div class="ring pop" style="left:{p.x}px;top:{p.y}px;width:{p.w}px;height:{p.h}px"></div>
      {/each}
    {/if}

    {#if !tour.busy}
      <div class="card" class:wide={step.wide} class:mini={watching} bind:clientWidth={cardW} bind:clientHeight={cardH} style="left:{pos.x}px;top:{pos.y}px" role="dialog" aria-label="Welcome tour">
        {#if watching}
          <div class="watching"><i class="spin"></i><span>{app.chatStatus.busy ? 'The co-GM is working — watch the canvas…' : 'Painting… watch the queue.'}</span></div>
        {:else}
          <header>
            <span class="ch">{chapter?.title}</span>
            <span class="dots" aria-hidden="true">{#each inChapter as _, i}<i class:on={i < nth} class:cur={i === nth - 1}></i>{/each}</span>
            <button class="x list" title="Chapters, restart, keys" aria-label="Chapters" onclick={() => (tour.menu = true)}>☰</button>
            <button class="x" title="Pause the tour (it waits in the ? menu)" aria-label="Pause the tour" onclick={pauseTour}>×</button>
          </header>
          <h3>{step.title}</h3>
          <div class="body">{#each para(tour.done && step.after ? `${step.body}\n\n${step.after}` : step.body) as p}<p>{@html p}</p>{/each}</div>

          {#if tour.action}
            <div class="act" class:done={tour.done}>
              <span class="mark">{tour.done ? '✓' : '▸'}</span>
              <span class="at">{@html para(tour.action.text)[0]}</span>
              {#if !tour.done && tour.action.auto}
                <button class="btn sm do" onclick={() => tour.action?.auto?.run()}>{tour.action.auto.label}</button>
              {/if}
            </div>
          {/if}

          <footer>
            <button class="btn ghost sm" disabled={tour.idx === 0} onclick={back}>‹ Back</button>
            <span class="grow"></span>
            {#if step.buttons?.length}
              {#each step.buttons as b}<button class="btn sm" class:primary={b.primary} onclick={() => void b.run()}>{b.label}</button>{/each}
            {:else}
              <button class="btn ghost sm" title="Go to the next chapter" onclick={skipChapter}>skip chapter</button>
              {#if tour.action && !tour.done}
                <button class="btn sm" onclick={next} title="Go on without doing it">Skip ›</button>
              {:else}
                <button class="btn primary sm" onclick={next}>{last ? 'Finish' : tour.idx === 0 ? 'Let’s go' : 'Next ›'}</button>
              {/if}
            {/if}
          </footer>
          <div class="bar"><i style="width:{Math.round(((tour.idx + 1) / STEPS.length) * 100)}%"></i></div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* no stacking context of its own: the dimmed cells set their own z-index so that the app's menus can sit above them */
  .tour { display: contents; }
  .cell { position: fixed; pointer-events: auto; background: rgba(6, 8, 14, 0.6); }
  .cell.clear { background: transparent; }
  .ring {
    position: fixed; z-index: 9000; border-radius: 12px; pointer-events: none; border: 2px solid var(--accent);
    transition: left 0.32s var(--ease), top 0.32s var(--ease), width 0.32s var(--ease), height 0.32s var(--ease);
    box-shadow: 0 0 22px -2px var(--accent), inset 0 0 18px -8px var(--accent);
    animation: pnp-tour-pulse 2.2s ease-in-out infinite;
  }
  .ring.free { border-style: dashed; }
  .ring.pop { border-radius: 14px; animation: none; }
  @keyframes pnp-tour-pulse { 50% { border-color: color-mix(in srgb, var(--accent) 45%, transparent); } }

  .card {
    position: fixed; width: 400px; max-width: calc(100vw - 28px); pointer-events: auto; z-index: 9001;
    background: var(--bg-2); border: 1px solid var(--accent); border-radius: 14px; padding: 12px 16px 0;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6), 0 0 36px -10px var(--accent);
    transition: left 0.32s var(--ease), top 0.32s var(--ease);
    animation: pnp-pop 0.22s ease-out;
  }
  .card.wide { width: 520px; }
  .card.mini { width: auto; padding: 8px 14px; border-radius: 99px; }
  .watching { display: flex; align-items: center; gap: 9px; color: var(--text-dim); font-size: 12.5px; }
  .spin { width: 12px; height: 12px; border: 2px solid var(--line-2); border-top-color: var(--accent); border-radius: 50%; display: inline-block; animation: pnp-spin 0.7s linear infinite; }
  @keyframes pnp-spin { to { transform: rotate(360deg); } }
  header { display: flex; align-items: center; gap: 10px; }
  .ch { font-size: 10.5px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--accent); font-weight: 600; }
  .dots { display: inline-flex; gap: 4px; margin-left: 4px; }
  .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--line-2); }
  .dots i.on { background: color-mix(in srgb, var(--accent) 55%, var(--line-2)); }
  .dots i.cur { background: var(--accent); box-shadow: 0 0 8px var(--accent); }
  .x { width: 24px; height: 24px; border-radius: 50%; border: 0; background: transparent; color: var(--text-faint); font-size: 18px; line-height: 1; }
  .x.list { margin-left: auto; font-size: 14px; }
  .x:hover { background: var(--bg-3); color: var(--text); }
  h3 { margin: 8px 0 6px; font-size: 16.5px; line-height: 1.25; }
  .body { color: var(--text-dim); font-size: 13px; line-height: 1.55; max-height: 46vh; overflow: auto; padding-right: 2px; }
  .body :global(p) { margin: 0 0 9px; }
  .body :global(b) { color: var(--text); }
  .body :global(code) { font-family: var(--mono); font-size: 11.5px; background: var(--bg); padding: 0 4px; border-radius: 4px; color: var(--text); }
  .body :global(kbd), .act :global(kbd) { font: 11px var(--mono); background: var(--bg-4); border: 1px solid var(--line-2); border-bottom-width: 2px; border-radius: 5px; padding: 0 5px; color: var(--text); }
  .act { display: flex; align-items: center; gap: 8px; margin: 4px 0 10px; padding: 8px 10px; border-radius: 10px; background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent); font-size: 12.5px; color: var(--text); }
  .act.done { background: #12301f; border-color: #2c5a3e; }
  .act .mark { font-weight: 700; color: var(--accent); }
  .act.done .mark { color: var(--ok); }
  .at { flex: 1; }
  .do { flex: none; }
  footer { display: flex; align-items: center; gap: 6px; padding: 4px 0 12px; }
  .grow { flex: 1; }
  .bar { height: 3px; margin: 0 -16px; background: var(--bg-4); border-radius: 0 0 14px 14px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--accent), #b89cff); transition: width 0.4s; }
  .btn.sm { padding: 3px 10px; font-size: 12px; }
</style>
