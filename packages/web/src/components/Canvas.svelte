<script lang="ts">
  import { untrack } from 'svelte';
  import {
    SvelteFlow, Background, BackgroundVariant, Controls, MiniMap, Panel,
    type Node, type Edge, type Connection,
  } from '@xyflow/svelte';
  import { NODE_TYPES, NODE_TYPE_INFO, EDGE_KINDS, EDGE_KIND_INFO, groupColor, trailEdges, type CampaignState, type NodeType, type EdgeKind } from '@pnp/shared';
  import { NODE_H, NODE_W, app, closeEnlarged, cmd, closeMenus, noteZoom, openCrossLink, screenToFlow, selectEdge, selectFrame, selectNode, viewCenter } from '../lib/app.svelte';
  import NodeCard from './NodeCard.svelte';
  import StoryEdge from './StoryEdge.svelte';
  import FlowBridge from './FlowBridge.svelte';
  import FrameNode from './FrameNode.svelte';
  import CanvasStub from './CanvasStub.svelte';
  import ReviewBar from './ReviewBar.svelte';

  const nodeTypes = { story: NodeCard, frame: FrameNode, stub: CanvasStub };
  const FRAME = 'frame:';
  /** jump markers for connections that lead to another canvas (not real nodes) */
  const STUB = 'stub:';
  const STUB_W = 230;
  const STUB_H = 48;
  type Box = { x: number; y: number; w: number; h: number };
  const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const edgeTypes = { story: StoryEdge };

  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);

  // app state -> flow nodes/edges (one-way; user gestures go out as commands)
  $effect(() => {
    const canvas = app.canvasId;
    const prev = new Map(untrack(() => nodes).map((n) => [n.id, n]));
    const next: Node[] = [];
    for (const f of app.graph.frames ?? []) {
      if (f.canvas !== canvas) continue;
      const old = prev.get(FRAME + f.id);
      next.push({ ...(old ?? {}), id: FRAME + f.id, type: 'frame', position: { x: f.x, y: f.y }, width: f.w, height: f.h, data: { frame: f }, zIndex: -1, dragHandle: '.frame-bar', connectable: false, class: 'frame-node' });
    }
    for (const [id, p] of Object.entries(app.graph.placements)) {
      const n = app.nodes[id];
      if (!n || n.trashed || p.canvas !== canvas) continue;
      const old = prev.get(id);
      next.push({
        ...(old && !old.data.ghost ? old : {}),
        id,
        type: 'story',
        position: { x: p.x, y: p.y },
        data: { node: n },
        class: app.fx[id]?.glide ? 'fx-glide' : '',
        zIndex: app.enlarged?.id === id ? 5000 : undefined, // an enlarged card lies over its neighbours
      });
    }
    for (const [id, g] of Object.entries(app.ghosts)) {
      if (g.placement.canvas !== canvas) continue;
      next.push({ id: `ghost:${id}`, type: 'story', position: { x: g.placement.x, y: g.placement.y }, data: { node: g.node, ghost: true }, draggable: false, selectable: false, connectable: false });
    }
    nodes = next;

    const proposedEdges = new Set(app.proposals.flatMap((p) => p.edges));
    const trail = trailEdges({ meta: app.meta, nodes: app.nodes, graph: app.graph } as unknown as CampaignState);
    const visible = new Set(Object.entries(app.graph.placements).filter(([, p]) => p.canvas === canvas).map(([id]) => id));
    const es: Edge[] = [];
    const stubs: Node[] = [];
    // what a jump marker must not sit on: the cards of this canvas and the markers already placed
    const taken: Box[] = Object.entries(app.graph.placements)
      .filter(([id, p]) => p.canvas === canvas && app.nodes[id] && !app.nodes[id].trashed)
      .map(([, p]) => ({ x: p.x - 12, y: p.y - 12, w: NODE_W + 24, h: NODE_H + 24 }));
    for (const e of app.graph.edges) {
      const fromHere = visible.has(e.from);
      const toHere = visible.has(e.to);
      if (!fromHere && !toHere) continue;
      const g = trail.get(e.id);
      const data = { kind: e.kind, label: e.label, played: !!g, trailColor: g ? groupColor(g) : undefined, proposed: proposedEdges.has(e.id) };
      if (fromHere && toHere) {
        es.push({ id: e.id, source: e.from, target: e.to, type: 'story', data });
        continue;
      }
      // exactly one end is on this canvas: draw the connection to a jump marker next to it (the other end may be in the pool: then there is nothing to jump to)
      const out = fromHere;
      const here = out ? e.from : e.to;
      const there = out ? e.to : e.from;
      const tp = app.graph.placements[there];
      const tn = app.nodes[there];
      const hp = app.graph.placements[here];
      if (!tp || !tn || tn.trashed || !hp) continue;
      // where the GM put it, else next to the node (right for outgoing, left for incoming), moving up/down until it is free
      const saved = e.markers?.[canvas];
      let px = saved ? saved.x : out ? hp.x + NODE_W + 90 : hp.x - STUB_W - 90;
      let py = saved ? saved.y : hp.y;
      if (!saved) {
        for (let i = 0; i < 24; i++) {
          const cand = hp.y + (i % 2 ? -1 : 1) * Math.ceil(i / 2) * (STUB_H + 8);
          if (!taken.some((b) => hit(b, { x: px, y: cand, w: STUB_W, h: STUB_H }))) { py = cand; break; }
        }
      }
      taken.push({ x: px, y: py, w: STUB_W, h: STUB_H });
      const sid = STUB + e.id;
      stubs.push({
        ...(prev.get(sid) ?? {}),
        id: sid, type: 'stub',
        position: { x: px, y: py },
        data: { edgeId: e.id, targetId: there, title: tn.title, canvas: app.graph.canvases.find((c) => c.id === tp.canvas)?.name ?? tp.canvas, kind: e.kind, out, moved: !!saved },
        draggable: true, dragHandle: '.grip', selectable: false, connectable: false, deletable: false,
      });
      es.push({ id: e.id, source: out ? e.from : sid, target: out ? sid : e.to, type: 'story', data });
    }
    if (stubs.length) nodes = [...next, ...stubs];
    for (const g of Object.values(app.edgeGhosts)) {
      if (visible.has(g.edge.from) && visible.has(g.edge.to))
        es.push({ id: `ghost:${g.edge.id}`, source: g.edge.from, target: g.edge.to, type: 'story', data: { kind: g.edge.kind, label: g.edge.label, ghost: true }, selectable: false });
    }
    edges = es;
  });

  // An enlarged card shrinks again when you double-click the empty canvas, pick another card, press Esc, use its × or switch canvas —
  // a plain click on the canvas leaves it alone.
  $effect(() => {
    const id = app.enlarged?.id;
    if (!id) return;
    const down = (e: PointerEvent) => {
      const other = (e.target as Element | null)?.closest?.('.svelte-flow__node')?.getAttribute('data-id');
      if (!other || other === id || /^(frame|stub|ghost):/.test(other)) return;
      closeEnlarged(true, true); // another card was grabbed
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  });
  // the selection moved to another node some other way (inspector, chat, search, pool, a jump marker): the one who moved it also moves the camera
  $effect(() => {
    const sel = app.selectedId;
    untrack(() => {
      if (app.enlarged && sel && sel !== app.enlarged.id) closeEnlarged(false);
    });
  });
  $effect(() => {
    app.canvasId;
    untrack(() => closeEnlarged(false));
  });
  function onPaneDblClick(e: MouseEvent) {
    if (!app.enlarged) return;
    const t = e.target as Element;
    if (t.closest('.svelte-flow__node, .svelte-flow__edge, .svelte-flow__controls, .svelte-flow__minimap, .svelte-flow__panel')) return;
    if (t.closest('.svelte-flow__pane, .svelte-flow__background')) closeEnlarged();
  }

  // selection from outside (timeline click, chat card) -> flow
  $effect(() => {
    const id = app.selectedId;
    if (!id) return;
    untrack(() => {
      const cur = nodes.find((n) => n.id === id);
      if (cur && !cur.selected) nodes = nodes.map((n) => ({ ...n, selected: n.id === id }));
    });
  });

  // ---- gestures -> commands -------------------------------------------------
  function onconnect(c: Connection) {
    void cmd('link', { from: c.source, to: c.target, kind: app.edgeKind });
  }

  function onreconnect(old: Edge, c: Connection) {
    // the far end of a cross-canvas connection is only a jump marker: it cannot be re-wired from here
    if (c.source.startsWith(STUB) || c.target.startsWith(STUB)) return;
    if (old.source.startsWith(STUB) || old.target.startsWith(STUB)) return;
    void cmd('relink', { edgeId: old.id, from: c.source, to: c.target });
  }

  function ondelete({ nodes: dnAll, edges: de }: { nodes: Node[]; edges: Edge[] }) {
    let dn = dnAll.filter((n) => !n.id.startsWith(STUB));
    const gone = new Set(dn.map((n) => n.id));
    const ops: { command: string; args: Record<string, unknown> }[] = [];
    for (const n of dn) if (n.id.startsWith(FRAME)) ops.push({ command: 'delete_frame', args: { id: n.id.slice(FRAME.length) } });
    dn = dn.filter((n) => !n.id.startsWith(FRAME));
    for (const e of de) if (!gone.has(e.source) && !gone.has(e.target)) ops.push({ command: 'unlink', args: { edgeId: e.id } });
    for (const n of dn) ops.push({ command: 'delete_node', args: { id: n.id } });
    if (ops.length) void cmd('batch', { ops, label: dn.length ? `Deleted ${dn.length} node(s)` : ops.some((o) => o.command === 'delete_frame') ? 'Removed a frame' : 'Removed edge(s)' });
  }

  // a connection dragged out of a node and dropped on a canvas TAB: pick the node on that canvas to connect to
  function onconnectend(event: MouseEvent | TouchEvent, state: { isValid: boolean | null; fromNode: Node | null; fromHandle: { type: string } | null }) {
    const from = state.fromNode;
    if (state.isValid || !from || from.id.startsWith(FRAME) || from.id.startsWith(STUB) || from.data.ghost) return;
    const pt = 'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent);
    const tab = document.elementsFromPoint(pt.clientX, pt.clientY).find((el) => (el as HTMLElement).dataset?.canvasTab) as HTMLElement | undefined;
    if (tab?.dataset.canvasTab) openCrossLink(from.id, state.fromHandle?.type === 'target' ? 'in' : 'out', tab.dataset.canvasTab);
  }

  function overPool(ev: MouseEvent | TouchEvent): boolean {
    const el = document.querySelector('[data-pool-drop]');
    if (!el) return false;
    const pt = 'changedTouches' in ev ? ev.changedTouches[0] : (ev as MouseEvent);
    const r = el.getBoundingClientRect();
    return pt.clientX >= r.left && pt.clientX <= r.right && pt.clientY >= r.top && pt.clientY <= r.bottom;
  }

  // dragging a frame carries the nodes inside it (their centre inside the frame)
  let carry: { id: string; sx: number; sy: number; members: { id: string; x: number; y: number }[] } | null = null;
  function onnodedragstart({ targetNode }: { targetNode: Node | null }) {
    carry = null;
    if (!targetNode?.id.startsWith(FRAME)) return;
    const f = targetNode.data.frame as { id: string; x: number; y: number; w: number; h: number; canvas: string };
    const members = Object.entries(app.graph.placements)
      .filter(([, p]) => p.canvas === f.canvas && p.x + 140 >= f.x && p.x + 140 <= f.x + f.w && p.y + 46 >= f.y && p.y + 46 <= f.y + f.h)
      .map(([id, p]) => ({ id, x: p.x, y: p.y }));
    carry = { id: f.id, sx: f.x, sy: f.y, members };
  }
  function onnodedrag({ targetNode }: { targetNode: Node | null }) {
    if (!carry || !targetNode || targetNode.id !== FRAME + carry.id) return;
    const dx = targetNode.position.x - carry.sx, dy = targetNode.position.y - carry.sy;
    const by = new Map(carry.members.map((m) => [m.id, m]));
    nodes = nodes.map((n) => (by.has(n.id) ? { ...n, position: { x: by.get(n.id)!.x + dx, y: by.get(n.id)!.y + dy } } : n));
  }

  function onnodedragstop({ nodes: movedAll, event }: { nodes: Node[]; event: MouseEvent | TouchEvent }) {
    // a jump marker was dragged by its grip: remember where it now sits (on this canvas)
    for (const n of movedAll.filter((x) => x.id.startsWith(STUB))) {
      const d = n.data as { edgeId: string };
      void cmd('move_edge_marker', { edgeId: d.edgeId, canvas: app.canvasId, x: n.position.x, y: n.position.y });
    }
    const fr = movedAll.find((n) => n.id.startsWith(FRAME));
    if (fr && carry && fr.id === FRAME + carry.id) {
      const dx = Math.round(fr.position.x - carry.sx), dy = Math.round(fr.position.y - carry.sy);
      const id = carry.id;
      carry = null;
      if (dx || dy) void cmd('move_frame', { id, dx, dy });
      return;
    }
    const moved = movedAll.filter((n) => !n.id.startsWith(FRAME) && !n.id.startsWith(STUB));
    if (!moved.length) return;
    if (overPool(event)) {
      void cmd('batch', { ops: moved.map((n) => ({ command: 'move_to_pool', args: { id: n.id } })), label: `Moved ${moved.length} node(s) to the pool` });
      return;
    }
    const changed = moved.filter((n) => {
      const p = app.graph.placements[n.id];
      return p && (Math.round(n.position.x) !== p.x || Math.round(n.position.y) !== p.y);
    });
    if (changed.length)
      void cmd('batch', { ops: changed.map((n) => ({ command: 'move_node', args: { id: n.id, x: n.position.x, y: n.position.y } })), label: changed.length > 1 ? `Moved ${changed.length} nodes` : undefined });
  }

  function ondragover(e: DragEvent) {
    if (e.dataTransfer?.types.includes('application/x-pnp-node')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }

  function ondrop(e: DragEvent) {
    const id = e.dataTransfer?.getData('application/x-pnp-node');
    if (!id) return;
    e.preventDefault();
    const pos = screenToFlow({ x: e.clientX, y: e.clientY });
    void cmd('place_on_canvas', { id, canvas: app.canvasId, x: Math.round(pos.x - 140), y: Math.round(pos.y - 40) });
  }

  // quick-create bar
  let newType = $state<NodeType>('scene');
  let newTitle = $state('');
  async function create(place: 'canvas' | 'pool') {
    const title = newTitle.trim() || NODE_TYPE_INFO[newType].label;
    const at = place === 'canvas' ? viewCenter() : {};
    const r = await cmd<{ id: string }>('create_node', { type: newType, title, place, ...at });
    newTitle = '';
    if (r) selectNode(r.id);
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && app.enlarged && closeEnlarged()} />

<div class="canvas" data-tour="canvas" role="application" {ondragover} {ondrop} ondblclick={onPaneDblClick}>
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    {edgeTypes}
    colorMode="dark"
    fitView
    minZoom={0.1}
    maxZoom={2.2}
    snapGrid={[10, 10]}
    deleteKey={['Delete', 'Backspace']}
    zoomOnDoubleClick={false}
    proOptions={{ hideAttribution: true }}
    {onconnect}
    {onconnectend}
    {onreconnect}
    {ondelete}
    {onnodedragstart}
    onmove={(_e, vp) => noteZoom(vp.zoom)}
    onmoveend={(_e, vp) => noteZoom(vp.zoom)}
    {onnodedrag}
    {onnodedragstop}
    multiSelectionKey={['Shift', 'Control', 'Meta']}
    onselectionchange={({ nodes: sel }) => { const ids = sel.filter((n) => !n.data.ghost && !n.id.startsWith(FRAME) && !n.id.startsWith(STUB)).map((n) => n.id); app.multi = ids.length > 1 ? ids : []; }}
    onnodeclick={({ node, event }) => { if (node.id.startsWith(FRAME)) { if (!(event.shiftKey || event.ctrlKey || event.metaKey)) selectFrame(node.id.slice(FRAME.length)); return; } if (node.id.startsWith(STUB)) return; if (!(event.shiftKey || event.ctrlKey || event.metaKey)) selectNode(node.id); }}
    onnodecontextmenu={({ node, event }) => {
      event.preventDefault();
      closeMenus();
      if (node.id.startsWith(FRAME)) { app.frameMenu = { frameId: node.id.slice(FRAME.length), x: event.clientX, y: event.clientY }; return; }
      if (node.data.ghost || node.id.startsWith(STUB)) return;
      if (!app.multi.includes(node.id)) selectNode(node.id);
      app.nodeMenu = { nodeId: node.id, x: event.clientX, y: event.clientY };
    }}
    onselectioncontextmenu={({ nodes: sel, event }) => {
      // right-click on the selection box (after a Shift-drag) acts on the whole selection
      event.preventDefault();
      closeMenus();
      const ids = sel.filter((n) => !n.data.ghost && !n.id.startsWith(FRAME) && !n.id.startsWith(STUB)).map((n) => n.id);
      if (!ids.length) return;
      if (ids.length > 1) app.multi = ids;
      app.nodeMenu = { nodeId: ids[0], x: event.clientX, y: event.clientY };
    }}
    onedgecontextmenu={({ edge, event }) => {
      event.preventDefault();
      closeMenus();
      if (edge.id.startsWith('ghost:')) return;
      selectEdge(edge.id);
      app.edgeMenu = { edgeId: edge.id, x: event.clientX, y: event.clientY };
    }}
    onedgeclick={({ edge }) => selectEdge(edge.id.startsWith('ghost:') ? null : edge.id)}
    onpaneclick={() => { selectNode(null); selectEdge(null); closeMenus(); }}
    onpanecontextmenu={({ event }) => {
      event.preventDefault();
      closeMenus();
      const p = screenToFlow({ x: event.clientX, y: event.clientY });
      app.paneMenu = { x: event.clientX, y: event.clientY, fx: Math.round(p.x - 140), fy: Math.round(p.y - 40) };
    }}
  >
    <FlowBridge />
    <Background variant={BackgroundVariant.Dots} gap={26} size={1.4} />
    <Controls showLock={false} />
    <MiniMap pannable zoomable nodeColor={(n) => NODE_TYPE_INFO[(n.data as { node: { type: NodeType } }).node?.type]?.color ?? '#555'} maskColor="rgba(10,12,17,0.7)" />

    <Panel position="top-left" class="tlpanel">
      <div class="tl">
      <div class="create" data-tour="create-bar">
        <select class="field" bind:value={newType}>
          {#each NODE_TYPES as t}<option value={t}>{NODE_TYPE_INFO[t].icon} {NODE_TYPE_INFO[t].label}</option>{/each}
        </select>
        <input class="field" placeholder="New node title…" bind:value={newTitle} onkeydown={(e) => e.key === 'Enter' && create('canvas')} />
        <button class="btn primary" onclick={() => create('canvas')} title="Add to the canvas">+ Canvas</button>
        <button class="btn" onclick={() => create('pool')} title="Prepare it in the sidebar pool">+ Pool</button>
      </div>
      <ReviewBar />
      </div>
    </Panel>

    <Panel position="bottom-center">
      <div class="kinds" data-tour="kinds" title="Kind of the next connection you draw — hover a kind to see what it is for">
        {#each EDGE_KINDS as k}
          <button class="kind" class:on={app.edgeKind === k} style="--c:{EDGE_KIND_INFO[k].color}" title={EDGE_KIND_INFO[k].help} onclick={() => (app.edgeKind = k as EdgeKind)}>
            <i></i>{EDGE_KIND_INFO[k].label}
          </button>
        {/each}
      </div>
    </Panel>
  </SvelteFlow>
</div>

<style>
  .canvas { height: 100%; width: 100%; position: relative; }
  /* the review bar sits under the add bar and is as wide as it: they can never overlap, however narrow the window */
  :global(.tlpanel) { max-width: calc(100% - 30px); }
  .tl { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
  .create { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; background: color-mix(in srgb, var(--bg-2) 88%, transparent); backdrop-filter: blur(10px); border: 1px solid var(--line-2); border-radius: var(--radius); }
  .create select { width: 140px; flex: 0 1 140px; min-width: 0; }
  .create input { flex: 1 1 150px; min-width: 0; width: 190px; }
  .kinds { display: flex; gap: 2px; padding: 4px; background: color-mix(in srgb, var(--bg-2) 88%, transparent); backdrop-filter: blur(10px); border: 1px solid var(--line-2); border-radius: 99px; }
  .kind { white-space: nowrap; display: inline-flex; align-items: center; gap: 6px; background: transparent; border: 0; border-radius: 99px; padding: 4px 11px; color: var(--text-dim); font-size: 11.5px; }
  .kind i { width: 14px; height: 0; border-top: 2px solid var(--c); }
  .kind:hover { color: var(--text); background: var(--bg-3); }
  .kind.on { color: var(--text); background: var(--bg-4); box-shadow: inset 0 0 0 1px var(--c); }
</style>
