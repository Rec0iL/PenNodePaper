<script lang="ts">
  // The character sheet of an enemy / NPC node. The form is NOT hard-coded: it is built from the
  // sheet structure the connected VTT (or its cached profile) declares, so any game system works.
  import { untrack } from 'svelte';
  import { validateSheet, fieldVisible, pickRole, sheetToText, type CharacterRole, type FieldSpec, type StoryNode } from '@pnp/shared';
  import { app, cmd } from '../lib/app.svelte';
  import FieldInput from './FieldInput.svelte';

  let { node }: { node: StoryNode } = $props();

  const RESERVED = new Set(['role', 'preset', 'sheet', 'mapId']);

  const profile = $derived(app.vtt?.profile ?? null);
  const roles = $derived<CharacterRole[]>(profile?.characters?.roles ?? []);
  const role = $derived(pickRole(roles, node.type, node.fields.role));
  const roleId = $derived(role?.id);
  const presetId = $derived(typeof node.fields.preset === 'string' ? node.fields.preset : '');
  const preset = $derived(role?.presets?.find((p) => p.id === presetId));

  /** the stored sheet; nodes from before sheets existed keep loose fields, which count as the sheet */
  const stored = $derived<Record<string, unknown>>(
    node.fields.sheet && typeof node.fields.sheet === 'object' && !Array.isArray(node.fields.sheet)
      ? { ...(node.fields.sheet as Record<string, unknown>) }
      : Object.fromEntries(Object.entries(node.fields).filter(([k]) => !RESERVED.has(k))),
  );

  // Local-first: rapid edits build on each other instead of on a stale server echo.
  let local = $state<Record<string, unknown>>({});
  let lastSent = '';
  let loadedFor = '';
  $effect(() => {
    const id = node.id;
    const server = JSON.stringify(stored);
    untrack(() => {
      if (id !== loadedFor || server !== lastSent) {
        local = JSON.parse(server);
        loadedFor = id;
        lastSent = server;
      }
    });
  });

  function save(next: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    local = next;
    lastSent = JSON.stringify(next);
    // loose pre-sheet fields move into the sheet: clear them from the node
    const legacy = Object.fromEntries(Object.keys(node.fields).filter((k) => !RESERVED.has(k)).map((k) => [k, null]));
    return cmd('update_node', { id: node.id, fields: { ...legacy, role: roleId ?? null, sheet: next, ...extra } });
  }
  const setVal = (key: string, v: unknown) => {
    const next = { ...local };
    if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete next[key];
    else next[key] = v;
    return save(next);
  };

  const check = $derived(role ? validateSheet(role, local, { preset: presetId, fillDefaults: false }) : null);
  const visible = $derived(role ? role.fields.filter((f) => fieldVisible(f, local)) : []);
  const groups = $derived.by(() => {
    const out: { name: string; fields: FieldSpec[] }[] = [];
    for (const f of visible) {
      const g = f.group ?? '';
      (out.find((x) => x.name === g) ?? (out[out.length - 1 && false ? 0 : out.push({ name: g, fields: [] }) - 1])).fields.push(f);
    }
    return out;
  });
  const missing = $derived(role ? role.fields.filter((f) => f.required && fieldVisible(f, local) && local[f.key] === undefined) : []);

  const asList = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

  function applyPreset(id: string) {
    const p = role?.presets?.find((x) => x.id === id);
    if (!p) return save(local, { preset: null });
    return save({ ...local, ...p.values }, { preset: p.id });
  }
</script>


