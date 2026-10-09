<script lang="ts">
  // A "jump marker": the end of a connection that leads to a node on ANOTHER canvas. Sits next to the node it hangs off
  // (the connection itself is the real one: select it, label it, delete it). Click to jump to the other end.
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { EDGE_KIND_INFO, type EdgeKind } from '@pnp/shared';
  import { app, cmd, focusNode } from '../lib/app.svelte';

  let { data }: NodeProps & { data: { edgeId: string; targetId: string; title: string; canvas: string; kind: EdgeKind; out: boolean; moved: boolean } } = $props();
  const info = $derived(EDGE_KIND_INFO[data.kind] ?? EDGE_KIND_INFO['leads-to']);
  const color = $derived(info.color);
</script>

<Handle type="target" position={Position.Left} isConnectable={false} />
<!-- the colour is the connection's own (leads to grey, if … orange, reveals purple …), the same as the line that runs to it -->
<div class="wrap" style="--c:{color}" data-kind={data.kind}>
<!-- only the grip drags the marker; a click on the rest jumps -->
<span class="grip" role="presentation" title={data.moved ? 'Drag to move this marker — double-click to put it back where it was placed automatically' : 'Drag to move this marker'} ondblclick={() => cmd('move_edge_marker', { edgeId: data.edgeId, canvas: app.canvasId, reset: true })}>⠿</span>
<button class="stub nodrag" onclick={(e) => { e.stopPropagation(); focusNode(data.targetId); }} title={`${info.label}: ${data.out ? 'continues' : 'comes from'} on the canvas “${data.canvas}” — click to jump there`}>
  <span class="arrow">{data.out ? '↠' : '↞'}</span>
  <span class="txt"><i><em>{info.label}</em> · {data.canvas}</i><b>{data.title}</b></span>
</button>
</div>
<Handle type="source" position={Position.Right} isConnectable={false} />

<style>
  .wrap { display: flex; align-items: stretch; width: 230px; }
  .grip { display: grid; place-items: center; width: 18px; flex: none; cursor: grab; color: #0a0c11; background: var(--c); border: 2px solid var(--c); border-right: 0; border-radius: 10px 0 0 10px; font-size: 14px; user-select: none; }
  .grip:active { cursor: grabbing; }
  .stub { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 6px 10px; text-align: left; border-radius: 10px; cursor: pointer; color: var(--text);
    background: color-mix(in srgb, var(--c) 20%, var(--bg-3)); border: 2px dashed var(--c); border-radius: 0 10px 10px 0; }
  .stub:hover { background: color-mix(in srgb, var(--c) 32%, var(--bg-3)); }
  .arrow { color: var(--c); font-size: 18px; font-weight: 700; }
  .txt { display: grid; min-width: 0; line-height: 1.25; }
  i { font-style: normal; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  i em { font-style: normal; font-weight: 700; color: var(--c); }
  b { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
