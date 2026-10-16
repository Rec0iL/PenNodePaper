import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_STYLE } from '@pnp/shared';
import { runCommand } from '../src/commands.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';
import { generateStyle, parseStyle, styleMaterial, stylePrompt } from '../src/style.js';

let dir: string;
let store: Store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-style-'));
  store = new Store(new Persistence(dir));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const world = () => {
  let md = '# Greywater\n\nA fog-bound harbour town of tarred timber, wet cobbles and sodium-yellow lanterns.\n\n';
  for (let i = 0; i < 30; i++) md += `## District ${i}\n\nDistrict ${i} is built of black basalt and rusted iron. ${'Salt-stained sailcloth awnings flap above crowded markets. '.repeat(10)}\n\n`;
  md += '## The Drowned Chapel\n\nA chapel half-sunk in the bay, green verdigris on copper bells, candlelight through stained glass.\n';
  return md;
};

describe('generate style from world books', () => {
  it('refuses when there is nothing to base a style on', () => {
    expect(() => styleMaterial(store)).toThrow(/write a world book first/);
  });

  it('gathers a bounded, evenly sampled view of long books incl. the summary', () => {
    store.world.add('greywater', world());
    store.world.setSummary('greywater', 'Fog-bound basalt harbour town; a drowned chapel in the bay.');
    const m = styleMaterial(store);
    expect(m.length).toBeLessThanOrEqual(14000);
    expect(m).toContain('Fog-bound basalt harbour town');
    expect(m).toContain('Excerpts');
    expect(m).toMatch(/basalt/);
    const p = stylePrompt(store, DEFAULT_STYLE);
    expect(p).toContain('ONLY one JSON object');
    expect(p).toContain(JSON.stringify(DEFAULT_STYLE)); // current style is offered for improvement
  });

  it('falls back to the rules digest when no world book exists', () => {
    store.rulebooks.setDigest('Gritty cyberpunk heists in a neon-soaked megacity.');
    expect(styleMaterial(store)).toContain('cyberpunk');
  });

  it('parses answers wrapped in fences/prose and repairs missing essentials', () => {
    const s = parseStyle('Sure! ```json\n{"suffix":"Gritty ink-and-wash illustration of a fog-bound harbour, tarred timber, wet cobbles, sodium lantern light, desaturated teal and rust palette.","negative":"modern objects","mapSuffix":"hand-inked harbour map on stained vellum"}\n```');
    expect(s.suffix).not.toMatch(/\.$/);
    expect(s.negative).toMatch(/watermark/); // essentials appended
    expect(s.negative).toMatch(/modern objects/);
    expect(s.mapSuffix).toMatch(/vellum/);
    expect(s.mapSuffix).not.toMatch(/top-down|from above/); // the camera is the map's own business
    expect(parseStyle('{"suffix":"a b c d e f g h","negative":"text, watermark, blurry"}').mapSuffix).toBe(DEFAULT_STYLE.mapSuffix);
  });

  it('the map style is only a look: a camera or a kind of map the AI wrote anyway is dropped', () => {
    const wrote = (mapSuffix: string) => parseStyle(JSON.stringify({ suffix: 'Gritty ink-and-wash illustration of a fog-bound harbour, tarred timber', negative: 'text, watermark, blurry', mapSuffix })).mapSuffix;
    expect(wrote('hand-painted tabletop RPG battle map, seen from directly above, orthographic top-down view, weathered stone and wet planks, warm lantern light, no characters, no text, no grid lines'))
      .toBe('hand-painted, weathered stone and wet planks, warm lantern light, no characters, no text, no grid lines');
    expect(wrote('aged parchment region map, bird\'s-eye view, isometric perspective, faded sepia ink')).toBe('aged parchment, faded sepia ink, no characters, no text, no grid lines');
    expect(wrote('lit from above by a low sun, charcoal on grey paper, shot from the side')).toBe('lit from above by a low sun, charcoal on grey paper, no characters, no text, no grid lines'); // light is not a camera
    expect(wrote('top-down, from above, battle map')).toBe(DEFAULT_STYLE.mapSuffix); // nothing left: the default look
    expect(DEFAULT_STYLE.mapSuffix).not.toMatch(/top-down|from above|battle/);
  });

  it('tells the AI to describe only the look of maps, never the camera or the kind of map', () => {
    store.rulebooks.setDigest('Gritty heists in a fog-bound harbour city.');
    const p = stylePrompt(store, DEFAULT_STYLE);
    expect(p).toMatch(/ONLY the look/);
    expect(p).toMatch(/Do NOT say anything about the camera/);
    expect(p).toMatch(/what KIND of map it is/);
    expect(p).not.toMatch(/MUST end with: "seen from directly above/);
  });

  it('rejects unusable answers', () => {
    expect(() => parseStyle('I cannot do that')).toThrow(/did not return a style/);
    expect(() => parseStyle('{ nope }')).toThrow(/not valid JSON/);
    expect(() => parseStyle('{"suffix":"dark","negative":""}')).toThrow(/too short/);
  });

  it('generateStyle sends the prompt to the chosen backend and returns the parsed style', async () => {
    store.world.add('greywater', world());
    let seen: { backend?: string; model?: string; prompt?: string } = {};
    const style = await generateStyle(store, DEFAULT_STYLE, 'agy', 'gemini-x', async (backend, prompt, model) => {
      seen = { backend, model, prompt };
      return '{"suffix":"Moody ink-and-wash harbour illustration, tarred timber and wet cobbles, sodium lantern glow, teal and rust palette","negative":"text, watermark, blurry, modern buildings","mapSuffix":"inked harbour map, seen from directly above, orthographic top-down view, no characters, no text, no grid lines"}';
    });
    expect(seen).toMatchObject({ backend: 'agy', model: 'gemini-x' });
    expect(seen.prompt).toContain('basalt');
    expect(style.suffix).toContain('ink-and-wash');
  });

  it('set_image_style (AI command) updates only the given fields and persists', () => {
    runCommand(store, 'set_image_style', { suffix: 'Charcoal sketch, high contrast' }, 'claude');
    expect(store.images).toBeNull(); // no image service in this test; read meta directly
    expect(store.state.meta.style).toEqual({ suffix: 'Charcoal sketch, high contrast' });
    runCommand(store, 'set_image_style', { negative: 'colour' }, 'claude');
    expect(new Store(new Persistence(dir)).state.meta.style).toEqual({ suffix: 'Charcoal sketch, high contrast', negative: 'colour' });
  });
});
