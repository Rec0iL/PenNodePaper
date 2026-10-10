import { TOUR_MESSAGES } from '@pnp/shared';
import { app, cmd, focusNode, redo, selectNode, sendChat, undo, activeJobs } from '../app.svelte';
import { calm, card, click, el, pick, sleep, typeInto, waitFor, type TourStep } from './kit';

const s = (chapter: string, step: Omit<TourStep, 'chapter'>): TourStep => ({ chapter, ...step });
const exists = (id: string) => !!app.nodes[id] && !app.nodes[id].trashed;
const sent = (text: string) => app.chat.some((m) => m.role === 'user' && m.text === text);
const lastBatch = () => app.history.at(-1)?.label ?? '';

// ---------------------------------------------------------------------------------------------------------------
// 5 · The AI co-GM
// ---------------------------------------------------------------------------------------------------------------
const ai: TourStep[] = [
  s('ai', {
    id: 'ai-tab', target: ['[data-tour="tab-chat"]'], side: 'left',
    need: ['anchor'], enter: () => { calm(); pick('rusty-anchor'); },
    title: 'Your co-GM',
    body: 'Now the part that makes PenNodePaper different: a **co-GM** that can do what you can do — create and connect nodes, write text, look things up in your rulebooks, draw maps, make pictures — **while you watch it happen**.\n\nIt lives in the **AI** tab.',
    action: () => ({ text: 'Open the AI tab', done: () => app.tab === 'chat', auto: { label: 'Open it for me', run: () => (app.tab = 'chat') } }),
  }),
  s('ai', {
    id: 'ai-intro', target: ['[data-tour="chat-bar"]', '[data-tour="chat-composer"]'], side: 'left',
    enter: () => { calm(); app.tab = 'chat'; },
    title: 'Claude, agy — or this tour’s stand-in',
    body: 'Normally you pick **Claude** or **agy** here (two AI programs you install once), choose a model and chat. **In this tour a scripted stand-in answers**, so nothing is installed — but it uses the very same tools and the very same animations.\n\nThe node you have selected goes along as **context**, and **@** mentions pull in others. You can also ask about a single node from the Inspector.',
  }),
  s('ai', {
    id: 'ai-select', target: [card('rusty-anchor')], side: 'right', pad: 10,
    need: ['anchor'], enter: () => { calm(); app.tab = 'chat'; selectNode(null); },
    title: 'Tell it what you are looking at',
    body: 'Select **The Rusty Anchor** on the canvas. It appears as a **context** chip above the message box, so you can say “this place” and the AI knows.',
    action: () => ({ text: 'Click “The Rusty Anchor”', done: () => app.selectedId === 'rusty-anchor', auto: { label: 'Select it for me', run: () => { selectNode('rusty-anchor', 'chat'); app.tab = 'chat'; } } }),
  }),
  s('ai', {
    id: 'ai-send', target: ['[data-tour="chat-composer"]'], side: 'left', watch: true,
    need: ['anchor'],
    enter: async () => { calm(); selectNode('rusty-anchor', 'chat'); app.tab = 'chat'; await sleep(250); el('[data-tour="chat-composer"] textarea')?.focus(); void typeInto('chat', TOUR_MESSAGES.brenn); },
    title: 'Ask for something',
    body: 'I typed a request for you: *give the tavern a barkeep and a rumour that points at the cult, and link them in*. Press **Enter** (or the ↑ button) to send it.\n\nThen **watch the canvas**: the camera follows the AI, new cards appear with a glow, and the connections draw themselves.',
    action: () => ({
      text: 'Send the message',
      done: () => sent(TOUR_MESSAGES.brenn) && exists('brenn') && !app.chatStatus.busy && lastBatch() !== '',
      auto: { label: 'Send it for me', run: async () => { app.fill = null; await sendChat(TOUR_MESSAGES.brenn, { pins: ['rusty-anchor'] }); } },
    }),
  }),
  s('ai', {
    id: 'ai-result', target: ['[data-tour="chat-msgs"]', '[data-tour="activity"]'], side: 'left',
    need: ['brenn'], enter: () => { calm(); if (exists('brenn')) focusNode('brenn'); app.tab = 'chat'; },
    title: 'What just happened',
    body: 'The AI worked **through tools**, shown as small cards in the chat — `create_node`, `link`, `update_node` … Each one changed the campaign for real: Brenn and a rumour on the canvas, a coin in the pool, new text in the tavern’s notes.\n\nEvery action is also in the **activity log** below, with the AI’s name on it. At the end it **suggests ideas** (💡) but never builds them unasked — that is what the *creativity* setting controls.',
  }),
  s('ai', {
    id: 'ai-undo', target: ['[data-tour="undo"]', '[data-tour="activity"]'], side: 'bottom',
    need: ['brenn'], enter: () => { calm(); app.tab = 'chat'; },
    title: 'You stay in charge: undo',
    body: 'Every step the AI took is **one undo step**. Press **Undo** (↶ in the top bar, or [[Ctrl]]+[[Z]]) and the last thing it did is taken back — you can even watch the card disappear.',
    action: () => {
      const n = app.history.length;
      return { text: 'Press Undo', done: () => app.history.length > n && /^Undo/.test(lastBatch()), auto: { label: 'Undo for me', run: () => void undo() } };
    },
  }),
  s('ai', {
    id: 'ai-redo', target: ['[data-tour="redo"]'], side: 'bottom',
    enter: () => { calm(); app.tab = 'chat'; },
    title: '… and redo',
    body: 'Changed your mind? **Redo** (↷, or [[Ctrl]]+[[Shift]]+[[Z]]) brings it back. You can step through the whole history this way.',
    action: () => {
      const n = app.history.length;
      return { text: 'Press Redo', done: () => app.history.length > n && /^Redo/.test(lastBatch()), auto: { label: 'Redo for me', run: () => void redo() } };
    },
  }),
  s('ai', {
    id: 'ai-modes', target: ['[data-tour="aimode"]', '[data-tour="creativity"]', '[data-tour="follow-ai"]'], side: 'bottom',
    enter: () => calm(),
    title: 'How much room the AI gets',
    body: '**live** — its edits stand until you undo them. **review** — they stay visible but wait for your *Keep* or *Reject* (let us try that in a moment).\n\n**creativity** goes from *exact* (does only what you ask) to *inventive* (adds twists and foreshadowing, additions only, and tells you what it added). **follow AI** lets the camera follow it around the canvas.',
  }),
  s('ai', {
    id: 'ai-review-on', target: ['[data-tour="aimode"]'], side: 'bottom',
    enter: () => calm(),
    title: 'Review mode',
    body: 'Switch **AI edits** to **review**. Then every request becomes one *change set* that you can keep or take back as a whole — handy when you let the AI loose on a big task.',
    action: () => ({
      text: 'Click “review”',
      done: () => app.meta.aiMode === 'review',
      auto: { label: 'Switch for me', run: () => void fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aiMode: 'review' }) }) },
    }),
  }),
  s('ai', {
    id: 'ai-review-send', target: ['[data-tour="chat-composer"]'], side: 'left', watch: true,
    need: ['anchor'],
    enter: async () => { calm(); app.tab = 'chat'; selectNode(null); await sleep(250); el('[data-tour="chat-composer"] textarea')?.focus(); void typeInto('chat', TOUR_MESSAGES.patrol); },
    title: 'Another request',
    body: 'Again a prepared request: *add a complication for after dark*. Send it.',
    action: () => ({
      text: 'Send the message',
      done: () => sent(TOUR_MESSAGES.patrol) && !app.chatStatus.busy && app.proposals.length > 0,
      auto: { label: 'Send it for me', run: async () => { app.fill = null; await sendChat(TOUR_MESSAGES.patrol); } },
    }),
  }),
  s('ai', {
    id: 'ai-review-decide', target: ['[data-tour="review-bar"]'], side: 'bottom', free: true,
    enter: () => { calm(); if (exists('night-patrol')) focusNode('night-patrol'); },
    title: 'Keep or reject',
    body: 'The new encounter is on the canvas with a dashed ✦ **new** mark, and the new connection is dashed too. The **review bar** lists the change set: *Show* jumps to it, **Keep** accepts it, **Reject** takes back exactly that set (and refuses if you edited the same things meanwhile, so nothing of yours is lost).',
    action: () => ({
      text: 'Press Keep or Reject',
      done: () => app.proposals.length === 0,
      auto: { label: 'Keep it for me', run: () => void cmd('accept_proposal', {}) },
    }),
  }),
  s('ai', {
    id: 'ai-review-off', target: ['[data-tour="aimode"]'], side: 'bottom',
    enter: () => calm(),
    title: 'Back to live',
    body: 'Switch back to **live** — in this mode the AI’s edits simply stand, and undo is your safety net.',
    action: () => ({
      text: 'Click “live”',
      done: () => (app.meta.aiMode ?? 'live') === 'live',
      auto: { label: 'Switch for me', run: () => void fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aiMode: 'live' }) }) },
    }),
  }),
  s('ai', {
    id: 'ai-thread', target: ['[data-tour="insp-ask"]'], side: 'left',
    need: ['brenn'], enter: async () => { calm(); pick('brenn'); await sleep(200); },
    title: 'Ask about one node',
    body: 'Every node has its own small chat at the bottom of the Inspector: *“give him a secret”*, *“what would he know about the ledger?”* The AI sees that node and the whole campaign. A pointer to the thread is left in the main chat.\n\nThe AI can also use your **rulebooks and world books** — see the Library chapter.',
  }),
];

