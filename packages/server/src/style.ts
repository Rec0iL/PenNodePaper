import { spawn } from 'node:child_process';
import { DEFAULT_STYLE, type Backend, type StyleConfig } from '@pnp/shared';
import type { Store } from './store.js';

// ---------------------------------------------------------------------------
// "Generate style from world books": an art-director pass. The world books (and,
// as a fallback, the rules digest) are condensed into the campaign's image style:
// the suffix appended to every image prompt, the negative prompt, and the map look.
// ---------------------------------------------------------------------------

const MATERIAL_CAP = 14000;
const PER_BOOK_TEXT = 4500;

export type Runner = (backend: Backend, prompt: string, model?: string) => Promise<string>;

/** Collect what the art director gets to read. Throws when there is nothing to base a style on. */
export function styleMaterial(store: Store): string {
  const parts: string[] = [];
  for (const b of store.world.list()) {
    const book = store.world.book(b.name);
    if (!book) continue;
    const summary = store.world.summary(b.name);
    const outline = store.world.outline(b.name, { depth: 2, maxChars: 1500 });
    // opening text of each top-level section, so a long book is sampled evenly rather than only its start
    const tops = book.sections.filter((s) => s.level > 0 && s.level <= 2 && s.text.trim());
    const each = Math.max(250, Math.floor(PER_BOOK_TEXT / Math.max(tops.length, 1)));
    const sample = tops.map((s) => `### ${s.title}\n${s.text.trim().slice(0, each)}`).join('\n\n').slice(0, PER_BOOK_TEXT);
    parts.push(`## World book "${b.name}"\n${summary ? `Summary: ${summary}\n` : ''}Outline:\n${outline}\n\nExcerpts:\n${sample || book.sections[0]?.text.slice(0, PER_BOOK_TEXT) || ''}`);
  }
  if (!parts.length) {
    const digest = store.rulebooks.digest;
    if (digest) parts.push(`## Rules digest (no world book yet)\n${digest.slice(0, 5000)}`);
  }
  if (!parts.length) throw new Error('There is nothing to base a style on yet — write a world book first (Library → ＋ New), or at least give the campaign a rules digest.');
  return parts.join('\n\n---\n\n').slice(0, MATERIAL_CAP);
}

export function stylePrompt(store: Store, current: StyleConfig): string {
  return [
    'You are the art director for a tabletop role-playing campaign. Read the campaign material below and define the VISUAL STYLE for AI-generated artwork (portraits, scenes, items, handouts) and for top-down maps. The image model (Krea 2) understands natural-language descriptions.',
    '',
    'Return ONLY one JSON object, no markdown fences, no commentary:',
    '{"suffix": "...", "negative": "...", "mapSuffix": "..."}',
    '',
    'Rules:',
    '- "suffix": 25-50 words, appended to every image prompt. Describe ONLY the look: medium/technique (e.g. oil painting, ink and wash, gritty photoreal), colour palette, lighting, mood, and the typical materials, architecture and costume of this world. Visual and evocative; NO character names, place names, plot or story.',
    '- "negative": a comma-separated list of things to avoid. Always include: text, watermark, signature, blurry, low quality, deformed, extra fingers. Add 3-6 elements that would BREAK this setting (e.g. modern objects, wrong technology level, wrong art style).',
    '- "mapSuffix": how maps of this world look when painted, in the same visual language (surfaces, materials, lighting, ink/paint style). It MUST end with: "seen from directly above, orthographic top-down view, no characters, no text, no grid lines".',
    '- Write in English regardless of the campaign language (the image model prefers it).',
    '',
    `Current style (improve on it, or replace it if it doesn't fit): ${JSON.stringify(current)}`,
    '',
    `Campaign: "${store.state.meta.name}"`,
    '',
    '=== CAMPAIGN MATERIAL ===',
    styleMaterial(store),
  ].join('\n');
}

/** Pull the JSON object out of a model answer (it may wrap it in fences or prose) and validate it. */
export function parseStyle(text: string): StyleConfig {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI did not return a style. Try again.');
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('The AI answer was not valid JSON. Try again.');
  }
  const str = (k: string) => (typeof j[k] === 'string' ? (j[k] as string).trim().replace(/\s+/g, ' ') : '');
  const suffix = str('suffix');
  if (suffix.split(/\s+/).length < 6) throw new Error('The AI style was too short to be useful. Try again.');
  let negative = str('negative');
  for (const must of ['text', 'watermark', 'blurry']) if (!new RegExp(`\\b${must}\\b`, 'i').test(negative)) negative = negative ? `${negative}, ${must}` : must;
  let mapSuffix = str('mapSuffix') || DEFAULT_STYLE.mapSuffix;
  if (!/top-down/i.test(mapSuffix)) mapSuffix = `${mapSuffix.replace(/[.,\s]+$/, '')}, seen from directly above, orthographic top-down view, no characters, no text, no grid lines`;
  return { suffix: suffix.replace(/[.\s]+$/, ''), negative, mapSuffix };
}

/** Run a CLI once, headless, no tools, and return its answer text. */
export const runOnce: Runner = (backend, prompt, model) =>
  new Promise((resolve, reject) => {
    const args =
      backend === 'claude'
        ? ['-p', prompt, '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', ...(model ? ['--model', model] : [])]
        : ['-p', prompt, '--output-format', 'json', ...(model ? ['--model', model] : [])];
    const child = spawn(backend, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 3 * 60_000);
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start "${backend}": ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out) as { result?: string; response?: string; is_error?: boolean };
        const text = j.result ?? j.response ?? '';
        if (code === 0 && text && !j.is_error) return resolve(text);
      } catch { /* fall through */ }
      reject(new Error(`${backend} failed${err.trim() ? `: ${err.trim().slice(-300)}` : out.trim() ? `: ${out.trim().slice(-300)}` : ''}`));
    });
  });

export async function generateStyle(store: Store, current: StyleConfig, backend: Backend, model?: string, run: Runner = runOnce): Promise<StyleConfig> {
  return parseStyle(await run(backend, stylePrompt(store, current), model));
}
