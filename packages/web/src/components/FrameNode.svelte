<script lang="ts">
  // A frame: a labelled coloured area behind a group of nodes. Only the title bar drags it (nodes inside come along);
  // the body lets clicks through so panning and box-selecting still work on the canvas.
  import { tick } from 'svelte';
  import { NodeResizer, type NodeProps } from '@xyflow/svelte';
  import type { Frame } from '@pnp/shared';
  import { app, cmd } from '../lib/app.svelte';

  let { data, selected }: NodeProps & { data: { frame: Frame } } = $props();
  const f = $derived(data.frame);

  let editing = $state(false);
  let draft = $state('');
  let input = $state<HTMLInputElement>();

  async function edit() {
    draft = f.title;
    editing = true;
    await tick();
    input?.focus();
    input?.select();
  }
  function commit() {
    if (!editing) return;
    editing = false;
    const t = draft.trim();
    if (t && t !== f.title) void cmd('update_frame', { id: f.id, title: t });
  }
  // a frame that was just created asks for its name
  $effect(() => {
    if (app.editingFrame === f.id) {
      app.editingFrame = null;
      void edit();
    }
  });

  function resized(_e: unknown, p: { x: number; y: number; width: number; height: number }) {
    void cmd('update_frame', { id: f.id, x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) });
  }
</script>

<NodeResizer minWidth={160} minHeight={90} isVisible={selected} onResizeEnd={resized} color={f.color} />
<div class="frame" class:sel={selected} class:compact={app.lod === 'compact'} style="--c:{f.color}">
  <div class="frame-bar" role="presentation" ondblclick={edit}>
    {#if editing}
      <input bind:this={input} class="nodrag" bind:value={draft} onblur={commit} onkeydown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') editing = false; e.stopPropagation(); }} />
    {:else}
      <span class="t" title="Drag to move the frame and everything in it · double-click to rename">▭ {f.title}</span>
    {/if}
  </div>
</div>

<style>
  .frame { width: 100%; height: 100%; box-sizing: border-box; border: 2px dashed color-mix(in srgb, var(--c) 70%, transparent); border-radius: 18px; background: color-mix(in srgb, var(--c) 7%, transparent); pointer-events: none; position: relative; }
  .frame.sel { border-style: solid; background: color-mix(in srgb, var(--c) 11%, transparent); }
  .frame-bar { position: absolute; left: 14px; top: -14px; pointer-events: auto; cursor: grab; max-width: calc(100% - 28px); }
  .t { display: inline-block; background: var(--c); color: #0a0c11; font-size: 12px; font-weight: 700; letter-spacing: .03em; padding: 3px 12px; border-radius: 99px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .frame.compact .t { font-size: 34px; padding: 6px 22px; }
  .frame.compact .frame-bar { top: -28px; }
  input { background: var(--bg-2); border: 1px solid var(--c); color: var(--text); border-radius: 99px; padding: 2px 10px; font-size: 12px; width: 240px; outline: none; }
</style>
