import { app, cmd, selectNode } from '../app.svelte';
import { calm, card, click, el, pick, sleep, typeInto, waitFor, type TourStep } from './kit';

const s = (chapter: string, step: Omit<TourStep, 'chapter'>): TourStep => ({ chapter, ...step });

const TAVERN = 'the-rusty-anchor';
const COAST = 'greywater-coast';
const PLACE = 'The Rusty Anchor, a rough medieval harbour tavern: a big taproom with worn planks, a stone-floored kitchen and a plank-floored store room. Warm lantern light, salt-stained dark wood, thick stone walls.';

/** What the server holds for the map (the editor keeps its own copy; the tour needs the painted results). */
const mapState = { terrains: [] as string[], pick: '', renders: [] as string[], at: 0, busy: false };
async function refreshMap(force = false) {
  if (mapState.busy || (!force && Date.now() - mapState.at < 300)) return;
  mapState.busy = true;
  try {
    const j = await (await fetch(`/api/maps/${TAVERN}`)).json();
    mapState.terrains = j.map?.terrains ?? [];
    mapState.pick = j.map?.terrainPick ?? '';
    mapState.renders = j.map?.renders ?? [];
  } catch { /* keep the last */ }
  mapState.at = Date.now();
  mapState.busy = false;
}
const openMap = (id = TAVERN) => (app.mapEditor = { mapId: id });
const mapOpen = (id = TAVERN) => app.mapEditor?.mapId === id;
/** the editor is on screen and has loaded its map */
const editorReady = () => waitFor(() => !!el('[data-tour="map-modal"]') && !!el('[data-tour="map-tools"]'), 5000);

