import { describe, expect, it } from 'vitest';
import { CUSTOM_CAMERA_MAX, cameraKey, cameraOr, cameraProfile, cleanCameraText, customCamera, dropAiPrompts, lookOnly } from '@pnp/shared';

describe('the camera of a map', () => {
  it('tidies the GM\'s words and only counts them for a custom camera', () => {
    expect(cleanCameraText('  a cross-section\n seen   from the side.  ')).toBe('a cross-section seen from the side');
    expect(cleanCameraText('x'.repeat(1000))).toHaveLength(CUSTOM_CAMERA_MAX);
    expect(cleanCameraText(undefined)).toBe('');
    expect(customCamera({ view: 'custom', viewText: 'from the side' })).toBe('from the side');
    expect(customCamera({ view: 'custom', viewText: '  ' })).toBe(''); // custom without words: the standard camera
    expect(customCamera({ view: 'strict', viewText: 'from the side' })).toBe('');
    expect(cameraOr({}, 'standard')).toBe('standard');
    expect(cameraOr({ view: 'custom', viewText: 'a side view' }, 'standard')).toBe('a side view');
  });

  it('a style keeps only the look: no camera clauses, no kind of map', () => {
    expect(lookOnly('hand-painted tabletop RPG battle map, seen from directly above, orthographic top-down view, detailed textures, no characters, no text, no grid lines'))
      .toBe('hand-painted, detailed textures, no characters, no text, no grid lines');
    expect(lookOnly('oil on canvas region map, isometric, bird\'s-eye perspective, muted palette')).toBe('oil on canvas, muted palette');
    expect(lookOnly('overland map in the style of a Tolkien endpaper; viewed from high above; ink and sepia')).toBe('in the style of a Tolkien endpaper, ink and sepia');
    expect(lookOnly('Dungeon Map, camera angle low, plan view, woodcut')).toBe('woodcut');
    expect(lookOnly('from above, straight down, top-down')).toBe('');
    // lighting and materials are not cameras
    expect(lookOnly('lit from above by torchlight, weathered stone, oblique light across the floor')).toBe('lit from above by torchlight, weathered stone, oblique light across the floor');
    expect(lookOnly('watercolour')).toBe('watercolour');
    expect(lookOnly('')).toBe('');
  });
});

describe('the camera profile: one table for every painting prompt', () => {
  it('a battle map looks straight from above; strict / plan are region settings', () => {
    const p = cameraProfile({ kind: 'battle' });
    expect(p).toMatchObject({ custom: false, look: 'seen from directly above, orthographic top-down view', prop: 'top-down orthographic view from directly above', kindNote: 'a top-down tabletop battle map', negative: 'perspective view' });
    expect(cameraProfile({ kind: 'battle', view: 'plan' })).toEqual(p);
  });

  it('region cameras: natural as always, top-down and survey map push the props and the AI the same way as the land', () => {
    const natural = cameraProfile({ kind: 'region' });
    expect(natural.prop).toBe('seen from high above, top-down');
    expect(natural.writerAs).toBe('as seen from high above on a map');
    expect(natural.extraNegative).toBe('');
    expect(natural.terrain).toMatch(/strictly straight down/);
    const strict = cameraProfile({ kind: 'region', view: 'strict' });
    expect(strict.terrain).toMatch(/camera points straight down at 90 degrees/);
    expect(strict.prop).toMatch(/plan view/);
    expect(strict.writerView).toBe('seen straight down in plan view');
    expect(strict.extraNegative).toMatch(/three-quarter view/);
    const plan = cameraProfile({ kind: 'region', view: 'plan' });
    expect(plan.terrain).toMatch(/hillshaded survey map/);
    expect(plan.prop).toMatch(/survey-plan symbol/);
    expect(plan.writerAs).toMatch(/flat survey-plan symbols/);
  });

  it('the GM\'s own camera is in every place, and rules nothing out', () => {
    for (const kind of ['battle', 'region'] as const) {
      const p = cameraProfile({ kind, view: 'custom', viewText: 'a vertical section seen from the side' });
      expect(p).toMatchObject({ custom: true, look: 'a vertical section seen from the side', prop: 'a vertical section seen from the side', terrain: '', negative: '', extraNegative: '', propNegative: '' });
      expect(p.writerView).toContain('a vertical section');
      expect(p.writerAs).toContain("the map's own view (a vertical section seen from the side)");
      expect(p.kindNote).toContain('its camera: a vertical section seen from the side');
    }
    expect(cameraProfile({ kind: 'region', view: 'custom', viewText: '  ' }).custom).toBe(false); // no words: the standard camera
  });

  it('a change of camera is noticed; what the AI wrote goes, what the GM wrote stays', () => {
    expect(cameraKey({})).toBe('default:');
    expect(cameraKey({ view: 'strict' })).not.toBe(cameraKey({}));
    expect(cameraKey({ view: 'custom', viewText: 'a' })).not.toBe(cameraKey({ view: 'custom', viewText: 'b' }));
    expect(cameraKey({ view: 'custom', viewText: ' ' })).toBe(cameraKey({}));
    const m = { propPrompts: { g1: { kind: 'table', text: 'mine' }, g2: { kind: 'barrel', text: 'ai', ai: true } } };
    dropAiPrompts(m);
    expect(m.propPrompts).toEqual({ g1: { kind: 'table', text: 'mine' } });
    const onlyAi: { propPrompts?: Record<string, { kind: string; text: string; ai?: boolean }> } = { propPrompts: { g1: { kind: 'table', text: 'x', ai: true } } };
    dropAiPrompts(onlyAi);
    expect(onlyAi.propPrompts).toBeUndefined();
  });
});
