import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImageJob, MapPaintMode } from '@pnp/shared';
import { Comfy, ComfyError } from '../src/comfy.js';
import { runCommand } from '../src/commands.js';
import { ImageService } from '../src/images.js';
import {
  REGION_KINDS, REGION_MASK, applyOps, migratePins, cleanKind, colorWord, describeRegionGroups, fallbackRegionPrompt, groupRegion, inStep2, newMap, pointInShape,
  CONSOLIDATE_DENOISE, LINE_DENOISE, consolidatePrompt, corridorSvg, lineGroupOf, lineStageWhat, lineStages, linesDrawnSvg, imageSize, regionCrops, regionKind, regionLegend, regionMaskSvg, renderSvg, ringMaskSvg, strokeSvg, toPng, type MapDoc,
} from '../src/maps.js';
import { parseRegionPrompts, regionGroupRequest, regionLook, regionTerrainRequest } from '../src/mappaint.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';
import { DEFAULT_STYLE } from '@pnp/shared';

// ---- compatibility: maps made before kinds existed draw exactly as they did ---------------------

const GOLDEN = {
  "control": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"400\" viewBox=\"0 0 640 400\"><rect width=\"640\" height=\"400\" fill=\"#2f6fb5\"/><polygon points=\"40,40 400,60 380,300 60,320\" fill=\"#9bb86a\" stroke=\"#9bb86a\" stroke-width=\"0\" stroke-linejoin=\"round\"/><polygon points=\"100,100 250,120 200,220\" fill=\"#2f6a3a\" stroke=\"#2f6a3a\" stroke-width=\"0\" stroke-linejoin=\"round\"/><polyline points=\"60,200 200,180 380,240\" fill=\"none\" stroke=\"#6a4a2a\" stroke-width=\"10\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-dasharray=\"1 0\"/><polyline points=\"300,60 310,150 340,260\" fill=\"none\" stroke=\"#5aa0e0\" stroke-width=\"20\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><ellipse cx=\"500\" cy=\"120\" rx=\"60\" ry=\"40\" fill=\"#4a8fd0\"/><circle cx=\"200\" cy=\"180\" r=\"14\" fill=\"#d04a4a\" stroke=\"#0b0c10\" stroke-width=\"3\"/><circle cx=\"330\" cy=\"100\" r=\"20\" fill=\"#a04ad0\" stroke=\"#0b0c10\" stroke-width=\"3\"/><polyline points=\"420,300 500,330\" fill=\"none\" stroke=\"#7a7a82\" stroke-width=\"60\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
  "preview": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"640\" height=\"400\" viewBox=\"0 0 640 400\"><rect width=\"640\" height=\"400\" fill=\"#2f6fb5\"/><polygon points=\"40,40 400,60 380,300 60,320\" fill=\"#9bb86a\" stroke=\"#0b0c10\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/><polygon points=\"100,100 250,120 200,220\" fill=\"#2f6a3a\" stroke=\"#0b0c10\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/><text x=\"183.33333333333334\" y=\"146.66666666666666\" text-anchor=\"middle\" font-size=\"16\" font-family=\"sans-serif\" fill=\"#fff\" stroke=\"#000\" stroke-width=\"3\" paint-order=\"stroke\" font-weight=\"600\">Darkwood</text><polyline points=\"60,200 200,180 380,240\" fill=\"none\" stroke=\"#6a4a2a\" stroke-width=\"10\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-dasharray=\"1 0\"/><polyline points=\"300,60 310,150 340,260\" fill=\"none\" stroke=\"#5aa0e0\" stroke-width=\"20\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><ellipse cx=\"500\" cy=\"120\" rx=\"60\" ry=\"40\" fill=\"#4a8fd0\"/><circle cx=\"200\" cy=\"180\" r=\"14\" fill=\"#d04a4a\" stroke=\"#0b0c10\" stroke-width=\"3\"/><text x=\"200\" y=\"180\" text-anchor=\"middle\" font-size=\"16\" font-family=\"sans-serif\" fill=\"#fff\" stroke=\"#000\" stroke-width=\"3\" paint-order=\"stroke\" font-weight=\"600\">Eldoria</text><circle cx=\"330\" cy=\"100\" r=\"20\" fill=\"#a04ad0\" stroke=\"#0b0c10\" stroke-width=\"3\"/><polyline points=\"420,300 500,330\" fill=\"none\" stroke=\"#7a7a82\" stroke-width=\"60\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>"
};

const oldMap = (): MapDoc => {
  const m = newMap('g', 'Golden', 'region');
  m.size = { w: 640, h: 400 };
  m.background = 'sea';
  m.shapes = [
    { id: 'a', type: 'polygon', kind: 'land', points: [[40, 40], [400, 60], [380, 300], [60, 320]] },
    { id: 'b', type: 'polygon', kind: 'forest', points: [[100, 100], [250, 120], [200, 220]], label: 'Darkwood' },
    { id: 'c', type: 'path', kind: 'road', points: [[60, 200], [200, 180], [380, 240]] },
    { id: 'd', type: 'path', kind: 'river', points: [[300, 60], [310, 150], [340, 260]], width: 20 },
    { id: 'e', type: 'ellipse', kind: 'lake', points: [[500, 120], [60, 40]] },
    { id: 'f', type: 'pin', kind: 'city', points: [[200, 180]], label: 'Eldoria' },
    { id: 'g', type: 'pin', kind: 'castle', points: [[330, 100]], r: 20 },
    { id: 'h', type: 'path', kind: 'mountain', points: [[420, 300], [500, 330]], width: 60 },
  ];
  return m;
};

