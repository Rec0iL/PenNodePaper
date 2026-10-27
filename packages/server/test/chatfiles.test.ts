import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { imageSize, mapIdsOf, type ChatAsk } from '@pnp/shared';
import { Chat } from '../src/chat.js';
import { runCommand } from '../src/commands.js';
import { imageDimensions } from '../src/imagefile.js';
import { toPng } from '../src/maps.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

const png = (w: number, h: number) => toPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#4a8"/></svg>`);

let dir: string;
let store: Store;
const run = (name: string, args: unknown = {}) => runCommand(store, name, args, 'claude') as any;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-chatfiles-'));
  store = new Store(new Persistence(dir));
  run('create_node', { id: 'inn', type: 'location', title: 'The Inn', summary: 'An inn.' });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('files the GM attaches to the chat', () => {
  it('keeps pictures and files under ids of its own; names are cleaned, pictures are known by their bytes', () => {
    const a = store.attachments.save('../../evil name<>.png', png(300, 200));
    expect(a).toMatchObject({ kind: 'image', w: 300, h: 200, mime: 'image/png' });
    expect(a.id).toMatch(/^att-[0-9a-f]{12}$/);
    expect(a.name).not.toContain('/');
    const t = store.attachments.save('notes.md', Buffer.from('# Rumours\nThe bell rings at midnight.'));
    expect(t.kind).toBe('file');
    expect(run('read_attachment', { id: t.id }).text).toContain('bell rings');
    expect(() => run('read_attachment', { id: a.id })).toThrow(/view_image/);
    expect(() => store.attachments.get('att-../../x')).toThrow(/not an attachment id/);
  });

  it('view_image hands the picture itself to the AI — attachments and pictures the campaign has', () => {
    const a = store.attachments.save('sketch.png', png(2400, 1200));
    const r = run('view_image', { file: a.id });
    expect(r.__images).toHaveLength(1);
    expect(r.size).toBe('1568x784'); // a big picture is scaled down to look at
    fs.mkdirSync(store.imagesDir, { recursive: true });
    fs.writeFileSync(path.join(store.imagesDir, 'inn-1.png'), png(64, 64));
    run('add_picture_to_node', { nodeId: 'inn', file: 'inn-1.png' });
    expect(run('view_image', { file: 'inn-1.png' })).toMatchObject({ from: 'campaign', usedBy: [{ id: 'inn' }] });
    expect(() => run('view_image', { file: '../../etc/passwd' })).toThrow(/No picture/);
  });

  it('a picture becomes a node\'s picture, or a map of the place sized to it (the node keeps its other maps)', () => {
    const a = store.attachments.save('tavern.png', png(1200, 800));
    const p = run('add_picture_to_node', { nodeId: 'inn', file: a.id, cover: true });
    expect(store.state.nodes.inn.images[0]).toBe(p.file);
    run('create_map', { name: 'Cellar', nodeId: 'inn' });
    const m = run('map_from_picture', { nodeId: 'inn', file: a.id, kind: 'battle', cols: 30 });
    expect(m.grid).toBe('30x20');
    const doc = store.maps.get(m.mapId);
    const want = imageSize(doc);
    expect(imageDimensions(fs.readFileSync(path.join(store.imagesDir, doc.renders[0])))).toEqual({ w: want.w, h: want.h });
    expect(mapIdsOf(store.state.nodes.inn)).toHaveLength(2);
    const r = run('map_from_picture', { nodeId: 'inn', file: a.id, kind: 'region' });
    expect(store.maps.get(r.mapId).kind).toBe('region');
  });
});

describe('questions to the GM', () => {
  it('ask_user shows a card in the chat; the answer goes back to the AI as the next message', async () => {
    const chat = new Chat({ store, port: 0, token: 't', campaignDir: dir, broadcast: () => {} });
    store.onAsk = (ask, actor) => chat.ask(ask, actor);
    const q: ChatAsk['questions'] = [{ question: 'Which way?', options: [{ label: 'North' }, { label: 'South' }] }];
    run('ask_user', { questions: q });
    const card = chat.messages.at(-1)!;
    expect(card.ask?.questions[0].question).toBe('Which way?');
    expect(card.backend).toBe('claude');
    const sent: unknown[] = [];
    (chat as unknown as { send: (o: unknown) => Promise<void> }).send = async (o) => void sent.push(o);
    await expect(chat.answer(card.id, [[]])).rejects.toThrow(/Pick an answer/);
    await chat.answer(card.id, [['South']], 'opus');
    expect(card.ask?.answered).toEqual([{ question: 'Which way?', picked: ['South'] }]);
    expect(sent).toEqual([{ text: 'South', backend: 'claude', model: 'opus', nodeId: undefined }]);
    await expect(chat.answer(card.id, [['North']])).rejects.toThrow(/already answered/);
  });

  it('without a chat the AI is told to ask in its reply', () => {
    expect(() => run('ask_user', { questions: [{ question: 'Which?', options: [{ label: 'a' }, { label: 'b' }] }] })).toThrow(/ask in your reply/);
  });
});
