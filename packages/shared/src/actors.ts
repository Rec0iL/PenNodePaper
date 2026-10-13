import type { Actor } from './index.js';

// ---------------------------------------------------------------------------
// Who is who: the assistants the app runs itself (Claude, agy, Codex) and any other MCP client that connects on
// its own. Those tell their name in the MCP handshake and are shown under it ("opencode"), not as somebody else.
// ---------------------------------------------------------------------------

export type ActorKey = 'user' | 'system' | 'claude' | 'agy' | 'codex' | 'ext';

/** An AI wrote this (as opposed to the GM or the app itself). */
export const isAiActor = (a: Actor): boolean => a !== 'user' && a !== 'system';

export const actorKey = (a: Actor): ActorKey => (a.startsWith('ext:') ? 'ext' : (a as ActorKey));

const LABELS: Record<string, string> = { user: 'You', system: 'system', claude: 'Claude', agy: 'agy', codex: 'Codex' };

/** The name shown in the activity log, on cards and in the review bar. */
export const actorName = (a: Actor): string => (a.startsWith('ext:') ? a.slice(4) || 'External AI' : (LABELS[a] ?? a));

const PALETTE = ['#7fe0a0', '#f2a1c8', '#e0c36a', '#5fd4c4', '#b89cff', '#ff9966', '#9ad0ff', '#c6e86b'];

/** A colour for the actor: the three built-in assistants have their own, everybody else gets a stable one from their name. */
export function actorColor(a: Actor): string {
  switch (actorKey(a)) {
    case 'user': return 'var(--accent)';
    case 'system': return 'var(--text-faint)';
    case 'claude': return 'var(--claude)';
    case 'agy': return 'var(--agy)';
    case 'codex': return 'var(--codex)';
    default: {
      let h = 0;
      for (const c of actorName(a)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return PALETTE[h % PALETTE.length];
    }
  }
}

/** Make a name sent by a client safe to show and to carry in an id: letters, digits, space . _ - + only, short. */
export function cleanClientName(raw: unknown): string {
  return String(raw ?? '').replace(/[^A-Za-z0-9 ._+-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}

/**
 * The actor for an MCP client that identified itself. The assistants the app knows keep their own identity
 * (a Claude Code or Codex someone attached by hand looks like the integrated one); everything else is `ext:<name>`.
 */
export function actorFromClient(name: unknown): Actor | null {
  const n = cleanClientName(name);
  if (!n) return null;
  if (/claude|anthropic/i.test(n)) return 'claude';
  if (/codex/i.test(n)) return 'codex';
  if (/^(agy|antigravity)\b/i.test(n)) return 'agy';
  return `ext:${n}`;
}
