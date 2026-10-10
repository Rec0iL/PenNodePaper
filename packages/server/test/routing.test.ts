import { describe, expect, it } from 'vitest';
import { bezierPoints, labelSize, roundedPath, routeEdges, type RBox, type REdge } from '@pnp/shared';

const card = (id: string, x: number, y: number, w = 280, h = 150): RBox => ({ id, x, y, w, h });
const edge = (id: string, a: RBox, b: RBox, label?: string): REdge => ({
  id, from: a.id, to: b.id,
  sx: a.x + a.w, sy: a.y + a.h / 2, tx: b.x, ty: b.y + b.h / 2,
  label: label ? labelSize(label) : null,
});
const hitsBox = (pts: { x: number; y: number }[], b: RBox) => pts.some((p) => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h);
const overlaps = (a: { x: number; y: number }, wa: { w: number; h: number }, b: { x: number; y: number }, wb: { w: number; h: number }) =>
  Math.abs(a.x - b.x) < (wa.w + wb.w) / 2 && Math.abs(a.y - b.y) < (wa.h + wb.h) / 2;

/** distance of a point from a polyline (the line may have long straight runs: the points alone are not enough) */
function distToLine(p: { x: number; y: number }, pts: { x: number; y: number }[]) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

describe('edge routing', () => {
  it('keeps the plain bezier when nothing is in the way', () => {
    const a = card('a', 0, 0), b = card('b', 500, 40);
    const r = routeEdges([a, b], [edge('e', a, b)]).get('e')!;
    expect(r.routed).toBe(false);
    expect(r.pts[0]).toEqual({ x: 280, y: 75 });
  });

  it('goes around a card that sits on the line', () => {
    const a = card('a', 0, 0), blocker = card('x', 400, -10), b = card('b', 900, 0);
    const r = routeEdges([a, blocker, b], [edge('e', a, b)]).get('e')!;
    expect(r.routed).toBe(true);
    expect(r.via.length).toBeGreaterThan(2);
    // the whole drawn line, rounded corners included, stays off the cards
    const line = [{ x: 280, y: 75 }, ...r.via, { x: 900, y: 75 }];
    expect(hitsBox(r.pts, blocker)).toBe(false);
    expect(line[0]).toEqual({ x: 280, y: 75 });
    // it enters and leaves horizontally (stub), so the arrow head stays right
    expect(r.via[0].y).toBe(75);
    expect(r.via[r.via.length - 1].y).toBe(75);
    expect(roundedPath(line)).toMatch(/^M 280 75/);
  });

  it('squeezes through a narrow gap beside the source card', () => {
    const a = card('a', 0, 300, 280, 92), blocker = card('x', 350, 280, 280, 92), b = card('b', 700, 300, 280, 92);
    const r = routeEdges([a, blocker, b], [edge('e', a, b)]).get('e')!;
    expect(r.routed).toBe(true);
    expect(hitsBox(r.pts, blocker)).toBe(false);
    expect(hitsBox(r.pts, a)).toBe(false);
  });

  it('routes a backward edge around both cards instead of through them', () => {
    const a = card('a', 600, 0), b = card('b', 0, 20);
    const r = routeEdges([a, b], [edge('e', a, b)]).get('e')!;
    expect(r.routed).toBe(true);
    expect(hitsBox(r.pts, a)).toBe(false);
    expect(hitsBox(r.pts, b)).toBe(false);
  });

  it('falls back to the bezier when the target is walled in', () => {
    const a = card('a', 0, 0), b = card('b', 1000, 0);
    // a ring of cards around b: no way in from the left
    const wall = [card('w1', 700, -400, 700, 330), card('w2', 700, 220, 700, 330), card('w3', 650, -100, 220, 350)];
    const r = routeEdges([a, b, ...wall], [edge('e', a, b)]).get('e')!;
    expect(r.pts.length).toBeGreaterThan(2);
  });

  it('puts a label in the middle when it is free, and slides it off a card that covers the middle', () => {
    const a = card('a', 0, 0), b = card('b', 900, 0);
    const lbl = 'leads to';
    const free = routeEdges([a, b], [edge('e', a, b, lbl)]).get('e')!;
    const mid = bezierPoints(280, 75, 900, 75)[Math.round(bezierPoints(280, 75, 900, 75).length / 2)];
    expect(Math.abs(free.label!.x - mid.x)).toBeLessThan(15);

    // a small card sitting right under the middle of the line, but not blocking the line itself
    const under = card('u', 540, 86, 80, 40);
    const moved = routeEdges([a, b, under], [edge('e', a, b, lbl)]).get('e')!;
    const sz = labelSize(lbl);
    expect(overlaps(moved.label!, sz, { x: under.x + under.w / 2, y: under.y + under.h / 2 }, { w: under.w, h: under.h })).toBe(false);
    expect(Math.abs(moved.label!.x - free.label!.x)).toBeGreaterThan(5);
  });

  it('keeps the labels of a bundle of edges apart', () => {
    const a = card('a', 0, 0), b = card('b', 700, 0);
    const edges = ['one', 'two', 'three', 'four'].map((n, i) => edge(`e${i}`, a, b, `connection ${n}`));
    const routes = routeEdges([a, b], edges);
    const spots = edges.map((e) => ({ at: routes.get(e.id)!.label!, sz: e.label! }));
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++) expect(overlaps(spots[i].at, spots[i].sz, spots[j].at, spots[j].sz)).toBe(false);
  });

  it('fans a bundle of parallel connections out so each label sits on its own line', () => {
    const a = card('a', 0, 0), b = card('b', 700, 0);
    const edges = ['one', 'two', 'three', 'four'].map((n, i) => edge(`e${i}`, a, b, `connection ${n}`));
    const routes = routeEdges([a, b], edges);
    const at = (e: REdge) => routes.get(e.id)!.label!;
    // every label is on its own edge ...
    for (const e of edges) {
      const r = routes.get(e.id)!;
      const d = distToLine(at(e), r.pts);
      expect(d).toBeLessThan(3);
      // it goes from the source to the target once: no running past the label and coming back
      for (let i = 1; i < r.via.length; i++) expect(r.via[i].x, `${e.id} via ${i}`).toBeGreaterThanOrEqual(r.via[i - 1].x);
      // the line runs level into the label and level out of it
      const l = at(e);
      const before = r.pts.filter((p) => p.x < l.x - e.label!.w / 2 - 4).pop()!, after = r.pts.find((p) => p.x > l.x + e.label!.w / 2 + 4)!;
      expect(Math.abs(before.y - l.y)).toBeLessThan(6);
      expect(Math.abs(after.y - l.y)).toBeLessThan(6);
    }
    // ... and the four lines are told apart where the labels are
    const ys = edges.map((e) => at(e).y).sort((p, q) => p - q);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThan(20);
  });

  it('bends a connection through its label when the label has to leave the line', () => {
    const a = card('a', 0, 0), b = card('b', 500, 0);
    // a card sits on the middle of the line but not on the line itself... and another one on each side of it
    const pin = card('p', 200, 78, 100, 40);
    const e = edge('e', a, b, 'a long label that does not fit between the cards');
    const r = routeEdges([a, b, pin], [e]).get('e')!;
    const d = distToLine(r.label!, r.pts);
    expect(d).toBeLessThan(8);
  });

  it('is deterministic', () => {
    const a = card('a', 0, 0), x = card('x', 400, -10), b = card('b', 900, 0);
    const edges = [edge('e1', a, b, 'one'), edge('e2', a, b, 'two')];
    const first = JSON.stringify([...routeEdges([a, x, b], edges)]);
    expect(JSON.stringify([...routeEdges([a, x, b], [...edges].reverse())])).toBe(first);
  });

  it('is quick on a dense canvas', () => {
    const boxes: RBox[] = [];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 8; j++) boxes.push(card(`n${i}-${j}`, i * 380, j * 230));
    const edges: REdge[] = [];
    for (let i = 0; i < 11; i++)
      for (let j = 0; j < 8; j++) {
        edges.push(edge(`h${i}-${j}`, boxes[i * 8 + j], boxes[(i + 1) * 8 + ((j + 3) % 8)], 'x'));
        edges.push(edge(`b${i}-${j}`, boxes[(i + 1) * 8 + j], boxes[i * 8 + ((j + 1) % 8)], 'y'));
      }
    const t0 = performance.now();
    const routes = routeEdges(boxes, edges);
    const ms = performance.now() - t0;
    expect(routes.size).toBe(edges.length);
    expect(ms).toBeLessThan(2500);
    console.log(`routed ${edges.length} edges over ${boxes.length} cards in ${ms.toFixed(0)} ms`);
  });
});

