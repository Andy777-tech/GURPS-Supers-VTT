import type { EdgeKey, MapModel } from '../../types/map';
import { boundaryBlocksSight, makeEdgeBlocker, resolveEdges } from '../../utils/mapEdges';
import type { EdgeBlocker, EdgeState } from '../../utils/mapEdges';

const resolvedCache = new WeakMap<MapModel, Map<EdgeKey, EdgeState>>();
const blockerCache = new WeakMap<MapModel, EdgeBlocker>();

export function selectResolvedEdges(map: MapModel): Map<EdgeKey, EdgeState> {
  let edges = resolvedCache.get(map);
  if (!edges) {
    edges = resolveEdges(map);
    resolvedCache.set(map, edges);
  }
  return edges;
}

export function selectEdgeBlocker(map: MapModel): EdgeBlocker | undefined {
  const edges = selectResolvedEdges(map);
  if (edges.size === 0 && !boundaryBlocksSight(map)) return undefined;
  let blocker = blockerCache.get(map);
  if (!blocker) {
    blocker = makeEdgeBlocker(map, edges, { boundaryBlocks: boundaryBlocksSight(map) });
    blockerCache.set(map, blocker);
  }
  return blocker;
}