<div class="label">{role?.label ?? (node.type === 'enemy' ? 'Enemy' : 'NPC')} sheet <span class="dim">— structure comes from your VTT / game system</span></div>
<div class="sheet" data-testid="character-sheet">
  {#if !role}
    <div class="dim">
      {profile ? `${profile.name} doesn't receive characters.` : 'PenNodePaper learns how enemies and NPCs are structured in your game from the VTT. Connect it once (⚙ Settings → VTT link); the sheet then appears here and is remembered for offline work.'}
    </div>
  {:else}
    {#if roles.length > 1}
      <div class="r2">
        <div>
          <div class="label tight">Sheet type</div>
          <select class="field" value={roleId} onchange={(e) => save(local, { role: e.currentTarget.value, preset: null })}>
            {#each roles as r}<option value={r.id}>{r.label}</option>{/each}
          </select>
        </div>
        {#if role.presets?.length}
          <div>
            <div class="label tight">Start from</div>
            <select class="field" value={presetId} onchange={(e) => applyPreset(e.currentTarget.value)}>
              <option value="">— preset —</option>
              {#each role.presets as p}<option value={p.id}>{p.label}</option>{/each}
            </select>
          </div>
        {/if}
      </div>
    {:else if role.presets?.length}
      <div class="label tight">Start from</div>
      <select class="field" value={presetId} onchange={(e) => applyPreset(e.currentTarget.value)}>
        <option value="">— preset —</option>
        {#each role.presets as p}<option value={p.id}>{p.label}</option>{/each}
      </select>
    {/if}
    {#if role.description}<div class="dim small">{role.description}</div>{/if}
    {#if preset?.help}<div class="dim small">{preset.help}</div>{/if}

    {#each groups as g}
      {#if g.name}<div class="grp">{g.name}</div>{/if}
      <div class="fields">
        {#each g.fields as f (f.key)}
          {@const range = preset?.ranges?.[f.key]}
          <div class="f" class:wide={f.type === 'longtext' || f.type === 'list' || f.type === 'tags'} class:bad={f.required && local[f.key] === undefined}>
            {#if f.type !== 'boolean'}
              <div class="label tight">{f.label}{#if f.required}<b class="req"> *</b>{/if}
                {#if range}<span class="dim"> usual {range[0]}–{range[1]}</span>{:else if f.type === 'number' && f.min !== undefined && f.max !== undefined}<span class="dim"> {f.min}–{f.max}</span>{/if}</div>
            {/if}
            {#if f.type === 'list'}
              {#each asList(local[f.key]) as entry, i (i)}
                <div class="entry">
                  {#each f.item ?? [] as sub (sub.key)}
                    <div class="sub">
                      {#if sub.type !== 'boolean'}<div class="label tight">{sub.label}</div>{/if}
                      <FieldInput f={sub} value={entry[sub.key]} set={(v) => setVal(f.key, asList(local[f.key]).map((x, j) => (j === i ? { ...x, [sub.key]: v } : x)))} />
                    </div>
                  {/each}
                  <button class="btn ghost" title="Remove" onclick={() => setVal(f.key, asList(local[f.key]).filter((_, j) => j !== i))}>×</button>
                </div>
              {/each}
              {@const first = f.item?.[0]}
              {#if first?.suggestions?.length}
                <select class="field" value="" onchange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ''; if (v) setVal(f.key, [...asList(local[f.key]), { [first.key]: v }]); }}>
                  <option value="">＋ Add {f.label.toLowerCase()}…</option>
                  {#each first.suggestions as o (o)}<option value={o}>{o}</option>{/each}
                  <option value="" disabled>──────────</option>
                </select>
                <button class="btn ghost" onclick={() => setVal(f.key, [...asList(local[f.key]), {}])}>＋ Add something else</button>
              {:else}
                <button class="btn" onclick={() => setVal(f.key, [...asList(local[f.key]), {}])}>＋ Add</button>
              {/if}
            {:else}
              <FieldInput {f} value={local[f.key]} set={(v) => setVal(f.key, v)} />
            {/if}
            {#if f.help}<div class="dim small">{f.help}</div>{/if}
          </div>
        {/each}
      </div>
    {/each}

    <div class="copy">
      <button class="btn" title="The sheet as JSON, keyed exactly like the VTT's fields" onclick={() => navigator.clipboard.writeText(JSON.stringify({ name: node.title, role: role.id, sheet: check?.sheet ?? local }, null, 2))}>Copy JSON</button>
      <button class="btn" title="Readable text, to read at the table or paste into notes" onclick={() => navigator.clipboard.writeText(sheetToText(role, node.title, check?.sheet ?? local))}>Copy as text</button>
    </div>
    {#if check && (check.errors.length || check.warnings.length || missing.length)}
      <div class="chk-box">
        {#each missing as f}<div class="err">⚠ {f.label} is required</div>{/each}
        {#each check.errors as e}<div class="err">⚠ {e}</div>{/each}
        {#each check.warnings as w}<div class="warn">• {w}</div>{/each}
      </div>
    {:else if check}<div class="ok small">✓ valid for {profile?.name}{app.vtt?.connected ? '' : ' (cached sheet)'}</div>{/if}
  {/if}
</div>

<style>
  .sheet { display: grid; gap: 6px; padding: 10px; background: var(--bg-3); border: 1px solid var(--line-2); border-left: 2px solid var(--tc); border-radius: 8px; }
  .label.tight { margin: 4px 0 2px; }
  .r2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .grp { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); margin-top: 6px; border-bottom: 1px solid var(--line); }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
  .f.wide { grid-column: 1 / -1; }
  .f.bad :global(.field) { border-color: #e0c36a; }
  .req { color: #e0c36a; }
  .dim { color: var(--text-faint); font-size: 11.5px; text-transform: none; letter-spacing: 0; }
  .small { font-size: 11.5px; }
  .entry { display: grid; grid-template-columns: 1fr auto; gap: 4px 6px; padding: 6px; margin-bottom: 4px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; align-items: start; }
  .entry .sub { grid-column: 1; }
  .entry .btn { grid-column: 2; grid-row: 1; }
  .copy { display: flex; gap: 6px; }
  .chk-box { display: grid; gap: 2px; font-size: 11.5px; }
  .err { color: var(--danger); }
  .warn { color: #e0c36a; }
  .ok { color: var(--ok); }
</style>
