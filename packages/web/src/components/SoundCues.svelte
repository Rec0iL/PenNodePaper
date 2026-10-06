<script lang="ts">
  // "Sound & music" of a node: pick the sounds this scene needs from the connected VTT's own list, then play them with
  // one click — optionally together with the node's handout. No typing, no ids.
  import { soundsOf, type SoundCue, type StoryNode } from '@pnp/shared';
  import { app, cmd, loadTracks, say } from '../lib/app.svelte';

  let { node }: { node: StoryNode } = $props();

  const connected = $derived(!!app.vtt?.connected);
  const profile = $derived(app.vtt?.connected ? app.vtt.profile : null);
  const canPlay = $derived(connected && !!profile?.push?.music_cue);
  const cues = $derived(soundsOf(node));
  const hasHandout = $derived(node.images.length > 0 || !!node.readAloud.trim() || !!node.summary.trim());
  let busy = $state(false);

  // the VTT's track list, fetched once per connection
  $effect(() => { if (connected && profile?.push?.music_cue) void loadTracks(); });

  const byId = $derived(new Map((app.tracks ?? []).map((t) => [t.id, t])));
  const nameOf = (c: SoundCue) => byId.get(c.trackId)?.title ?? c.title ?? c.trackId;
  const unknown = (c: SoundCue) => !!app.tracks && !byId.has(c.trackId);

  const groups = $derived.by(() => {
    const have = new Set(cues.map((c) => c.trackId));
    const out = new Map<string, { id: string; title: string }[]>();
    for (const t of app.tracks ?? []) {
      if (have.has(t.id)) continue;
      const g = t.uploaded ? 'Your own' : t.category || 'Sounds';
      (out.get(g) ?? out.set(g, []).get(g)!).push(t);
    }
    return [...out.entries()];
  });

  const save = (next: SoundCue[]) => cmd('set_node_sounds', { nodeId: node.id, sounds: next });
  function add(trackId: string) {
    const t = byId.get(trackId);
    if (!t || cues.some((c) => c.trackId === trackId)) return;
    void save([...cues, { trackId, title: t.title }]);
  }
  const remove = (trackId: string) => save(cues.filter((c) => c.trackId !== trackId));

  async function play(args: { handout?: boolean; trackId?: string }) {
    busy = true;
    const r = await cmd<{ played: string[]; handout: string | null; problems?: string[] }>('play_node', { nodeId: node.id, ...args });
    busy = false;
    if (!r) return;
    const parts = [r.played.length ? `Playing ${r.played.join(', ')}` : '', r.handout ? `handed out “${r.handout}”` : ''].filter(Boolean);
    say(parts.join(' · ') + (r.problems?.length ? ` (${r.problems.join('; ')})` : ''), r.problems?.length ? 'error' : 'ok');
  }
</script>

<div class="label">Sound &amp; music</div>
<div class="box">
  {#if !canPlay}
    <div class="note">{profile ? `${profile.name} cannot play sounds from here.` : 'Connect your VTT to pick sounds and play them (⚙ Settings → VTT link).'}</div>
  {/if}

  {#each cues as c (c.trackId)}
    <div class="cue" class:bad={unknown(c)}>
      <button class="go" disabled={!canPlay || busy} onclick={() => play({ trackId: c.trackId })} title="Play just this one">▶</button>
      <div class="txt">
        <span class="nm">{nameOf(c)}</span>
        {#if unknown(c)}<span class="why">not in this VTT's list</span>{:else if c.note}<span class="why">{c.note}</span>{/if}
      </div>
      <button class="btn ghost" title="Take it off the list" onclick={() => remove(c.trackId)}>×</button>
    </div>
  {:else}
    <div class="note">No sounds yet for this scene.</div>
  {/each}

  <select class="field" disabled={!canPlay || !app.tracks} value="" onchange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ''; if (v) add(v); }}>
    <option value="">{!canPlay ? 'Connect the VTT to choose sounds' : !app.tracks ? 'Loading the VTT\'s sounds…' : '＋ Add a sound or music…'}</option>
    {#each groups as [name, list] (name)}
      <optgroup label={name}>{#each list as t (t.id)}<option value={t.id}>{t.title}</option>{/each}</optgroup>
    {/each}
  </select>

  <div class="btns">
    <button class="btn primary" disabled={!canPlay || busy || !cues.length} onclick={() => play({})} title={cues.length > 1 ? 'Start all of them, in this order' : 'Play it on the VTT'}>▶ Play{cues.length > 1 ? ` all ${cues.length}` : ''}</button>
    <button class="btn" disabled={!canPlay || busy || (!cues.length && !hasHandout) || !profile?.push?.handout} onclick={() => play({ handout: true })} title={hasHandout ? 'Play the sounds AND show this node’s handout to the players right now' : 'This node has nothing to hand out yet (no picture, read-aloud text or summary)'}>▶ Play + hand out</button>
  </div>
</div>

<style>
  .box { display: grid; gap: 6px; padding: 10px; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 10px; }
  .note { color: var(--text-faint); font-size: 12px; line-height: 1.5; }
  .cue { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; padding: 5px 6px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; }
  .cue.bad { border-color: #6a4a18; }
  .go { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--accent); background: var(--bg-4); color: var(--accent); font-size: 11px; }
  .go:hover:not(:disabled) { background: var(--accent); color: var(--bg); }
  .go:disabled { opacity: 0.4; }
  .txt { display: grid; min-width: 0; line-height: 1.3; }
  .nm { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .why { font-size: 11px; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bad .why { color: #e0c36a; }
  .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
</style>
