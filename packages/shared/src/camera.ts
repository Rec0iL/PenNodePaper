import type { MapDoc } from './mapdata.js';

// ---------------------------------------------------------------------------
// The camera of a map. It is a property of the MAP (the Paint tab), never of the campaign's image style: the style says how
// things look (materials, brush, palette), the map says what kind of map it is and from where it is seen.
// ---------------------------------------------------------------------------

/** default = the standard (battle maps: from straight above; region maps: the natural painted-map look), strict / plan = region maps only, custom = the GM's own words. */
export type MapView = 'default' | 'strict' | 'plan' | 'custom';
export const MAP_VIEWS: MapView[] = ['default', 'strict', 'plan', 'custom'];
export const CUSTOM_CAMERA_MAX = 300;

/** The GM's description of the camera, tidied up: one line, not endless, no closing full stop. */
export const cleanCameraText = (raw: unknown): string => String(raw ?? '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim().slice(0, CUSTOM_CAMERA_MAX);

/** Which camera a map has, as one comparable string (a change of it makes the prompts written for the old one stale). */
export const cameraKey = (m: Pick<MapDoc, 'view' | 'viewText'>): string => `${m.view && m.view !== 'custom' ? m.view : customCamera(m) ? 'custom' : 'default'}:${customCamera(m)}`;

/** The prompts the AI wrote for the groups were written for one camera: when it changes they are dropped (the GM's own stay). */
export function dropAiPrompts(m: Pick<MapDoc, 'propPrompts'>): void {
  if (!m.propPrompts) return;
  const keep = Object.fromEntries(Object.entries(m.propPrompts).filter(([, e]) => !e.ai));
  if (Object.keys(keep).length) m.propPrompts = keep;
  else delete m.propPrompts;
}

/** The GM's own camera for this map, or '' when the map uses a standard one (or "custom" without any words). */
export const customCamera = (m: Pick<MapDoc, 'view' | 'viewText'>): string => (m.view === 'custom' ? cleanCameraText(m.viewText) : '');

/** The GM's camera wording when there is one, else the standard wording of the place that asks. */
export const cameraOr = (m: Pick<MapDoc, 'view' | 'viewText'>, standard: string): string => customCamera(m) || standard;

// ------------------------------------------------------------ what the camera says everywhere ---

/** The wording of the built-in region views (the terrain pass); the standard view of a battle map needs none. */
const VIEW_TEXT = {
  default: 'A flat map, strictly straight down from above like a satellite image or a painted game map: no perspective, no horizon, no tilt, mountains and trees shown from above.',
  strict:
    'A plan view: the camera points straight down at 90 degrees, like an orthographic satellite image. No horizon, no sky, no tilt, no foreshortening. Mountains and hills are shown as top-down shaded relief with ridge lines, trees as round crowns seen from directly above, nothing is seen from the side.',
  plan:
    'A flat top-down topographic plan, drawn like a hillshaded survey map: strictly orthographic, camera straight down at 90 degrees, no horizon line, no sky, no clouds, no three-quarter or isometric view whatsoever. Relief is shown only by top-down hillshading and contour-like ridge lines; every tree is a round crown seen from directly above; coastlines and rivers are seen as plan outlines.',
} as const;
const VIEW_NEGATIVE = "three-quarter view, oblique view, isometric, side view, mountain icons seen from the side, horizon, sky, clouds, bird's-eye perspective, tilted camera, foreshortening";
/** The camera words every standard region painting rules out (the natural view too). */
const REGION_CAMERA_NEGATIVE = 'perspective, oblique view, tilted view, horizon, sky, aerial view from an angle';

/**
 * Everything the camera of a map says, for every place that writes a painting prompt: the whole-map prompts, the inpainting
 * of props / structures, the prompts the AI writes for them, and what the camera rules out. One table, so the standard
 * cameras and the GM's own all reach every stage the same way.
 */
export interface CameraProfile {
  /** the GM described the camera in their own words */
  custom: boolean;
  /** short wording in every whole-map prompt */
  look: string;
  /** region terrain pass: the longer wording of the view ('' for a battle map and for the GM's own camera, whose words are `look`) */
  terrain: string;
  /** header of every inpainted prop / structure prompt */
  prop: string;
  /** how the AI that writes the painting prompts is told the empty picture is seen (in brackets) … */
  writerView: string;
  /** … and how it should describe each object */
  writerAs: string;
  /** "a top-down tabletop battle map" / "…(its camera: …)": what the AI is told it prepares a picture for */
  kindNote: string;
  /** camera words the whole-map passes rule out (negative prompt) */
  negative: string;
  /** more of them, for the flat plan views */
  extraNegative: string;
  /** camera words the prop / structure passes rule out */
  propNegative: string;
}

export function cameraProfile(m: Pick<MapDoc, 'kind' | 'view' | 'viewText'>): CameraProfile {
  const words = customCamera(m);
  const region = m.kind === 'region';
  if (words) {
    return {
      custom: true, look: words, terrain: '', prop: words,
      writerView: words, writerAs: `as seen in the map's own view (${words})`,
      kindNote: `${region ? 'an overland (region) map' : 'a tabletop battle map'} (its camera: ${words})`,
      negative: '', extraNegative: '', propNegative: '',
    };
  }
  const look = 'seen from directly above, orthographic top-down view';
  if (!region) {
    return {
      custom: false, look, terrain: '', prop: 'top-down orthographic view from directly above',
      writerView: 'seen from directly above', writerAs: 'as seen from directly above',
      kindNote: 'a top-down tabletop battle map', negative: 'perspective view', extraNegative: '', propNegative: '',
    };
  }
  const view = m.view === 'strict' || m.view === 'plan' ? m.view : 'default';
  const flat = view !== 'default';
  return {
    custom: false, look, terrain: VIEW_TEXT[view],
    prop: view === 'strict' ? 'in plan view, the camera straight down at 90 degrees, orthographic, no tilt'
      : view === 'plan' ? 'drawn as a flat topographic survey-plan symbol, strictly from above, no tilt'
      : 'seen from high above, top-down',
    writerView: view === 'strict' ? 'seen straight down in plan view' : view === 'plan' ? 'seen straight down, as a flat survey plan' : 'seen from high above',
    writerAs: view === 'strict' ? 'as seen straight down in plan view, on a map' : view === 'plan' ? 'as flat survey-plan symbols seen straight down, on a map' : 'as seen from high above on a map',
    kindNote: 'a top-down overland (region) map',
    negative: REGION_CAMERA_NEGATIVE, extraNegative: flat ? VIEW_NEGATIVE : '', propNegative: 'perspective view',
  };
}

// ----------------------------------------------- keeping the style to the look ---

/** "battle map", "region map", "dungeon map", "battlemap", "floor plan" (with "tabletop RPG" in front): what KIND of map it is. */
const KIND_WORDS = /\b(?:(?:tabletop|table-top)\s+)?(?:rpg\s+)?(?:(?:battle|region|regional|overland|world|dungeon|floor)\s*-?\s*map|battlemap|floor\s*plan)s?\b/gi;

/** Words that name a camera or an angle (not "lit from above": that is lighting). */
const CAMERA_WORDS = new RegExp(
  [
    String.raw`\b(?:seen|viewed|shot|captured|photographed|looking|viewing)\s+(?:from|down|straight|directly|at|on)\b`,
    String.raw`\btop[- ]?down\b`, String.raw`\bbird'?s?[- ]?eye\b`, String.raw`\bisometric\b`, String.raw`\borthographic\b`, String.raw`\bthree[- ]quarter\b`,
    String.raw`\bplan view\b`, String.raw`\bside[- ]?(?:view|on)\b`, String.raw`\bcross[- ]section\b`, String.raw`\baerial\s+(?:view|shot)\b`,
    String.raw`\boverhead\s+(?:view|shot|camera|angle)\b`, String.raw`\b(?:camera|viewing|view)\s+angle\b`, String.raw`\bcamera\b`,
    String.raw`\bpoint of view\b`, String.raw`\bviewpoint\b`, String.raw`\bperspective\b`, String.raw`\bforeshortening\b`, String.raw`\boblique\s+(?:view|projection)\b`,
  ].join('|'),
  'i',
);

/** A clause that is nothing but an angle ("from above", "straight down"); "lit from above" is lighting and stays. */
const CAMERA_CLAUSE = /^(?:(?:from|looking|straight|directly)\s+)?(?:(?:directly|straight|high|right|way)\s+)?(?:above|overhead|down|up|the side|below|the top)$/i;

/**
 * What an image style may say about maps: only their LOOK. Every clause that names a camera or an angle is dropped, and so
 * are the words for the kind of map — the map brings both itself (see MapView). Works on style text written by hand or
 * by an AI, and on styles saved before the camera moved to the map.
 */
export function lookOnly(text: string): string {
  return text
    .replace(KIND_WORDS, ' ')
    .split(/\s*[,;]\s*/)
    .map((c) => c.replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, ''))
    .filter((c) => c && !CAMERA_WORDS.test(c) && !CAMERA_CLAUSE.test(c))
    .join(', ');
}
