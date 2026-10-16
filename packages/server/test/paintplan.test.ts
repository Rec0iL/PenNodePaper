import { describe, expect, it } from 'vitest';
import { applyOps, controlLegend, lineGroupOf, lineStageWhat, lineStages, newMap, paintPlan, regionKind, terrainLegend, CONTROL_LEGEND, cleanKind } from '../src/maps.js';

const region = () => {
  const m = newMap('r', 'Realm', 'region');
  m.size = { w: 1000, h: 700 };
  applyOps(m, [
    { op: 'shape', type: 'polygon', kind: 'forest', points: [[40, 40], [400, 60], [380, 300]] },
    { op: 'shape', type: 'path', kind: 'river', points: [[10, 100], [300, 200], [600, 260]] },
    { op: 'shape', type: 'path', kind: 'road', points: [[50, 400], [500, 420]] },
    { op: 'shape', type: 'ellipse', kind: 'town', points: [[300, 420], [20, 20]] },
  ]);
  return m;
};

describe('the line passes: water, then land, then walls', () => {
  it('walls are their own group; so are palisades and the GM\'s own wall kinds', () => {
    const k = (id: string, name: string, extra = {}) => cleanKind({ id, name, layer: 'structure', geometry: 'line', color: '#888888', prompt: 'a line', ...extra });
    expect(lineGroupOf(regionKind('wall'))).toBe('wall');
    expect(lineGroupOf(regionKind('river'))).toBe('water');
    expect(lineGroupOf(regionKind('road'))).toBe('land');
    expect(lineGroupOf(k('palisade', 'Wooden palisade'))).toBe('wall');
    expect(lineGroupOf(k('ley', 'Ley line'))).toBe('land');
    expect(lineGroupOf(k('ley2', 'Ley line', { lineGroup: 'wall' }))).toBe('wall');
    expect(lineGroupOf(k('moat', 'Moat canal', { lineGroup: 'water' }))).toBe('water');
  });

  it('a map with a river, a road and a wall has three passes in that order, the wall one with its own words', () => {
    const m = region();
    applyOps(m, [{ op: 'shape', type: 'path', kind: 'wall', points: [[200, 380], [420, 380], [420, 470]] }]);
    const st = lineStages(m);
    expect(st.map((s) => s.group)).toEqual(['water', 'land', 'wall']);
    const w = lineStageWhat(st[2]);
    expect(w.what).toMatch(/^Fortification walls run across the land/);
    expect(w.what).toMatch(/gate where a road passes through/);
    expect(w.what).toContain('a tall fortification wall with battlements'); // the kind's own wording, built-in kinds too
    expect(w.not).toContain('new road');
    // the other passes do not paint walls
    expect(lineStageWhat(st[0]).not).toContain('walls');
    expect(lineStageWhat(st[1]).not).toContain('walls');
    expect(lineStageWhat(st[1]).what).not.toMatch(/Wall/);
  });
});

describe('every shape belongs to a pass', () => {
  it('a line kind drawn as an area becomes the closed line of its outline; a structure drawn as a line is refused', () => {
    const m = region();
    const r = applyOps(m, [
      { op: 'shape', type: 'polygon', kind: 'wall', points: [[100, 100], [200, 100], [200, 200]], id: 'ring' },
      { op: 'shape', type: 'ellipse', kind: 'wall', points: [[500, 300], [60, 40]], id: 'round' },
    ]);
    expect(r.notes.join(' ')).toMatch(/closed line/);
    const ring = m.shapes.find((s) => s.id === 'ring')!;
    expect(ring.type).toBe('path');
    expect(ring.points[0]).toEqual(ring.points.at(-1));
    expect(ring.points).toHaveLength(4);
    const round = m.shapes.find((s) => s.id === 'round')!;
    expect(round.type).toBe('path');
    expect(round.points).toHaveLength(33);
    expect(lineStages(m).find((s) => s.group === 'wall')!.shapes).toHaveLength(2); // both are painted by the wall pass
    expect(() => applyOps(m, [{ op: 'shape', type: 'path', kind: 'town', points: [[10, 10], [50, 50]] }])).toThrow(/area or a spot/);
  });

  it('the plan lists what is painted by which pass and names the shapes no pass would paint', () => {
    const m = region();
    expect(paintPlan(m).orphans).toEqual([]);
    expect(paintPlan(m).passes.join('\n')).toMatch(/rivers: 1 line[\s\S]*roads, rails and bridges: 1 line[\s\S]*structures: 1 shape in 1 group/);
    // what an old map or a hand-edited file can hold
    m.shapes.push({ id: 'lost1', type: 'polygon', kind: 'river', points: [[1, 1], [9, 1], [9, 9]] });
    m.shapes.push({ id: 'lost2', type: 'path', kind: 'castle', points: [[1, 1], [9, 9]] });
    m.shapes.push({ id: 'lost3', type: 'path', kind: 'road', points: [[5, 5]] });
    const orphans = paintPlan(m).orphans;
    expect(orphans.map((o) => o.id)).toEqual(['lost1', 'lost2', 'lost3']);
    expect(orphans[0].why).toMatch(/line kind drawn as an area/);
    expect(orphans[1].why).toMatch(/not along a line/);
    expect(orphans[2].why).toMatch(/at least two points/);
  });

  it('battle plan: floors, walls and doors come from the terrain picture, props are painted group by group', () => {
    const m = newMap('b', 'B', 'battle', 12, 10);
    applyOps(m, [{ op: 'room', x: 2, y: 2, w: 6, h: 5, floor: 'stone' }, { op: 'door', x: 4, y: 6, side: 's' }, { op: 'prop', kind: 'barrel', x: 3, y: 3 }]);
    const p = paintPlan(m);
    expect(p.passes.join('\n')).toMatch(/floors: 30 cells[\s\S]*walls: \d+ segments and doors: 1[\s\S]*props: 1 prop in 1 group/);
    expect(p.orphans).toEqual([]);
  });
});

describe('the legend explains every mark the plan picture has', () => {
  it('names the kinds of door the map really uses, and only those', () => {
    const m = newMap('b', 'B', 'battle', 12, 10);
    applyOps(m, [{ op: 'room', x: 2, y: 2, w: 6, h: 5, floor: 'stone' }, { op: 'door', x: 4, y: 2, side: 'n' }]);
    expect(terrainLegend(m)).toContain('small orange marks = doors');
    expect(terrainLegend(m)).not.toMatch(/window|archway|portcullis/);
    expect(controlLegend(m)).toBe(CONTROL_LEGEND); // nothing special: unchanged
    applyOps(m, [{ op: 'door', x: 6, y: 2, side: 'n', kind: 'window' }, { op: 'door', x: 3, y: 6, side: 's', kind: 'portcullis' }, { op: 'door', x: 2, y: 4, side: 'w', kind: 'arch' }]);
    for (const l of [terrainLegend(m), controlLegend(m)]) {
      expect(l).toContain('light-blue marks in walls = windows');
      expect(l).toContain('grey bars = portcullis gates');
      expect(l).toContain('tan arched marks = open archways');
    }
  });
});
