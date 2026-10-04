import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pickRole, slugify, type StoryNode, type UpfCharacter, type UpfImage, type VttProfile } from '@pnp/shared';
import type { Store } from './store.js';

// ---------------------------------------------------------------------------
// The players' characters, reported by the VTT, kept as nodes of type "pc".
// They are saved with the campaign (so sessions can be prepared without the VTT
// running) and re-synced whenever the VTT reports a change. The VTT owns the
// sheet; everything the GM wrote on the node (summary, notes, tags, links) is theirs.
// ---------------------------------------------------------------------------

export const partyNodeId = (profileId: string, charId: string) => `pc-${slugify(profileId)}-${slugify(charId)}`.slice(0, 64);

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function savePortrait(dir: string, id: string, img: UpfImage): { file: string; hash: string } {
  const bytes = Buffer.from(img.b64, 'base64');
  const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 12);
  const file = `${id}-${hash}.${EXT[img.mime] ?? 'png'}`;
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, file))) fs.writeFileSync(path.join(dir, file), bytes);
  return { file, hash };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Upsert the party as pc nodes. A full snapshot: players missing from it are kept, marked as not in the VTT. */
export function syncParty(store: Store, profile: VttProfile, chars: UpfCharacter[]): { created: number; updated: number; absent: number } {
  const stats = { created: 0, updated: 0, absent: 0 };
  const stamp = new Date().toISOString();
  store.transact('system', `Party synced from ${profile.name}`, (tx) => {
    const seen = new Set<string>();
    for (const c of chars) {
      const id = partyNodeId(profile.id, c.id);
      seen.add(id);
      const cur = tx.node(id);
      if (cur?.trashed) continue; // the GM removed this one: respect it
      const portrait = c.portrait ? savePortrait(store.imagesDir, id, c.portrait) : null;
      const base: Record<string, unknown> = {
        ...(cur?.fields ?? {}),
        source: profile.id, vttId: c.id, role: c.role, sheet: c.sheet, playerName: c.playerName ?? null, online: !!c.online, present: true,
        ...(portrait ? { portraitHash: portrait.hash } : {}),
      };
      const before = cur ? { ...cur.fields, syncedAt: undefined } : null;
      const content = { ...base };
      const changed = !cur || !same(before && { ...before }, { ...content, syncedAt: undefined }) || cur.title !== c.name || (portrait !== null && cur.images[0] !== portrait.file);
      if (!changed) continue;
      const fields = { ...content, syncedAt: stamp };
      const images = portrait ? [portrait.file, ...(cur?.images ?? []).filter((f) => f !== portrait.file)] : cur?.images ?? [];
      const node: StoryNode = cur
        ? { ...cur, title: c.name, images, fields, updatedAt: stamp }
        : {
            id, type: 'pc', title: c.name, summary: c.playerName ? `Played by ${c.playerName}` : '', body: '', readAloud: '', tags: [], status: 'untouched',
            fields, images, poolHint: '', trashed: false, createdAt: stamp, updatedAt: stamp,
          };
      tx.putNode(node);
      cur ? stats.updated++ : stats.created++;
    }
    for (const n of Object.values(tx.state.nodes)) {
      if (n.type !== 'pc' || n.trashed || n.fields.source !== profile.id || seen.has(n.id)) continue;
      if (n.fields.present !== false || n.fields.online !== false) {
        tx.putNode({ ...n, fields: { ...n.fields, present: false, online: false }, updatedAt: stamp });
        stats.absent++;
      }
    }
    tx.label = `Party synced from ${profile.name}: ${chars.length} character${chars.length === 1 ? '' : 's'}`;
  });
  return stats;
}

/** One line per player for the AI: who they are and what matters, labelled with the VTT's own field names. */
export function partyDigest(store: Store): string {
  const pcs = Object.values(store.state.nodes).filter((n) => n.type === 'pc' && !n.trashed);
  if (!pcs.length) return '';
  const profile = store.vtt.status().profile;
  const lines = pcs.map((n) => {
    const roles = profile?.characters?.roles ?? [];
    const role = pickRole(roles, 'pc', n.fields.role);
    const sheet = (n.fields.sheet ?? {}) as Record<string, unknown>;
    const bits: string[] = [];
    for (const f of role?.fields ?? Object.keys(sheet).map((k) => ({ key: k, label: k, type: 'text' as const }))) {
      const v = sheet[f.key];
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      const shown = Array.isArray(v) ? v.map((e) => (typeof e === 'object' && e ? String((e as Record<string, unknown>).name ?? Object.values(e)[0] ?? '') : String(e))).filter(Boolean).join(', ') : String(v);
      if (shown.length > 0 && f.type !== 'longtext') bits.push(`${f.label}: ${shown.slice(0, 90)}`);
    }
    const who = n.fields.playerName ? ` (player ${String(n.fields.playerName)})` : '';
    const group = typeof n.fields.group === 'string' && n.fields.group ? ` [group: ${n.fields.group}]` : '';
    const gone = n.fields.present === false ? ' [not in the VTT right now]' : '';
    return `- ${n.title}${who}${group}${gone}${n.summary && !n.summary.startsWith('Played by') ? ` — ${n.summary}` : ''}${bits.length ? `\n    ${bits.join(' · ').slice(0, 520)}` : ''}`;
  });
  return lines.join('\n').slice(0, 4500);
}
