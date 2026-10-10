import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// The pictures the welcome tour plays back. They were made once with the real pipelines (ComfyUI / Krea 2, the
// same quick and precise map painting you get in the app) and are shipped with it as small JPEGs, so the tour
// needs no ComfyUI and no AI. `scripts/make-tutorial-assets.ts` makes them again.
// ---------------------------------------------------------------------------

export const ASSET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/tutorial');

export interface TutorialPicture {
  file: string;
  /** the node this picture was made for (it is what "Generate" returns for that node) */
  nodeId?: string;
  kind: 'portrait' | 'scene' | 'item' | 'handout' | 'banner' | 'square';
  /** the prompt it was made with (shown as the Inspector's suggestion) */
  prompt: string;
}

/** Pictures for nodes. Those with `seed: true` are already on their cards when the tour starts. */
export const PICTURES: (TutorialPicture & { seed?: boolean })[] = [
  { file: 'arrival.jpg', nodeId: 'arrival', kind: 'scene', seed: true, prompt: 'A fog-bound harbour town at dusk seen from an arriving ferry: a wooden pier vanishing into thick fog, a few lit lanterns, a tall clock tower with a faintly green face looming over the rooftops, wet cobbles and moored fishing boats.' },
  { file: 'orla.jpg', nodeId: 'harbour-master', kind: 'portrait', seed: true, prompt: 'Harbour Master Orla, a gruff weathered woman in her fifties in a salt-stained oilskin coat with a brass harbour-master badge, tired sharp eyes and a grey-streaked braid, lit by a desk lantern.' },
  { file: 'brenn.jpg', nodeId: 'brenn', kind: 'portrait', prompt: 'Brenn the barkeep, a broad-shouldered bald man in his forties with a thick red-brown beard and a stained leather apron, polishing a tankard behind a tavern bar, a sly knowing smile, warm firelight.' },
  { file: 'rusty-anchor.jpg', nodeId: 'rusty-anchor', kind: 'scene', prompt: 'A rough dockside tavern at night, a rusty iron anchor hanging over the door as its sign, warm light spilling from salt-stained windows onto wet cobbles, drifting fog and moored boats behind.' },
  { file: 'tamm.jpg', nodeId: 'old-fisherman', kind: 'portrait', prompt: 'Old fisherman Tamm, a wiry elderly man with deep weather wrinkles, white stubble and a knitted cap, a fishing net over one shoulder, squinting out to sea in grey dawn light.' },
  { file: 'ledger.jpg', nodeId: 'dockside-hand', kind: 'handout', prompt: 'A torn half page of an old shipping ledger on dark wood: yellowed paper with handwritten columns of dates and cargo, ink stains, burnt edges and a fragment of a wax seal showing a small bell crest.' },
  { file: 'penny.jpg', nodeId: 'black-penny', kind: 'item', prompt: 'A single tarnished black coin, a black penny with a tiny bell stamped on it, lying on a worn wooden table, shallow depth of field, dramatic side light.' },
  { file: 'cove.jpg', nodeId: 'smugglers-cove', kind: 'scene', prompt: 'A smugglers\' cove at night: a hidden shingle beach under tall black cliffs, a rowing boat being unloaded by lantern light, crates and barrels on the stones, rough surf.' },
];

export interface TutorialMapAssets {
  /** the one-pass ("quick") painting */
  quick: string;
  /** step 1: candidates for the empty terrain, and for each the finished painting of step 2 */
  terrains?: string[];
  finals?: string[];
}

/** The two painted maps of the practice campaign. */
export const MAP_ASSETS: Record<string, TutorialMapAssets> = {
  'the-rusty-anchor': { quick: 'rusty-anchor-quick.jpg', terrains: ['rusty-anchor-terrain-a.jpg', 'rusty-anchor-terrain-b.jpg'], finals: ['rusty-anchor-final-a.jpg', 'rusty-anchor-final-b.jpg'] },
  'greywater-coast': { quick: 'greywater-coast.jpg' },
};

export const TAVERN_MAP = 'the-rusty-anchor';
export const COAST_MAP = 'greywater-coast';

export const assetPath = (file: string) => path.join(ASSET_DIR, file);
export const hasAsset = (file: string) => fs.existsSync(assetPath(file));
export const readAsset = (file: string) => fs.readFileSync(assetPath(file));

/** Copy a shipped picture into a campaign's images folder (once). Returns false when the file is not part of this install. */
export function installPicture(imagesDir: string, file: string): boolean {
  if (!hasAsset(file)) return false;
  fs.mkdirSync(imagesDir, { recursive: true });
  const to = path.join(imagesDir, file);
  if (!fs.existsSync(to)) fs.copyFileSync(assetPath(file), to);
  return true;
}
