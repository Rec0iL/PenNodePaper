import type { TourStep } from './kit';
import { basics } from './steps-basics';
import { aiChapters } from './steps-ai';
import { mapsChapter } from './steps-maps';
import { sessionChapters } from './steps-session';

export interface Chapter {
  id: string;
  title: string;
  /** a line for the chapter menu */
  blurb: string;
  /** minutes, roughly */
  mins: number;
}

export const CHAPTERS: Chapter[] = [
  { id: 'welcome', title: 'Welcome', blurb: 'What this is, and how the tour works', mins: 1 },
  { id: 'screen', title: 'Find your way around', blurb: 'Canvas, pool, side panel, activity log', mins: 2 },
  { id: 'nodes', title: 'Nodes', blurb: 'Select, write, read aloud, enlarge, create', mins: 3 },
  { id: 'connect', title: 'Pool & connections', blurb: 'Bring things into the story and wire them up', mins: 2 },
  { id: 'ai', title: 'The AI co-GM', blurb: 'Ask, watch, undo, review', mins: 4 },
  { id: 'images', title: 'Pictures', blurb: 'Portraits and scenes with ComfyUI', mins: 2 },
  { id: 'maps', title: 'Maps', blurb: 'Battle maps in one or two steps, region maps', mins: 4 },
  { id: 'structure', title: 'Frames & canvases', blurb: 'Structure a big story', mins: 3 },
  { id: 'session', title: 'Running a session', blurb: 'Players, the Story tab, getting back on track, tables, clocks', mins: 5 },
  { id: 'library', title: 'Library', blurb: 'Rulebooks and world books', mins: 1 },
  { id: 'vtt', title: 'Players & your VTT', blurb: 'Handouts, maps, NPCs and music to the table', mins: 2 },
  { id: 'finish', title: 'Safety net & finish', blurb: 'Search, backups, the GM binder, a real AI', mins: 2 },
];

const all: TourStep[] = [...basics, ...aiChapters, ...mapsChapter, ...sessionChapters];

// the order of the chapters is the order of the list above; within a chapter the steps keep the order they were written in
const order = CHAPTERS.map((c) => c.id);
export const STEPS: TourStep[] = all.map((s, i) => ({ s, i })).sort((a, b) => order.indexOf(a.s.chapter) - order.indexOf(b.s.chapter) || a.i - b.i).map((x) => x.s);
