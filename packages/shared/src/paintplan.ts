import type { MapDoc } from './mapdata.js';
import { derivedWalls } from './maps.js';
import { groupProps } from './mapgroups.js';
import { groupRegion } from './regiongroups.js';
import { lineStages } from './regionlines.js';
import { inStep2, isLineKind, regionKind, type LineGroup } from './regionkinds.js';

// ---------------------------------------------------------------------------
// What will be painted, and by which step. Every element of a map has to belong to a pass, or it is drawn in the editor and
// never painted. This lists the passes with what they take and names the shapes that no pass takes.
// ---------------------------------------------------------------------------

export interface PaintPlan {
  kind: MapDoc['kind'];
  /** readable lines, one per pass: "walls: 14 segments, in the terrain picture" */
  passes: string[];
  /** region maps: the line passes in painting order */
  lines: { group: LineGroup; names: string[]; count: number }[];
  /** step 2: prop / structure groups */
  groups: number;
  /** shapes that no pass paints, with the reason */
  orphans: { id: string; kind: string; type: string; why: string }[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function paintPlan(m: MapDoc): PaintPlan {
  if (m.kind === 'battle') {
    const cells = m.rows.join('').replace(/\./g, '').length;
    const groups = groupProps(m).length;
    return {
      kind: 'battle', lines: [], groups, orphans: [],
      passes: [
        `floors: ${plural(cells, 'cell')}, drawn into the terrain picture`,
        `walls: ${plural(derivedWalls(m).length, 'segment')} and doors: ${m.doors.length}, drawn into the terrain picture (the model paints them from it)`,
        `props: ${plural(m.props.length, 'prop')} in ${plural(groups, 'group')}, painted one group at a time in step 2`,
      ],
    };
  }
  const stages = lineStages(m);
  const groups = groupRegion(m).length;
  const orphans: PaintPlan['orphans'] = [];
  for (const s of m.shapes) {
    const k = regionKind(s.kind, m.kinds);
    if (isLineKind(k) && (s.type !== 'path' || s.points.length < 2)) {
      orphans.push({ id: s.id, kind: s.kind, type: s.type, why: s.type === 'path' ? `“${k.name}” is a line and needs at least two points` : `“${k.name}” is a line kind drawn as ${s.type === 'ellipse' ? 'an ellipse' : 'an area'}: no pass paints it — draw it as a line` });
    } else if (inStep2(k) && s.type === 'path') {
      orphans.push({ id: s.id, kind: s.kind, type: s.type, why: `“${k.name}” is painted into an area or a spot, not along a line: draw it as an area or a pin` });
    }
  }
  const areas = m.shapes.filter((s) => s.type !== 'path' && !inStep2(regionKind(s.kind, m.kinds)) && !isLineKind(regionKind(s.kind, m.kinds))).length;
  return {
    kind: 'region', groups, orphans,
    lines: stages.map((st) => ({ group: st.group, names: st.names, count: st.shapes.length })),
    passes: [
      `land: ${plural(areas, 'area')} on the ${regionKind(m.background ?? 'land', m.kinds).name.toLowerCase()} background, painted first`,
      ...stages.map((st) => `${st.group === 'water' ? 'rivers' : st.group === 'wall' ? 'walls' : 'roads, rails and bridges'}: ${plural(st.shapes.length, 'line')} (${st.names.join(', ')}), their own pass after the land`),
      `structures: ${plural(m.shapes.filter((s) => s.type !== 'path' && inStep2(regionKind(s.kind, m.kinds))).length, 'shape')} in ${plural(groups, 'group')}, painted one group at a time in step 2`,
    ],
  };
}
