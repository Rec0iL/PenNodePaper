<script lang="ts">
  // Play music and sounds on the connected VTT with one click — the same cues the AI sends (play_track).
  import { app, cmd, loadTracks, say } from '../lib/app.svelte';

  type Track = { id: string; title: string; category?: string; uploaded?: boolean };

  const profile = $derived(app.vtt?.profile ?? null);
  const supported = $derived(!!profile?.push?.music_cue);
  const moods = $derived(!!profile?.push?.music_cue?.mood);
  const connected = $derived(!!app.vtt?.connected);

  const tracks = $derived<Track[] | null>(app.tracks);
  let query = $state('');
  let mood = $state('');
  let playing = $state('');
  let busy = $state(false);

  $effect(() => { if (app.soundsOpen && connected && supported) void loadTracks(true); });

  const groups = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<string, Track[]>();
    for (const t of tracks ?? []) {
      if (q && !`${t.title} ${t.category ?? ''}`.toLowerCase().includes(q)) continue;
      const g = t.uploaded ? 'Your own' : (t.category || 'Sounds');
      (out.get(g) ?? out.set(g, []).get(g)!).push(t);
    }
    return [...out.entries()];
  });

  async function play(t: Track) {
    busy = true;
    const r = await cmd('play_track', { action: 'play', trackId: t.id });
    busy = false;
    if (r !== undefined) { playing = t.id; say(`Playing “${t.title}”`, 'ok'); }
  }
  async function playMood() {
    const m = mood.trim();
    if (!m) return;
    busy = true;
    const r = await cmd('play_track', { action: 'play', mood: m });
    busy = false;
    if (r !== undefined) { playing = ''; say(`Playing something for “${m}”`, 'ok'); }
  }
  async function stop() {
    busy = true;
    const r = await cmd('play_track', { action: 'stop' });
    busy = false;
    if (r !== undefined) { playing = ''; say('Stopped', 'ok'); }
  }
  const close = () => (app.soundsOpen = false);
</script>

<svelte:window onkeydown={(e) => app.soundsOpen && e.key === 'Escape' && close()} />

{#if app.soundsOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" onclick={(e) => e.target === e.currentTarget && close()}>
    <div class="panel" role="dialog" aria-label="Music and sounds">
      <header>
        <b>♪ Music &amp; sounds</b><span class="dim">{profile?.name ?? ''}</span>
        <span class="grow"></span>
        <button class="btn" disabled={!connected || !supported || busy} onclick={stop} title="Stop what is playing (fades out)">■ Stop</button>
        <button class="btn ghost" onclick={close}>×</button>
      </header>
      {#if !supported}
        <p class="hint">{profile ? `${profile.name} cannot play music cues from here.` : 'No VTT known yet — connect one in ⚙ Settings → VTT link.'}</p>
      {:else if !connected}
        <p class="hint">The VTT is not connected right now, so nothing can be played. Reconnect it (⚙ Settings → VTT link) and open this again.</p>
      {:else}
        {#if moods}
          <div class="mood">
            <input class="field" placeholder="…or describe a mood, e.g. tense, tavern, triumphant" bind:value={mood} onkeydown={(e) => e.key === 'Enter' && playMood()} />
            <button class="btn primary" disabled={!mood.trim() || busy} onclick={playMood}>▶</button>
          </div>
        {/if}
        <input class="field" placeholder="Search tracks…" bind:value={query} />
        <div class="list">
          {#if tracks === null}
            <p class="hint">Asking the VTT…</p>
          {:else if !tracks.length}
            <p class="hint">The VTT did not list any tracks.</p>
          {:else if !groups.length}
            <p class="hint">Nothing matches “{query}”.</p>
          {/if}
          {#each groups as [name, list] (name)}
            <div class="grp">{name}</div>
            {#each list as t (t.id)}
              <button class="track" class:on={playing === t.id} disabled={busy} onclick={() => play(t)} title="Play on the VTT for everyone">
                <span class="go">{playing === t.id ? '♪' : '▶'}</span><span class="nm">{t.title}</span>
              </button>
            {/each}
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 1400; display: flex; justify-content: center; align-items: flex-start; padding-top: 52px; background: rgba(5, 6, 9, 0.45); animation: pnp-pop 0.15s ease-out; }
  .panel { width: min(440px, 94vw); max-height: 78vh; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px 14px; background: var(--bg-2); border: 1px solid var(--line-2); border-radius: 14px; box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6); }
  header { display: flex; align-items: center; gap: 10px; }
  .grow { flex: 1; }
  .dim { color: var(--text-faint); font-size: 11.5px; }
  .hint { color: var(--text-faint); font-size: 12px; margin: 6px 2px; line-height: 1.5; }
  .mood { display: flex; gap: 6px; }
  .mood .field { flex: 1; min-width: 0; }
  .list { overflow: auto; display: grid; gap: 2px; align-content: start; }
  .grp { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-faint); margin: 8px 0 2px; border-bottom: 1px solid var(--line); }
  .track { display: flex; align-items: center; gap: 10px; text-align: left; padding: 6px 8px; border-radius: 6px; background: var(--bg-3); border: 1px solid transparent; color: var(--text); font-size: 12.5px; }
  .track:hover:not(:disabled) { background: var(--bg-4); border-color: var(--accent); }
  .track.on { border-color: var(--ok); }
  .go { color: var(--accent); width: 14px; text-align: center; }
  .track.on .go { color: var(--ok); }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
