import { visitsOf } from '@pnp/shared';
import { app, cmd, flow, selectFrame, selectNode, sendChat, setPanelSize } from '../app.svelte';
import { calm, camera, fit, card, click, el, pick, sleep, typeInto, waitFor, type TourStep } from './kit';

const s = (chapter: string, step: Omit<TourStep, 'chapter'>): TourStep => ({ chapter, ...step });
const exists = (id: string) => !!app.nodes[id] && !app.nodes[id].trashed;
const hereAt = (id: string) => !!app.nodes[id] && visitsOf(app.nodes[id]).some((v) => v.here);
const visited = (id: string) => !!app.nodes[id] && visitsOf(app.nodes[id]).length > 0;
const otherCanvas = () => app.graph.canvases.find((c) => c.id !== 'main');
const PARTY = ['pc-mira', 'pc-dorn', 'pc-ash'];
const GUIDANCE = 'Keep it short and let a person give the lead — no letters or documents. The players should feel they found it themselves.';

// ---------------------------------------------------------------------------------------------------------------
// 8 · Frames and canvases
// ---------------------------------------------------------------------------------------------------------------
const structure: TourStep[] = [
  s('structure', {
    id: 'frame-make', target: [card('arrival'), card('missing-ledger'), card('smugglers-cove'), card('cult-reveal')], side: 'bottom', pad: 36, span: true,
    need: ['base'], enter: async () => { calm(); app.canvasId = 'main'; selectNode(null); app.tab = 'inspector'; await fit(); },
    title: 'Frames',
    body: 'A big canvas needs structure. A **frame** is a labelled, coloured area behind a group of nodes — an act, a district, a side quest. Drag a frame by its title and **everything inside it moves along**.\n\n**Hold Shift and drag a box** around the four story cards to select them, then **right-click** one of the selected cards → **Frame these nodes**. (Or right-click the empty canvas → *Frame*, and drag the corners.)',
    action: () => {
      const n = app.graph.frames.length;
      return {
        text: 'Frame the four story cards',
        done: () => app.graph.frames.length > n,
        auto: { label: 'Do it for me', run: async () => { const r = await cmd<{ id: string }>('create_frame', { title: 'Act I · Greywater', nodeIds: ['arrival', 'missing-ledger', 'smugglers-cove', 'cult-reveal'] }); void r; } },
      };
    },
    after: 'Double-click a frame’s title to rename it; drag its corners to resize it.',
  }),
  s('structure', {
    id: 'frame-edit', target: ['.frame-bar'], side: 'bottom', pad: 14,
    need: ['frame'], enter: () => { calm(); app.canvasId = 'main'; },
    title: 'Name and colour',
    body: '**Click the frame’s title.** The Inspector then shows its name, its **colour** (a swatch or any colour you like) and a remove button. Frames show in the GM binder’s story map, too.',
    action: () => ({
      text: 'Click the frame’s title bar',
      done: () => app.selectedFrame !== null,
      auto: { label: 'Select it for me', run: () => { const f = app.graph.frames[0]; if (f) selectFrame(f.id); } },
    }),
  }),
  s('structure', {
    id: 'canvas-new', target: ['[data-tour="canvas-tabs"]'], side: 'bottom',
    enter: () => { calm(); app.canvasId = 'main'; },
    title: 'A second canvas',
    body: 'Click the **+** next to the canvas tabs to add another canvas — one per act or chapter. Each canvas is its own space; the story flow, the played path and the linter simply **continue across** them.',
    action: () => ({
      text: 'Add a canvas with the +',
      done: () => app.graph.canvases.length > 1,
      auto: { label: 'Add one for me', run: async () => { const r = await cmd<{ id: string }>('create_canvas', { name: 'Act II · The cult', id: 'act-2' }); if (r) app.canvasId = r.id; } },
    }),
  }),
  s('structure', {
    id: 'canvas-link', target: [card('cult-reveal'), '[data-tour="canvas-tabs"]'], side: 'bottom', pad: 14,
    need: ['act2'], enter: () => { calm(); app.canvasId = 'main'; selectNode('cult-reveal'); },
    title: 'Connect across canvases',
    body: 'The story goes on in Act II. Right-click *The bell tolls thirteen* → **Connect to another canvas…**, or **drag a connection from the card onto the other canvas’ tab**. A dialog opens: pick the canvas and the node there, and press **Connect**.',
    action: () => ({
      text: 'Connect “The bell tolls thirteen” to a node on the other canvas',
      done: () => { const o = otherCanvas(); return app.graph.edges.some((e) => e.from === 'cult-reveal' && !!o && app.graph.placements[e.to]?.canvas === o.id); },
      auto: { label: 'Do it for me', run: async () => { const t = Object.entries(app.graph.placements).find(([, p]) => p.canvas === otherCanvas()?.id)?.[0]; if (t) await cmd('link', { from: 'cult-reveal', to: t, kind: 'leads-to', label: 'the flood chambers open' }); } },
    }),
  }),
  s('structure', {
    id: 'canvas-jump', target: ['.svelte-flow__node[data-id^="stub:"]'], side: 'bottom', pad: 12,
    need: ['act2'], enter: async () => { calm(); app.canvasId = 'main'; await waitFor(() => !!el('.svelte-flow__node[data-id^="stub:"]'), 3000); },
    title: 'Jump markers',
    body: 'Next to the card a **jump marker** appeared: it shows *where the line continues* (the canvas and the node) in the colour of the connection. **Click it to jump** there. Drag it by its grip to put it elsewhere; double-click the grip to let it place itself again.',
    action: () => ({
      text: 'Click the jump marker',
      done: () => app.canvasId !== 'main',
      auto: { label: 'Jump for me', run: () => { const o = otherCanvas(); if (o) app.canvasId = o.id; } },
    }),
    after: 'You are on the other canvas now; it has the matching marker pointing back. Click it, or the “Main story” tab, to return.',
  }),
  s('structure', {
    id: 'canvas-zoom', target: ['[data-tour="canvas"]'], side: 'left', pad: 0,
    need: ['base'], enter: async () => { calm(); app.canvasId = 'main'; await sleep(150); await fit(); },
    title: 'Zoomed out: titles only',
    body: 'Far zoomed out, cards shrink to their **colour and one big title** (and frame titles grow), so a campaign with hundreds of nodes is still readable at a glance. Zoom in and the full cards come back.',
    action: () => ({
      text: 'Scroll out until the cards turn into titles',
      done: () => app.lod === 'compact',
      auto: { label: 'Zoom out for me', run: async () => { const v = flow()?.getViewport(); if (v) await camera(() => flow()?.setViewport({ ...v, zoom: 0.3 }, 500)); } },
    }),
    after: 'Zoom back in again to read the details — or press **Fit** (the corner buttons).',
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// 9 · Running a session
// ---------------------------------------------------------------------------------------------------------------
const session: TourStep[] = [
  s('session', {
    id: 'play-party', target: ['[data-tour="party"]'], side: 'right',
    need: ['anchor'], enter: () => { calm(); app.canvasId = 'main'; app.tab = 'inspector'; },
    title: 'Your players',
    body: 'Now the table. The strip above the pool shows your **players’ characters**. Normally your VTT sends them (with portraits), so they are there even when you are offline; here three made-up ones stand in.\n\nA colour ring says which part of the party a character is with.',
  }),
  s('session', {
    id: 'play-here', target: ['[data-tour="insp-play"]'], side: 'left',
    need: ['anchor'], enter: async () => { calm(); pick('arrival'); await sleep(250); },
    title: 'Where are the players?',
    body: 'Select the scene they are in and press **▶ Move players here…**: tick who goes there (*Whole party*, or single characters). The card gets a pulsing **▶ players are here** tag, a number in the order of play, and the line they walked is highlighted.',
    action: () => ({
      text: 'Move the players to “Arrival at Greywater”',
      done: () => hereAt('arrival'),
      auto: { label: 'Do it for me', run: () => void cmd('move_players', { characters: PARTY, nodeId: 'arrival' }) },
    }),
  }),
  s('session', {
    id: 'play-offscript', target: [card('rusty-anchor'), '[data-tour="insp-play"]'], side: 'bottom', pad: 12,
    need: ['anchor'], enter: () => { calm(); pick('rusty-anchor'); },
    title: 'Off the rails',
    body: 'Players never read the plan. They skip the ledger and walk into the tavern. Right-click **The Rusty Anchor** → **Move players here**, or select it and press the ▶ button.',
    action: () => ({
      text: 'Move the players to “The Rusty Anchor”',
      done: () => hereAt('rusty-anchor'),
      auto: { label: 'Do it for me', run: () => void cmd('move_players', { characters: PARTY, nodeId: 'rusty-anchor' }) },
    }),
  }),
  s('session', {
    id: 'play-story', target: ['[data-tour="story-where"]'], side: 'left',
    need: ['played'], enter: () => { calm(); app.tab = 'story'; },
    title: 'The Story tab: where are we?',
    body: 'The **Story** tab keeps track for you. Here is the **path the players took**, scene by scene — click a step to jump to it. Whatever you do with the ▶ buttons or the AI ends up here.',
  }),
  s('session', {
    id: 'play-back', target: ['[data-tour="story-back"]'], side: 'left',
    need: ['played'], enter: () => { calm(); app.tab = 'story'; },
    title: 'Getting back on track',
    body: 'Because they skipped the ledger, the tab now shows **where the story can pick up** (with *paths meet* where several lines merge), what was **bypassed**, the **roads not taken** and what the players **don’t know yet** — so a missed clue is never lost.',
  }),
  s('session', {
    id: 'play-guidance', target: ['[data-tour="story-guidance"]', '[data-tour="story-bridge"]'], side: 'left',
    need: ['played'], enter: async () => { calm(); app.tab = 'story'; await sleep(250); void typeInto('guidance', GUIDANCE, undefined, 8); },
    title: 'Bridge back — with a railguard',
    body: 'The **✦ Bridge back with the AI** button asks the co-GM for a way to rejoin the story. The text field above it is the **railguard**: tell the AI *how* the bridge should go — I wrote one — or leave it empty and the AI chooses.',
    action: () => ({
      text: 'Press “✦ Bridge back with the AI”',
      done: () => exists('bridge-lead') && !app.chatStatus.busy,
      auto: { label: 'Press it for me', run: () => click('[data-tour="story-bridge"]') },
    }),
  }),
  s('session', {
    id: 'play-bridge', target: [card('bridge-lead')], side: 'right', pad: 10,
    need: ['bridge'], enter: () => { calm(); app.tab = 'story'; if (exists('bridge-lead')) pick('bridge-lead', 'story'); },
    title: 'The bridge',
    body: 'The AI analysed the situation, added **one short bridge** (follow the green dashed **bridge** lines) and gave the missed clue a **second way in**. It followed your railguard, deleted nothing and left what already happened alone. Read its note in the AI tab.\n\nUse the same guidance field next time to steer the *tone*: no fights, a rumour instead of a letter, a lead from an NPC the players like.',
  }),
  s('session', {
    id: 'play-split', target: [card('missing-ledger'), '[data-tour="insp-play"]'], side: 'bottom', pad: 12,
    need: ['played'], enter: () => { calm(); pick('missing-ledger'); },
    title: 'Splitting the party',
    body: 'Parties split up. Move **some** characters to another node and the others keep their place: each part has its **own colour, marker and trail**, named after who is together (“Dorn & Ash”). When they meet again they become the plain *party* once more.\n\nTry it: select *The missing ledger* and press **▶ Move players here…** (or right-click the card), tick **Dorn** and **Ash**, and press *Move 2 selected here* — Mira stays in the tavern.',
    action: () => ({
      text: 'Move Dorn and Ash to “The missing ledger”',
      done: () => hereAt('missing-ledger') && hereAt('rusty-anchor'),
      auto: { label: 'Do it for me', run: () => void cmd('move_players', { characters: ['pc-dorn', 'pc-ash'], nodeId: 'missing-ledger' }) },
    }),
    after: 'Two lanes now — open the Story tab to see them. “Where they can meet again” offers a button to bring everyone together at one node.',
  }),
  s('session', {
    id: 'play-status', target: [card('smugglers-cove')], side: 'right', pad: 10,
    need: ['played'], enter: () => { calm(); app.tab = 'inspector'; pick('smugglers-cove'); },
    title: 'Status: done, skipped, in play',
    body: 'Right-click a node, or use the buttons in the Inspector, for its **status**: *untouched*, *active* (in play — an event, a place they might return to), *done*, *skipped* (deliberately bypassed). Several nodes can be active at once, and a status never moves the players.\n\nSelect **several cards** (Shift/Ctrl-click) to set the status — or “the players are at all of these” — for all of them in one go.',
  }),
  s('session', {
    id: 'play-table', target: [card('harbour-rumours'), '[data-tour="insp-roll"]'], side: 'bottom', pad: 12,
    need: ['tools'], enter: () => { calm(); app.canvasId = 'main'; pick('harbour-rumours'); },
    title: 'Random tables',
    body: 'A **random table** node holds one entry per line; **3×** makes an entry three times as likely, and the die follows the faces (this one has five lines, one counted twice: a d6). Press the **🎲** on the card — or **Roll** in the Inspector — to roll; the last result stays on the card and a short history in the Inspector.',
    action: () => {
      const last = () => String(app.nodes['harbour-rumours']?.fields.last ?? '');
      const l0 = last();
      return { text: 'Roll the table (🎲 on the card, or Roll in the Inspector)', done: () => last() !== '' && last() !== l0, auto: { label: 'Roll for me', run: () => void cmd('roll_table', { nodeId: 'harbour-rumours' }) } };
    },
  }),
  s('session', {
    id: 'play-table-ai', target: ['[data-tour="insp-roll"]'], side: 'left',
    need: ['tools'], enter: async () => { calm(); pick('harbour-rumours'); await sleep(200); },
    title: 'Fill a table with the AI',
    body: 'Type a **topic** (“rumours at the harbour tavern”, “what is in the smugglers’ crates”) and press **✦ Fill with AI**: the co-GM reads your world books and writes entries that fit — and appends them if the table already has some.',
    action: () => {
      const n = ((app.nodes['harbour-rumours']?.fields.entries as unknown[]) ?? []).length;
      return {
        text: 'Press “✦ Fill with AI”',
        done: () => ((app.nodes['harbour-rumours']?.fields.entries as unknown[]) ?? []).length > n && !app.chatStatus.busy,
        auto: { label: 'Press it for me', run: () => click('[data-tour="table-fill"]') },
      };
    },
  }),
  s('session', {
    id: 'play-clock', target: [card('bell-clock'), '[data-tour="insp-play"]'], side: 'bottom', pad: 12,
    need: ['tools'], enter: () => { calm(); app.canvasId = 'main'; pick('bell-clock'); },
    title: 'Clocks',
    body: 'A **clock** counts down something the players fear — the ritual, the patrol, the tide. Advance a segment when they waste time; when it fills, its consequence is **due**. Clocks also show up in the Story tab.',
    action: () => {
      const f = () => Number(app.nodes['bell-clock']?.fields.filled ?? 0);
      const f0 = f();
      return { text: 'Advance the clock with ＋ advance in the Inspector', done: () => f() > f0, auto: { label: 'Tick it for me', run: () => void cmd('advance_clock', { nodeId: 'bell-clock', by: 1 }) } };
    },
  }),
  s('session', {
    id: 'play-wiki', target: ['[data-tour="story-wiki"]'], side: 'left',
    need: ['played'], enter: async () => { calm(); app.tab = 'story'; await sleep(150); click('[data-tour="story-wiki"] .btn'); },
    title: 'For the players',
    body: 'The last block of the Story tab is a **spoiler-safe wiki**: only what the players have experienced or learned, only the **read-aloud** text. Preview it, export it as markdown, send it to a VTT as a handout — or press **✦ Recap with AI** for a narrator-style “Previously…”.\n\nThat is why write a read-aloud for what you want your players to remember.',
  }),
  s('session', {
    id: 'play-lint', target: ['[data-tour="story-problems"]'], side: 'left',
    need: ['played'], enter: () => { calm(); app.tab = 'story'; },
    title: 'The story linter',
    body: '**Problems** finds what would trip you up at the table: nodes nobody can reach, dead ends, a bridge that goes nowhere, a clue that opens nothing. Click a line to jump to the node. Run it before the session and after big edits.',
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// 10 · Library
// ---------------------------------------------------------------------------------------------------------------
const library: TourStep[] = [
  s('library', {
    id: 'lib-tab', target: ['[data-tour="tab-library"]'], side: 'left',
    enter: () => { calm(); app.tab = 'inspector'; },
    title: 'Library: your rules and your world',
    body: 'Rulebooks and world books are **stable reference documents** that do not clutter the canvas. Both are plain markdown, split by headings, searchable by you — and by the AI, which looks things up there instead of inventing rules or lore.',
    action: () => ({ text: 'Open the Library tab', done: () => app.tab === 'library', auto: { label: 'Open it for me', run: () => (app.tab = 'library') } }),
  }),
  s('library', {
    id: 'lib-books', target: ['[data-tour="dock"]'], side: 'left',
    enter: () => { calm(); app.tab = 'library'; },
    title: 'Rulebooks, world books, import',
    body: '**Rulebooks**: upload your system’s rules (.md) or import by path — plus an optional short *core rules digest* the AI always has in mind. **World books**: lore, geography, factions, history as long as you like; the AI always sees each book’s dense summary and searches the rest. **Import notes**: bring in your existing prep (.md, .txt, .docx, .pdf) and let the AI turn it into typed nodes.\n\nThe search box searches both kinds at once.',
  }),
  s('library', {
    id: 'lib-editor', target: ['[data-tour="editor-modal"]'], side: 'left',
    enter: async () => { calm(); app.tab = 'library'; app.editor = { name: 'greywater_lore' }; await sleep(300); },
    title: 'Writing a world book',
    body: 'A small autosaving editor with an **outline**, formatting shortcuts and a **summary** field — that summary is what the AI reads on every request. The AI can write or extend a book on request; the previous version is always kept in `worldbooks/.bak/`.',
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// 11 · VTT and the players
// ---------------------------------------------------------------------------------------------------------------
const vtt: TourStep[] = [
  s('vtt', {
    id: 'vtt-chip', target: ['[data-tour="vtt"]'], side: 'bottom',
    enter: () => calm(),
    title: 'Your tabletop software',
    body: 'The chip says whether a **VTT** (virtual tabletop) is connected. PenNodePaper speaks a small, open protocol: *KINETIK VTT*, *EldaraHQ*, *HeroHQ* and *Pips & Paws* already do — a VTT announces what it can receive, and the app **adapts**: character sheets in that game’s own terms, only the buttons it supports.',
  }),
  s('vtt', {
    id: 'vtt-settings', target: ['[data-tour="settings-vtt"]'], side: 'left',
    enter: async () => { calm({ settings: true }); app.settingsOpen = true; await waitFor(() => !!el('[data-tour="settings-vtt"]')); },
    title: 'Pairing and export',
    body: 'Give the VTT this **address and token**, and it connects (you only need a free port on your own machine — nothing goes to the internet). **No live link?** Export a file: a complete session for KINETIK VTT or a universal bundle.\n\nIf you also open PenNodePaper from another device on your network, the LAN section above has what you need.',
  }),
  s('vtt', {
    id: 'vtt-push', target: ['[data-tour="insp-vtt"]'], side: 'left',
    need: ['base'], enter: async () => { calm(); pick('dockside-hand'); await sleep(250); },
    title: 'Show it to the players',
    body: 'On any node with text, a picture or a map you find **Show to the players**: send it to the VTT as a **handout**, as a **backdrop** on the map screen, or the battle map itself with the token starts; NPCs and enemies go as character sheets. “Show right away” lights it up for the players.\n\nWithout a VTT the buttons are greyed out; export a file then.',
  }),
  s('vtt', {
    id: 'vtt-sheet', target: ['[data-tour="insp-sheet"]'], side: 'left',
    need: ['base'], enter: async () => { calm(); pick('harbour-master'); await sleep(300); },
    title: 'NPC and enemy sheets',
    body: 'NPCs and enemies get a **character sheet** whose fields come from **your game**: the VTT describes how characters are built (a tier ladder, hit points, moves, a list of traits, pick lists wherever it offers choices), and PenNodePaper builds the form from that — so the AI can write sheets in your game’s own terms, and **Push to the VTT** sends them over.\n\nWithout a VTT you see a note instead of the form; once a VTT has announced its structure it is remembered, so the sheet works offline, too.',
  }),
  s('vtt', {
    id: 'vtt-sound', target: ['[data-tour="insp-sound"]'], side: 'left',
    need: ['base'], enter: async () => { calm(); pick('arrival'); await sleep(250); },
    title: 'Music and sounds',
    body: 'Give a node **sound cues** (a mood, a track, an effect) and they play when you press *Play* — together with its handout if you like. The **♪** button in the top bar plays any track of the connected VTT by hand.',
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// 12 · Safety net and finish
// ---------------------------------------------------------------------------------------------------------------
const finishChapter: TourStep[] = [
  s('finish', {
    id: 'fin-search', target: ['[data-tour="search"]'], side: 'bottom',
    enter: () => calm(),
    title: 'Search everything',
    body: 'Press [[Ctrl]]+[[K]] (or ⌘K): type what you remember — a word from a title, a tag, the read-aloud, a note — and jump to the node. Filters: `type:npc`, `#tag`, `is:pool`, `is:played`. Start with `>` for actions: new node, tabs, backups, undo…',
    action: () => ({ text: 'Open the search', done: () => app.paletteOpen, auto: { label: 'Open it for me', run: () => (app.paletteOpen = true) } }),
    after: 'Type “bell”, press Enter, and it takes you there. [[Esc]] closes it.',
  }),
  s('finish', {
    id: 'fin-campaign', target: ['[data-tour="campaign-pop"]'], side: 'right',
    enter: async () => { calm(); await sleep(150); click('[data-tour="brand"] .camp'); await waitFor(() => !!el('[data-tour="campaign-pop"]')); },
    title: 'Campaigns, branches and backups',
    body: '**New campaign**, **Branch this campaign…** (a full copy to try “what if the players side with the cult?”), **Backups & sync…**, **GM binder (PDF)…** — all behind the campaign’s name.',
  }),
  s('finish', {
    id: 'fin-backups', target: ['[data-tour="backup-modal"]'], side: 'left',
    enter: async () => { calm(); app.backupsOpen = true; await sleep(300); },
    title: 'Backups',
    body: 'Snapshots of the whole campaign folder are taken **automatically while you work**, and you can make labelled ones. **Restore** puts everything back (after a safety snapshot of the present). Snapshots can be copied to a **mirror folder** (Dropbox, Syncthing, a USB stick), exported as one file, and committed to a local **git** repository if you like. Nothing is ever sent anywhere by itself.',
  }),
  s('finish', {
    id: 'fin-binder', target: ['[data-tour="binder-modal"]'], side: 'left',
    enter: async () => { calm(); app.binderOpen = true; await sleep(300); },
    title: 'The GM binder',
    body: 'The whole campaign as **one printable A4 PDF**: cover, contents with page numbers, the story map, the story beat by beat with read-aloud in shaded boxes and **page references on every connection**, people, places, handouts, random tables. You can leave out your GM notes (for a co-GM) or the pictures (small file), and print **table copies** of handouts and maps.\n\nIt needs WeasyPrint (`pip install weasyprint`); the install guide has it.',
  }),
  s('finish', {
    id: 'fin-layout', target: ['[data-tour="splitter-left"]', '[data-tour="splitter-right"]', '[data-tour="splitter-bottom"]'], side: 'bottom', pad: 12,
    enter: () => { calm(); app.tab = 'inspector'; },
    title: 'Make room',
    body: 'Drag the **splitters** between the pool, the canvas, the side panel and the activity strip to the sizes you like (double-click one to reset it); they are remembered. The lit lines are the three splitters.\n\nEverything also works on a laptop in the garden: LAN mode (see Settings) lets another device on your network control PenNodePaper.',
    action: () => {
      const l0 = `${app.layout.left},${app.layout.right},${app.layout.bottom}`;
      return {
        text: 'Drag one of the splitters',
        done: () => `${app.layout.left},${app.layout.right},${app.layout.bottom}` !== l0,
        auto: { label: 'Do it for me', run: () => setPanelSize('left', app.layout.left + 50) },
      };
    },
    after: 'Nice. Double-click a splitter to put it back.',
  }),
  s('finish', {
    id: 'fin-keys', target: [], side: 'center',
    enter: () => calm(),
    title: 'Keys worth knowing',
    body: '[[Ctrl]]+[[Z]] / [[Ctrl]]+[[Shift]]+[[Z]] — undo / redo\n[[Ctrl]]+[[K]] — search and actions\n**Double-click** a card — enlarge it; [[Esc]] puts it back\n**Right-click** a card, a line or the canvas — the menus\n**Shift**-drag — select several cards; [[Delete]] removes them (to the trash)\n[[Space]]+drag in the map editor — move around\n**?** in the top bar — this tour, any time',
  }),
  s('finish', {
    id: 'fin-real-ai', target: ['[data-tour="tab-chat"]'], side: 'left',
    enter: () => { calm(); app.tab = 'chat'; },
    title: 'Connect a real AI',
    body: 'The co-GM in this tour was scripted. To use a real one: install **Claude Code** and/or **agy** (the install guide, `docs/INSTALL.md`, has the steps for Linux, macOS and Windows) — then the AI tab talks to it, with the same tools and animations you just saw. For **pictures** and **painted maps**, install ComfyUI and the Krea 2 model.\n\nNone of that is needed to write, connect, map and run a campaign.',
  }),
  s('finish', {
    id: 'fin-done', wide: true, side: 'center', target: [],
    enter: () => calm(),
    title: 'That is the tour',
    body: 'You have seen the canvas and the pool, nodes and connections, the co-GM and review mode, pictures, maps in two steps, frames and canvases, the table tools, the library and the VTT link.\n\nThis practice campaign is yours to keep playing with. When you are ready, start a campaign of your own — and the **?** in the top bar brings the tour back any time.',
    buttons: [
      { label: 'Keep practising here', run: async () => (await import('../tour.svelte')).finish() },
      { label: 'Start my own campaign', primary: true, run: async () => { await (await import('../tour.svelte')).finish(); click('[data-tour="brand"] .camp'); } },
      { label: 'Do the tour again', run: async () => (await import('../tour.svelte')).restartTour() },
    ],
  }),
];

export const sessionChapters = [...structure, ...session, ...library, ...vtt, ...finishChapter];
void [sendChat, sleep, visited];
