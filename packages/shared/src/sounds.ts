// ---------------------------------------------------------------------------
// The sound cues of a node: the music / sound effects the GM wants for that scene, picked from the connected VTT's
// track list. Stored in node.fields.sounds; older nodes (and the AI before it had a tool for this) may carry a loose
// node.fields.sound instead, which is read the same way.
// ---------------------------------------------------------------------------

export interface SoundCue {
  /** a track id from the VTT's own list (the `tracks` request) */
  trackId: string;
  /** shown in the UI; the VTT's track list is the source of truth */
  title?: string;
  /** when to play it (“when the bell strikes”), shown under the title */
  note?: string;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

function one(v: unknown): SoundCue | null {
  if (typeof v === 'string') return v.trim() ? { trackId: v.trim() } : null;
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const trackId = str(o.trackId) ?? str(o.track) ?? str(o.id);
  if (!trackId) return null;
  const title = str(o.title) ?? str(o.titel) ?? str(o.name);
  const note = str(o.note) ?? str(o.wann) ?? str(o.when);
  return { trackId, ...(title ? { title } : {}), ...(note ? { note } : {}) };
}

/** The node's sound cues, in order (duplicates dropped). */
export function soundsOf(n: { fields: Record<string, unknown> }): SoundCue[] {
  const raw = n.fields.sounds ?? n.fields.sound;
  const list = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  const seen = new Set<string>();
  return list.flatMap((x) => {
    const c = one(x);
    if (!c || seen.has(c.trackId)) return [];
    seen.add(c.trackId);
    return [c];
  });
}
