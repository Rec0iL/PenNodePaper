import { describe, expect, it } from 'vitest';
import { CUSTOM_CAMERA_MAX, cameraOr, cleanCameraText, customCamera, lookOnly } from '@pnp/shared';

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
