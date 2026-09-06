import type { EdgeKey, EdgeOverride, ImageLayerId, MapModel, TileId } from '../types/map';
import { findTileGridPos, getTileIdAt } from './mapUtils';
import { indexFootprints } from './footprints';
import type { FootprintIndex } from './footprints';

export type EdgeState = EdgeOverride & { layerIds: ImageLayerId[]; derived: boolean };
export type EdgeBlocker = (a: { row: number; col: number }, b: { row: number; col: number }) => boolean;

export function edgeKey(a: TileId, b: TileId): EdgeKey {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function splitEdgeKey(key: EdgeKey): [TileId, TileId] {
  const [a, b] = key.split('|');
  return [a, b];
}

const SIDES: ReadonlyArray<[dr: number, dc: number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * Derive the boundary edges of every footprint: an edge between a footprint
 * tile and an orthogonal neighbour that is not in the same footprint. Tiles
 * on the map border have no neighbour on that side and therefore no edge —
 * the paint-expansion buffer is expected to keep footprints off the border.
 */
export function deriveBoundaryEdges(
  map: Pick<MapModel, 'grid' | 'rows' | 'cols'>,
  index: FootprintIndex
): Map<EdgeKey, ImageLayerId[]> {
  const edges = new Map<EdgeKey, ImageLayerId[]>();
  for (const [layerId, tiles] of index.byLayer) {
    for (const tileId of tiles) {
      const pos = findTileGridPos(map, tileId);
      if (!pos) continue;
      for (const [dr, dc] of SIDES) {
        const neighbour = getTileIdAt(map, pos.row + dr, pos.col + dc);
        if (!neighbour || tiles.has(neighbour)) continue;
        const key = edgeKey(tileId, neighbour);
        const owners = edges.get(key);
        if (owners) {
          if (!owners.includes(layerId)) owners.push(layerId);
        } else {
          edges.set(key, [layerId]);
        }
      }
    }
  }
  return edges;
}

/** Effective edge states: derived walls, then overrides (which may also add free-standing walls). */
export function resolveEdges(
  map: Pick<MapModel, 'grid' | 'rows' | 'cols' | 'imageLayers' | 'edgeOverrides'>,
  index: FootprintIndex = indexFootprints(map)
): Map<EdgeKey, EdgeState> {
  const states = new Map<EdgeKey, EdgeState>();
  for (const [key, layerIds] of deriveBoundaryEdges(map, index)) {
    states.set(key, { kind: 'wall', layerIds, derived: true });
  }
  for (const [key, override] of Object.entries(map.edgeOverrides ?? {})) {
    const existing = states.get(key);
    if (override.kind === 'open' && !existing) continue; // open-on-open: nothing to show
    states.set(key, { ...override, layerIds: existing?.layerIds ?? [], derived: existing?.derived ?? false });
  }
  return states;
}

/** Double-click cycle: wall → door (closed) → open → wall. */
export function cycleEdge(current: EdgeOverride['kind']): EdgeOverride {
  switch (current) {
    case 'wall': return { kind: 'door', state: 'closed' };
    case 'door': return { kind: 'open' };
    default: return { kind: 'wall' };
  }
}

/**
 * The override to store after a cycle. Returns null when the new state equals
 * the derived state (so the map does not accumulate no-op overrides).
 */
export function nextOverride(state: EdgeState | undefined): EdgeOverride | null {
  const next = cycleEdge(state?.kind ?? 'open');
  const derivedKind = state?.derived ? 'wall' : 'open';
  return next.kind === derivedKind ? null : next;
}

export function edgeBlocksSight(state: EdgeState | undefined): boolean {
  if (!state) return false;
  if (state.kind === 'wall') return true;
  if (state.kind === 'door') return state.state !== 'open';
  return false;
}

/**
 * Sight-blocking predicate for the LOS walker. A diagonal step is blocked only
 * when *both* L-shaped orthogonal routes around the corner are blocked.
 */
export function makeEdgeBlocker(
  map: Pick<MapModel, 'grid' | 'rows' | 'cols'>,
  states: Map<EdgeKey, EdgeState>
): EdgeBlocker {
  const blockedBetween = (r1: number, c1: number, r2: number, c2: number): boolean => {
    const a = getTileIdAt(map, r1, c1);
    const b = getTileIdAt(map, r2, c2);
    if (!a || !b) return false;
    return edgeBlocksSight(states.get(edgeKey(a, b)));
  };
  return (a, b) => {
    const dr = b.row - a.row;
    const dc = b.col - a.col;
    if (dr === 0 && dc === 0) return false;
    if (dr === 0 || dc === 0) return blockedBetween(a.row, a.col, b.row, b.col);
    const viaRow = blockedBetween(a.row, a.col, b.row, a.col) || blockedBetween(b.row, a.col, b.row, b.col);
    const viaCol = blockedBetween(a.row, a.col, a.row, b.col) || blockedBetween(a.row, b.col, b.row, b.col);
    return viaRow && viaCol;
  };
}

/** Door click policy shared by exploration and combat. Undefined means no mutation. */
export function doorClickOverride(
  state: EdgeState | undefined,
  isGm: boolean,
  shiftKey = false
): EdgeOverride | undefined {
  if (state?.kind !== 'door') return undefined;
  if (shiftKey) {
    return isGm ? { kind: 'door', state: state.state === 'locked' ? 'closed' : 'locked' } : undefined;
  }
  if (state.state === 'locked' && !isGm) return undefined;
  return { kind: 'door', state: state.state === 'open' ? 'closed' : 'open' };
}