describe('places are areas, not dots', () => {
  it('a pin from an old caller is stored as a round area of its radius (or the kind\'s usual size)', () => {
    const m = newMap('p', 'P', 'region');
    applyOps(m, [
      { op: 'shape', type: 'pin', kind: 'village', points: [[100, 100]], r: 20, id: 'a' },
      { op: 'shape', type: 'pin', kind: 'city', points: [[300, 100]], id: 'b' },
    ]);
    expect(m.shapes[0]).toMatchObject({ type: 'ellipse', points: [[100, 100], [20, 20]] });
    expect(m.shapes[1]).toMatchObject({ type: 'ellipse', points: [[300, 100], [28, 28]] });
    expect(m.shapes.some((s) => s.type === 'pin')).toBe(false);
  });

  it('old maps with pins migrate on load; the renderer still draws a pin if one ever turns up', () => {
    const m = oldMap();
    expect(m.shapes.filter((s) => s.type === 'pin')).toHaveLength(2);
    expect(migratePins(m)).toBe(true);
    expect(m.shapes.filter((s) => s.type === 'pin')).toHaveLength(0);
    const city = m.shapes.find((s) => s.id === 'f')!;
    expect(city).toMatchObject({ type: 'ellipse', points: [[200, 180], [28, 28]], label: 'Eldoria' });
    expect(m.shapes.find((s) => s.id === 'g')).toMatchObject({ type: 'ellipse', points: [[330, 100], [20, 20]] });
    expect(migratePins(m)).toBe(false);
    expect(renderSvg(m, 'control')).not.toContain('stroke="#0b0c10" stroke-width="3"'); // the dot's ring is gone
  });

  it('the legend speaks of areas, never dots', () => {
    expect(regionLegend(kingdom())).not.toMatch(/dot/);
  });
});

describe('region maps from before kinds existed', () => {
  it('render byte-identical in the editor and in the one-pass control picture', () => {
    expect(renderSvg(oldMap(), 'control')).toBe(GOLDEN.control);
    // the names are lettering now (labelstyles.ts); everything else of the editor picture is unchanged
    const bare = (s: string) => s.replace(/<g class="letters">.*<\/g>(?=<\/svg>)/, '').replace(/<text\b[^>]*>[^<]*<\/text>/g, '');
    expect(bare(renderSvg(oldMap(), 'preview'))).toBe(bare(GOLDEN.preview));
    expect(renderSvg(oldMap(), 'preview')).toContain('class="letters"');
  });

  it('every old terrain id is still a built-in kind with its old colour', () => {
    for (const id of ['sea', 'lake', 'land', 'forest', 'hills', 'mountain', 'desert', 'swamp', 'snow', 'road', 'river', 'wall', 'city', 'village', 'castle', 'ruins', 'cave', 'port'])
      expect(REGION_KINDS.some((k) => k.id === id), id).toBe(true);
    expect(regionKind('forest').color).toBe('#2f6a3a');
  });
});

// ---- kinds -------------------------------------------------------------------------------------

