import { describe, expect, it } from 'vitest';
import { parseQuery, searchNodes, type CampaignState, type StoryNode } from '@pnp/shared';

const node = (id: string, type: StoryNode['type'], title: string, extra: Partial<StoryNode> = {}): StoryNode => ({
  id, type, title, summary: '', body: '', readAloud: '', tags: [], status: 'untouched', fields: {}, images: [], poolHint: '', trashed: false, createdAt: '', updatedAt: '2026-01-01', ...extra,
});
const state = (nodes: StoryNode[], placed: string[] = []): CampaignState => ({
  meta: { name: 't', language: 'de', createdAt: '' },
  nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
  graph: { version: 1, canvases: [{ id: 'main', name: 'Main' }], placements: Object.fromEntries(placed.map((id) => [id, { canvas: 'main', x: 0, y: 0 }])), edges: [], frames: [] },
});

describe('quick search', () => {
  const s = state([
    node('brenn', 'npc', 'Brenn der Wirt', { summary: 'Erkennt den Kult an schwarzen Pennys.', tags: ['taverne'] }),
    node('anker', 'location', 'Der Rostige Anker (Taverne)', { summary: 'Rauchige Hafentaverne.', body: 'Im Keller lagert Wein.' }),
    node('mira', 'npc', 'Mira Salzzunge', { readAloud: 'Sie flüstert über die Glocke.', tags: ['kult'] }),
    node('glocke', 'event', 'Die Glocke schlägt dreizehn', { status: 'done' }),
    node('gone', 'npc', 'Brenn der Zweite', { trashed: true }),
  ], ['anker', 'glocke']);

  it('ranks title matches above text matches and ignores trashed nodes and accents', () => {
    expect(searchNodes(s, 'brenn').map((h) => h.id)).toEqual(['brenn']);
    expect(searchNodes(s, 'taverne').map((h) => h.id)).toEqual(['anker', 'brenn']); // title, then tag
    expect(searchNodes(s, 'rauchige')[0].id).toBe('anker');
    expect(searchNodes(s, 'fluestert')[0]?.id).toBeUndefined(); // ü is not ue — but accents fold: "flustert" finds it
    expect(searchNodes(s, 'flustert')[0].id).toBe('mira');
  });

  it('every word has to match, and a snippet shows where', () => {
    expect(searchNodes(s, 'wirt kult').map((h) => h.id)).toEqual(['brenn']);
    expect(searchNodes(s, 'wein')[0].snippet).toContain('Wein');
    expect(searchNodes(s, 'wirt zzz')).toEqual([]);
  });

  it('filters: type:, #tag, is:pool / is:played', () => {
    expect(parseQuery('type:npc #kult mira')).toMatchObject({ types: ['npc'], tags: ['kult'], terms: ['mira'] });
    expect(searchNodes(s, 'type:npc').map((h) => h.id).sort()).toEqual(['brenn', 'mira']);
    expect(searchNodes(s, '#kult').map((h) => h.id)).toEqual(['mira']);
    expect(searchNodes(s, 'is:pool type:npc').map((h) => h.id).sort()).toEqual(['brenn', 'mira']);
    expect(searchNodes(s, 'is:played').map((h) => h.id)).toEqual(['glocke']);
    expect(searchNodes(s, 'type:loc')[0].id).toBe('anker'); // prefix of the type
  });

  it('without words it lists the filtered nodes, most recently changed first', () => {
    expect(searchNodes(s, '').length).toBe(4);
  });
});
