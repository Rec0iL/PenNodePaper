import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import type { GraphFile } from '@pnp/shared';
import { parseNode } from './persistence.js';
import type { Store } from './store.js';

/**
 * Picks up edits made outside the app (hand edits, Claude Code editing the
 * campaign folder directly) and feeds them through the normal transaction
 * path, so the UI animates them like any other change.
 */
export function watchCampaign(store: Store, log: (m: string) => void = () => {}) {
  const p = store.persistence;
  const watcher = chokidar.watch([p.nodesDir, p.graphPath], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
  });

  const read = (file: string): string | null => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };

  const onNode = (file: string) => {
    if (!file.endsWith('.md')) return;
    const content = read(file);
    if (p.isSelfWrite(file, content)) return;
    const id = path.basename(file, '.md');
    if (content === null) {
      const cur = store.state.nodes[id];
      if (!cur || cur.trashed) return;
      log(`external delete: ${id}`);
      store.transact('system', `File removed: ${cur.title}`, (tx) => {
        for (const e of tx.state.graph.edges.filter((e) => e.from === id || e.to === id)) tx.removeEdge(e.id);
        tx.setPlacement(id, null);
        tx.putNode({ ...cur, trashed: true });
      });
      return;
    }
    const node = parseNode(content, id);
    if (!node) return;
    const cur = store.state.nodes[node.id];
    if (cur && JSON.stringify(cur) === JSON.stringify(node)) return;
    log(`external edit: ${node.id}`);
    store.transact('system', `File edited: ${node.title}`, (tx) => tx.putNode(node));
  };

  const onGraph = (file: string) => {
    const content = read(file);
    if (content === null || p.isSelfWrite(file, content)) return;
    let g: GraphFile;
    try {
      g = JSON.parse(content) as GraphFile;
    } catch {
      return;
    }
    log('external edit: graph.json');
    store.transact('system', 'graph.json edited', (tx) => {
      const cur = tx.state.graph;
      for (const c of g.canvases ?? []) if (JSON.stringify(cur.canvases.find((x) => x.id === c.id)) !== JSON.stringify(c)) tx.putCanvas(c);
      for (const id of Object.keys(cur.placements)) if (!g.placements?.[id]) tx.setPlacement(id, null);
      for (const [id, pl] of Object.entries(g.placements ?? {})) if (tx.state.nodes[id] && !tx.state.nodes[id].trashed) tx.setPlacement(id, pl);
      const ids = new Set((g.edges ?? []).map((e) => e.id));
      for (const e of [...cur.edges]) if (!ids.has(e.id)) tx.removeEdge(e.id);
      for (const e of g.edges ?? []) {
        if (!tx.state.nodes[e.from] || !tx.state.nodes[e.to]) continue;
        const have = cur.edges.find((x) => x.id === e.id);
        if (!have || JSON.stringify(have) !== JSON.stringify(e)) tx.putEdge(e);
      }
    });
  };

  watcher.on('add', onNode).on('change', (f) => (f === p.graphPath ? onGraph(f) : onNode(f))).on('unlink', onNode);
  watcher.on('add', (f) => f === p.graphPath && onGraph(f));
  return () => watcher.close();
}