// ---------------------------------------------------------------------------------------------------------------
// 6 · Pictures
// ---------------------------------------------------------------------------------------------------------------
const BRENN_PROMPT = 'Brenn the barkeep, a broad-shouldered bald man in his forties with a thick red-brown beard and a stained leather apron, polishing a tankard behind a tavern bar, a sly knowing smile, warm firelight.';

const images: TourStep[] = [
  s('images', {
    id: 'img-select', target: [card('brenn')], side: 'right', pad: 10,
    need: ['brenn'], enter: () => { calm(); selectNode(null); app.tab = 'inspector'; },
    title: 'Pictures for your nodes',
    body: 'Portraits, scenes, items and handouts are made with **ComfyUI** (a free image program that runs on your computer) and the **Krea 2** model. Let us give Brenn a face: select his card.',
    action: () => ({ text: 'Click “Brenn the barkeep”', done: () => app.selectedId === 'brenn', auto: { label: 'Select him for me', run: () => pick('brenn') } }),
  }),
  s('images', {
    id: 'img-panel', target: ['[data-tour="insp-images"]'], side: 'left',
    need: ['brenn'], enter: async () => { calm(); pick('brenn'); await sleep(250); void typeInto('image', BRENN_PROMPT, 'brenn', 6); },
    title: 'The Images panel',
    body: 'Pick a **kind** (portrait, scene, item, handout, banner — each has its own shape), how many **variants**, and describe the picture. The prompt is prepared from the node’s title and summary — I filled in a better one. The campaign’s **style** is added automatically, so every picture looks like it belongs to the same world.\n\n**✦ AI writes it** lets the AI read the node and write the prompt itself.',
  }),
  s('images', {
    id: 'img-generate', target: ['[data-tour="img-generate"]', '[data-tour="queue"]'], side: 'left', watch: true,
    need: ['brenn'], enter: () => { calm(); pick('brenn'); },
    title: 'Generate',
    body: 'Press **Generate**. The job joins the **queue** (one picture at a time, shown in the top bar and on the card) with a live progress bar.\n\nOn a real computer this takes about a minute; **in the tour it is sped up**.',
    action: () => {
      const n = app.nodes.brenn?.images.length ?? 0;
      return {
        text: 'Press Generate',
        done: () => (app.nodes.brenn?.images.length ?? 0) > n && activeJobs().length === 0,
        auto: { label: 'Generate for me', run: async () => { await cmd('generate_image', { nodeId: 'brenn', prompt: BRENN_PROMPT, kind: 'portrait', variants: 1 }); } },
      };
    },
  }),
  s('images', {
    id: 'img-result', target: ['[data-tour="insp-images"]', card('brenn')], side: 'left',
    need: ['brenn'], enter: () => { calm(); pick('brenn'); },
    title: 'The finished picture',
    body: 'The picture attached itself to the node — as an **undoable edit** like any other — and became the **cover** on the card. Click a picture for a big view; ★ makes another one the cover, ✕ detaches it.\n\nYou can ask for 1–4 variants and keep the one you like. Pictures can also be sent to your VTT as **handouts** (later).',
    action: () => ({ text: 'Click the picture to see it large', done: () => app.lightbox !== null, auto: { label: 'Open it for me', run: () => { const f = app.nodes.brenn?.images[0]; if (f) app.lightbox = { nodeId: 'brenn', file: f }; } } }),
    after: 'Close it with [[Esc]] or a click. Notice the tidy campaign look — that is the style, shared by every picture.',
  }),
  s('images', {
    id: 'img-settings', target: ['[data-tour="settings-modal"]'], side: 'left',
    enter: async () => { calm(); app.settingsOpen = true; await sleep(300); },
    title: 'Settings: ComfyUI and your style',
    body: 'The ⚙ button holds the connection to **ComfyUI**, the models, and the **image style** of the campaign (the words added to every prompt, what to avoid, how maps look). **✦ Generate from the world books** lets the AI derive a style from your lore.\n\nThis tour *pretends* to have ComfyUI. In your own campaigns you point this at yours — **docs/INSTALL.md** walks you through it. Everything except pictures works without it.',
  }),
];

export const aiChapters = [...ai, ...images];
void [click, el, waitFor];
