import { describe, expect, it } from 'vitest';
import { campaignReducer } from '../../campaignReducer';
import { imageLayer, imageState } from '../../../assets/__tests__/fixtures';
import { defaultFootprint } from '../../../utils/footprints';
import { edgeKey, nextOverride, resolveEdges } from '../../../utils/mapEdges';
import { expandMap } from '../../../utils/mapUtils';
import type { EdgeOverride } from '../../../types/map';

function setup() {
  return imageState([imageLayer({ id: 'A', x: 1, y: 1, footprint: defaultFootprint(4, 3) })]);
}

describe('edge override reducer', () => {
  it('creates lazily, sets, replaces, deletes, and ignores a missing map', () => {
    const { state, map } = setup();
    const key = edgeKey(map.grid[2][4], map.grid[2][5]);
    expect(map.edgeOverrides).toBeUndefined();
    const set = (override: EdgeOverride | null, current = state, mapId = map.id) => campaignReducer(current, {
      type: 'map/setEdgeOverride', payload: { mapId, edgeKey: key, override },
    });
    const first = set({ kind: 'door', state: 'closed' });
    expect(first.maps.mapsById[map.id].edgeOverrides?.[key]).toEqual({ kind: 'door', state: 'closed' });
    const replaced = set({ kind: 'door', state: 'open' }, first);
    expect(replaced.maps.mapsById[map.id].edgeOverrides?.[key]).toEqual({ kind: 'door', state: 'open' });
    expect(set(null, replaced).maps.mapsById[map.id].edgeOverrides).toEqual({});
    expect(set(null).maps.mapsById[map.id].edgeOverrides).toBeUndefined();
    expect(set({ kind: 'wall' }, state, 'missing')).toBe(state);
  });

  it('GM cycle on open ground stores a free-standing wall', () => {
    const { state, map } = setup();
    const key = edgeKey(map.grid[6][2], map.grid[6][3]);
    const next = campaignReducer(state, {
      type: 'map/setEdgeOverride', payload: { mapId: map.id, edgeKey: key, override: nextOverride(resolveEdges(map).get(key)) },
    });
    expect(resolveEdges(next.maps.mapsById[map.id]).get(key)).toEqual({ kind: 'wall', layerIds: [], derived: false });
  });

  it('preserves every override key and effective state on expansion', () => {
    const { map } = setup();
    map.edgeOverrides = {
      [edgeKey(map.grid[2][4], map.grid[2][5])]: { kind: 'door', state: 'locked' },
      [edgeKey(map.grid[1][0], map.grid[1][1])]: { kind: 'open' },
      [edgeKey(map.grid[6][2], map.grid[6][3])]: { kind: 'wall' },
      [edgeKey(map.grid[7][2], map.grid[7][3])]: { kind: 'open' },
    };
    const expanded = expandMap(map, { top: 2, left: 1, right: 0, bottom: 0 });
    expect(expanded.edgeOverrides).toEqual(map.edgeOverrides);
    const before = resolveEdges(map);
    const after = resolveEdges(expanded);
    expect(after).toEqual(before);
    for (const key of Object.keys(map.edgeOverrides)) expect(after.get(key)).toEqual(before.get(key));
  });

  it('leaves doors in place after a layer moves, rotates, or is deleted', () => {
    const { state, map } = setup();
    const key = edgeKey(map.grid[2][4], map.grid[2][5]);
    map.edgeOverrides = { [key]: { kind: 'door', state: 'locked' } };
    const moved = campaignReducer(state, { type: 'map/updateImageLayer', payload: { mapId: map.id, layerId: 'A', changes: { x: 2 } } });
    const rotated = campaignReducer(moved, { type: 'map/rotateImageLayer', payload: { mapId: map.id, layerId: 'A', direction: 'cw' } });
    const removed = campaignReducer(rotated, { type: 'map/removeImageLayer', payload: { mapId: map.id, layerId: 'A' } });
    for (const current of [moved, rotated, removed]) expect(current.maps.mapsById[map.id].edgeOverrides).toEqual(map.edgeOverrides);
    expect(resolveEdges(removed.maps.mapsById[map.id]).get(key)).toEqual({ kind: 'door', state: 'locked', derived: false, layerIds: [] });
  });
});
