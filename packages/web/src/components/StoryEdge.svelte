<script lang="ts">
  import { EdgeLabel, EdgeReconnectAnchor, getBezierPath, type EdgeProps } from '@xyflow/svelte';
  import { Tween } from 'svelte/motion';
  import { EDGE_KIND_INFO, type EdgeKind } from '@pnp/shared';
  import { app, cmd } from '../lib/app.svelte';

  let { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data: rawData, selected }: EdgeProps = $props();
  const data = $derived(rawData as { kind: EdgeKind; label: string; ghost?: boolean; played?: boolean; trailColor?: string; proposed?: boolean });

  const style = $derived(EDGE_KIND_INFO[data.kind] ?? EDGE_KIND_INFO['leads-to']);
  const mode = $derived(data.ghost ? 'fade' : app.edgeFx[id]);
  const present = $derived(app.presence?.edgeId === id ? app.presence : null);
  const oldLabel = $derived(app.edgeDiffs[id]?.from ?? '');
  const showOld = $derived(!!app.edgeDiffs[id] && oldLabel !== (data.label ?? ''));
  const actorColor = $derived(present?.actor === 'agy' ? 'var(--agy)' : 'var(--claude)');

  // The displayed end points tween while an edge is being rewired (slide old -> new);
  // otherwise they track the props 1:1 (so dragging nodes stays crisp).
  const disp = new Tween({ sx: 0, sy: 0, tx: 0, ty: 0 }, { duration: 0 });
  let first = true;
  $effect(() => {
    const target = { sx: sourceX, sy: sourceY, tx: targetX, ty: targetY };
    if (first) {
      first = false;
      void disp.set(target, { duration: 0 });
    } else if (mode === 'rewire') {
      void disp.set(target, { duration: 950, easing: (t) => 1 - Math.pow(1 - t, 3) });
    } else {
      void disp.set(target, { duration: 0 });
    }
  });

  // --- label editing: double-click the edge/label, or use the "+ label" chip on a selected edge
  let editing = $state(false);
  let draft = $state('');
  function start() {
    if (data.ghost) return;
    draft = data.label ?? '';
    editing = true;
  }
  function commit() {
    if (!editing) return;
    editing = false;
    const next = draft.trim();
    if (next !== (data.label ?? '')) void cmd('relink', { edgeId: id, label: next });
  }
  // the label is portalled into the flow's label layer after mount, which drops focus: focus a tick later
  const focusSelect = (el: HTMLInputElement) => {
    const t = setTimeout(() => {
      el.focus();
      el.select();
    }, 30);
    return { destroy: () => clearTimeout(t) };
  };

  const path = $derived(
    getBezierPath({
      sourceX: disp.current.sx, sourceY: disp.current.sy, targetX: disp.current.tx, targetY: disp.current.ty,
      sourcePosition, targetPosition,
    }),
  );
</script>

<g style="color:{present ? actorColor : data.played ? (data.trailColor ?? '#ffd166') : style.color}">
  <path
    class="pnp-edge-path"
    class:draw={mode === 'draw'}
    class:fade={mode === 'fade'}
    class:flash={mode === 'flash' || mode === 'rewire'}
    class:present={!!present}
    class:trail={!!data.played && !present}
    d={path[0]}
    pathLength={mode === 'draw' ? 1 : undefined}
    stroke={present ? actorColor : data.played ? (data.trailColor ?? '#ffd166') : style.color}
    stroke-width={present ? 4 : data.played ? 3.5 : data.proposed ? 3 : 2}
    stroke-dasharray={mode === 'draw' || data.played ? undefined : data.proposed ? '7 5' : style.dash}
    fill="none"
    stroke-linecap="round"
  />
  <!-- fat invisible path for easier clicking -->
  <path d={path[0]} stroke="transparent" stroke-width="18" fill="none" role="presentation" ondblclick={(e) => { e.stopPropagation(); start(); }} />
  <polygon
    class="arrow"
    points="-6,-4.5 3,0 -6,4.5"
    fill={data.played ? (data.trailColor ?? '#ffd166') : style.color}
    transform={`translate(${disp.current.tx},${disp.current.ty})`}
  />
</g>

{#if editing}
  <EdgeLabel x={path[1]} y={path[2]}>
    <input
      class="lbl-input"
      style="--c:{style.color}"
      placeholder="label…"
      bind:value={draft}
      use:focusSelect
      onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commit(); else if (e.key === 'Escape') editing = false; }}
      onblur={commit}
    />
  </EdgeLabel>
{:else if data.label || present || showOld}
  <EdgeLabel x={path[1]} y={path[2]} selectEdgeOnClick>
    <span class="stack">
      {#if present}<span class="who" style="--pc:{actorColor}">{present.actor === 'agy' ? 'agy' : 'Claude'}</span>{/if}
      {#if showOld && oldLabel}<span class="old">{oldLabel}</span>{/if}
      {#if data.label}
        <span class="lbl" class:fresh={showOld} style="--c:{present ? actorColor : style.color}" role="presentation" ondblclick={(e) => { e.stopPropagation(); start(); }} title="Double-click to edit">{data.label}</span>
      {/if}
    </span>
  </EdgeLabel>
{:else if selected && !data.ghost}
  <EdgeLabel x={path[1]} y={path[2]}>
    <button class="add" style="--c:{style.color}" onclick={start}>＋ label</button>
  </EdgeLabel>
{/if}

{#if selected && !data.ghost}
  <EdgeReconnectAnchor type="source" position={{ x: sourceX, y: sourceY }} />
  <EdgeReconnectAnchor type="target" position={{ x: targetX, y: targetY }} />
{/if}

<style>
  .pnp-edge-path { transition: stroke-width 0.15s; }
  .pnp-edge-path.draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: pnp-draw 1s var(--ease) forwards; filter: drop-shadow(0 0 5px currentColor); }
  .pnp-edge-path.fade { animation: pnp-fade 0.7s ease-in forwards; }
  .pnp-edge-path.flash { filter: drop-shadow(0 0 6px currentColor); }
  .arrow { opacity: 0.9; }
  .lbl-input { width: 150px; font: inherit; font-size: 11px; padding: 2px 8px; border-radius: 99px; background: var(--bg-2); border: 1px solid var(--c); color: var(--text); outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 25%, transparent); pointer-events: all; }
  .add { font-size: 10.5px; padding: 1px 8px; border-radius: 99px; background: var(--bg-2); border: 1px dashed var(--c); color: var(--c); cursor: pointer; pointer-events: all; }
  .add:hover { background: var(--bg-3); }
  .stack { display: flex; flex-direction: column; align-items: center; gap: 2px; pointer-events: none; }
  .who { font-size: 9.5px; font-weight: 600; letter-spacing: 0.05em; background: var(--pc); color: #0a0c11; padding: 0 7px; border-radius: 99px; box-shadow: 0 0 14px var(--pc); animation: pnp-pop 0.2s ease-out; }
  .old { font-size: 10.5px; color: var(--danger); text-decoration: line-through; opacity: 0.85; white-space: nowrap; animation: pnp-pop 0.25s ease-out; }
  .lbl.fresh { animation: pnp-flash 1.2s ease-out; --glow: var(--c); }
  .pnp-edge-path.trail { filter: drop-shadow(0 0 6px currentColor); }
  .pnp-edge-path.present { filter: drop-shadow(0 0 7px currentColor); }
  .lbl {
    font-size: 10.5px; padding: 1px 7px; border-radius: 99px; background: var(--bg-2);
    border: 1px solid var(--c); color: var(--c); white-space: nowrap; pointer-events: all;
  }
</style>
