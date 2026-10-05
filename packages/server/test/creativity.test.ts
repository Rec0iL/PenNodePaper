import { describe, expect, it } from 'vitest';
import { creativityBlock } from '../src/chat.js';

describe('creativityBlock', () => {
  it('level 3 (and unset) adds nothing — the baseline behaviour', () => {
    expect(creativityBlock(3)).toBe('');
    expect(creativityBlock(undefined)).toBe('');
  });
  it('1 forbids extras and ideas; 2 offers exactly one idea; 4 and 5 offer several', () => {
    expect(creativityBlock(1)).toMatch(/nothing more/);
    expect(creativityBlock(1)).not.toMatch(/💡/);
    expect(creativityBlock(2)).toMatch(/ONE creative idea/);
    expect(creativityBlock(4)).toMatch(/2-4 further creative ideas/);
    expect(creativityBlock(5)).toMatch(/additions only/);
    for (const l of [2, 4, 5] as const) expect(creativityBlock(l)).toMatch(/"yes"/);
  });
});
