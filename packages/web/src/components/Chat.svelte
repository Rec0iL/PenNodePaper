<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Backend, ChatMsg } from '@pnp/shared';
  import { NODE_TYPE_INFO } from '@pnp/shared';
  import { app, cancelChat, chatMeta, clearChat, focusNode, remember, selectNode, sendChat } from '../lib/app.svelte';

  /** When set, this is a per-node thread (compact, filtered to that node). */
  let { nodeId }: { nodeId?: string } = $props();

  let text = $state('');
  let pins = $state<string[]>([]);
  let useSelected = $state(true);
  let list: HTMLDivElement;
  let models = $state<{ claude: { id: string; label: string }[]; agy: { id: string; label: string }[] } | null>(null);
  let agy = $state<{ installed: boolean; registered: boolean; permitted: boolean } | null>(null);
  let setupMsg = $state('');
  let mention = $state<{ q: string; at: number } | null>(null);

  onMount(async () => {
    const m = await chatMeta();
    models = m.models;
    agy = m.agy;
  });
  async function checkAgy() {
    agy = (await chatMeta(true)).agy;
  }
  async function setupAgy() {
    setupMsg = 'registering…';
    const r = await (await fetch('/api/agy/setup', { method: 'POST' })).json();
    agy = { installed: r.installed, registered: r.registered, permitted: r.permitted };
    setupMsg = r.ok ? '' : r.output || 'setup failed';
  }

  // --- what's shown --------------------------------------------------------------
  type Row = { kind: 'msg'; m: ChatMsg } | { kind: 'thread'; nodeId: string; count: number; last: string };
  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    for (const m of app.chat) {
      if (nodeId) {
        if (m.nodeId === nodeId) out.push({ kind: 'msg', m });
      } else if (m.nodeId) {
        const prev = out[out.length - 1];
        if (prev?.kind === 'thread' && prev.nodeId === m.nodeId) {
          prev.count++;
          if (m.role !== 'tool') prev.last = m.text || prev.last;
        } else out.push({ kind: 'thread', nodeId: m.nodeId, count: 1, last: m.role !== 'tool' ? m.text : '' });
      } else out.push({ kind: 'msg', m });
    }
    return out;
  });

  $effect(() => {
    rows.length;
    app.chat.at(-1)?.text;
    void tick().then(() => list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' }));
  });

  const busy = $derived(app.chatStatus.busy);
  const selected = $derived(app.selectedId && app.nodes[app.selectedId] && !app.nodes[app.selectedId].trashed ? app.nodes[app.selectedId] : null);
  const chipIds = $derived([...new Set([...(useSelected && selected && !nodeId ? [selected.id] : []), ...pins])]);

  // --- composer ------------------------------------------------------------------
  const candidates = $derived(
    mention
      ? Object.values(app.nodes).filter((n) => !n.trashed && n.title.toLowerCase().includes(mention!.q.toLowerCase())).slice(0, 6)
      : [],
  );

  function oninput(e: Event & { currentTarget: HTMLTextAreaElement }) {
    const el = e.currentTarget;
    const before = el.value.slice(0, el.selectionStart);
    const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(before);
    mention = m ? { q: m[1], at: before.length - m[1].length - 1 } : null;
  }
  function pick(id: string) {
    const n = app.nodes[id];
    if (!mention || !n) return;
    text = `${text.slice(0, mention.at)}@${n.title} ${text.slice(mention.at + 1 + mention.q.length)}`;
    if (!pins.includes(id)) pins = [...pins, id];
    mention = null;
  }

  async function submit() {
    const t = text.trim();
    if (!t || busy) return;
    const ids = chipIds.filter((id) => t.includes(`@${app.nodes[id]?.title}`) || id === selected?.id || id === nodeId);
    const ok = await sendChat(t, { nodeId, pins: ids });
    if (ok) {
      text = '';
      pins = [];
    }
  }
  function onkey(e: KeyboardEvent) {
    if (mention && candidates.length && (e.key === 'Tab' || e.key === 'Enter')) {
      e.preventDefault();
      pick(candidates[0].id);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape') mention = null;
  }

  function fmt(s: string) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
</script>

<div class="chat" class:compact={!!nodeId}>
  {#if !nodeId}
    <div class="bar">
      <div class="seg">
        {#each ['claude', 'agy'] as b}
          <button class:on={app.backend === b} style="--c:var(--{b})" onclick={() => { app.backend = b as Backend; remember('pnp.backend', b); }}>{b === 'claude' ? 'Claude' : 'agy'}</button>
        {/each}
      </div>
      <select
        class="field model"
        value={app.models[app.backend]}
        onchange={(e) => { app.models[app.backend] = e.currentTarget.value; remember(`pnp.model.${app.backend}`, e.currentTarget.value); }}
        title="Model"
      >
        {#each models?.[app.backend] ?? [{ id: '', label: 'default' }] as m}<option value={m.id}>{m.label}</option>{/each}
      </select>
      <button class="btn ghost" title="Start a fresh conversation" disabled={busy} onclick={() => confirm('Clear the chat and start a new AI session?') && clearChat()}>↺</button>
    </div>
  {/if}

  {#if app.backend === 'agy' && agy && agy.installed && (!agy.registered || !agy.permitted)}
    <div class="setup">
      <b>{agy.registered ? 'agy is registered but not allowed to use the tools.' : "agy isn't connected to this app yet."}</b>
      <p>This changes agy's own global config in <code>~/.gemini/antigravity-cli</code>: it registers this app's MCP server (<code>agy mcp add pennodepaper …</code>) and adds the allow-rule <code>mcp(pennodepaper/*)</code>, which headless agy needs because it can't ask for permission. Only this server is allowed; a backup is kept as <code>settings.json.pnp-backup</code>.</p>
      <button class="btn primary" onclick={setupAgy}>Connect agy</button>
      {#if setupMsg}<span class="err">{setupMsg}</span>{/if}
    </div>
  {:else if app.backend === 'agy' && agy && !agy.installed}
    <div class="setup"><b>agy not found.</b> Install the Antigravity CLI and make sure <code>agy</code> is on your PATH.</div>
  {/if}

  <div class="msgs" bind:this={list}>
    {#each rows as r, i (r.kind === 'msg' ? r.m.id : `t-${r.nodeId}-${i}`)}
      {#if r.kind === 'thread'}
        {@const n = app.nodes[r.nodeId]}
        <button class="thread" onclick={() => { selectNode(r.nodeId); if (n) focusNode(r.nodeId); }}>
          <span>💬</span>
          <span class="tt">Thread on <b>{n?.title ?? r.nodeId}</b> · {r.count} message{r.count > 1 ? 's' : ''}</span>
          {#if r.last}<span class="tl">{r.last.slice(0, 90)}</span>{/if}
        </button>
      {:else}
        {@const m = r.m}
        {#if m.role === 'user'}
          <div class="user"><div class="b">{m.text}</div></div>
        {:else if m.role === 'assistant' && !m.text && !m.streaming}
          <!-- a turn that only called tools has no text: the tool cards say it all -->
        {:else if m.role === 'assistant'}
          <div class="ai" style="--c:var(--{m.backend})">
            <span class="who">{m.backend === 'agy' ? 'agy' : 'Claude'}</span>
            <div class="b">{@html fmt(m.text)}{#if m.streaming}<span class="caret"></span>{/if}</div>
          </div>
        {:else if m.role === 'tool' && m.tool}
          <div class="tool" class:err={m.tool.status === 'error'} style="--c:var(--{m.backend})">
            <span class="st">{#if m.tool.status === 'running'}<i class="spin"></i>{:else if m.tool.status === 'ok'}✓{:else}✗{/if}</span>
            <code>{m.tool.name}</code>
            <span class="sum">{m.tool.summary}</span>
            {#if m.text}<span class="et">{m.text}</span>{/if}
          </div>
        {:else}
          <div class="sys">{m.text}</div>
        {/if}
      {/if}
    {:else}
      <div class="hello">
        <div class="big">✦</div>
        {#if nodeId}
          <p>Ask the AI about this node. It can see the node and the whole campaign.</p>
        {:else}
          <p><b>Your co-GM.</b> Ask it to build, link, move, or review nodes — you'll watch it work on the canvas.</p>
          <div class="ex">
            {#each ['Prepare three tavern rumours as pool nodes', 'Which pool nodes could fit after the ledger clue?', 'Link every NPC to the scene where they first appear'] as ex}
              <button class="chip" onclick={() => (text = ex)}>{ex}</button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if busy}
      <div class="think" style="--c:var(--{app.chatStatus.backend ?? 'claude'})"><i class="spin"></i> {app.chatStatus.backend === 'agy' ? 'agy' : 'Claude'} is working…
        <button class="btn ghost" onclick={() => cancelChat()}>stop</button></div>
    {/if}
  </div>

  <div class="composer">
    {#if chipIds.length}
      <div class="ctx">
        <span class="lab">context</span>
        {#each chipIds as id}
          {@const n = app.nodes[id]}
          {#if n}
            <span class="cchip" style="--tc:{NODE_TYPE_INFO[n.type].color}">{NODE_TYPE_INFO[n.type].icon} {n.title}
              {#if id === selected?.id && !pins.includes(id)}<button title="don't include" onclick={() => (useSelected = false)}>×</button>
              {:else if pins.includes(id)}<button onclick={() => (pins = pins.filter((p) => p !== id))}>×</button>{/if}
            </span>
          {/if}
        {/each}
      </div>
    {:else if selected && !useSelected && !nodeId}
      <button class="ctx off" onclick={() => (useSelected = true)}>+ include “{selected.title}”</button>
    {/if}
    {#if mention && candidates.length}
      <div class="mention">
        {#each candidates as n, i}
          <button class:hot={i === 0} onmousedown={(e) => { e.preventDefault(); pick(n.id); }}>
            <span style="color:{NODE_TYPE_INFO[n.type].color}">{NODE_TYPE_INFO[n.type].icon}</span> {n.title}
          </button>
        {/each}
      </div>
    {/if}
    <div class="row">
      <textarea class="field" rows="2" placeholder={nodeId ? 'Ask about this node…' : 'Ask the AI… (@ to mention a node, Enter to send)'} bind:value={text} {oninput} onkeydown={onkey} disabled={busy}></textarea>
      <button class="btn primary send" disabled={busy || !text.trim()} onclick={submit}>↑</button>
    </div>
  </div>
</div>

<style>
  .chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .chat.compact { height: 360px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--bg); }
  .bar { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); align-items: center; }
  .seg { display: flex; background: var(--bg); border: 1px solid var(--line-2); border-radius: 99px; padding: 2px; }
  .seg button { background: transparent; border: 0; border-radius: 99px; padding: 3px 12px; color: var(--text-dim); }
  .seg button.on { background: var(--c); color: #0a0c11; font-weight: 600; }
  .model { width: auto; flex: 1; padding: 3px 8px; }
  .setup { margin: 8px 10px 0; padding: 10px 12px; border: 1px solid var(--line-2); border-left: 3px solid var(--agy); border-radius: var(--radius-s); background: var(--bg-3); font-size: 12px; }
  .setup p { margin: 4px 0 8px; color: var(--text-dim); }
  .setup code, .tool code, .b :global(code) { font-family: var(--mono); font-size: 11px; background: var(--bg); padding: 0 4px; border-radius: 4px; }
  .err { color: var(--danger); margin-left: 8px; }
  .msgs { flex: 1; overflow: auto; padding: 12px 10px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .user { align-self: flex-end; max-width: 88%; }
  .user .b { background: var(--accent-soft); border: 1px solid #2f4170; padding: 7px 11px; border-radius: 12px 12px 3px 12px; white-space: pre-wrap; }
  .ai { max-width: 94%; animation: pnp-pop 0.2s ease-out; }
  .who { font-size: 10px; letter-spacing: 0.06em; font-weight: 600; color: var(--c); text-transform: uppercase; }
  .ai .b { margin-top: 2px; background: var(--bg-3); border: 1px solid var(--line-2); border-left: 2px solid var(--c); padding: 7px 11px; border-radius: 3px 12px 12px 12px; white-space: pre-wrap; line-height: 1.5; }
  .caret { display: inline-block; width: 6px; height: 13px; background: var(--c); margin-left: 2px; vertical-align: -2px; animation: pnp-ring 0.9s infinite; }
  .tool { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 4px 9px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; font-size: 12px; margin-left: 10px; color: var(--text-dim); animation: pnp-pop 0.2s ease-out; }
  .tool .st { color: var(--ok); width: 14px; text-align: center; }
  .tool.err .st, .tool .et { color: var(--danger); }
  .tool code { color: var(--c); }
  .tool .sum { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
  .thread { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; text-align: left; background: var(--bg-3); border: 1px dashed var(--line-2); border-radius: var(--radius-s); padding: 6px 10px; color: var(--text-dim); }
  .thread:hover { border-color: var(--accent); color: var(--text); }
  .tt b { color: var(--text); }
  .tl { font-size: 11.5px; color: var(--text-faint); font-style: italic; flex-basis: 100%; }
  .sys { align-self: center; color: var(--danger); font-size: 12px; background: #2a1518; border: 1px solid #5a2a30; padding: 6px 10px; border-radius: 8px; max-width: 94%; white-space: pre-wrap; }
  .think { display: flex; align-items: center; gap: 8px; color: var(--text-dim); font-size: 12px; }
  .spin { width: 11px; height: 11px; border: 2px solid var(--line-2); border-top-color: var(--c, var(--accent)); border-radius: 50%; display: inline-block; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .hello { text-align: center; color: var(--text-dim); padding: 28px 12px; }
  .hello .big { font-size: 34px; color: var(--line-2); }
  .ex { display: grid; gap: 6px; margin-top: 12px; }
  .ex .chip { cursor: pointer; text-align: left; padding: 5px 10px; border-radius: 8px; font-size: 12px; }
  .ex .chip:hover { border-color: var(--accent); color: var(--text); }
  .composer { padding: 8px 10px 10px; border-top: 1px solid var(--line); position: relative; }
  .ctx { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-bottom: 6px; }
  .ctx.off { background: transparent; border: 0; color: var(--text-faint); font-size: 11.5px; padding: 0; margin-bottom: 6px; }
  .lab { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); }
  .cchip { display: inline-flex; gap: 5px; align-items: center; font-size: 11.5px; padding: 1px 4px 1px 8px; border-radius: 99px; border: 1px solid var(--tc); background: color-mix(in srgb, var(--tc) 12%, transparent); }
  .cchip button { background: transparent; border: 0; color: var(--text-dim); padding: 0 4px; }
  .row { display: flex; gap: 6px; align-items: flex-end; }
  .row textarea { resize: none; min-height: 0; }
  .send { width: 34px; height: 34px; padding: 0; border-radius: 10px; font-size: 16px; }
  .mention { position: absolute; bottom: 100%; left: 10px; right: 10px; background: var(--bg-3); border: 1px solid var(--line-2); border-radius: var(--radius-s); overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); }
  .mention button { display: block; width: 100%; text-align: left; background: transparent; border: 0; padding: 6px 10px; }
  .mention button.hot, .mention button:hover { background: var(--accent-soft); }
</style>
