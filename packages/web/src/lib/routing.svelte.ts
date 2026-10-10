// Edge routing state: the canvas computes the routes of all connections once (see @pnp/shared routeEdges),
// each StoryEdge looks its own up. A per-browser switch turns the whole thing off.
import type { EdgeRoute } from '@pnp/shared';
import { remember } from './app.svelte';

const KEY = 'pnp.edgeRouting';
function saved(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export const routing = $state({ on: saved(), routes: new Map<string, EdgeRoute>() });

export function setRouting(on: boolean) {
  routing.on = on;
  remember(KEY, on ? '1' : '0');
}