describe('kinds', () => {
  it('towns, camps and hospitals are structures; water, forest and roads are terrain', () => {
    for (const id of ['city', 'town', 'village', 'house', 'hospital', 'camp', 'castle', 'port']) expect(regionKind(id).layer, id).toBe('structure');
    for (const id of ['sea', 'forest', 'desert', 'road', 'road_paved', 'river']) expect(regionKind(id).layer, id).toBe('terrain');
    expect(regionKind('road').name).toBe('Gravel road');
    expect(regionKind('road_paved').name).toBe('Asphalt road');
  });

  it('colours are distinct, so the model can tell kinds apart in the sketch', () => {
    const colors = REGION_KINDS.map((k) => k.color.toLowerCase());
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('a custom kind is cleaned and validated; unknown ids read as plain terrain', () => {
    const k = cleanKind({ name: 'Radioactive Crater', layer: 'terrain', color: '#7CFF3A', prompt: 'a glowing green crater of molten glass', geometry: 'area' });
    expect(k).toMatchObject({ id: 'radioactive_crater', layer: 'terrain', color: '#7cff3a', custom: true });
    expect(() => cleanKind({ name: 'x', color: 'green', prompt: 'a thing like that' })).toThrow(/hex colour/);
    expect(() => cleanKind({ name: 'x', color: '#aabbcc', prompt: 'x' })).toThrow(/describe/);
    expect(regionKind('who_knows').layer).toBe('terrain');
    const line = cleanKind({ name: 'Ley line', layer: 'terrain', geometry: 'line', color: '#ff00ff', prompt: 'a glowing magical ley line' });
    expect(line.width).toBe(10);
  });

  it('colour words are plain and every kind of a map gets its own', () => {
    expect(colorWord('#2f6a3a')).toMatch(/green/);
    expect(colorWord('#2f6fb5')).toMatch(/blue/);
    expect(colorWord('#f4f4f4')).toBe('white');
    const k = kingdom();
    const legend = regionLegend(k);
    const words = [...legend.matchAll(/(?:: |, )([a-z -]+?)(?: lines)? = /g)].map((x) => x[1]);
    expect(words.length).toBeGreaterThan(5);
    expect(new Set(words).size).toBe(words.length); // never "yellow = hills, yellow = farmland"
  });

  it('edit_map ops: unknown kind is refused with the list; define_kind lets the map use its own', () => {
    const m = newMap('r', 'R', 'region');
    expect(() => applyOps(m, [{ op: 'shape', type: 'polygon', kind: 'crater', points: [[0, 0], [10, 0], [5, 8]] }])).toThrow(/Unknown kind "crater"/);
    applyOps(m, [
      { op: 'define_kind', kind: { name: 'Crater', layer: 'terrain', color: '#7cff3a', prompt: 'a glowing crater of molten green glass' } },
      { op: 'shape', type: 'polygon', kind: 'crater', points: [[0, 0], [10, 0], [5, 8]], prompt: '  a  big crater ' },
    ]);
    expect(m.kinds).toHaveLength(1);
    expect(m.shapes[0].prompt).toBe('a big crater');
    expect(() => applyOps(m, [{ op: 'remove_kind', id: 'crater' }])).toThrow(/still used/);
    applyOps(m, [{ op: 'remove_shape', id: m.shapes[0].id }, { op: 'remove_kind', id: 'crater' }]);
    expect(m.kinds).toEqual([]);
  });
});

// ---- the sketch for step 1 and the legend ------------------------------------------------------

const kingdom = (): MapDoc => {
  const m = newMap('k', 'Kingdom', 'region');
  m.size = { w: 1344, h: 768 };
  m.background = 'land';
  applyOps(m, [
    { op: 'shape', type: 'polygon', kind: 'sea', points: [[0, 0], [400, 0], [380, 300], [0, 340]] },
    { op: 'shape', type: 'polygon', kind: 'forest', points: [[700, 100], [1000, 120], [950, 360], [720, 330]] },
    { op: 'shape', type: 'path', kind: 'river', points: [[420, 0], [440, 200], [520, 420], [500, 768]], width: 18, id: 'river' },
    { op: 'shape', type: 'path', kind: 'road_paved', points: [[200, 600], [600, 560], [1100, 620]], width: 12, id: 'road' },
    { op: 'shape', type: 'ellipse', kind: 'city', points: [[600, 540], [44, 30]], label: 'Eldoria', id: 'city' },
    { op: 'shape', type: 'ellipse', kind: 'village', points: [[800, 580], [16, 14]], id: 'v1' },
    { op: 'shape', type: 'polygon', kind: 'village', points: [[812, 575], [840, 580], [836, 604], [814, 600]], id: 'v2' },
    { op: 'shape', type: 'ellipse', kind: 'camp', points: [[850, 220], [30, 22]], prompt: 'a bandit camp', id: 'camp' },
    { op: 'shape', type: 'ellipse', kind: 'port', points: [[390, 330], [26, 18]], id: 'port' },
  ]);
  return m;
};

describe('the terrain sketch (step 1)', () => {
  it('leaves structures out; the control picture keeps everything', () => {
    const m = kingdom();
    const terrain = renderSvg(m, 'terrain');
    const control = renderSvg(m, 'control');
    expect(control).toContain(regionKind('city').color);
    expect(terrain).not.toContain(regionKind('city').color);
    expect(terrain).not.toContain(regionKind('camp').color);
    expect(terrain).toContain(regionKind('forest').color);
  });

  it('has no rivers or roads either: lines are painted in their own passes afterwards', () => {
    const t = renderSvg(kingdom(), 'terrain');
    expect(t).not.toContain(regionKind('river').color);
    expect(t).not.toContain(regionKind('road_paved').color);
    const control = renderSvg(kingdom(), 'control');
    expect(control).toContain(regionKind('river').color); // quick mode still paints everything in one pass
  });

  it('line width comes from the shape, else from the kind', () => {
    const m = kingdom();
    m.shapes.push({ id: 'p', type: 'path', kind: 'path', points: [[0, 700], [100, 720]] });
    const svg = renderSvg(m, 'preview');
    expect(svg).toContain('stroke-width="18"');
    expect(svg).toContain('stroke-width="5"'); // the footpath default
  });

  it('the legend names only what is drawn (and only terrain in step 1)', () => {
    const m = kingdom();
    const step1 = regionLegend(m, true);
    expect(step1).toMatch(/EMPTY landscape/);
    expect(step1).toContain('= sea');
    expect(step1).not.toContain('asphalt road'); // lines are not part of the terrain sketch
    expect(step1).not.toContain('city');
    expect(step1).not.toContain('desert');
    const all = regionLegend(m);
    expect(all).toContain('city');
    expect(all).toContain('camp');
  });
});

// ---- groups, windows, masks ---------------------------------------------------------------------

describe('structure groups (step 2)', () => {
  it('touching shapes of one kind are ONE group; terrain and lines are never windowed', () => {
    const g = groupRegion(kingdom());
    expect(g.map((x) => x.kind).sort()).toEqual(['camp', 'city', 'port', 'village']);
    expect(g.find((x) => x.kind === 'village')!.shapes).toHaveLength(2);
    expect(g.map((x) => x.id)).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(g.map((x) => x.kind)).not.toContain('river');
    expect(g.map((x) => x.kind)).not.toContain('road_paved');
  });

  it('a custom line kind joins the land pass, or the water pass when it is water', () => {
    const m = kingdom();
    applyOps(m, [
      { op: 'define_kind', kind: { name: 'Ley line', layer: 'terrain', geometry: 'line', color: '#ff00ff', prompt: 'a glowing magical ley line' } },
      { op: 'define_kind', kind: { name: 'Lava stream', layer: 'terrain', geometry: 'line', color: '#ff5a00', prompt: 'a stream of molten lava', lineGroup: 'water' } },
      { op: 'shape', type: 'path', kind: 'ley_line', points: [[10, 700], [300, 740]], id: 'ley' },
      { op: 'shape', type: 'path', kind: 'lava_stream', points: [[700, 700], [900, 740]], id: 'lava' },
    ]);
    expect(groupRegion(m).map((x) => x.kind)).not.toContain('ley_line');
    expect(lineGroupOf(regionKind('ley_line', m.kinds))).toBe('land');
    expect(lineGroupOf(regionKind('lava_stream', m.kinds))).toBe('water');
    const st = lineStages(m);
    expect(st.find((x) => x.group === 'land')!.kinds).toContain('ley_line');
    expect(st.find((x) => x.group === 'water')!.kinds).toEqual(expect.arrayContaining(['river', 'lava_stream']));
    expect(renderSvg(m, 'terrain')).not.toContain('#ff00ff');
  });

  it('describes groups for the AI: size, terrain underneath, what is nearby, GM wording', () => {
    const m = kingdom();
    const info = describeRegionGroups(m, groupRegion(m));
    const port = info.find((i) => i.kind === 'port')!;
    expect(port.nearby).toContain('sea');
    const camp = info.find((i) => i.kind === 'camp')!;
    expect(camp).toMatchObject({ under: 'forest', shapePrompts: ['a bandit camp'] });
    const city = info.find((i) => i.kind === 'city')!;
    expect(city.labels).toEqual(['Eldoria']);
    expect(city.kindPrompt).toMatch(/city/);
    expect(fallbackRegionPrompt(camp)).toBe('a bandit camp');
    expect(fallbackRegionPrompt(info.find((i) => i.kind === 'village')!)).toMatch(/2 of them/);
  });

  it('hit testing follows the drawn geometry', () => {
    const m = kingdom();
    const road = m.shapes.find((s) => s.id === 'road')!;
    expect(pointInShape(road, 400, 580, m.kinds)).toBe(true);
    expect(pointInShape(road, 400, 500, m.kinds)).toBe(false);
    const camp = m.shapes.find((s) => s.id === 'camp')!;
    expect(pointInShape(camp, 860, 225)).toBe(true);
    expect(pointInShape(camp, 900, 225)).toBe(false);
  });
});

describe('windows and masks', () => {
  it('a small structure gets one window with context, on the latent grid, scaled up', () => {
    const m = kingdom();
    for (const g of groupRegion(m).filter((x) => x.kind !== 'river')) {
      const crops = regionCrops(g, 1344, 768);
      expect(crops).toHaveLength(1);
      const c = crops[0];
      for (const v of [c.w, c.h, c.tw, c.th, c.x, c.y]) expect(v % 16).toBe(0);
      expect(c.w).toBeGreaterThanOrEqual(256);
      expect(c.x + c.w).toBeLessThanOrEqual(1344);
      expect(c.y + c.h).toBeLessThanOrEqual(768);
      expect(Math.max(c.tw, c.th)).toBeLessThanOrEqual(768 + 16);
      expect(c.tw).toBeGreaterThanOrEqual(c.w); // small things are painted at a higher resolution than they are shown
    }
  });

  it('a huge area is cut into overlapping tiles, only where it really is', () => {
    const m = newMap('long', 'Long', 'region');
    m.size = { w: 1344, h: 768 };
    // a long thin diagonal structure (a walled settlement along a ridge): the corners of its box are empty
    applyOps(m, [{ op: 'shape', type: 'polygon', kind: 'fort', points: [[20, 20], [60, 20], [1320, 730], [1280, 745]], id: 'diag' }]);
    const g = groupRegion(m)[0];
    const crops = regionCrops(g, 1344, 768);
    expect(crops.length).toBeGreaterThan(1);
    const covers = (x: number, y: number) => crops.some((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
    expect(covers(30, 25)).toBe(true);
    expect(covers(1300, 735)).toBe(true);
    expect(crops.length).toBeLessThanOrEqual(6);
  });

  it('masks follow the drawn shape, sit in the window and render', () => {
    const m = kingdom();
    const g = groupRegion(m).find((x) => x.kind === 'camp')!;
    const c = regionCrops(g, 1344, 768)[0];
    const svg = regionMaskSvg(g, c, REGION_MASK.grow, 0, { w: c.tw, h: c.th });
    expect(svg).toContain('<ellipse cx="850" cy="220" rx="30" ry="22"');
    expect(svg).toContain(`viewBox="${c.x} ${c.y} ${c.w} ${c.h}"`);
    const png = toPng(svg);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});

describe('lines: their own passes after the terrain', () => {
  it('water comes before land; each pass knows its own lines', () => {
    const st = lineStages(kingdom());
    expect(st.map((x) => x.group)).toEqual(['water', 'land']);
    expect(st[0].kinds).toEqual(['river']);
    expect(st[1].kinds).toEqual(['road_paved']);
    expect(st[1].names).toEqual(['asphalt road']);
    expect(lineStages(newMap('empty', 'E', 'region'))).toEqual([]);
  });

  it('a stage draws its lines as pre-rendered strokes (bank + water + highlight) at their own width', () => {
    const m = kingdom();
    const [water, land] = lineStages(m);
    const svg = linesDrawnSvg(m, 'AAAA', water);
    expect(svg).toContain('data:image/png;base64,AAAA');
    expect(svg).toContain('stroke="#6f6240"'); // bank
    expect(svg).toContain('stroke="#3d7db8"'); // water
    expect(svg).toContain('stroke-width="18"'); // the drawn width, not the kind default
    expect(svg).not.toContain('#4a4a54'); // the road waits for the land pass
    expect(linesDrawnSvg(m, 'AAAA', land)).toContain('stroke-dasharray="9 9"'); // asphalt centre line
    // a custom line gets a generic stroke in its own colour
    const k = { id: 'ley', name: 'Ley line', layer: 'terrain' as const, geometry: 'line' as const, color: '#aa22cc', prompt: 'a glowing ley line', custom: true };
    expect(strokeSvg({ id: 'x', type: 'path', kind: 'ley', points: [[0, 0], [9, 9]] }, k, 8)).toContain('#aa22cc');
  });

  it('the corridor around the lines is a feathered mask in px of the canvas', () => {
    const m = kingdom();
    const svg = corridorSvg(m, lineStages(m)[0]);
    expect(svg).toContain('width="1344" height="768"');
    expect(svg).toContain('feGaussianBlur');
    expect(svg).toContain(`stroke-width="${18 * 2 + 30}"`);
    expect(toPng(svg).subarray(1, 4).toString()).toBe('PNG');
  });

  it('the pass prompt names the lines, keeps rivers and roads apart', () => {
    const [water, land] = lineStages(kingdom());
    const w = lineStageWhat(water), l = lineStageWhat(land);
    expect(w.what).toMatch(/^River winds/);
    expect(w.not).toMatch(/roads/);
    expect(l.what).toMatch(/Asphalt road cross the land/);
    expect(l.what).toMatch(/No new rivers/);
    expect(LINE_DENOISE).toBe(0.3);
  });
});

describe('consolidate (the last step)', () => {
  it('the ring mask surrounds every pasted object and leaves the object itself out', () => {
    const r = ringMaskSvg(kingdom())!;
    expect(r.w).toBe(1344);
    expect(r.svg).toContain('fill="#000"'); // the core is cut out of the halo
    expect(r.svg).toContain('feGaussianBlur');
    expect(toPng(r.svg).subarray(1, 4).toString()).toBe('PNG');
    expect(ringMaskSvg(newMap('e', 'E', 'region'))).toBeNull();
    const bm = newMap('b', 'B', 'battle', 12, 10);
    applyOps(bm, [{ op: 'room', x: 1, y: 1, w: 8, h: 6, floor: 'wood' }, { op: 'prop', kind: 'table', x: 3, y: 3, w: 2, h: 1 }]);
    const br = ringMaskSvg(bm)!;
    expect(br.w).toBe(imageSize(bm).w);
    expect(ringMaskSvg(newMap('e2', 'E', 'battle', 8, 8))).toBeNull();
  });

  it('values rated best by the GM: 0.70 on battle maps, 0.80 on region maps', () => {
    expect(CONSOLIDATE_DENOISE).toEqual({ battle: 0.7, region: 0.8 });
    expect(consolidatePrompt('A tavern.', 'hand-painted top-down map')).toMatch(/One coherent painting/);
  });
});

// ---- the prompts the AI gets and gives ------------------------------------------------------------

describe('prompts for the AI (region)', () => {
  it('the terrain request forbids anything built and carries the facts of the sketch', () => {
    const req = regionTerrainRequest(kingdom(), 'A war-torn coastal kingdom in the first snow');
    expect(req).toContain('war-torn coastal kingdom');
    expect(req).toMatch(/nothing built/);
    expect(req).toContain('sea');
    expect(req).toContain('forest');
    expect(req).not.toContain('city'); // structures are not terrain facts
  });

  it('the structure request hands over the world look and every group', () => {
    const m = kingdom();
    const infos = describeRegionGroups(m, groupRegion(m));
    const req = regionGroupRequest('A coastal kingdom', { ...DEFAULT_STYLE, suffix: 'steampunk industrial age' }, infos);
    expect(req).toContain('steampunk industrial age');
    expect(req).toMatch(/tipis, nomad yurts/);
    for (const i of infos) expect(req).toContain(`"id":"${i.id}"`);
  });

  it('parses an answer in fences; gaps get the plain wording of the kind', () => {
    const m = kingdom();
    const infos = describeRegionGroups(m, groupRegion(m));
    const r = parseRegionPrompts('```json\n{"g1": "a walled harbour city with many red roofs", "g2": "x"}\n```', infos);
    expect(r.prompts.g1).toBe('a walled harbour city with many red roofs');
    expect(r.prompts.g2).toBe(fallbackRegionPrompt(infos[1]));
    expect(r.fromAi).toBe(1);
    expect(parseRegionPrompts('nonsense', infos).fromAi).toBe(0);
  });

  it('the look for region maps drops "battle map" from the campaign wording', () => {
    expect(regionLook(DEFAULT_STYLE)).toContain('overland map');
    expect(regionLook(DEFAULT_STYLE)).toContain('directly above');
    expect(regionLook(DEFAULT_STYLE)).not.toContain('battle');
    expect(regionLook({ ...DEFAULT_STYLE, regionSuffix: 'parchment cartography, ink and watercolour.' })).toBe('parchment cartography, ink and watercolour');
  });
});

// ---- the whole precise flow for a region map against a fake ComfyUI ---------------------------------

let dir: string;
let store: Store;
let svc: ImageService;
let seen: ImageJob[];
let wfs: any[];
let mode: MapPaintMode;
let aiCalls: string[];
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;

class FakeComfy extends Comfy {
  async uploadImage(_b: Buffer, name: string) {
    return name;
  }
  async generate(wf: any, opts: any) {
    wfs.push(wf);
    opts.onProgress?.(0.5);
    await new Promise((r) => setTimeout(r, 3));
    if (opts.signal?.aborted) throw new ComfyError('Cancelled.');
    return { bytes: Buffer.from(`png-${wfs.length}`), filename: 'x.png' };
  }
}
const idle = async () => {
  for (let i = 0; i < 400 && svc.jobs.some((j) => j.status === 'queued' || j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-region-'));
  store = new Store(new Persistence(dir));
  seen = [];
  wfs = [];
  mode = 'staged';
  aiCalls = [];
  svc = new ImageService(store, path.join(dir, 'images'), (j) => seen.push(j), new FakeComfy(), {
    mapMode: () => mode,
    ai: async (_backend, prompt) => {
      aiCalls.push(prompt);
      if (prompt.includes('GROUPS (JSON)')) {
        const ids = [...prompt.matchAll(/"id":"(g\d+)"/g)].map((x) => x[1]);
        return JSON.stringify(Object.fromEntries(ids.map((id) => [id, `AI says: a detailed structure for ${id}`])));
      }
      return 'Wild coastal land with a pine forest, nothing built, no buildings or settlements.';
    },
  });
  store.images = svc;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function setup() {
  run('create_node', { id: 'realm', type: 'location', title: 'The Realm', summary: 'A kingdom.' });
  const { mapId } = run('create_map', { name: 'Realm', nodeId: 'realm', kind: 'region' });
  const m = store.maps.get(mapId);
  const k = kingdom();
  m.size = k.size;
  m.shapes = k.shapes;
  store.maps.save(m, { backup: 'none' });
  return mapId as string;
}
const PLACE = 'A war-torn coastal kingdom in early winter';

describe('precise painting of a region map', () => {
  it('step 1 paints the land, then the lines: rivers first, then roads, each kept only inside its own corridor', async () => {
    const mapId = setup();
    const r = run('render_map', { mapId, prompt: PLACE, seed: 5 });
    expect(r.step).toMatch(/1 of 2/);
    expect(r.note).toMatch(/no structures yet/);
    await idle();
    expect(wfs).toHaveLength(3); // terrain + river pass + road pass
    const [terrain, water, land] = wfs;
    // the terrain: the sketch without structures AND without lines, bare ground
    expect(terrain['20'].inputs.image).toBe('pnp-' + mapId + '-terrain.png');
    expect(terrain['13'].inputs.denoise).toBeCloseTo(0.72, 2);
    const tp = terrain['10'].inputs.text as string;
    expect(tp).toContain('nothing built');
    expect(tp).toContain('EMPTY landscape');
    expect(tp).toContain('overland map');
    expect(tp).toContain('No rivers, no streams, no roads');
    expect(tp).not.toContain('city');
    expect(tp).not.toContain('asphalt');
    expect(terrain['11'].inputs.text).toMatch(/buildings/);
    expect(terrain['11'].inputs.text).toMatch(/rivers, streams, roads/);
    // the line passes: whole-picture sampling at 0.30, composited over the untouched original through the corridor mask
    for (const wf of [water, land]) {
      expect(wf['13'].inputs.denoise).toBe(0.3);
      expect(wf['25']).toBeUndefined(); // no noise mask: the whole picture is sampled
      expect(wf['28'].class_type).toBe('ImageCompositeMasked');
      expect(wf['28'].inputs.destination).toEqual(['50', 0]);
      expect(wf['15'].inputs.images).toEqual(['28', 0]);
      expect(wf['10'].inputs.text).toContain('Nothing is built anywhere');
      expect(wf['11'].inputs.text).toMatch(/castle/);
    }
    expect(water['10'].inputs.text).toMatch(/River winds/);
    expect(land['10'].inputs.text).toMatch(/Asphalt road cross the land/);
    expect(land['10'].inputs.text).toMatch(/No new rivers/);
    expect(land['11'].inputs.text).toMatch(/river, stream/);
    const m = store.maps.get(mapId);
    expect(m.terrains).toHaveLength(1);
    expect(m.renders).toEqual([]);
    expect(store.state.nodes.realm.images).toEqual([]);
    expect(aiCalls[0]).toMatch(/FIRST of two painting steps/);
    expect(aiCalls[0]).toMatch(/do NOT mention rivers/);
    expect(seen.some((j) => j.phase === 'Painting the rivers…')).toBe(true);
    expect(seen.some((j) => j.phase === 'Painting roads, rails and bridges…')).toBe(true);
  });

  it('view: strict puts the plan-view wording into every pass and is kept on the map', async () => {
    const mapId = setup();
    run('render_map', { mapId, prompt: PLACE, view: 'strict' });
    await idle();
    expect(store.maps.get(mapId).view).toBe('strict');
    expect(wfs[0]['10'].inputs.text).toMatch(/camera points straight down at 90 degrees/);
    expect(wfs[0]['11'].inputs.text).toMatch(/three-quarter view/);
    expect(wfs[1]['11'].inputs.text).toMatch(/three-quarter view/);
    run('render_map', { mapId, prompt: PLACE, view: 'default' });
    await idle();
    expect(store.maps.get(mapId).view).toBeUndefined();
  });

  it('a map without lines has no line passes', async () => {
    const mapId = setup();
    const m = store.maps.get(mapId);
    m.shapes = m.shapes.filter((s) => s.type !== 'path');
    store.maps.save(m, { backup: 'none' });
    run('render_map', { mapId, prompt: PLACE });
    await idle();
    expect(wfs).toHaveLength(1);
  });

  it('step 2 inpaints every structure with the GM wording kept, then blends them in (ring only, 0.80)', async () => {
    const mapId = setup();
    run('render_map', { mapId, prompt: PLACE });
    await idle();
    wfs.length = 0;
    expect(() => run('paint_map_props', { mapId })).toThrow(/No terrain picked/);
    run('set_map_terrain', { mapId, file: store.maps.get(mapId).terrains![0] });
    const m0 = store.maps.get(mapId);
    const campId = groupRegion(m0).find((g) => g.kind === 'camp')!.id;
    m0.propPrompts = { [campId]: { kind: 'camp', text: 'a smoking bandit camp with black tents' } };
    store.maps.save(m0, { backup: 'none' });

    const r = run('paint_map_props', { mapId, seed: 40 });
    expect(r.groups).toBe(4);
    await idle();
    expect(wfs).toHaveLength(5); // 4 structures + the consolidate pass
    const structures = wfs.slice(0, 4), ring = wfs[4];
    for (const wf of structures) {
      expect(wf['25'].class_type).toBe('SetLatentNoiseMask');
      expect(wf['13'].inputs.denoise).toBe(1);
      expect(wf['32']).toBeUndefined();
      expect(wf['10'].inputs.text).toMatch(/Hand-painted overland map seen from high above/);
    }
    const texts = structures.map((w) => w['10'].inputs.text as string);
    expect(texts.some((t) => t.includes('a smoking bandit camp with black tents'))).toBe(true);
    expect(texts.filter((t) => t.includes('AI says')).length).toBe(3);
    // the ring pass: whole picture, only the ring around the objects is resampled and kept
    expect(ring['13'].inputs.denoise).toBe(0.8);
    expect(ring['25'].class_type).toBe('SetLatentNoiseMask');
    expect(ring['28'].inputs.destination).toEqual(['20', 0]);
    expect(ring['10'].inputs.text).toMatch(/One coherent painting/);
    expect(ring['11'].inputs.text).toMatch(/new buildings/);
    const req = aiCalls.find((c) => c.includes('GROUPS (JSON)'))!;
    expect(req).not.toContain(`"id":"${campId}"`);
    expect(req).toContain(PLACE);
    const m = store.maps.get(mapId);
    expect(m.renders).toHaveLength(1);
    expect(store.state.nodes.realm.images).toEqual(m.renders);
    expect(m.propPrompts![campId].text).toBe('a smoking bandit camp with black tents');
    expect(Object.values(m.propPrompts!).filter((p) => p.ai)).toHaveLength(3);
    expect(seen.some((j) => /Painting structures 2\/4/.test(j.phase ?? ''))).toBe(true);
    expect(seen.some((j) => j.phase === 'Blending the objects into the picture…')).toBe(true);
    expect(seen.at(-1)!.progress).toBe(1);
  });

  it('consolidate can be switched off, per map', async () => {
    const mapId = setup();
    run('render_map', { mapId, prompt: PLACE, consolidate: false });
    await idle();
    expect(store.maps.get(mapId).consolidate).toBe(false);
    run('set_map_terrain', { mapId, file: store.maps.get(mapId).terrains![0] });
    wfs.length = 0;
    run('paint_map_props', { mapId });
    await idle();
    expect(wfs).toHaveLength(4); // structures only
    expect(run('get_map', { mapId }).consolidate).toBe(false);
    run('paint_map_props', { mapId, consolidate: true });
    await idle();
    expect(store.maps.get(mapId).consolidate).toBeUndefined();
  });

  it('a region map without structures says so', async () => {
    const mapId = setup();
    const m = store.maps.get(mapId);
    m.shapes = m.shapes.filter((s) => regionKind(s.kind).layer === 'terrain');
    store.maps.save(m, { backup: 'none' });
    run('render_map', { mapId, prompt: PLACE });
    await idle();
    run('set_map_terrain', { mapId, file: store.maps.get(mapId).terrains![0] });
    expect(() => run('paint_map_props', { mapId })).toThrow(/no structures to paint/);
  });

  it('get_map shows the structure groups, the line passes, the view and the paint mode', () => {
    const mapId = setup();
    const r = run('get_map', { mapId });
    expect(r.paintMode).toBe('staged');
    expect(r.structureGroups).toHaveLength(4);
    expect(r.linePasses).toEqual(['water: river', 'land: asphalt road']);
    expect(r.camera).toBe('default'); // how flat the land is painted (render_map's view)
    expect(r.view).toContain('Region map'); // the readable description of the map is still there
    expect(r.consolidate).toBe(true);
  });
});

describe('the campaign library of region kinds', () => {
  it('a kind defined once is usable on every region map; the map keeps its own copy', () => {
    const mapId = setup();
    run('set_region_kind', { name: 'Radioactive crater', layer: 'terrain', color: '#7cff3a', prompt: 'a glowing crater of molten green glass' });
    expect(store.state.meta.regionKinds).toHaveLength(1);
    expect(run('get_map', { mapId }).libraryKinds).toEqual([{ id: 'radioactive_crater', name: 'Radioactive crater', layer: 'terrain', geometry: 'area', inThisMap: false }]);
    // the shape op alone is enough: the definition travels with it
    run('edit_map', { mapId, ops: [{ op: 'shape', type: 'polygon', kind: 'radioactive_crater', points: [[100, 600], [200, 600], [150, 700]], id: 'c1' }] });
    const m = store.maps.get(mapId);
    expect(m.kinds?.map((k) => k.id)).toEqual(['radioactive_crater']);
    expect(m.shapes.some((s) => s.id === 'c1')).toBe(true);
    expect(run('get_map', { mapId }).libraryKinds[0].inThisMap).toBe(true);
    // the library entry may change or go; the map's copy stays
    run('remove_region_kind', { id: 'radioactive_crater' });
    expect(store.state.meta.regionKinds).toBeUndefined();
    expect(store.maps.get(mapId).kinds).toHaveLength(1);
  });

  it('edit_map still accepts a pin from an old caller (an AI with a stale tool list) and stores a round area', () => {
    const mapId = setup();
    run('edit_map', { mapId, ops: [{ op: 'shape', type: 'pin', kind: 'village', points: [[100, 100]], r: 20, label: 'Millbrook', id: 'p1' }, { op: 'shape', type: 'pin', kind: 'city', points: [[300, 100]], id: 'p2' }] });
    const m = store.maps.get(mapId);
    expect(m.shapes.some((s) => s.type === 'pin')).toBe(false);
    expect(m.shapes.find((s) => s.id === 'p1')).toMatchObject({ type: 'ellipse', points: [[100, 100], [20, 20]], label: 'Millbrook' });
    expect(m.shapes.find((s) => s.id === 'p2')?.type).toBe('ellipse');
  });

  it('refuses built-in ids and unusable definitions with a message for the AI', () => {
    expect(() => run('set_region_kind', { name: 'City', id: 'city', layer: 'structure', color: '#aa0000', prompt: 'a big city' })).toThrow(/built-in/);
    expect(() => run('set_region_kind', { name: 'Odd', layer: 'terrain', color: 'green', prompt: 'a green thing' })).toThrow(/hex colour/);
    expect(() => run('remove_region_kind', { id: 'nope' })).toThrow(/No library kind/);
  });

  it('a library line kind lands in the line passes', async () => {
    const mapId = setup();
    run('set_region_kind', { name: 'Ley line', layer: 'terrain', geometry: 'line', color: '#ff00ff', prompt: 'a glowing ley line', width: 7 });
    run('edit_map', { mapId, ops: [{ op: 'shape', type: 'path', kind: 'ley_line', points: [[10, 700], [300, 740]], id: 'ley' }] });
    run('render_map', { mapId, prompt: PLACE });
    await idle();
    expect(wfs).toHaveLength(3); // terrain, rivers, then roads + the ley line in the land pass
    expect(wfs[2]['10'].inputs.text).toMatch(/glowing ley line/);
  });
});

describe('repainting one group', () => {
  async function painted() {
    const mapId = setup();
    run('render_map', { mapId, prompt: PLACE });
    await idle();
    run('set_map_terrain', { mapId, file: store.maps.get(mapId).terrains![0] });
    run('paint_map_props', { mapId, seed: 40 });
    await idle();
    wfs.length = 0;
    return mapId;
  }

  it('paints that one group again on the latest picture and blends only its ring; the rest is not touched', async () => {
    const mapId = await painted();
    const m0 = store.maps.get(mapId);
    const city = groupRegion(m0).find((g) => g.kind === 'city')!.id;
    const writtenBefore = m0.propPrompts![city].text;
    const r = run('repaint_map_group', { mapId, group: city, seed: 900 });
    expect(r.kind).toBe('city');
    await idle();
    expect(wfs).toHaveLength(2); // one window + the ring of THIS group
    const [paint, ring] = wfs;
    expect(paint['25'].class_type).toBe('SetLatentNoiseMask');
    expect(paint['13'].inputs.denoise).toBe(1);
    expect(paint['13'].inputs.seed).toBe(901); // a new roll, not the seed of the first painting
    expect(paint['10'].inputs.text).toContain(writtenBefore.replace(/[.\s]+$/, '')); // the same object as before
    expect(ring['13'].inputs.denoise).toBe(0.8);
    expect(ring['25'].class_type).toBe('SetLatentNoiseMask');
    expect(aiCalls.filter((c) => c.includes('GROUPS (JSON)'))).toHaveLength(1); // only the first full painting asked the AI
    const m = store.maps.get(mapId);
    expect(m.renders).toHaveLength(2); // the first picture stays for comparison
    expect(store.state.nodes.realm.images).toEqual(m.renders);
    expect(seen.some((j) => /Painting city again/.test(j.phase ?? ''))).toBe(true);
  });

  it('uses the GM wording, or a one-off prompt, or writes one for a group that never had one', async () => {
    const mapId = await painted();
    const m = store.maps.get(mapId);
    const camp = groupRegion(m).find((g) => g.kind === 'camp')!.id;
    run('repaint_map_group', { mapId, group: camp, prompt: 'a burnt-out camp, charred tents', seed: 5 });
    await idle();
    expect(wfs[0]['10'].inputs.text).toContain('a burnt-out camp, charred tents');
    // the one-off prompt is not stored as the group's wording
    expect(store.maps.get(mapId).propPrompts![camp].text).not.toContain('burnt-out');
    wfs.length = 0;
    const m2 = store.maps.get(mapId);
    delete m2.propPrompts![camp];
    store.maps.save(m2, { backup: 'none' });
    run('repaint_map_group', { mapId, group: camp, seed: 6 });
    await idle();
    expect(wfs[0]['10'].inputs.text).toMatch(/AI says: a detailed structure for/);
    expect(store.maps.get(mapId).propPrompts![camp]).toMatchObject({ ai: true });
  });

  it('with the blend switched off it is one pass; errors are clear', async () => {
    const mapId = await painted();
    const m = store.maps.get(mapId);
    m.consolidate = false;
    store.maps.save(m, { backup: 'none' });
    run('repaint_map_group', { mapId, group: 'g1', seed: 1 });
    await idle();
    expect(wfs).toHaveLength(1);
    expect(() => run('repaint_map_group', { mapId, group: 'g99' })).toThrow(/no group "g99"/);
    expect(() => run('repaint_map_group', { mapId, group: 'g1', render: 'nope.png' })).toThrow(/not one of this map/);
    const fresh = setup2();
    expect(() => run('repaint_map_group', { mapId: fresh, group: 'g1' })).toThrow(/no finished picture/);
  });

  it('the ring of one group is only that group', () => {
    const m = kingdom();
    const all = ringMaskSvg(m)!.svg;
    const one = ringMaskSvg(m, ['g1'])!.svg;
    expect(one.length).toBeLessThan(all.length);
    expect(ringMaskSvg(m, ['g99'])).toBeNull();
  });
});

function setup2() {
  run('create_node', { id: 'other', type: 'location', title: 'Other', summary: 'x' });
  const { mapId } = run('create_map', { name: 'Other', nodeId: 'other', kind: 'region' });
  return mapId as string;
}
