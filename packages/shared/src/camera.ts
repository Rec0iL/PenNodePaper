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

/** The GM's own camera for this map, or '' when the map uses a standard one (or "custom" without any words). */
export const customCamera = (m: Pick<MapDoc, 'view' | 'viewText'>): string => (m.view === 'custom' ? cleanCameraText(m.viewText) : '');

/** The GM's camera wording when there is one, else the standard wording of the place that asks. */
export const cameraOr = (m: Pick<MapDoc, 'view' | 'viewText'>, standard: string): string => customCamera(m) || standard;

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
