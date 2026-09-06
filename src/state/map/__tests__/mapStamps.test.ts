import { describe, expect, it } from 'vitest';
import { campaignReducer } from '../../campaignReducer';
import { imageLayer, imageState } from '../../../assets/__tests__/fixtures';
import type { MapStamp } from '../../../types/map';
import { defaultFootprint, projectFootprint } from '../../../utils/footprints';
import { DEFAULT_TERRAIN_ELEVATION } from '../../../constants/map';
import { addStamp, updateStamp, removeStamp, placeStamp, isMapAction } from '../mapActions';

const stamp: MapStamp = {
  id: 'stamp',
  name: 'Room',
  assetId: 'asset',
  width: 4,
  height: 3,
  category: 'room',
  placement: 'underlay',
  createdAt: 1,
};

describe('map stamps reducer', () => {
  it('preserves stamp B when adding it beside A and removing A', () => {
    const { state } = imageState([]);
    const a = campaignReducer(state, addStamp({ stamp }));
    const bStamp = { ...stamp, id: 'B', name: 'B' };
    const b = campaignReducer(a, addStamp({ stamp: bStamp }));
    expect(b.maps.stamps).toEqual({ stamp, B: bStamp });
    expect(campaignReducer(b, removeStamp({ stampId: stamp.id })).maps.stamps).toEqual({ B: bStamp });
  });
  it('updates only editable fields even when changes carries protected fields', () => {
    const { state } = imageState([]);
    const original = { ...stamp, footprint: defaultFootprint(4, 3) };
    const added = campaignReducer(state, addStamp({ stamp: original }));
    const changes = {
      ...original, name: 'Renamed', id: 'other', width: 99, height: 98,
      footprint: defaultFootprint(1, 1), assetId: 'missing',
    };
    const updated = campaignReducer(added, updateStamp({ stampId: stamp.id, changes }));
    expect(updated.maps.stamps?.stamp).toEqual({ ...original, name: 'Renamed' });
  });
  it.each([[4, 'terrain-plains'], [0, 'terrain-plains'], [0, null]] as const)(
    'uses elevation override %s on %s at a non-diagonal anchor and retains rotation 270', (elevation, terrainId) => {
    const { state, map } = imageState([]);
    const tile = map.tilesById[map.grid[3][2]];
    tile.terrainId = terrainId;
    map.terrainById['terrain-plains'].elevation = 2;
    tile.elevationOverride = elevation;
    map.tilesById[map.grid[2][3]].elevationOverride = 2;
    const added = campaignReducer(state, addStamp({ stamp }));
    const result = campaignReducer(added, placeStamp({
      mapId: map.id, stampId: stamp.id, anchor: { col: 2, row: 3 }, rotation: 270, layerId: 'new',
    }));
    expect(result.maps.mapsById[map.id].imageLayers?.[0]).toMatchObject({ elevation, rotation: 270 });
  });
  it.each(['room', 'background'] as const)('expands top and left for a %s stamp and shifts existing layers equally', (category) => {
    const existing = imageLayer({ x: 4, y: 4 });
    const { state, map } = imageState([existing]);
    const added = campaignReducer(state, addStamp({ stamp: { ...stamp, category } }));
    const result = campaignReducer(added, placeStamp({
      mapId: map.id, stampId: stamp.id, anchor: { col: 0, row: 0 }, rotation: 0, layerId: 'new',
    }));
    const expanded = result.maps.mapsById[map.id];
    const top = expanded.rows - map.rows;
    const left = expanded.cols - map.cols;
    expect(top).toBeGreaterThan(0);
    expect(left).toBeGreaterThan(0);
    expect(expanded.imageLayers).toHaveLength(2);
    expect(expanded.imageLayers?.[0]).toEqual({ ...existing, x: existing.x + left, y: existing.y + top });
    expect(expanded.imageLayers?.[1]).toMatchObject({ id: 'new', x: left, y: top });
  });
  it('keeps an existing layer when placing a stamp beside it', () => {
    const existing = imageLayer({ x: 2, y: 2, width: 2, height: 2 });
    const { state, map } = imageState([existing]);
    const added = campaignReducer(state, addStamp({ stamp: { ...stamp, width: 2, height: 2 } }));
    const result = campaignReducer(added, placeStamp({
      mapId: map.id, stampId: stamp.id, anchor: { col: 4, row: 2 }, rotation: 0, layerId: 'new',
    }));
    expect(result.maps.mapsById[map.id].imageLayers).toHaveLength(2);
    expect(result.maps.mapsById[map.id].imageLayers?.[0]).toEqual(existing);
  });

  it('lazily adds, updates and removes metadata, ignoring unknown ids', () => {
    const { state } = imageState([]);
    expect(state.maps.stamps).toBeUndefined();
    const added = campaignReducer(state, addStamp({ stamp }));
    expect(added.maps.stamps?.stamp).toEqual(stamp);
    const updated = campaignReducer(
      added,
      updateStamp({
        stampId: stamp.id,
        changes: { name: 'Hall', category: 'hallway', placement: 'overlay' },
      })
    );
    expect(updated.maps.stamps?.stamp).toMatchObject({
      name: 'Hall',
      category: 'hallway',
      placement: 'overlay',
    });
    expect(
      campaignReducer(updated, updateStamp({ stampId: 'unknown', changes: { name: 'Bad' } }))
    ).toBe(updated);
    expect(campaignReducer(updated, removeStamp({ stampId: stamp.id })).maps.stamps).toEqual({});
    for (const type of ['map/addStamp', 'map/updateStamp', 'map/removeStamp', 'map/placeStamp'])
      expect(isMapAction({ type })).toBe(true);
  });
  it('places rotated geometry with anchor elevation and leaves placed layers when metadata is removed', () => {
    const { state, map } = imageState([]);
    map.tilesById[map.grid[3][3]].elevationOverride = 4;
    const added = campaignReducer(state, addStamp({ stamp }));
    const placed = campaignReducer(
      added,
      placeStamp({
        mapId: map.id,
        stampId: stamp.id,
        anchor: { col: 3, row: 3 },
        rotation: 90,
        layerId: 'img',
      })
    );
    const layer = placed.maps.mapsById[map.id].imageLayers?.[0];
    expect(layer).toMatchObject({
      id: 'img',
      x: 3,
      y: 3,
      width: 3,
      height: 4,
      rotation: 90,
      elevation: 4,
      footprint: defaultFootprint(3, 4),
    });
    expect(
      campaignReducer(placed, removeStamp({ stampId: stamp.id })).maps.mapsById[map.id]
        .imageLayers?.[0]
    ).toEqual(layer);
  });
  it('expands for a 4×3 room at the bottom-right corner, including off-grid cells and a border on every side', () => {
    const { state, map } = imageState([]);
    const added = campaignReducer(state, addStamp({ stamp }));
    const result = campaignReducer(
      added,
      placeStamp({
        mapId: map.id,
        stampId: stamp.id,
        anchor: { col: map.cols - 1, row: map.rows - 1 },
        rotation: 0,
        layerId: 'img',
      })
    );
    const expanded = result.maps.mapsById[map.id];
    expect(expanded.rows).toBeGreaterThan(map.rows);
    expect(expanded.cols).toBeGreaterThan(map.cols);
    const layer = expanded.imageLayers![0];
    expect(layer.elevation).toBe(DEFAULT_TERRAIN_ELEVATION);
    expect(projectFootprint(expanded, layer).size).toBe(12);
    for (const [dx, dy] of layer.footprint!) {
      const row = layer.y + dy;
      const col = layer.x + dx;
      expect(row).toBeGreaterThan(0);
      expect(row).toBeLessThan(expanded.rows - 1);
      expect(col).toBeGreaterThan(0);
      expect(col).toBeLessThan(expanded.cols - 1);
      expect(expanded.tilesById[expanded.grid[row][col]]).toBeDefined();
    }
  });
  it('uses terrain elevation and leaves backgrounds without footprints', () => {
    const { state, map } = imageState([]);
    map.tilesById[map.grid[3][3]].terrainId = 'terrain-plains';
    map.terrainById['terrain-plains'].elevation = 2;
    const added = campaignReducer(state, addStamp({ stamp: { ...stamp, category: 'background' } }));
    const placed = campaignReducer(
      added,
      placeStamp({
        mapId: map.id,
        stampId: stamp.id,
        anchor: { col: 3, row: 3 },
        rotation: 0,
        layerId: 'img',
      })
    );
    expect(placed.maps.mapsById[map.id].imageLayers?.[0]).toMatchObject({ elevation: 2 });
    expect(placed.maps.mapsById[map.id].imageLayers?.[0]).not.toHaveProperty('footprint');
  });
  it('ignores placement of unknown stamps and maps', () => {
    const { state, map } = imageState([]);
    expect(
      campaignReducer(
        state,
        placeStamp({
          mapId: map.id,
          stampId: 'missing',
          anchor: { col: 0, row: 0 },
          rotation: 0,
          layerId: 'img',
        })
      )
    ).toBe(state);
    const added = campaignReducer(state, addStamp({ stamp }));
    expect(
      campaignReducer(
        added,
        placeStamp({
          mapId: 'missing',
          stampId: stamp.id,
          anchor: { col: 0, row: 0 },
          rotation: 0,
          layerId: 'img',
        })
      )
    ).toBe(added);
  });
});