const maps: TourStep[] = [
  s('maps', {
    id: 'map-open', target: [card('rusty-anchor'), '[data-tour="insp-map"]'], side: 'bottom', pad: 10,
    need: ['anchor'], enter: async () => { calm(); pick('rusty-anchor'); await refreshMap(true); },
    title: 'A place with a map',
    body: 'Places can carry a **map**. The ⌗ **map** badge on the card says this one has: the tavern’s floor plan, drawn on a grid. (No badge? The Inspector’s *＋ Battle map* / *＋ Region map* make one.)\n\nOpen it from the badge, from the Inspector’s **Open the map of this place** button, or by clicking the card’s ⌗ badge.',
    action: () => ({ text: 'Click “⌗ map” on the card', done: () => mapOpen(), auto: { label: 'Open it for me', run: () => openMap() } }),
  }),
  s('maps', {
    id: 'map-editor', target: ['[data-tour="map-view"]'], side: 'left', pad: 0,
    enter: async () => { calm({ map: true }); if (!mapOpen()) openMap(); await editorReady(); },
    title: 'The map editor',
    body: 'This is the tavern as a **plan**: a taproom, a kitchen and a store room, with tables, chairs, barrels and a fireplace. The editor **saves by itself** and shares its undo steps with the AI, so you and the co-GM can work on one map at the same time.\n\nScroll to zoom, hold [[Space]] and drag to move, or drag with the middle mouse button.',
  }),
  s('maps', {
    id: 'map-tools', target: ['[data-tour="map-tools"]'], side: 'right',
    enter: async () => { calm({ map: true }); if (!mapOpen()) openMap(); await editorReady(); },
    title: 'Drawing tools',
    body: '**Select** moves and edits what is drawn (drag, arrow keys, [[R]] rotates, [[Ctrl]]+[[D]] duplicates). **Room** drags a rectangle with walls; **Paint** and **Erase** work cell by cell; **Door**, **Wall**, **Prop** (furniture), **Label** and **Token** (where figures start) do what they say.\n\nWalls are **derived** from the floor, so you never draw them by hand.',
  }),
  s('maps', {
    id: 'map-views', target: ['[data-tour="map-views"]', '[data-tour="map-tabs"]'], side: 'bottom',
    enter: async () => { calm({ map: true }); if (!mapOpen()) openMap(); await editorReady(); },
    title: 'Plan, input, painted',
    body: '**Plan** is what you edit. **Terrain input** and **Painted** show what the image model gets and what it made, once you paint. The **Paint** tab on the right turns your plan into a painted battle map; **Map** holds grid size, feet per cell and tokens.',
  }),
  s('maps', {
    id: 'map-cast', target: ['[data-tour="map-tab-cast"]'], side: 'left',
    need: ['brenn'],
    enter: async () => { calm({ map: true }); if (!mapOpen()) openMap(); await editorReady(); click('[data-tour="map-tab-cast"]'); },
    title: 'Characters on the map',
    body: 'The **Characters** tab lists the NPCs and enemies that **belong to** this place on the canvas — Brenn, now that the AI made him. Pick one and click a cell: that token **is** Brenn, not just a marker (a white ring shows the link).\n\nWhen the map goes to your VTT, those characters go with it, and every token is tied to its entry there — the enemies are already in the combat list with their stat blocks instead of you creating them by hand.',
  }),
  s('maps', {
    id: 'map-modes', target: ['[data-tour="map-mode"]'], side: 'left',
    enter: async () => { calm({ map: true }); if (!mapOpen()) openMap(); await editorReady(); click('[data-tour="map-tab-paint"]'); },
    title: 'Two ways to paint',
    body: 'A computer’s idea of a floor plan with furniture is messy: in **one pass** props drift, merge or vanish. So there are two ways, chosen once in **⚙ Settings → Map painting**:\n\n**Quick (1 step)** — everything in one pass, about a minute or two.\n**Precise (2 steps)** — ① the **empty place** first, ② then every **prop group painted into exactly its spot**. You judge after each step. It takes a while, which is why the panel tells you how long it will take on your computer.\n\nThe tour uses **precise** — and plays it back in seconds, although the panel quotes the minutes your computer would need.',
  }),
  s('maps', {
    id: 'map-terrain', target: ['[data-tour="map-prompt"]', '[data-tour="map-terrain-btn"]'], side: 'left', watch: true,
    need: ['anchor'],
    enter: async () => { calm({ map: true }); if (!mapOpen()) openMap(); await editorReady(); click('[data-tour="map-tab-paint"]'); await sleep(200); void typeInto('map', PLACE, undefined, 5); await refreshMap(true); },
    title: 'Step ①: the empty terrain',
    body: 'Describe what the place **looks like** — materials, mood, light; not the layout, that comes from your plan. I wrote one for you. The AI then turns it into a description of the *empty* shell, so the model does not invent furniture.\n\nPress **Paint the terrain**. With *2×* you get two candidates to choose from.',
    action: () => {
      const n = mapState.terrains.length;
      return {
        text: 'Press “Paint the terrain”',
        done: () => { void refreshMap(); return mapState.terrains.length >= n + 2 && !app.jobs.some((j) => j.kind === 'map' && (j.status === 'running' || j.status === 'queued')); },
        auto: { label: 'Paint it for me', run: async () => { app.fill = null; await cmd('render_map', { mapId: TAVERN, prompt: PLACE, fidelity: 'balanced', variants: 2 }); } },
      };
    },
  }),
  s('maps', {
    id: 'map-pick', target: ['[data-tour="map-terrains"]'], side: 'left',
    enter: async () => { calm({ map: true }); if (!mapOpen()) openMap(); await editorReady(); click('[data-tour="map-tab-paint"]'); await refreshMap(true); },
    need: ['maps-terrain'],
    title: 'Choose a terrain',
    body: 'Two empty versions of the same tavern: same walls, same doors, different mood. **Click the one you like**; it is marked ✓ and becomes the base for step ②. You can paint more candidates until one fits.\n\nThe **Terrain** view button at the top shows your pick across the whole map.',
    action: () => ({
      text: 'Click a terrain',
      done: () => { void refreshMap(); return !!mapState.pick; },
      auto: { label: 'Choose one for me', run: async () => { await refreshMap(true); const f = mapState.terrains.at(-1); if (f) await cmd('set_map_terrain', { mapId: TAVERN, file: f }); } },
    }),
  }),
  s('maps', {
    id: 'map-props', target: ['[data-tour="map-groups"]', '[data-tour="map-props-btn"]'], side: 'left', watch: true,
    enter: async () => { calm({ map: true }); if (!mapOpen()) openMap(); await editorReady(); click('[data-tour="map-tab-paint"]'); await refreshMap(true); },
    title: 'Step ②: the props, spot by spot',
    body: 'Every prop **group** is now painted into exactly its place, one after the other, each with its own prompt. **Touching props of the same kind are one object**: a row of tables becomes one long table, five barrels in a row stay five barrels. Tick *show the groups on the plan* to see them. When the last prop is in, one more pass **blends them into the floor**: shadows appear and edges settle, while the objects themselves stay exactly as painted (a tick box under the button switches it off).\n\nPress **Paint the props**. A map with many groups takes a while for real — here it is sped up.',
    action: () => {
      const n = mapState.renders.length;
      return {
        text: 'Press “Paint the props on the chosen terrain”',
        done: () => { void refreshMap(); return mapState.renders.length > n && !app.jobs.some((j) => j.kind === 'map' && (j.status === 'running' || j.status === 'queued')); },
        auto: { label: 'Paint them for me', run: async () => { app.fill = null; await cmd('paint_map_props', { mapId: TAVERN, prompt: PLACE }); } },
      };
    },
  }),
  s('maps', {
    id: 'map-result', target: ['[data-tour="map-view"]', '[data-tour="map-views"]'], side: 'left', pad: 0,
    enter: async () => {
      calm({ map: true }); if (!mapOpen()) openMap(); await editorReady(); await refreshMap(true);
      click('[data-tour="map-view-painted"]');
    },
    need: ['maps-props'],
    title: 'The painted map',
    body: 'There it is — the plan, painted, with every prop where you put it. Use **Plan / Terrain / Painted** to flip between them. Not happy? Paint the props again for a new variation, or pick another terrain; every result stays in **Painted versions**.\n\n**Just one object came out wrong** — a fused chair, a melted barrel? Open *Painting prompts of the groups* in the Paint tab and press **↻ paint this one again** on that group: only it is painted again, on the finished picture, and the new version is added next to the old one.\n\nThe picture also became the **cover of the place’s card**, and it is what you send your players as the map.',
  }),
  s('maps', {
    id: 'map-settings', target: ['[data-tour="settings-map-modes"]'], side: 'left',
    enter: async () => { calm({ settings: true }); app.mapEditor = null; app.settingsOpen = true; await waitFor(() => !!el('[data-tour="settings-map-modes"]')); },
    title: 'Quick or precise',
    body: 'Here is the choice, in **⚙ Settings → Map painting** — a setting of *this computer*, because it depends on how fast your graphics card is.\n\n**Quick** is one pass: fine for a rough scene or a weak card. **Precise** costs about 1½ minutes for the terrain plus ~40 s per prop group on a 16 GB card — for the maps you will print or put on the table. Region maps work in steps too.\n\nChange it here to compare: the tour’s next “Paint it” will use the other way. (Region maps work in steps too: the land with its rivers and roads first, then every structure.)',
  }),
  s('maps', {
    id: 'map-region', target: ['[data-tour="map-view"]', '[data-tour="map-tab-draw"]'], side: 'left', pad: 0,
    enter: async () => { calm({ map: true }); openMap(COAST); await editorReady(); click('[data-tour="map-tab-draw"]'); },
    title: 'Region maps: land, lines, places',
    body: 'The other kind: **region maps** — a sketch for a coast, a country or a town, in three layers:\n\n**Terrain** areas (sea, forest, hills, desert, snow…), **lines** (rivers, roads, railways, paths, bridges) and **structures** — a city, a camp, a hospital. A place is always an **area**, never a dot: draw or stamp it as big as it should be.\n\nThe **Draw** tab on the right holds the palette. This one is the coast around Greywater.',
  }),
  s('maps', {
    id: 'map-region-draw', target: ['[data-tour="map-tools"]', '[data-tour="map-tab-draw"]'], side: 'right',
    enter: async () => { calm({ map: true }); if (!mapOpen(COAST)) openMap(COAST); await editorReady(); click('[data-tour="map-tab-draw"]'); },
    title: 'Lines with a width, places that fit',
    body: '**Line** draws a multi-point path — click points, double-click to finish — and its **width is yours**: set it in the Draw tab before you draw or change it afterwards. **Stamp** puts a structure of its usual size with one click, or drag outwards to size it.\n\n**Select** a shape to rename it, tell the painter what you want there (“a burnt-out camp”), change its kind or width, or drag its white corners to reshape it.\n\n**＋ Your own type…** adds terrain, lines or structures of your own — a *radioactive crater*, a *ley line*, a *wizard tower* — to the campaign; every region map can use them, and so can the AI.',
  }),
  s('maps', {
    id: 'map-region-paint', target: ['[data-tour="map-tab-paint"]', '[data-tour="map-view"]'], side: 'left', pad: 0,
    enter: async () => { calm({ map: true }); if (!mapOpen(COAST)) openMap(COAST); await editorReady(); click('[data-tour="map-tab-paint"]'); },
    title: 'Painting a region map',
    body: 'The same precise steps, tuned for land: **①** the land is painted first, **without** the rivers and roads, so the model cannot invent or lose them — then each **river** and **road** is painted exactly along the path you drew, one kind after the other. **②** every structure is painted into its own area, in the style of your world (a camp is tipis, yurts or canvas tents, depending on the world). **③** a last pass blends them in.\n\n**Camera** decides how flat the land looks: natural painted-map look, straight top-down, or a hillshaded survey map. Each pass is about a minute on a 16 GB card, so a map with ten structures takes around a quarter of an hour; you accept or repaint after every step.',
  }),
  s('maps', {
    id: 'map-close', target: [card('rusty-anchor'), '[data-tour="insp-map"]'], side: 'right',
    enter: async () => { calm(); pick('rusty-anchor'); },
    title: 'Where the map goes next',
    body: 'Back on the canvas the tavern now wears its painted map. From here the map can be **pushed to your VTT** (grid, token starts and all), printed in the **GM binder**, or shown to the players as a backdrop. Locations can hold both a *picture* of a place and its *tactical map*.',
  }),
];

export const mapsChapter = maps;
void [selectNode, COAST];
