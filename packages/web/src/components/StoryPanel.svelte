<script lang="ts">
  // The GM's session view: where are the players, what is wrong with the plan, how do we get back on track.
  // All analysis is the shared pure code the AI's tools use too (lint_story / story_status).
  import { DEFAULT_GROUP, NODE_TYPE_INFO, groupColor, lintStory, playerWiki, storyStatus, wikiCount, wikiMarkdown, type CampaignState } from '@pnp/shared';
  import { app, cmd, focusNode, say, sendChat } from '../lib/app.svelte';

  const campaign = $derived({ meta: app.meta, nodes: app.nodes, graph: app.graph } as unknown as CampaignState);
  const st = $derived(storyStatus(campaign));
  const issues = $derived(lintStory(campaign));
  const warns = $derived(issues.filter((i) => i.level === 'warn'));
  const infos = $derived(issues.filter((i) => i.level === 'info'));
  let showInfos = $state(false);
  const title = (id: string) => app.nodes[id]?.title ?? id;
  const color = (id: string) => NODE_TYPE_INFO[app.nodes[id]?.type ?? 'scene']?.color ?? '#888';

  // one lane per part of the party (a single lane when nobody split up)
  const lanes = $derived(st.groups.filter((g) => g.path.length || g.members.length));
  const split = $derived(lanes.length > 1);
  const everyone = $derived(Object.values(app.nodes).filter((n) => n.type === 'pc' && !n.trashed && n.fields.present !== false).map((n) => n.id));
  const laneName = (g: string) => (g === DEFAULT_GROUP ? (split ? 'Rest of the party' : 'Party') : g);
  const gather = (nodeId: string) => cmd('move_players', { characters: everyone, nodeId });

  // what the players know (the same pure code the AI's player_wiki uses)
  const wiki = $derived(playerWiki(campaign));
  const wikiN = $derived(wikiCount(wiki));
  let showWiki = $state(false);
  let sending = $state(false);
  const canSend = $derived(!!app.vtt?.connected && !!app.vtt.profile?.push.handout);
  async function exportWiki() {
    const r = await cmd<{ url: string; file: string }>('export_player_wiki', {});
    if (r) { window.open(r.url, '_blank'); say(`Saved ${r.file} in the exports folder`, 'ok'); }
  }
  async function sendWiki() {
    sending = true;
    const r = await cmd('push_player_wiki', {});
    sending = false;
    if (r) say(`Recap added to ${app.vtt?.profile?.name ?? 'the VTT'}'s handouts`, 'ok');
  }
  function recap() {
    app.tab = 'chat';
    void sendChat('Write a short, vivid recap of the story so far for my players, in the campaign language, as if told by a narrator (about 120-200 words). Call player_wiki first and write ONLY from what it contains — nothing the players have not experienced, no GM secrets, no hints about what comes next. Then create it as a handout node (type handout, title "Previously…", the text as readAloud, place:"pool") so I can push it from the Inspector.');
  }

  const lost = $derived(st.skippedPast.length + st.untaken.length + st.unrevealed.filter((u) => u.opens.length).length);

  function bridge() {
    app.tab = 'chat';
    void sendChat(
      'The players went off-script. Call story_status, then help me get back on track: (1) tell me in 3-4 lines what they have effectively bypassed or not learned and what that costs the story; (2) propose the best 1-2 places to merge back (prefer frontier nodes marked converges:true) and ONE short bridge for each — create it as a node with create_node (place on the canvas next to where the players are) and link it with a "bridge" edge; (3) if an important clue was missed, add a second, different way for the players to learn it; (4) do not delete anything and do not change what already happened. Keep the new nodes brief.',
    );
  }

  function returnSkipped() {
    const ops = st.skippedPast.filter((s) => app.graph.placements[s.id] && !app.nodes[s.id].fields.playedSeq).map((s) => ({ command: 'move_to_pool', args: { id: s.id } }));
    if (ops.length) void cmd('batch', { ops, label: `Returned ${ops.length} bypassed node(s) to the pool` });
  }
</script>

