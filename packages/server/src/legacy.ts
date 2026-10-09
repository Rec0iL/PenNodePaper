import { randomBytes } from 'node:crypto';
import type { CampaignState } from '@pnp/shared';

// ---------------------------------------------------------------------------
// Portals (a doorway NODE between two canvases) are gone: a connection between canvases is simply an edge, drawn on each canvas
// as a jump marker. Campaigns that still hold portal nodes are converted when they are opened.
// ---------------------------------------------------------------------------

/** Each portal becomes the connection it stood for: whatever led into it now leads straight to where it arrived. */
export function replacePortals(s: Pick<CampaignState, 'nodes' | 'graph'>, ids: string[]): { removed: string[]; connections: number } {
  const removed: string[] = [];
  let connections = 0;
  for (const p of ids) {
    if (!s.nodes[p]) continue;
    const ins = s.graph.edges.filter((e) => e.to === p && e.from !== p && s.nodes[e.from]);
    const outs = s.graph.edges.filter((e) => e.from === p && e.to !== p && s.nodes[e.to]);
    for (const i of ins) {
      for (const o of outs) {
        if (i.from === o.to || s.graph.edges.some((e) => e.from === i.from && e.to === o.to && e.kind === i.kind)) continue;
        s.graph.edges.push({ id: `e-${i.from}-${o.to}-${randomBytes(2).toString('hex')}`, from: i.from, to: o.to, kind: i.kind, label: i.label || o.label });
        connections++;
      }
    }
    s.graph.edges = s.graph.edges.filter((e) => e.from !== p && e.to !== p);
    delete s.graph.placements[p];
    delete s.nodes[p];
    removed.push(p);
  }
  return { removed, connections };
}
