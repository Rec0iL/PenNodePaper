<script lang="ts">
  // One input of a character sheet. Built for people who would rather pick than type: wherever the game system gives
  // choices (suggestions, a short number range) the field is a dropdown or a row of chips; typing stays possible
  // ("Other…") because the VTT's suggestions are never a hard limit.
  import type { FieldSpec } from '@pnp/shared';

  let { f, value, set }: { f: FieldSpec; value: unknown; set: (v: unknown) => void } = $props();

  const OTHER = '__other__';

  // ---- number: a short, stepped range becomes a dropdown ----
  const steps = $derived.by(() => {
    if (f.type !== 'number' || f.min === undefined || f.max === undefined) return null;
    const step = f.step && f.step > 0 ? f.step : 1;
    const n = Math.floor((f.max - f.min) / step + 1e-9) + 1;
    if (n < 2 || n > 40) return null;
    return Array.from({ length: n }, (_, i) => Math.round((f.min! + i * step) * 1000) / 1000);
  });
  const numOptions = $derived(steps && typeof value === 'number' && !steps.includes(value) ? [...steps, value].sort((a, b) => a - b) : steps);

  // ---- text with suggestions: dropdown + "Other…" ----
  let other = $state(false);
  const sugg = $derived(f.suggestions ?? []);
  const text = $derived(String(value ?? ''));
  const custom = $derived(text !== '' && !sugg.includes(text));
  const showText = $derived(other || custom);

  // ---- tags with suggestions: chips ----
  const picked = $derived(Array.isArray(value) ? (value as string[]) : []);
  let adding = $state('');
  const toggle = (t: string) => set(picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t]);
  const addOwn = () => {
    const t = adding.trim();
    adding = '';
    if (t && !picked.includes(t)) set([...picked, t]);
  };
</script>

{#if f.type === 'number'}
  {#if numOptions}
    <select class="field" value={typeof value === 'number' ? String(value) : ''} onchange={(e) => set(e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))}>
      <option value="">{f.default !== undefined ? `default (${f.default})` : '—'}</option>
      {#each numOptions as n (n)}<option value={String(n)}>{n}</option>{/each}
    </select>
  {:else}
    <input class="field" type="number" min={f.min} max={f.max} step={f.step ?? 1} value={value ?? ''} placeholder={f.default !== undefined ? String(f.default) : '—'}
      onchange={(e) => set(e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))} />
  {/if}
{:else if f.type === 'boolean'}
  <label class="chk"><input type="checkbox" checked={value === true} onchange={(e) => set(e.currentTarget.checked)} /> {f.label}</label>
{:else if f.type === 'select'}
  <select class="field" value={String(value ?? '')} onchange={(e) => set(e.currentTarget.value || undefined)}>
    <option value="">—</option>
    {#each f.options ?? [] as o}<option value={o.value}>{o.label ?? o.value}</option>{/each}
  </select>
{:else if f.type === 'longtext'}
  <textarea class="field" rows="3" value={text} onchange={(e) => set(e.currentTarget.value)}></textarea>
{:else if f.type === 'tags'}
  {#if sugg.length}
    <div class="chips">
      {#each sugg as t (t)}<button type="button" class="chip" class:on={picked.includes(t)} onclick={() => toggle(t)}>{t}</button>{/each}
      {#each picked.filter((t) => !sugg.includes(t)) as t (t)}<button type="button" class="chip on" title="Remove" onclick={() => toggle(t)}>{t} ×</button>{/each}
      <input class="field own" placeholder="＋ other…" bind:value={adding} onkeydown={(e) => e.key === 'Enter' && addOwn()} onblur={addOwn} />
    </div>
  {:else}
    <input class="field" value={picked.join(', ')} placeholder="comma, separated" onchange={(e) => set(e.currentTarget.value.split(',').map((t) => t.trim()).filter(Boolean))} />
  {/if}
{:else if sugg.length}
  <select class="field" value={showText ? OTHER : text} onchange={(e) => { const v = e.currentTarget.value; if (v === OTHER) other = true; else { other = false; set(v || undefined); } }}>
    <option value="">—</option>
    {#each sugg as o (o)}<option value={o}>{o}</option>{/each}
    <option value={OTHER}>Other…{custom ? ` (${text})` : ''}</option>
  </select>
  {#if showText}
    <input class="field" style="margin-top:4px" value={text} placeholder="Type your own…" onchange={(e) => set(e.currentTarget.value)} />
  {/if}
{:else}
  <input class="field" value={text} onchange={(e) => set(e.currentTarget.value)} />
{/if}

<style>
  .chk { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--text-dim); padding-top: 18px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .chip { padding: 2px 10px; border-radius: 99px; border: 1px solid var(--line-2); background: var(--bg-3); color: var(--text-dim); font-size: 11.5px; }
  .chip:hover { background: var(--bg-4); color: var(--text); }
  .chip.on { border-color: var(--accent); color: var(--text); background: var(--bg-4); }
  .own { width: 110px; padding: 2px 8px; font-size: 11.5px; }
</style>
