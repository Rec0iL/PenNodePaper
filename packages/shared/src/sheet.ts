import type { CharacterRole, FieldSpec } from './vtt.js';

// ---------------------------------------------------------------------------
// Character sheets are described by the VTT (CharacterRole). This validates and
// normalises a sheet against such a description — used by the editor form, the
// AI's set_character_sheet and the push, so all three agree on what is valid.
// ---------------------------------------------------------------------------

export interface SheetCheck {
  /** only known, currently visible keys, coerced to the declared types */
  sheet: Record<string, unknown>;
  /** problems that make a push pointless (wrong type, out of range, missing required) */
  errors: string[];
  /** things worth a look (outside the preset's usual range, unknown keys dropped) */
  warnings: string[];
}

export const fieldVisible = (f: FieldSpec, sheet: Record<string, unknown>) => {
  const c = f.showIf;
  if (!c) return true;
  const v = sheet[c.key];
  return ('equals' in c ? v === c.equals : true) && ('notEquals' in c ? v !== c.notEquals : true);
};

const optValue = (f: FieldSpec, v: unknown): string | undefined => {
  const s = String(v ?? '').trim().toLowerCase();
  return f.options?.find((o) => o.value.toLowerCase() === s || o.label?.toLowerCase() === s)?.value;
};

function coerce(f: FieldSpec, v: unknown, path: string, errors: string[], warnings: string[]): unknown {
  const bad = (msg: string) => {
    errors.push(`${path}: ${msg}`);
    return undefined;
  };
  switch (f.type) {
    case 'text':
    case 'longtext':
      return v == null ? undefined : String(v);
    case 'boolean':
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return bad('must be true or false');
    case 'number': {
      if (v === '' || v == null) return undefined;
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return bad(`"${String(v)}" is not a number`);
      if (f.min !== undefined && n < f.min) return bad(`${n} is below the minimum ${f.min}`);
      if (f.max !== undefined && n > f.max) return bad(`${n} is above the maximum ${f.max}`);
      return n;
    }
    case 'select': {
      const o = optValue(f, v);
      if (!o) return bad(`"${String(v)}" is not one of: ${(f.options ?? []).map((x) => x.value).join(', ')}`);
      return o;
    }
    case 'tags': {
      const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null;
      if (!arr) return bad('must be a list of tags');
      return arr.map((t) => String(t).trim()).filter(Boolean);
    }
    case 'list': {
      if (v == null) return undefined;
      if (!Array.isArray(v)) return bad('must be a list');
      const item = f.item ?? [];
      return v.flatMap((e, i): Record<string, unknown>[] => {
        // shorthand: a plain string fills the first item field
        const entry = typeof e === 'string' ? { [item[0]?.key ?? 'name']: e } : e && typeof e === 'object' ? (e as Record<string, unknown>) : null;
        if (!entry) {
          errors.push(`${path}[${i}]: must be an object`);
          return [];
        }
        const out: Record<string, unknown> = {};
        for (const sub of item) {
          const val = coerce(sub, entry[sub.key], `${path}[${i}].${sub.key}`, errors, warnings);
          if (val !== undefined) out[sub.key] = val;
          else if (sub.required) errors.push(`${path}[${i}].${sub.key}: required`);
        }
        return Object.keys(out).length ? [out] : [];
      });
    }
  }
}

export function validateSheet(role: CharacterRole, input: Record<string, unknown>, opts: { preset?: string; fillDefaults?: boolean } = {}): SheetCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const out: Record<string, unknown> = {};
  const preset = role.presets?.find((p) => p.id === opts.preset);

  // two passes so showIf sees the already-coerced controlling value
  const ordered = [...role.fields].sort((a, b) => Number(!!a.showIf) - Number(!!b.showIf));
  for (const f of ordered) {
    if (!fieldVisible(f, out)) continue;
    let raw = input[f.key];
    if (raw === undefined && opts.fillDefaults !== false) raw = preset?.values[f.key] ?? f.default;
    const val = raw === undefined ? undefined : coerce(f, raw, f.key, errors, warnings);
    if (val !== undefined) out[f.key] = val;
    else if (f.required && raw === undefined) errors.push(`${f.key}: required (${f.label})`);
    const r = preset?.ranges?.[f.key];
    if (r && typeof val === 'number' && (val < r[0] || val > r[1])) warnings.push(`${f.key}: ${val} is outside the usual range ${r[0]}–${r[1]} for "${preset!.label}"`);
  }
  const known = new Set(role.fields.map((f) => f.key));
  const dropped = Object.keys(input).filter((k) => !known.has(k));
  if (dropped.length) warnings.push(`ignored (not part of the "${role.label}" sheet): ${dropped.join(', ')}`);
  return { sheet: out, errors, warnings };
}

/** Which of a VTT's roles describes a node: explicit choice > the role named like the node type > a role tagged for it > the first one. */
export function pickRole(roles: CharacterRole[], nodeType: string, explicit?: unknown): CharacterRole | undefined {
  if (typeof explicit === 'string') {
    const hit = roles.find((r) => r.id === explicit);
    if (hit) return hit;
  }
  return roles.find((r) => r.for?.includes(nodeType as 'enemy' | 'npc' | 'pc')) ?? roles.find((r) => r.id === nodeType) ?? roles[0];
}

const show = (f: FieldSpec, v: unknown): string => {
  if (v === undefined || v === null || v === '') return '';
  if (f.type === 'boolean') return v ? 'yes' : 'no';
  if (f.type === 'select') return f.options?.find((o) => o.value === v)?.label ?? String(v);
  if (f.type === 'tags') return (v as string[]).join(', ');
  if (f.type === 'list') return (v as Record<string, unknown>[]).map((e) => (f.item ?? []).map((sub) => show(sub, e[sub.key])).filter(Boolean).join(' · ')).join('; ');
  return String(v);
};

/** A sheet as readable text (labels instead of keys) — for GMs whose VTT can't import characters (yet). */
export function sheetToText(role: CharacterRole, name: string, sheet: Record<string, unknown>): string {
  const lines = [`${name} — ${role.label}`];
  let group: string | undefined;
  for (const f of role.fields) {
    if (!fieldVisible(f, sheet)) continue;
    const val = show(f, sheet[f.key]);
    if (!val) continue;
    if (f.group !== group && f.group) lines.push('', `[${f.group}]`);
    group = f.group;
    lines.push(f.type === 'list' ? `${f.label}:\n${(sheet[f.key] as Record<string, unknown>[]).map((e) => `  - ${(f.item ?? []).map((sub) => show(sub, e[sub.key])).filter(Boolean).join(' · ')}`).join('\n')}` : `${f.label}: ${val}`);
  }
  return lines.join('\n');
}