describe('edge routing, random layouts', () => {
  // small seeded generator so a failure is reproducible
  const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  it('never lets a routed edge run through a card', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rnd = rng(seed);
      const boxes: RBox[] = [];
      for (let i = 0; i < 14; i++) boxes.push(card(`n${i}`, Math.round(rnd() * 1400 / 10) * 10, Math.round(rnd() * 800 / 10) * 10, 280, 92 + Math.round(rnd() * 60)));
      // the generator may drop cards on top of each other: keep only the ones that do not overlap
      const clean = boxes.filter((b, i) => !boxes.slice(0, i).some((o) => b.x < o.x + o.w + 24 && b.x + b.w + 24 > o.x && b.y < o.y + o.h + 24 && b.y + b.h + 24 > o.y));
      const edges: REdge[] = [];
      for (let i = 0; i < clean.length; i++) for (const j of [i + 1, i + 3]) if (clean[j]) edges.push(edge(`e${i}-${j}`, clean[i], clean[j], 'lbl'));
      const routes = routeEdges(clean, edges);
      for (const e of edges) {
        const r = routes.get(e.id)!;
        if (!r.routed) continue;
        // the line starts and ends on a card's border (the handle) and is nowhere inside any card
        for (const b of clean) expect(hitsBox(r.pts, b), `seed ${seed}, ${e.id} runs through ${b.id}`).toBe(false);
      }
    }
  });
});
