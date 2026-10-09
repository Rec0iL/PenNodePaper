<script lang="ts">
  // The inspector for a selected frame (click its title tab): name, colour, and what is inside.
  import { FRAME_PALETTE, type Frame } from '@pnp/shared';
  import { app, cmd, selectFrame } from '../lib/app.svelte';

  let { frame }: { frame: Frame } = $props();

  const inside = $derived(
    Object.entries(app.graph.placements).filter(([id, p]) => p.canvas === frame.canvas && !app.nodes[id]?.trashed && p.x + 140 >= frame.x && p.x + 140 <= frame.x + frame.w && p.y + 46 >= frame.y && p.y + 46 <= frame.y + frame.h).length,
  );
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const custom = $derived(!FRAME_PALETTE.some((c) => same(c, frame.color)));

  const setColor = (color: string) => { if (!same(color, frame.color)) void cmd('update_frame', { id: frame.id, color }); };
  const rename = (title: string) => { const t = title.trim(); if (t && t !== frame.title) void cmd('update_frame', { id: frame.id, title: t }); };
  async function remove() {
    selectFrame(null);
    await cmd('delete_frame', { id: frame.id });
  }
</script>

<div class="insp" style="--tc:{frame.color}">
  <div class="head"><span class="icon">▭</span><div><div class="kind">Frame</div><div class="sub">{inside} node{inside === 1 ? '' : 's'} inside — they move with it (drag its title)</div></div></div>

  <div class="label">Name</div>
  <input class="field" value={frame.title} maxlength="60" onchange={(e) => rename(e.currentTarget.value)} onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />

  <div class="label">Colour</div>
  <div class="sw">
    {#each FRAME_PALETTE as c (c)}<button class:on={same(frame.color, c)} style="--c:{c}" aria-label={c} title={c} onclick={() => setColor(c)}></button>{/each}
    <label class="own" class:on={custom} style="--c:{frame.color}" title="Pick any colour"><input type="color" value={frame.color} onchange={(e) => setColor(e.currentTarget.value)} /><span>＋</span></label>
  </div>
  <div class="dim small">The AI can change the colour as well (<code>update_frame</code>).</div>

  <div class="label">Frame</div>
  <button class="btn danger" onclick={remove} title="The nodes inside stay where they are">Remove the frame <span class="dim">· nodes stay</span></button>
</div>

<style>
  .insp { display: grid; gap: 6px; padding: 14px; align-content: start; }
  .head { display: flex; gap: 10px; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
  .icon { font-size: 22px; color: var(--tc); }
  .kind { font-weight: 600; font-size: 14px; }
  .sub { color: var(--text-faint); font-size: 11.5px; }
  .label { margin-top: 6px; }
  .sw { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .sw button, .own { width: 26px; height: 26px; border-radius: 50%; background: var(--c); border: 2px solid transparent; padding: 0; position: relative; cursor: pointer; }
  .sw button.on, .own.on { border-color: var(--text); box-shadow: 0 0 0 2px var(--bg-2) inset; }
  .own { display: grid; place-items: center; overflow: hidden; background: conic-gradient(#ff7a9c, #ffd166, #7fe0a0, #5fd4c4, #7aa2ff, #b89cff, #ff7a9c); }
  .own.on { background: var(--c); }
  .own span { font-size: 15px; color: #0a0c11; font-weight: 700; pointer-events: none; }
  .own input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
  .dim { color: var(--text-faint); } .small { font-size: 11.5px; }
  code { font-family: var(--mono); font-size: 11px; background: var(--bg); padding: 0 4px; border-radius: 4px; }
</style>