<div class="story">
  <section>
    <div class="label">Where are we</div>
    {#if st.played.length}
      {#each lanes as lane (lane.group)}
        <div class="lane" style="--g:{groupColor(lane.group)}">
          {#if split || lane.members.length}
            <div class="lh"><i></i><b>{laneName(lane.group)}</b>{#if lane.members.length}<span class="dim">{lane.members.join(', ')}</span>{/if}</div>
          {/if}
          <div class="path">
            {#each lane.path as p, i (p.id)}
              {#if i}<span class="arr">›</span>{/if}
              <button class="step" class:here={lane.here.some((h) => h.id === p.id)} style="--c:{color(p.id)}" onclick={() => focusNode(p.id)} title={`#${p.seq} · ${p.status}`}>{p.title}</button>
            {:else}
              <span class="dim">hasn't played anything yet</span>
            {/each}
          </div>
        </div>
      {/each}
      {#if split && st.meetingPoints.length}
        <div class="sub">Where they can meet again</div>
        {#each st.meetingPoints as m (m.id)}
          <div class="row">
            <button class="mp" onclick={() => focusNode(m.id)}><i style="background:{color(m.id)}"></i><span class="t">{m.title}</span></button>
            {#if everyone.length}<button class="lnk" onclick={() => gather(m.id)} title="Move all players here">everyone here</button>{/if}
          </div>
        {/each}
      {/if}
    {:else}
      <p class="dim">Nothing played yet. Select a node and press <b>▶ Players are here</b> in the Inspector (or tell the AI what happened — it records it with <code>mark_played</code>). A pool node the players visit joins the story map automatically.</p>
    {/if}
  </section>

  {#if st.played.length}
    <section>
      <div class="label">Getting back on track {#if lost}<span class="chip warn">{lost}</span>{/if}</div>
      {#if st.frontier.length}
        <div class="sub">Where the story can pick up next</div>
        {#each st.frontier.slice(0, 5) as f (f.id)}
          <button class="row" onclick={() => focusNode(f.id)}>
            <i style="background:{color(f.id)}"></i><span class="t">{f.title}</span>
            {#if f.converges}<span class="chip good" title="Several planned paths meet here — a natural place to merge back">paths meet</span>{/if}
            <span class="dim">{f.hops} step{f.hops > 1 ? 's' : ''}</span>
          </button>
        {/each}
      {/if}
      {#if st.skippedPast.length}
        <div class="sub">Bypassed <button class="lnk" onclick={returnSkipped} title="Put bypassed, unplayed nodes back into the pool so they can still be used">return to pool</button></div>
        {#each st.skippedPast as s (s.id)}
          <button class="row" onclick={() => focusNode(s.id)}><i style="background:{color(s.id)}"></i><span class="t">{s.title}</span><span class="dim">{s.explicit ? 'skipped' : 'bypassed'}</span></button>
        {/each}
      {/if}
      {#if st.untaken.length}
        <div class="sub">Roads not taken</div>
        {#each st.untaken as u (u.from + u.to)}
          <button class="row" onclick={() => focusNode(u.to)}><span class="t">{u.fromTitle} → <b>{u.toTitle}</b></span>{#if u.label}<span class="dim">{u.label}</span>{/if}</button>
        {/each}
      {/if}
      {#if st.unrevealed.length}
        <div class="sub">Players don't know yet</div>
        {#each st.unrevealed as u (u.id)}
          <button class="row" onclick={() => focusNode(u.id)}>
            <i style="background:{color(u.id)}"></i><span class="t">{u.title}</span>{#if u.opens.length}<span class="dim">opens: {u.opens.join(', ')}</span>{/if}
          </button>
        {/each}
      {/if}
      <button class="btn primary bridge" onclick={bridge} disabled={app.chatStatus.busy}>✦ Bridge back with the AI</button>
    </section>
  {/if}

  <section>
    <div class="label">Problems {#if warns.length}<span class="chip warn">{warns.length}</span>{/if}{#if infos.length}<span class="chip">{infos.length} notes</span>{/if}</div>
    {#each warns as i, k (i.code + (i.nodeId ?? '') + k)}
      <button class="issue warn" onclick={() => i.nodeId && focusNode(i.nodeId)}>⚠ {i.message}</button>
    {:else}
      <p class="ok">✓ No structural problems found.</p>
    {/each}
    {#if infos.length}
      <button class="lnk" onclick={() => (showInfos = !showInfos)}>{showInfos ? 'hide' : 'show'} {infos.length} smaller notes</button>
      {#if showInfos}
        {#each infos as i, k (i.code + (i.nodeId ?? '') + k)}<button class="issue" onclick={() => i.nodeId && focusNode(i.nodeId)}>• {i.message}</button>{/each}
      {/if}
    {/if}
  </section>

  <section>
    <div class="label">For the players {#if wikiN}<span class="chip">{wikiN}</span>{/if}</div>
    <p class="dim">What they have experienced and learned. Only the <b>read-aloud</b> text is shown — summaries and notes stay yours, so write a read-aloud for what you want described.{wikiN ? '' : ' Nothing yet.'}</p>
    <div class="wrow">
      <button class="btn" onclick={() => (showWiki = !showWiki)} disabled={!wikiN}>{showWiki ? 'Hide' : 'Preview'}</button>
      <button class="btn" onclick={exportWiki} disabled={!wikiN} title="Save as a markdown file to hand out">⬇ Export .md</button>
      <button class="btn" onclick={sendWiki} disabled={!wikiN || !canSend || sending} title={canSend ? 'Add it to the VTT as a text handout' : 'Needs a connected VTT that takes handouts'}>✉ To VTT</button>
      <button class="btn primary" onclick={recap} disabled={!wikiN || app.chatStatus.busy} title="The AI writes a narrator-style recap from this, spoiler-safe">✦ Recap with AI</button>
    </div>
    {#if showWiki}<pre class="wikipre">{wikiMarkdown(wiki)}</pre>{/if}
  </section>

  {#if st.clocks.length}
    <section>
      <div class="label">Clocks</div>
      {#each st.clocks as c (c.id)}
        <div class="clock" class:full={c.full}>
          <button class="ring" onclick={() => focusNode(c.id)} title={c.consequence || 'no consequence written'}>
            <svg viewBox="-12 -12 24 24" width="30" height="30">
              {#each Array(c.segments) as _, i}
                {@const a0 = (i / c.segments) * Math.PI * 2 - Math.PI / 2}
                {@const a1 = ((i + 1) / c.segments) * Math.PI * 2 - Math.PI / 2 - 0.08}
                <path d={`M ${9 * Math.cos(a0)} ${9 * Math.sin(a0)} A 9 9 0 0 1 ${9 * Math.cos(a1)} ${9 * Math.sin(a1)}`} fill="none" stroke-width="4" stroke={i < c.filled ? (c.full ? 'var(--danger)' : '#ff9966') : 'var(--line-2)'} />
              {/each}
            </svg>
          </button>
          <div class="ct"><b>{c.title}</b><span class="dim">{c.filled}/{c.segments}{c.full ? ' — FULL' : ''}</span>{#if c.consequence}<span class="dim">→ {c.consequence}</span>{/if}</div>
          <button class="btn ghost" disabled={c.filled <= 0} onclick={() => cmd('advance_clock', { nodeId: c.id, by: -1 })} aria-label="Back one segment">−</button>
          <button class="btn" disabled={c.full} onclick={() => cmd('advance_clock', { nodeId: c.id, by: 1 })} aria-label="Advance one segment">＋</button>
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .story { padding: 10px 14px 40px; display: grid; gap: 14px; }
  .label { display: flex; gap: 6px; align-items: center; }
  .sub { font-size: 11px; color: var(--text-faint); margin: 8px 0 3px; display: flex; gap: 8px; align-items: baseline; }
  .dim { color: var(--text-faint); font-size: 11.5px; }
  p.dim { line-height: 1.5; margin: 4px 0; }
  code { font-family: var(--mono); font-size: 11px; background: var(--bg); padding: 0 4px; border-radius: 4px; }
  .lane { border-left: 3px solid var(--g); padding-left: 8px; margin-bottom: 8px; }
  .lh { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; font-size: 12px; }
  .lh i { width: 8px; height: 8px; border-radius: 50%; background: var(--g); align-self: center; }
  .mp { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; background: transparent; border: 0; color: inherit; padding: 0; text-align: left; }
  .mp i { width: 4px; height: 14px; border-radius: 2px; flex: none; }
  .path { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .arr { color: var(--text-faint); }
  .step { background: var(--bg-3); border: 1px solid var(--line-2); border-left: 3px solid var(--c); color: var(--text); padding: 2px 9px; border-radius: 8px; font-size: 12px; }
  .step:hover { border-color: var(--accent); }
  .step.here { background: color-mix(in srgb, var(--c) 18%, var(--bg-3)); box-shadow: 0 0 12px -2px var(--c); font-weight: 600; }
  .step.here::before { content: '▶ '; color: var(--c); }
  .row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: transparent; border: 0; padding: 4px 6px; border-radius: 6px; color: var(--text-dim); }
  .row:hover { background: var(--bg-3); color: var(--text); }
  .row i { width: 4px; height: 14px; border-radius: 2px; flex: none; }
  .row .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip.warn { background: #3a2a10; color: #ffcf70; border-color: #6a4a18; }
  .chip.good { background: #12301f; color: var(--ok); border-color: #2c5a3e; }
.wrow { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .wikipre { margin: 8px 0 0; padding: 10px 12px; background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-s); font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; max-height: 300px; overflow: auto; color: var(--text-dim); font-family: inherit; }
  .lnk { background: none; border: 0; color: var(--accent); padding: 0; font-size: 11.5px; text-decoration: underline; text-align: left; }
  .bridge { margin-top: 10px; width: 100%; }
  .issue { display: block; width: 100%; text-align: left; background: transparent; border: 0; padding: 4px 6px; border-radius: 6px; color: var(--text-dim); font-size: 12px; line-height: 1.4; }
  .issue.warn { color: #ffcf70; }
  .issue:hover { background: var(--bg-3); }
  .ok { color: var(--ok); font-size: 12px; margin: 4px 0; }
  .clock { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .clock.full .ct b { color: var(--danger); }
  .ring { background: transparent; border: 0; padding: 0; }
  .ct { flex: 1; display: grid; font-size: 12.5px; }
</style>
