// ---------------------------------------------------------------------------
// Universal Push Format (UPF) + VTT capability profile + bridge protocol.
// PenNodePaper defines ONE fixed format for everything pushable; each VTT adapts
// to it on its own side and announces what it supports in its `hello` profile.
// Spec for VTT authors: docs/vtt-bridge-spec.md
// ---------------------------------------------------------------------------

export const BRIDGE_PROTOCOL = 1;

export interface UpfImage {
  name: string;
  mime: string;
  /** base64 of the raw file bytes */
  b64: string;
}

export interface UpfHandout {
  id: string;
  title: string;
  kind: 'text' | 'image';
  text?: string;
  image?: UpfImage;
  /** a player id the VTT knows; omitted = everyone (when revealed) */
  to?: string;
  /** show it to the players right away; otherwise only add it to the GM's handout library */
  reveal?: boolean;
}

export interface UpfScene {
  id: string;
  name: string;
  image: UpfImage;
  /** image size in px */
  width: number;
  height: number;
  grid: {
    type: 'square' | 'hex';
    /** cell size in px of `image` */
    size: number;
    offsetX: number;
    offsetY: number;
    /** true = do not draw the grid (an illustration shown as a backdrop, not a tactical map) */
    hidden?: boolean;
    /** real-world units per cell (e.g. 6) and the unit name */
    unitsPerCell: number;
    unit: string;
  };
  /** start positions; x/y are CELL coordinates (0,0 = top-left cell) */
  /** kinds: pc = player start marker (see profile.push.scene.playerStarts), npc/enemy = figures */
  tokens: { x: number; y: number; kind: 'pc' | 'npc' | 'enemy'; label?: string }[];
  /** make it the active scene for the players */
  activate?: boolean;
}

// --- characters: the VTT describes its own sheet structure ---------------------------------

export type FieldType = 'text' | 'longtext' | 'number' | 'boolean' | 'select' | 'tags' | 'list';

/** One field of a character sheet, as a VTT describes it. */
export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  /** select */
  options?: { value: string; label?: string }[];
  /** number */
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  required?: boolean;
  /** text fields: known values (e.g. skill names from the rule package) offered as autocomplete; not enforced */
  suggestions?: string[];
  /** UI section heading */
  group?: string;
  help?: string;
  /** list: the fields of every entry (e.g. a move = name + text) */
  item?: FieldSpec[];
  /** only relevant while another field has this value (e.g. a goon group size) */
  showIf?: { key: string; equals?: unknown; notEquals?: unknown };
}

/** A starting point with the game's own defaults (e.g. KINETIK's tiers goon … nemesis). */
export interface CharacterPreset {
  id: string;
  label: string;
  values: Record<string, unknown>;
  /** sensible bounds for this preset, per number field; used to warn, never to block */
  ranges?: Record<string, [number, number]>;
  help?: string;
}

/** A kind of character the VTT can receive (enemy, npc, …) and exactly how it is structured. */
export interface CharacterRole {
  id: string;
  label: string;
  description?: string;
  fields: FieldSpec[];
  presets?: CharacterPreset[];
  /** accepts a portrait image */
  portrait?: boolean;
  /** which kinds of node this role suits (default: the role whose id equals the node type); "pc" = the players' own characters, reported by the VTT */
  for?: ('enemy' | 'npc' | 'pc')[];
}

export interface UpfCharacter {
  id: string;
  /** one of the VTT's role ids */
  role: string;
  name: string;
  preset?: string;
  /** values keyed by the role's field keys — nothing else */
  sheet: Record<string, unknown>;
  /** GM-facing free text */
  notes?: string;
  portrait?: UpfImage;
  /** role "pc": the player at the table, and whether they are connected right now */
  playerName?: string;
  online?: boolean;
  /** offline bundles only: the id of the scene this character belongs on (the map of the place they live in) */
  scene?: string;
}

export interface UpfMusicCue {
  action: 'play' | 'stop';
  /** a track id from the VTT's own track list (see `tracks` request) */
  trackId?: string;
  /** free-text mood; the VTT may map it to a track or ignore it */
  mood?: string;
}

export interface UpfTrack {
  id: string;
  title: string;
  category?: string;
  /** uploaded by the GM (true) or shipped with the VTT (false) */
  uploaded?: boolean;
}

export type UpfPush =
  | { kind: 'handout'; payload: UpfHandout }
  | { kind: 'scene'; payload: UpfScene }
  | { kind: 'character'; payload: UpfCharacter }
  | { kind: 'music_cue'; payload: UpfMusicCue };

/** What a VTT announces about itself on connect (cached by PenNodePaper for offline use). */
export interface VttProfile {
  /** stable id, e.g. "kinetik-vtt" */
  id: string;
  name: string;
  version: string;
  protocol: number;
  push: {
    handout?: { text?: boolean; image?: boolean; toPlayer?: boolean };
    /** playerStarts: the VTT wants player start markers (pc tokens). Default false: players are added in the VTT itself. */
    scene?: { grids: ('square' | 'hex')[]; tokens?: boolean; playerStarts?: boolean };
    /** the VTT can receive pushed characters (the structure itself is in `profile.characters`) */
    character?: Record<string, never>;
    music_cue?: { tracks?: boolean; mood?: boolean };
  };
  /**
   * How characters are structured in this game system. Independent of `push.character`: a VTT that
   * cannot import characters (yet) can still describe them, so the AI can write characters the GM reads.
   */
  characters?: { roles: CharacterRole[] };
  /** What the VTT can REPORT to PenNodePaper (the other direction of `push`). party: the players' characters, requested on connect and re-sent whenever they change. */
  provides?: { party?: boolean };
  requests?: ('tracks' | 'party')[];
  images?: { maxBytes?: number; formats?: string[] };
  /** offline file import: which converter understands this VTT (e.g. "kinetik-session") */
  file?: { kind: string; version: number };
}

// --- bridge messages ---------------------------------------------------------------------

export type BridgeFromVtt =
  | { t: 'hello'; protocol: number; profile: VttProfile }
  | { t: 'result'; id: string; ok: boolean; error?: string; data?: unknown }
  /** unsolicited: the full list of the players' characters, sent when anything about the party changes */
  | { t: 'party'; characters: UpfCharacter[] };

export type BridgeToVtt =
  | { t: 'welcome'; protocol: number; app: 'pennodepaper'; campaign: string }
  | ({ t: 'push'; id: string } & UpfPush)
  | { t: 'request'; id: string; what: 'tracks' | 'party' };

export interface VttStatus {
  connected: boolean;
  profile: VttProfile | null;
  source: 'live' | 'cached' | 'none';
  cached: VttProfile[];
}
