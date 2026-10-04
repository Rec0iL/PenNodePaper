// Random tables: a "table" node holds its entries as lines in fields.entries ("Rain", "3× Fog" = three times as likely).
// Pure, so the Inspector, the card and the AI's tools read and roll them the same way.
import type { StoryNode } from './index.js';

export interface TableEntry {
  text: string;
  /** faces of the die that give this entry (a plain line = 1) */
  weight: number;
}

export interface TableRange extends TableEntry {
  from: number;
  to: number;
}

export interface TableRoll {
  roll: number;
  index: number;
  text: string;
  range: string;
}

const WEIGHT = /^\s*(\d{1,3})\s*[x×]\s+(.+)$/i;

export function parseEntry(line: string): TableEntry | null {
  const t = line.trim();
  if (!t) return null;
  const m = WEIGHT.exec(t);
  return m ? { weight: Math.max(1, Number(m[1])), text: m[2].trim() } : { weight: 1, text: t };
}

export const parseEntryLines = (text: string): TableEntry[] => text.split('\n').flatMap((l) => parseEntry(l) ?? []);
export const entryLine = (e: TableEntry) => (e.weight > 1 ? `${e.weight}× ${e.text}` : e.text);

/** The entries of a table node (lines of fields.entries, or {text, weight} objects). */
export function tableEntries(n: Pick<StoryNode, 'fields'>): TableEntry[] {
  const raw = n.fields.entries;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e): TableEntry[] => {
    if (typeof e === 'string') { const p = parseEntry(e); return p ? [p] : []; }
    if (e && typeof e === 'object' && typeof (e as { text?: unknown }).text === 'string') {
      const o = e as { text: string; weight?: unknown };
      return o.text.trim() ? [{ text: o.text.trim(), weight: Math.max(1, Math.round(Number(o.weight)) || 1) }] : [];
    }
    return [];
  });
}

/** 1–N faces for every entry, in order. */
export function tableRanges(entries: TableEntry[]): TableRange[] {
  let at = 1;
  return entries.map((e) => {
    const r = { ...e, from: at, to: at + e.weight - 1 };
    at += e.weight;
    return r;
  });
}

export const tableFaces = (entries: TableEntry[]) => entries.reduce((s, e) => s + e.weight, 0);

/** "d6", "d20", "d100" when the faces match a standard die, else "d37". */
export const dieLabel = (faces: number) => (faces > 0 ? `d${faces}` : '—');

const fmtRange = (r: TableRange) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`);

export function rollTable(entries: TableEntry[], rnd: () => number = Math.random): TableRoll {
  const faces = tableFaces(entries);
  if (!faces) throw new Error('The table has no entries.');
  const roll = Math.min(faces, Math.floor(rnd() * faces) + 1);
  const ranges = tableRanges(entries);
  const index = ranges.findIndex((r) => roll >= r.from && roll <= r.to);
  return { roll, index, text: ranges[index].text, range: fmtRange(ranges[index]) };
}

/** A small seeded generator (mulberry32) so a roll can be reproduced. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tableMarkdown(title: string, entries: TableEntry[]): string {
  const rs = tableRanges(entries);
  return [`### ${title} (${dieLabel(tableFaces(entries))})`, '', ...rs.map((r) => `${fmtRange(r)}. ${r.text}`)].join('\n');
}

export interface RollLogEntry { at: string; roll: number; text: string }
export const rollLog = (n: Pick<StoryNode, 'fields'>): RollLogEntry[] =>
  Array.isArray(n.fields.history) ? (n.fields.history as RollLogEntry[]).filter((h) => h && typeof h.text === 'string') : [];
