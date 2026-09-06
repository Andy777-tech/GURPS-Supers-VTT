import { describe, expect, it } from 'vitest';
import { imageState } from '../../../assets/__tests__/fixtures';
import { campaignReducer } from '../../campaignReducer';
import { edgeKey } from '../../../utils/mapEdges';
import { selectEdgeBlocker, selectResolvedEdges } from '../mapEdges';

describe('edge selectors', () => {
  it('memoizes by map identity and refreshes both caches after a reducer change', () => {
    const { state, map } = imageState([]);
    const edges = selectResolvedEdges(map);
    expect(selectResolvedEdges(map)).toBe(edges);
    expect(selectEdgeBlocker(map)).toBeUndefined();
    const next = campaignReducer(state, {
      type: 'map/setEdgeOverride', payload: {
        mapId: map.id, edgeKey: edgeKey(map.grid[2][2], map.grid[2][3]), override: { kind: 'wall' },
      },
    }).maps.mapsById[map.id];
    expect(selectResolvedEdges(next)).not.toBe(edges);
    expect(selectResolvedEdges(next)).toBe(selectResolvedEdges(next));
    expect(selectEdgeBlocker(next)).toBe(selectEdgeBlocker(next));
    expect(selectEdgeBlocker(next)?.({ row: 2, col: 2 }, { row: 2, col: 3 })).toBe(true);
    expect(selectResolvedEdges(map)).toBe(edges);
  });
});
