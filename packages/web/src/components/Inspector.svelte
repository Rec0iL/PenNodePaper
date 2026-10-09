<script lang="ts">
  import { dieLabel, entryLine, parseEntryLines, rollLog, tableEntries, tableFaces, tableRanges, FLOW_TYPES, VISITABLE_TYPES, STATUS_CHOICES, visitsOf, groupsOf, sheetToText, type CampaignState, clockOf, isKnown, NODE_TYPES, NODE_STATUSES, NODE_TYPE_INFO, EDGE_KINDS, EDGE_KIND_INFO, type EdgeKind, type NodeType, type NodeStatus } from '@pnp/shared';
  import { app, cmd, focusNode, openCrossLink, say, sendChat } from '../lib/app.svelte';
  import Chat from './Chat.svelte';
  import SoundCues from './SoundCues.svelte';
  import ImagesPanel from './ImagesPanel.svelte';
  import MultiSelect from './MultiSelect.svelte';
  import CharacterSheet from './CharacterSheet.svelte';
  import FramePanel from './FramePanel.svelte';

  const node = $derived(app.selectedId ? app.nodes[app.selectedId] : undefined);
  const frameSel = $derived(app.selectedFrame ? app.graph.frames.find((f) => f.id === app.selectedFrame && f.canvas === app.canvasId) : undefined);
  const placement = $derived(node ? app.graph.placements[node.id] : undefined);
  const info = $derived(node ? NODE_TYPE_INFO[node.type] : undefined);
  const edges = $derived(node ? app.graph.edges.filter((e) => e.from === node.id || e.to === node.id) : []);
  const diffs = $derived(node ? app.diffs[node.id] ?? {} : {});

  // npc/enemy sheets are edited in the schema-driven sheet form; map ids / sheet internals never belong in the raw list
  const hasRoles = $derived(!!app.vtt?.profile?.characters?.roles?.length);
  // bookkeeping the app manages itself (where the players are, the sound list …): not for typing into
  const genericHidden = $derived(new Set(['role', 'preset', 'sheet', 'mapId', 'visits', 'sound', 'sounds', ...(node?.type === 'table' ? ['entries', 'last', 'history'] : []), ...(hasRoles && (node?.type === 'npc' || node?.type === 'enemy') ? Object.keys(node.fields) : [])]));

  const clock = $derived(node?.type === 'clock' ? clockOf(node) : null);
  const customFields = $derived(node ? Object.entries(node.fields).filter(([k]) => !genericHidden.has(k)) : []);
  const showSounds = $derived(!!node && !['pc', 'annotation', 'clock', 'table'].includes(node.type));
  const hasParty = $derived(Object.values(app.nodes).some((n) => n.type === 'pc' && !n.trashed && n.fields.present !== false));
  const playing = (status: 'active' | 'done' | 'skipped') => node && cmd('mark_played', { nodeId: node.id, status });
  const pcText = $derived.by(() => {
    if (!node || node.type !== 'pc') return '';
    const roles = app.vtt?.profile?.characters?.roles ?? [];
    const rid = typeof node.fields.role === 'string' ? node.fields.role : '';
    const role = roles.find((r) => r.id === rid) ?? roles.find((r) => r.for?.includes('pc') || r.id === 'pc'); // never a guess: an enemy form must not describe a player
    const sheet = (node.fields.sheet && typeof node.fields.sheet === 'object' ? node.fields.sheet : {}) as Record<string, unknown>;
    return role ? sheetToText(role, node.title, sheet) : Object.entries(sheet).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n');
  });
  const isHere = $derived(!!node && visitsOf(node).some((v) => v.here));
  const setStatus = (status: string) => node && cmd('set_status', { nodeId: node.id, status });

  const mapId = $derived(node && typeof node.fields.mapId === 'string' && node.fields.mapId ? node.fields.mapId : null);
  // painted renders of the map are listed among the node's images, but they are the map, not pictures of the place
  let mapRenders = $state<string[]>([]);
  $effect(() => {
    const id = mapId;
    void app.mapEvent;
    if (!id) { mapRenders = []; return; }
    fetch(`/api/maps/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && mapId === id) mapRenders = j.map.renders ?? []; }).catch(() => {});
  });
  const pictures = $derived(node ? node.images.filter((f) => !mapRenders.includes(f)) : []);
  const BACKDROP_TYPES = new Set(['location', 'scene', 'encounter', 'event', 'faction']);
  const hasText = $derived(!!node && !!(node.readAloud.trim() || node.summary.trim()));
  const showVtt = $derived(!!node && node.type !== 'pc' && node.type !== 'annotation' && node.type !== 'clock' && node.type !== 'table' && (pictures.length > 0 || hasText || !!mapId || node.type === 'npc' || node.type === 'enemy'));
  // random tables: edit the lines locally, commit on blur
  let tableText = $state('');
  let tableFor = '';
  let topic = $state('');
  const tEntries = $derived(node?.type === 'table' ? tableEntries(node) : []);
  $effect(() => {
    if (node?.type !== 'table') return;
    const server = tEntries.map(entryLine).join('\n');
    if (node.id !== tableFor || server !== tableText.split('\n').filter((l) => l.trim()).join('\n')) {
      if (node.id !== tableFor) topic = '';
      tableFor = node.id;
      tableText = server;
    }
  });
  const saveTable = () => node && cmd('set_table', { nodeId: node.id, entries: parseEntryLines(tableText).map(entryLine) });
  const roll = (times = 1) => node && cmd('roll_table', { nodeId: node.id, times });
  function fillWithAi() {
    if (!node) return;
    app.tab = 'chat';
    void sendChat(
      `Fill the random table “${node.title}” (node ${node.id}) with ${topic.trim() ? `entries for: ${topic.trim()}` : 'fitting entries for its title and summary'}. Use 12 entries (or 6/8/20 if that fits better), specific and evocative, in the campaign language; use the world books for local colour (search_world) and avoid duplicates of what is there already. Use "N× text" to make a likely entry more common. Call set_table with ${tEntries.length ? 'append:true if you are adding to the existing entries, otherwise replace them' : 'the entries'}; then say in one line what the table covers.`,
      { nodeId: node.id },
    );
  }
  let reveal = $state(false);
  let withPlayers = $state(false);
  let pushing = $state(false);
  const prof = $derived(app.vtt?.connected ? app.vtt.profile : null);
  async function push(name: string, args: Record<string, unknown>) {
    pushing = true;
    const r = await cmd<{ pushed: string }>(name, args);
    pushing = false;
    if (r) say(`Sent to ${prof?.name ?? 'the VTT'}`, 'ok');
  }

  const edge = $derived(app.selectedEdge ? app.graph.edges.find((e) => e.id === app.selectedEdge) : undefined);
  const relink = (edgeId: string, p: Record<string, unknown>) => cmd('relink', { edgeId, ...p });

  const patch = (p: Record<string, unknown>) => node && cmd('update_node', { id: node.id, ...p });
  const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

  function parseVal(s: string): unknown {
    const t = s.trim();
    if (t === '') return '';
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return s;
  }

  let newKey = $state('');
  function addField() {
    const k = newKey.trim();
    if (!k) return;
    void patch({ fields: { [k]: '' } });
    newKey = '';
  }

  const was = (field: string) => {
    const d = diffs[field];
    if (!d) return '';
    const s = str(d.from);
    return s.length > 160 ? s.slice(0, 160) + '…' : s;
  };
</script>

{#if app.multi.length > 1}
  <MultiSelect />
{:else if frameSel && !node && !edge}
  <FramePanel frame={frameSel} />
{:else if edge && !node}
  {@const ek = EDGE_KIND_INFO[edge.kind]}
  <div class="insp" style="--tc:{ek.color}">
    <div class="head">
      <span class="icon">⟶</span>
      <div class="id"><b>Connection</b><code>{edge.id.slice(0, 28)}</code></div>
      <div class="acts"><button class="btn danger" onclick={() => cmd('unlink', { edgeId: edge.id })} title="Remove this connection">🗑</button></div>
    </div>
    <div class="ends">
      <button class="oth" onclick={() => focusNode(edge.from)}>{app.nodes[edge.from]?.title ?? edge.from}</button>
      <button class="btn ghost" title="Reverse direction" onclick={() => relink(edge.id, { from: edge.to, to: edge.from })}>⇄</button>
      <button class="oth" onclick={() => focusNode(edge.to)}>{app.nodes[edge.to]?.title ?? edge.to}</button>
    </div>
    <div class="label">Label <span class="dim">(shown on the line — also: double-click it on the canvas)</span></div>
    <input class="field" value={edge.label} placeholder="e.g. if they want a drink" onchange={(e) => relink(edge.id, { label: e.currentTarget.value.trim() })} />
    <div class="label">Kind</div>
    <select class="field" value={edge.kind} onchange={(e) => relink(edge.id, { kind: e.currentTarget.value as EdgeKind })}>
      {#each EDGE_KINDS as k}<option value={k}>{EDGE_KIND_INFO[k].label}</option>{/each}
    </select>
    <p class="dim small">{ek.help}</p>
    <label class="chk"><input type="checkbox" checked={!edge.noTrail} onchange={(e) => relink(edge.id, { noTrail: !e.currentTarget.checked })} /> highlight it when the players take this path</label>
  </div>
{:else if node && info}
  <div class="insp" style="--tc:{info.color}">
    <div class="head">
      <span class="icon">{info.icon}</span>
      <div class="id"><b>{info.label}</b><code>{node.id}</code></div>
      <div class="acts">
        {#if placement}
          <button class="btn" onclick={() => focusNode(node.id)} title="Center on the canvas">⌖</button>
          <button class="btn" onclick={() => cmd('move_to_pool', { id: node.id })}>To pool</button>
        {:else}
          <button class="btn primary" onclick={() => cmd('place_on_canvas', { id: node.id, canvas: app.canvasId })}>Place on canvas</button>
        {/if}
        <button class="btn danger" onclick={() => cmd('delete_node', { id: node.id })} title="Move to trash (undoable)">🗑</button>
      </div>
    </div>

    <div class="row2">
      <div>
        <div class="label">Type</div>
        <select class="field" class:diff={diffs.type} value={node.type} onchange={(e) => patch({ type: e.currentTarget.value as NodeType })}>
          {#each NODE_TYPES as t}<option value={t}>{NODE_TYPE_INFO[t].icon} {NODE_TYPE_INFO[t].label}</option>{/each}
        </select>
      </div>
      <div>
        <div class="label">Status</div>
        <select class="field" class:diff={diffs.status} value={node.status} onchange={(e) => setStatus(e.currentTarget.value)}>
          {#each NODE_STATUSES as s}<option>{s}</option>{/each}
        </select>
      </div>
    </div>

    <div class="label">Title</div>
    <input class="field" class:diff={diffs.title} value={node.title} onchange={(e) => patch({ title: e.currentTarget.value })} />
    {#if diffs.title}<div class="was">{was('title')}</div>{/if}

    <div class="label">Summary <span class="dim">(card text)</span></div>
    <textarea class="field short" class:diff={diffs.summary} value={node.summary} onchange={(e) => patch({ summary: e.currentTarget.value })}></textarea>
    {#if diffs.summary}<div class="was">{was('summary')}</div>{/if}

    <div class="label">Tags</div>
    <input class="field" class:diff={diffs.tags} value={node.tags.join(', ')} placeholder="comma, separated"
      onchange={(e) => patch({ tags: e.currentTarget.value.split(',').map((s) => s.trim()).filter(Boolean) })} />

    {#if !placement || node.poolHint}
      <div class="label">When might this happen? <span class="dim">(pool hint)</span></div>
      <input class="field" class:diff={diffs.poolHint} value={node.poolHint} onchange={(e) => patch({ poolHint: e.currentTarget.value })} />
    {/if}

    {#if node.type === 'table'}
      <div class="label">Random table <span class="dim">· {tEntries.length ? `${dieLabel(tableFaces(tEntries))}, ${tEntries.length} entries` : 'empty'}</span></div>
      <div class="tablebox">
        <div class="trow">
          <button class="btn primary" disabled={!tEntries.length} onclick={() => roll(1)}>🎲 Roll</button>
          <button class="btn" disabled={!tEntries.length} onclick={() => roll(3)} title="Roll three times (with replacement)">×3</button>
          {#if typeof node.fields.last === 'string' && node.fields.last}<span class="lastroll">{node.fields.last}</span>{/if}
        </div>
        <textarea class="field tall mono" bind:value={tableText} onblur={saveTable} placeholder={'One entry per line.\n3× Fog  = three times as likely'}></textarea>
        {#if tEntries.length}
          <div class="ranges">{#each tableRanges(tEntries) as r}<span><b>{r.from === r.to ? r.from : `${r.from}–${r.to}`}</b> {r.text}</span>{/each}</div>
        {/if}
        <div class="trow">
          <input class="field" placeholder="Topic for the AI (e.g. rumours at the harbour tavern)" bind:value={topic} onkeydown={(e) => e.key === 'Enter' && fillWithAi()} />
          <button class="btn" disabled={app.chatStatus.busy} onclick={fillWithAi} title="The AI writes entries from your world books">✦ Fill with AI</button>
        </div>
        {#if rollLog(node).length > 1}
          <details class="hist"><summary>Earlier rolls</summary>{#each rollLog(node).slice(1) as h}<div>{h.text} <span class="dim">· {h.roll}</span></div>{/each}</details>
        {/if}
      </div>
    {/if}

    {#if node.type === 'location' || mapId}
      <div class="mapbox">
        {#if mapId}
          <button class="btn primary" onclick={() => (app.mapEditor = { mapId })}>⌗ Open the map of this place</button>
          <span class="dim">or double-click the card</span>
        {:else}
          <div class="dim">This place has no map yet — the pictures below are enough for a place you only describe.</div>
          <div class="mrow">
            <button class="btn" onclick={() => cmd('create_map', { name: node.title, nodeId: node.id, kind: 'battle', cols: 24, rows: 18 })}>＋ Battle map</button>
            <button class="btn" onclick={() => cmd('create_map', { name: node.title, nodeId: node.id, kind: 'region' })}>＋ Region map</button>
          </div>
        {/if}
      </div>
    {/if}

    {#if VISITABLE_TYPES.has(node.type) || node.type === 'lore' || node.type === 'item' || node.type === 'clock'}
      <div class="label">At the table</div>
      <div class="table">
        {#if VISITABLE_TYPES.has(node.type)}
          <div class="trow">
            {#if hasParty}
              <button class="btn primary" onclick={(e) => { const r = e.currentTarget.getBoundingClientRect(); app.nodeMenu = { nodeId: node.id, x: r.left, y: r.bottom + 4 }; }} title="Choose which players go here — the party can split up">▶ Move players here…</button>
            {:else}
              <button class="btn" class:primary={!isHere} onclick={() => playing('active')} title={placement ? 'The players are at this node now' : 'The players visit this prepared node: it joins the story map, linked from where they were'}>▶ Players are here{placement ? '' : ' (adds to story)'}</button>
            {/if}
          </div>
          <div class="seg" role="group" aria-label="Status">
            {#each STATUS_CHOICES as c}
              <button class="segb" class:on={node.status === c.id} title={c.help} onclick={() => setStatus(c.id)}>{c.icon} {c.label}</button>
            {/each}
          </div>
        {/if}
        {#if node.type === 'clue' || node.type === 'lore' || node.type === 'npc' || node.type === 'location' || node.type === 'item' || node.type === 'faction'}
          <label class="chk"><input type="checkbox" checked={isKnown(node)} onchange={(e) => cmd('set_known', { nodeId: node.id, known: e.currentTarget.checked })} /> the players know this</label>
        {/if}
        {#if clock}
          <div class="trow">
            <button class="btn ghost" disabled={clock.filled <= 0} onclick={() => cmd('advance_clock', { nodeId: node.id, by: -1 })}>−</button>
            <b>{clock.filled} / {clock.segments}</b>{#if clock.full}<span class="due">due</span>{/if}
            <button class="btn" disabled={clock.full} onclick={() => cmd('advance_clock', { nodeId: node.id, by: 1 })}>＋ advance</button>
          </div>
          <div class="r2">
            <div><div class="label tight2">Segments</div><input class="field" type="number" min="2" max="24" value={clock.segments} onchange={(e) => patch({ fields: { segments: Number(e.currentTarget.value) || 6 } })} /></div>
          </div>
          <div class="label tight2">When it fills…</div>
          <textarea class="field" rows="2" value={clock.consequence} placeholder="What happens when the clock is full?" onchange={(e) => patch({ fields: { consequence: e.currentTarget.value } })}></textarea>
        {/if}
      </div>
    {/if}

    <div class="label">Notes <span class="dim">(markdown, GM only)</span></div>
    <textarea class="field tall mono" class:diff={diffs.body} value={node.body} onchange={(e) => patch({ body: e.currentTarget.value })}></textarea>
    {#if diffs.body}<div class="was">{was('body')}</div>{/if}

    <div class="label">Read aloud</div>
    <textarea class="field read" class:diff={diffs.readAloud} value={node.readAloud} placeholder="Text for the players…" onchange={(e) => patch({ readAloud: e.currentTarget.value })}></textarea>
    {#if diffs.readAloud}<div class="was">{was('readAloud')}</div>{/if}

    {#if node.type === 'npc' || node.type === 'enemy'}
      <CharacterSheet {node} />
    {:else if node.type === 'pc'}
      <div class="label">Player character</div>
      <div class="pcbox">
        <div class="dim small">
          Managed by the VTT{node.fields.playerName ? ` · player: ${node.fields.playerName}` : ''}{node.fields.present === false ? ' · no longer in the session' : ''}{typeof node.fields.syncedAt === 'string' ? ` · synced ${new Date(node.fields.syncedAt).toLocaleString()}` : ''}. Change the sheet there and sync; your notes and the group are yours.
        </div>
        {#if pcText}<pre class="sheettext">{pcText}</pre>{:else}<div class="dim small">No sheet details yet.</div>{/if}
        <div class="label tight2">Part of the party</div>
        <input class="field" list="pc-groups" value={typeof node.fields.group === 'string' ? node.fields.group : ''} placeholder="party (together with everyone)" onchange={(e) => cmd('set_party_group', { nodeIds: [node.id], group: e.currentTarget.value })} />
        <datalist id="pc-groups">{#each groupsOf({ meta: app.meta, nodes: app.nodes, graph: app.graph } as unknown as CampaignState) as g}<option value={g}></option>{/each}</datalist>
      </div>
    {/if}

    {#if showSounds}<SoundCues {node} />{/if}

    {#if showVtt}
      <div class="label">Show to the players</div>
      <div class="vttbox">
        <div class="vstat" class:on={!!prof}><i></i>{prof ? `${prof.name} connected` : 'no VTT connected'}</div>
        <label class="chk"><input type="checkbox" bind:checked={reveal} /> show it to the players right away</label>
        {#if pictures.length}
          <div class="pics">
            {#each pictures as f (f)}
              <div class="pic">
                <img src={`/api/images/${f}?w=160`} alt="" loading="lazy" decoding="async" />
                <div class="pbtns">
                  <button class="btn" disabled={!prof || pushing || !prof.push.handout} onclick={() => push('push_handout', { nodeId: node.id, image: f, reveal })} title="A handout the players can look at">✉ Handout</button>
                  {#if BACKDROP_TYPES.has(node.type)}
                    <button class="btn" disabled={!prof || pushing || !prof.push.scene} onclick={() => push('push_scene', { nodeId: node.id, imageFile: f, activate: reveal })} title="On the map screen as a backdrop — no grid, no tokens">▭ Map screen</button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {:else if hasText}
          <button class="btn" disabled={!prof || pushing || !prof.push.handout} onclick={() => push('push_handout', { nodeId: node.id, reveal })}>✉ Text handout</button>
          <span class="dim small">Sends the read-aloud text (else the summary). GM notes are never sent.</span>
        {/if}
        {#if mapId}
          <label class="chk"><input type="checkbox" bind:checked={withPlayers} /> include player start markers {prof?.push.scene?.playerStarts ? '(this VTT wants them)' : '(testing — players are added in the VTT)'}</label>
          <button class="btn primary" disabled={!prof || pushing || !prof.push.scene} onclick={() => push('push_scene', { nodeId: node.id, activate: reveal, includePlayers: withPlayers || undefined })}>⌗ Map screen: the battle map (grid + tokens)</button>
        {/if}
        {#if node.type === 'npc' || node.type === 'enemy'}
          <button class="btn" disabled={!prof || pushing || !prof.push.character} onclick={() => push('push_character', { nodeId: node.id })}>Push {node.type === 'enemy' ? 'enemy' : 'NPC'} to the VTT (sheet)</button>
          <span class="dim small">The sheet is checked against {prof?.name ?? 'the VTT'}'s structure first; the cover image becomes the portrait.</span>
        {/if}
        {#if !prof}<span class="dim small">No live link? <button class="lnk" onclick={() => (app.settingsOpen = true)}>Export a file instead</button></span>{/if}
      </div>
    {/if}

    <div class="label">Images</div>
    <ImagesPanel {node} {mapRenders} />

    <details class="adv" open={customFields.length > 0 && !!diffs.fields}>
      <summary class="label">Advanced · custom fields <span class="chip">{customFields.length}</span></summary>
      <div class="dim small">Free notes for special cases, as name and value. Most nodes need none.</div>
    <div class="kv" class:diff={diffs.fields}>
      {#each customFields as [k, v] (k)}
        <div class="kvrow">
          <code>{k}</code>
          <input class="field" value={str(v)} onchange={(e) => patch({ fields: { [k]: parseVal(e.currentTarget.value) } })} />
          <button class="btn ghost" title="Remove" onclick={() => patch({ fields: { [k]: null } })}>×</button>
        </div>
      {/each}
      <div class="kvrow add">
        <input class="field" placeholder="new field…" bind:value={newKey} onkeydown={(e) => e.key === 'Enter' && addField()} />
        <button class="btn" onclick={addField}>Add</button>
      </div>
    </div>
    </details>

    <div class="label">Ask the AI about this node</div>
    {#key node.id}<Chat nodeId={node.id} />{/key}

    <div class="label">Connections <span class="chip">{edges.length}</span></div>
    <div class="edges">
      {#each edges as e (e.id)}
        {@const other = app.nodes[e.from === node.id ? e.to : e.from]}
        {@const k = EDGE_KIND_INFO[e.kind]}
        <div class="edge" style="--c:{k.color}">
          <span class="dir">{e.from === node.id ? '→' : '←'}</span>
          <span class="kind">{k.label}</span>
          <button class="oth" onclick={() => other && focusNode(other.id)}>{other?.title ?? e.to}{#if other && app.graph.placements[other.id] && node && app.graph.placements[node.id] && app.graph.placements[other.id].canvas !== app.graph.placements[node.id].canvas}<span class="dim small"> · {app.graph.canvases.find((c) => c.id === app.graph.placements[other.id].canvas)?.name}</span>{/if}</button>
          <input class="elabel" value={e.label} placeholder="label…" title="Edit the label on this connection" onchange={(ev) => relink(e.id, { label: ev.currentTarget.value.trim() })} />
          <button class="btn ghost" title="Remove link" onclick={() => cmd('unlink', { edgeId: e.id })}>×</button>
        </div>
      {:else}
        <div class="dim small">No connections. Drag from a node's handle to another node.</div>
      {/each}
      {#if app.graph.placements[node.id] && app.graph.canvases.length > 1}
        <button class="btn ghost" onclick={() => openCrossLink(node.id)} title="Connect to a node on another canvas — or drag a connection onto that canvas' tab">↠ Connect to another canvas…</button>
      {/if}
    </div>
  </div>
{:else}
  <div class="none">
    <div class="big">◇</div>
    <p>Select a node to edit it.</p>
    <p class="dim small">Drag from the pool to the canvas, draw edges between handles, or ask the AI in the chat.</p>
  </div>
{/if}

<style>
  .insp { padding: 12px 14px 40px; }
  .head { display: flex; align-items: center; gap: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
  .icon { font-size: 20px; color: var(--tc); text-shadow: 0 0 14px var(--tc); }
  .id { display: grid; line-height: 1.2; }
  .id b { color: var(--tc); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
  .id code { font-family: var(--mono); font-size: 10.5px; color: var(--text-faint); }
  .acts { margin-left: auto; display: flex; gap: 5px; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .dim { color: var(--text-faint); text-transform: none; letter-spacing: 0; }
  .small { font-size: 11.5px; }
  .short { min-height: 56px; }
  .tall { min-height: 170px; }
  .table { display: grid; gap: 8px; padding: 10px; background: var(--bg-3); border: 1px solid var(--line-2); border-left: 2px solid var(--tc); border-radius: 8px; }
  .trow { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .due { color: var(--danger); font-size: 11.5px; font-weight: 600; }
  .label.tight2 { margin: 4px 0 2px; }
  .pics { display: grid; gap: 6px; }
  .pic { display: flex; gap: 8px; align-items: center; }
  .pic img { width: 64px; height: 48px; object-fit: cover; border-radius: 6px; border: 1px solid var(--line-2); flex: none; }
  .pbtns { display: flex; flex-wrap: wrap; gap: 4px; }
  .pbtns .btn { padding: 3px 8px; font-size: 11.5px; }
  .vttbox { display: grid; gap: 6px; padding: 10px; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 8px; }
  .vstat { font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
  .vstat i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-faint); }
  .vstat.on i { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .chk { display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--text-dim); }
  .lnk { background: none; border: 0; color: var(--accent); padding: 0; text-decoration: underline; }
  .mapbox { margin-top: 12px; padding: 10px; background: var(--bg-3); border: 1px solid var(--line-2); border-left: 2px solid var(--tc); border-radius: 8px; display: grid; gap: 6px; }
  .mrow { display: flex; gap: 6px; }
  .read { min-height: 80px; font-style: italic; }
  .mono { font-family: var(--mono); font-size: 12px; }
  .diff { animation: pnp-diffglow 7s ease-out; border-color: var(--accent); }
  .was { margin-top: 4px; font-size: 11.5px; color: var(--danger); text-decoration: line-through; opacity: 0.8; animation: pnp-pop 0.3s ease-out; }
  .kv { display: grid; gap: 5px; }
  .kvrow { display: grid; grid-template-columns: 88px 1fr auto; gap: 6px; align-items: center; }
  .kvrow.add { grid-template-columns: 1fr auto; }
  .kvrow code { font-family: var(--mono); font-size: 11px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; }
  .pcbox { display: grid; gap: 6px; }
  .sheettext { margin: 0; padding: 8px 10px; background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-s); font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; max-height: 260px; overflow: auto; color: var(--text-dim); font-family: inherit; }
  .tablebox { display: grid; gap: 8px; }
  .tablebox .trow { display: flex; gap: 8px; align-items: center; }
  .tablebox .trow .field { flex: 1; min-width: 0; }
  .lastroll { color: var(--accent); font-style: italic; font-size: 13px; }
  .ranges { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11.5px; color: var(--text-dim); }
  .ranges b { color: var(--text-faint); font-weight: 500; }
  .hist { font-size: 12px; color: var(--text-dim); }
  .hist summary { cursor: pointer; color: var(--text-faint); font-size: 11.5px; }
  .seg { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; padding: 2px; background: var(--bg-3); border-radius: var(--radius-s); }
  .segb { background: transparent; border: 0; border-radius: 6px; padding: 5px 2px; font-size: 11px; color: var(--text-dim); white-space: nowrap; }
  .segb:hover { color: var(--text); }
  .segb.on { background: var(--bg-4); color: var(--text); box-shadow: inset 0 0 0 1px var(--line-2); }
  .edges { display: grid; gap: 4px; }
  details.adv > summary { cursor: pointer; list-style: none; }
  details.adv > summary::-webkit-details-marker { display: none; }
  details.adv > summary::before { content: '▸ '; color: var(--text-faint); }
  details.adv[open] > summary::before { content: '▾ '; }
  .edge { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 6px; background: var(--bg-3); border-left: 2px solid var(--c); }
  .edge .kind { color: var(--c); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; }
  .edge .oth { flex: 1; text-align: left; background: transparent; border: 0; color: var(--text); padding: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .edge .oth:hover { color: var(--accent); }
  .elabel { width: 38%; background: var(--bg); border: 1px solid var(--line-2); border-radius: 6px; padding: 1px 6px; font-size: 11.5px; outline: none; color: var(--text); }
  .elabel:focus { border-color: var(--c); }
  .ends { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
  .ends .oth { flex: 1; text-align: center; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: 8px; padding: 6px 8px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ends .oth:hover { border-color: var(--accent); }
  .edge .dir { color: var(--text-faint); }
  .none { padding: 60px 24px; text-align: center; color: var(--text-dim); }
  .big { font-size: 40px; color: var(--line-2); margin-bottom: 8px; }
</style>
