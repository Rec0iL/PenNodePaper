import { NODE_TYPE_INFO } from '@pnp/shared';
import { app, closeEnlarged, cmd, flow, toggleEnlarge, undo, redo } from '../app.svelte';
import { calm, camera, fit, card, click, el, pick, pool, sleep, viewKey, waitFor, type TourStep } from './kit';

const s = (chapter: string, step: Omit<TourStep, 'chapter'>): TourStep => ({ chapter, ...step });
const exists = (id: string) => !!app.nodes[id] && !app.nodes[id].trashed;
const placed = (id: string) => !!app.graph.placements[id];
const nodeCount = () => Object.values(app.nodes).filter((n) => !n.trashed).length;

// ---------------------------------------------------------------------------------------------------------------
// 1 · Welcome
// ---------------------------------------------------------------------------------------------------------------
const welcome: TourStep[] = [
  s('welcome', {
    id: 'welcome', wide: true, side: 'center',
    title: 'Welcome to PenNodePaper',
    body: 'A canvas for your **story and your world** — scenes, people, places, clues, maps and pictures as cards you connect — with a co-GM at the side that can do the same chores you can.\n\nYou are in a **practice campaign**, “Greywater”. Break whatever you like: nothing here matters, and you can start over at any time.\n\nThe AI in this tour is a **scripted stand-in** and the pictures are played back, so nothing has to be installed or connected. It takes about 20 minutes; you can stop and continue whenever you like.',
  }),
  s('welcome', {
    id: 'how', side: 'center',
    title: 'How the tour works',
    body: 'The part of the screen a step is about is **lit**; the rest is dimmed. Press **Next** to go on.\n\nSome steps ask you to do something — then the card waits, and there is always a **Do it for me** button if a gesture is fiddly.\n\nThe **?** in the top bar opens the chapters, so you can jump around, pause, or start over. [[Ctrl]]+[[Z]] undoes anything you do.',
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// 2 · The screen
// ---------------------------------------------------------------------------------------------------------------
const screen: TourStep[] = [
  s('screen', {
    id: 'screen-brand', target: '[data-tour="brand"]', side: 'bottom',
    need: ['base'], enter: () => { calm(); app.tab = 'inspector'; },
    title: 'Campaigns',
    body: 'The campaign’s name is a **menu**: open another campaign, start a new one, branch this one (“what if the players side with the cult?”), make backups, or print the GM binder. We will come back to it at the end.\n\nA campaign is just a **folder of plain files** on your computer — notes you can open in any editor.',
  }),
  s('screen', {
    id: 'screen-canvases', target: '[data-tour="canvas-tabs"]', side: 'bottom',
    enter: () => calm(),
    title: 'Canvases',
    body: 'Big stories get **several canvases**: one per act, chapter or side quest. Right now there is one, “Main story”. The **+** adds another — we will make one later.',
  }),
  s('screen', {
    id: 'screen-canvas', target: '[data-tour="canvas"]', side: 'left', pad: 0,
    enter: async () => { calm(); await fit(); },
    title: 'The canvas',
    body: 'This is your story as a **graph**: every card is a node, every line a connection. Nothing is in a rigid order, so you can rearrange freely.\n\n**Drag** the background to move around, **scroll** to zoom. In the corner: a minimap and zoom buttons.',
    action: () => {
      const v0 = viewKey();
      return {
        text: 'Scroll to zoom, or drag the background',
        done: () => viewKey() !== v0,
        auto: { label: 'Zoom for me', run: async () => { const v = flow()?.getViewport(); if (v) await camera(() => flow()?.setViewport({ ...v, zoom: Math.min(1.2, v.zoom * 1.35) }, 500)); } },
      };
    },
    after: 'That is all there is to moving around. Zoom far out, and the cards turn into big titles so a large campaign stays readable — we try that later.',
  }),
  s('screen', {
    id: 'screen-card', target: [card('arrival')], side: 'right', pad: 10,
    enter: async () => { calm(); await fit(); },
    title: 'A node',
    body: 'One card = one piece of your story. The **colour and symbol** say what it is — a *scene*, an *NPC*, a *clue*, a *location*, an *event*… There are sixteen kinds, from encounters to handouts to clocks.\n\nOn the card: title, a short summary, tags, the status (untouched, active, done, skipped) and a picture if it has one. The small ⌗ badge means “this place has a map”.',
  }),
  s('screen', {
    id: 'screen-edge', target: [card('arrival'), card('missing-ledger')], side: 'bottom', pad: 8,
    enter: () => calm(),
    title: 'Connections',
    body: 'The line between two cards is a **connection** with a *kind*: leads to, if …, reveals, belongs to, foreshadows, bridge. Each has its own colour and dash; the bar at the bottom of the canvas explains them (we will use it in a minute).',
  }),
  s('screen', {
    id: 'screen-pool', target: '[data-tour="pool"]', side: 'right',
    enter: () => calm(),
    title: 'The pool',
    body: 'The sidebar holds everything that **has no place in the story yet**: the tavern the players may or may not visit, a random encounter, a handout. Prepare it once, drag it onto the canvas **when it happens**.\n\nEach card says *when* it might come up (⏱). Players’ characters would appear in the strip above, once a VTT sends them.',
  }),
  s('screen', {
    id: 'screen-dock', target: '[data-tour="dock"]', side: 'left',
    enter: () => { calm(); app.tab = 'inspector'; },
    title: 'The side panel',
    body: '**Inspector** — edit the selected node. **Story** — where the players are and how to get them back on track. **Library** — your rulebooks and world books. **AI** — the chat with your co-GM.\n\nWe visit each of them.',
  }),
  s('screen', {
    id: 'screen-activity', target: '[data-tour="activity"]', side: 'top',
    enter: () => calm(),
    title: 'The activity log',
    body: 'Every change is logged here, **yours and the AI’s**, and every one is an **undo step**. Click an entry to jump to what it changed.\n\nUndo and redo (↶ ↷) are in the top bar, or [[Ctrl]]+[[Z]] and [[Ctrl]]+[[Shift]]+[[Z]].',
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// 3 · Nodes
// ---------------------------------------------------------------------------------------------------------------
const nodes: TourStep[] = [
  s('nodes', {
    id: 'nodes-select', target: [card('arrival')], side: 'right', pad: 10,
    need: ['base'], enter: () => { calm(); app.selectedId = null; app.tab = 'inspector'; },
    title: 'Open a node',
    body: 'Click a card to select it. The **Inspector** on the right then shows everything about it.',
    action: () => ({ text: 'Click the card “Arrival at Greywater”', done: () => app.selectedId === 'arrival', auto: { label: 'Select it for me', run: () => pick('arrival') } }),
  }),
  s('nodes', {
    id: 'nodes-inspector', target: ['[data-tour="insp-head"]', '[data-tour="insp-title"]'], side: 'left',
    enter: () => { calm(); pick('arrival'); },
    title: 'The Inspector',
    body: 'At the top: the node’s **type** and **status**, its title, a **summary** (the text on the card) and tags. Everything saves as you type or when you leave the field, and the card changes at once.\n\nFurther down you find notes, the read-aloud text, the table tools, pictures, the chat about this node and its connections.',
  }),
  s('nodes', {
    id: 'nodes-notes', target: ['[data-tour="insp-notes"]'], side: 'left',
    enter: () => { calm(); pick('arrival'); },
    title: 'GM notes vs. read-aloud',
    body: '**Notes** are for you only — markdown, as long as you like. Nothing there ever leaves the program.\n\n**Read aloud** is what you say **to the players**: the boxed text. It is the only text that goes into player handouts, the “For the players” wiki and the enlarged card’s shaded block — your notes never do.',
  }),
  s('nodes', {
    id: 'nodes-edit', target: ['[data-tour="insp-summary"]'], side: 'left',
    enter: () => { calm(); pick('arrival'); },
    title: 'Write something',
    body: 'Change the summary: click into it, type, and click outside. Watch the card on the canvas follow.',
    action: () => {
      const s0 = app.nodes.arrival?.summary;
      return {
        text: 'Edit the summary of this node',
        done: () => app.nodes.arrival?.summary !== s0,
        auto: { label: 'Do it for me', run: () => void cmd('update_node', { id: 'arrival', summary: 'The party reaches a fog-bound harbour town at dusk. Something is wrong with the bell.' }) },
      };
    },
    after: 'Saved — and it is one undo step. Press [[Ctrl]]+[[Z]] if you want the old text back.',
  }),
  s('nodes', {
    id: 'nodes-enlarge', target: [card('arrival')], side: 'right', pad: 10,
    enter: () => { calm(); pick('arrival'); },
    title: 'Look closer: double-click',
    body: '**Double-click** a card to enlarge it **in place** — the camera zooms onto it and shows the summary, the **read-aloud text**, your **GM notes** and a bigger picture, so you can read it at the table without opening anything.',
    action: () => ({ text: 'Double-click the card', done: () => app.enlarged?.id === 'arrival', auto: { label: 'Do it for me', run: () => void toggleEnlarge('arrival') } }),
  }),
  s('nodes', {
    id: 'nodes-enlarged', target: ['[data-tour="canvas"]'], side: 'left', pad: 0,
    enter: async () => {
      calm({ enlarged: true });
      if (app.enlarged?.id !== 'arrival') { pick('arrival'); await toggleEnlarge('arrival'); }
    },
    title: 'The enlarged card',
    body: 'The shaded block is the **read-aloud** text; below it, your **GM notes** with their formatting. The picture is big enough to show the players.\n\nIt shrinks again when you **double-click the empty canvas**, pick another card, press [[Esc]] or use the ×. The camera goes back to where it was.',
    action: () => ({ text: 'Shrink it: [[Esc]], the ×, or double-click the empty canvas', done: () => app.enlarged === null, auto: { label: 'Do it for me', run: () => closeEnlarged() } }),
  }),
  s('nodes', {
    id: 'nodes-create', target: ['[data-tour="create-bar"]'], side: 'bottom',
    enter: () => calm(),
    title: 'Make a node',
    body: 'The bar at the top left of the canvas makes nodes: pick a **type**, type a **title**, then **+ Canvas** puts it where you are looking, **+ Pool** prepares it for later.\n\nTry it — for example an NPC called “Lighthouse keeper”.',
    action: () => {
      const n0 = nodeCount();
      return {
        text: 'Add any node with “+ Canvas” or “+ Pool”',
        done: () => nodeCount() > n0,
        auto: { label: 'Do it for me', run: async () => { const r = await cmd<{ id: string }>('create_node', { type: 'npc', title: 'Lighthouse keeper', summary: 'Lives alone, hears everything the sea says.', place: 'pool' }); if (r) pick(r.id); } },
      };
    },
    after: 'There it is. The other ways: **right-click the empty canvas** (next), or ask the AI.',
  }),
  s('nodes', {
    id: 'nodes-paneMenu', target: ['[data-tour="canvas"]'], side: 'left', pad: 0,
    enter: () => calm(),
    title: 'Right-click the canvas',
    body: 'Right-click the **empty** canvas for a menu that adds any kind of node **right there** — or a **frame**, a labelled coloured area for an act or a district (we meet frames later).',
    action: () => ({
      text: 'Right-click an empty spot on the canvas',
      done: () => app.paneMenu !== null,
      auto: { label: 'Open it for me', run: () => { const r = el('[data-tour="canvas"]')!.getBoundingClientRect(); app.paneMenu = { x: r.left + r.width * 0.55, y: r.top + r.height * 0.72, fx: 400, fy: 480 }; } },
    }),
    after: 'Pick a type to add it there — or just press [[Esc]] to close the menu and go on.',
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// 4 · Pool and connections
// ---------------------------------------------------------------------------------------------------------------
const connect: TourStep[] = [
  s('connect', {
    id: 'connect-pool', target: [pool('rusty-anchor'), '[data-tour="canvas"]'], side: 'bottom', pad: 4,
    need: ['base'], enter: () => { calm(); pick('rusty-anchor'); },
    title: 'From the pool to the story',
    body: 'The players walk into the tavern: take **The Rusty Anchor** out of the pool and **drop it on the canvas** (drag it, or press its → button). The same works backwards: drag a card back to the pool when it is not needed after all.',
    action: () => ({ text: 'Drag “The Rusty Anchor” onto the canvas', done: () => placed('rusty-anchor'), auto: { label: 'Place it for me', run: () => void cmd('place_on_canvas', { id: 'rusty-anchor', canvas: app.canvasId, nearNodeId: 'arrival' }) } }),
    after: 'On the canvas now — and the pool is one card shorter.',
  }),
  s('connect', {
    id: 'connect-draw', target: [card('arrival'), card('rusty-anchor')], side: 'bottom', pad: 14,
    need: ['anchor-free'], enter: () => { calm(); pick('rusty-anchor'); },
    title: 'Draw a connection',
    body: 'Every card has a dot on each side. **Drag from the right-hand dot** of one card **to the left-hand dot** of another — here from *Arrival at Greywater* to *The Rusty Anchor*. The kind of the new line is whatever is chosen in the bar at the bottom.',
    action: () => ({
      text: 'Connect “Arrival” to “The Rusty Anchor”',
      done: () => app.graph.edges.some((e) => e.from === 'arrival' && e.to === 'rusty-anchor'),
      auto: { label: 'Connect them for me', run: () => void cmd('link', { from: 'arrival', to: 'rusty-anchor', kind: 'leads-to' }) },
    }),
    after: 'Connected. Drag an end of a line to another card to re-wire it; select a line and press [[Delete]] to remove it.',
  }),
  s('connect', {
    id: 'connect-kinds', target: ['[data-tour="kinds"]'], side: 'top',
    enter: () => calm(),
    title: 'Kinds of connection',
    body: 'Hover a kind to see what it is for: **leads to** is the story flow, **if …** needs a condition, **reveals** gives something away, **belongs to** puts an NPC in a place, **foreshadows** plants a hint, **bridge** is how you bring wandering players back.\n\nThe kind you pick here is used for the next line you draw.',
  }),
  s('connect', {
    id: 'connect-edit', target: ['[data-tour="canvas"]', '[data-tour="dock"]'], side: 'bottom', free: true, pad: 0,
    need: ['anchor-link'], enter: () => { calm(); pick('rusty-anchor'); },
    title: 'Label and change a connection',
    body: '**Click the line** you just made. The Inspector then shows its two ends, a **label** (written on the line — try “if they want a drink”) and its **kind** — change it to *if …*.\n\nYou can also double-click a line to type its label right on the canvas.',
    action: () => {
      const has = () => app.graph.edges.find((e) => e.from === 'arrival' && e.to === 'rusty-anchor');
      return {
        text: 'Give the line a label',
        done: () => !!has()?.label,
        auto: { label: 'Do it for me', run: () => { const e = has(); if (e) void cmd('relink', { edgeId: e.id, label: 'if they want a drink', kind: 'conditional' }); } },
      };
    },
  }),
  s('connect', {
    id: 'connect-menu', target: [card('arrival'), '[data-tour="node-menu"]'], side: 'right', pad: 10,
    enter: () => { calm(); pick('arrival'); },
    title: 'Right-click a node',
    body: 'The node menu has what you need **at the table**: *Move players here* (tick who goes), the **status** (untouched / active / done / skipped), *Open in inspector*, *Connect to another canvas* (once there is a second one), *Send to pool* and *Delete* (it only goes to the trash; undo brings it back).\n\nSelect **several** cards and the menu acts on all of them: set their status, say the players are at all of them, or *Frame these nodes*.',
    action: () => ({
      text: 'Right-click the card “Arrival at Greywater”',
      done: () => app.nodeMenu !== null,
      auto: { label: 'Open it for me', run: () => { const r = el(card('arrival'))?.getBoundingClientRect(); if (r) app.nodeMenu = { nodeId: 'arrival', x: r.right - 20, y: r.top + 24 }; } },
    }),
    after: 'We use the table tools later. Press [[Esc]] to close the menu.',
  }),
];

export const basics = [...welcome, ...screen, ...nodes, ...connect];
void [NODE_TYPE_INFO, sleep, undo, redo, waitFor, click, exists];
