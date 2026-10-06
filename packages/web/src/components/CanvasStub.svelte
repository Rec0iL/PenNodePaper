<script lang="ts">
  // A "jump marker": the end of a connection that leads to a node on ANOTHER canvas. Sits next to the node it hangs off
  // (the connection itself is the real one: select it, label it, delete it). Click to jump to the other end.
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { EDGE_KIND_INFO, type EdgeKind } from '@pnp/shared';
  import { focusNode } from '../lib/app.svelte';

  let { data }: NodeProps & { data: { targetId: string; title: string; canvas: string; kind: EdgeKind; out: boolean } } = $props();
  const color = $derived((EDGE_KIND_INFO[data.kind] ?? EDGE_KIND_INFO['leads-to']).color);
</script>

<Handle type="target" position={Position.Left} isConnectable={false} />
<button class="stub nodrag" style="--c:{color}" onclick={(e) => { e.stopPropagation(); focusNode(data.targetId); }} title={`${data.out ? 'Continues' : 'Comes from'} on the canvas “${data.canvas}” — click to jump there`}>
  <span class="arrow">{data.out ? '↠' : '↞'}</span>
  <span class="txt"><i>{data.canvas}</i><b>{data.title}</b></span>
</button>
<Handle type="source" position={Position.Right} isConnectable={false} />

<style>
  .stub { width: 230px; display: flex; align-items: center; gap: 8px; padding: 6px 10px; text-align: left; border-radius: 10px; cursor: pointer; color: var(--text);
    background: color-mix(in srgb, var(--c) 14%, var(--bg-3)); border: 1px dashed var(--c); }
  .stub:hover { background: color-mix(in srgb, var(--c) 26%, var(--bg-3)); }
  .arrow { color: var(--c); font-size: 16px; }
  .txt { display: grid; min-width: 0; line-height: 1.25; }
  i { font-style: normal; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  b { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
