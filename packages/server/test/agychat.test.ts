import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatMsg } from '@pnp/shared';
import { Chat } from '../src/chat.js';
import { Persistence } from '../src/persistence.js';
import { Store } from '../src/store.js';

// A stand-in `agy` that replays a prepared stream (the format is what the real one prints with --output-format stream-json).
let dir: string;
let oldPath: string | undefined;
let chat: Chat;
const messages: ChatMsg[] = [];

const line = (o: unknown) => JSON.stringify(o);
const step = (i: number, state: string, step_type: string, more: Record<string, unknown> = {}) => line({ event: 'step_update', step_update: { conversation_id: 'c1', step_index: i, state, step_type, ...more } });
const QUOTA = 'Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 56h33m12s.';

function fakeAgy(lines: string[], exit = 0, stderr = '') {
  const script = `#!/bin/sh\ncat <<'EOF_STREAM'\n${[line({ event: 'init', conversation_id: 'c1', init: {} }), ...lines].join('\n')}\nEOF_STREAM\n${stderr ? `echo '${stderr}' >&2\n` : ''}exit ${exit}\n`;
  fs.writeFileSync(path.join(dir, 'bin', 'agy'), script, { mode: 0o755 });
}
const finals = () => [...new Map(messages.map((m) => [m.id, m])).values()];
const system = () => finals().filter((m) => m.role === 'system').map((m) => m.text);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-agychat-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  oldPath = process.env.PATH;
  process.env.PATH = `${path.join(dir, 'bin')}:${oldPath}`;
  messages.length = 0;
  const store = new Store(new Persistence(path.join(dir, 'camp')));
  chat = new Chat({ store, port: 0, token: '', campaignDir: dir, broadcast: (m) => m.t === 'chat' && (messages.push({ ...m.msg }), undefined) });
});
afterEach(() => {
  process.env.PATH = oldPath;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('agy results', () => {
  it('a turn that went through says nothing, and agy’s bookkeeping steps and thinking-only steps leave no bubbles', async () => {
    fakeAgy([
      step(0, 'DONE', 'user_input'),
      step(1, 'DONE', 'system_message'),
      step(2, 'DONE', 'agent_response'), // thinking only, no words
      step(3, 'ACTIVE', 'agent_response', { text_delta: 'Alles ' }),
      step(3, 'DONE', 'agent_response', { text_delta: 'erledigt.' }),
      line({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response: 'Alles erledigt.' } }),
    ]);
    await chat.send({ text: 'hi', backend: 'agy' });
    const m = finals();
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant']);
    expect(m[1].text).toBe('Alles erledigt.');
    expect(m[1].streaming).toBe(false);
  });

  it('an old error that agy repeats in the result of a later, successful turn is not reported again', async () => {
    // the conversation once hit a quota error (another model); this turn ran on a different model and answered
    fakeAgy([
      step(0, 'DONE', 'user_input'),
      step(1, 'DONE', 'system_message'),
      step(2, 'ACTIVE', 'agent_response', { text_delta: 'zwei' }),
      step(2, 'DONE', 'agent_response', { text_delta: '\n' }),
      line({ event: 'result', result: { conversation_id: 'c1', status: 'ERROR', response: 'zwei\n', error: QUOTA, num_turns: 2 } }),
    ]);
    await chat.send({ text: 'weiter', backend: 'agy' });
    expect(system()).toEqual([]);
    expect(finals().find((x) => x.role === 'assistant')?.text).toBe('zwei\n');
  });

  it('a turn that really failed is reported once, with agy’s own words', async () => {
    fakeAgy([
      step(0, 'DONE', 'user_input'),
      step(1, 'DONE', 'error_message'),
      line({ event: 'result', result: { conversation_id: 'c1', status: 'ERROR', response: '', error: QUOTA } }),
    ], 3, `{"message":"${QUOTA.slice(0, 40)}...","status":"RESOURCE_EXHAUSTED"}`);
    await chat.send({ text: 'weiter', backend: 'agy' });
    expect(system()).toEqual([`agy: ${QUOTA}`]);
    expect(finals().some((x) => x.role === 'tool')).toBe(false); // the error step is no "tool"
  });

  it('stopping a run is quiet: no "interrupted" noise', async () => {
    fakeAgy([
      step(0, 'DONE', 'user_input'),
      line({ event: 'result', result: { conversation_id: 'c1', status: 'ERROR', response: 'x', error: 'interrupted' } }),
    ], 1, 'error: interrupted');
    const done = chat.send({ text: 'lang', backend: 'agy' });
    chat.cancel();
    await done;
    expect(system()).toEqual([]);
  });
});
