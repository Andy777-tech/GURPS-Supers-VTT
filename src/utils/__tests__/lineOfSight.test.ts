import { imageLayer, imageState } from '../../assets/__tests__/fixtures';
import { defaultFootprint, indexFootprints } from '../footprints';
import { edgeKey, makeEdgeBlocker, resolveEdges } from '../mapEdges';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SIGHT_RANGE_TILES, DEFAULT_TERRAIN_ELEVATION } from '../../constants/map';
import type { MapModel, TerrainId, TileId } from '../../types/map';
import { createNewMap } from '../mapUtils';
import {
  computeVisibleTiles,
  getEffectiveElevation,
  getSightRangeTiles,
  hasLineOfSight,
} from '../lineOfSight';

function makeMap(): MapModel {
  return createNewMap({
    name: 'LOS test',
    scale: '12mi',
    startTerrainId: 'terrain-plains',
  });
}

function tileAt(map: MapModel, row: number, col: number): TileId {
  return map.grid[row][col];
}

function setTerrain(map: MapModel, row: number, col: number, terrainId: TerrainId | null) {
  map.tilesById[tileAt(map, row, col)].terrainId = terrainId;
}

describe('line of sight', () => {
  let map: MapModel;

  beforeEach(() => {
    map = makeMap();
  });

  it('uses terrain elevation', () => {
    const tileId = tileAt(map, 4, 4);
    map.terrainById['terrain-plains'].elevation = 3;
    expect(getEffectiveElevation(map, tileId)).toBe(3);
  });

  it('prefers a per-tile override', () => {
    const tileId = tileAt(map, 4, 4);
    map.tilesById[tileId].elevationOverride = 7;
    expect(getEffectiveElevation(map, tileId)).toBe(7);
  });

  it('resolves null terrain and missing tiles to zero', () => {
    const tileId = tileAt(map, 4, 3);
    setTerrain(map, 4, 3, null);
    expect(getEffectiveElevation(map, tileId)).toBe(0);
    expect(getEffectiveElevation(map, 'not-a-tile')).toBe(0);
  });

  it('uses the default when a terrain omits elevation', () => {
    const tileId = tileAt(map, 4, 4);
    delete map.terrainById['terrain-plains'].elevation;
    expect(getEffectiveElevation(map, tileId)).toBe(DEFAULT_TERRAIN_ELEVATION);
  });

  it('always sees self and adjacent tiles', () => {
    const from = tileAt(map, 4, 4);
    const adjacent = tileAt(map, 5, 5);
    map.tilesById[adjacent].elevationOverride = 20;
    expect(hasLineOfSight(map, from, from)).toBe(true);
    expect(hasLineOfSight(map, from, adjacent)).toBe(true);
  });

  it('cuts visibility off by Chebyshev range', () => {
    map.sightRangeTiles = 1;
    const observer = tileAt(map, 4, 4);
    const visible = computeVisibleTiles(map, [observer]);
    expect(visible).toContain(tileAt(map, 5, 5));
    expect(visible).not.toContain(tileAt(map, 6, 4));
  });

  it('blocks plains-to-plains sight with an intermediate hill', () => {
    setTerrain(map, 4, 3, 'terrain-plains');
    setTerrain(map, 4, 4, 'terrain-hills');
    setTerrain(map, 4, 5, 'terrain-plains');
    expect(hasLineOfSight(map, tileAt(map, 4, 3), tileAt(map, 4, 5))).toBe(false);
  });

  it('lets a mountain observer see over that hill to plains', () => {
    setTerrain(map, 4, 3, 'terrain-mountains');
    setTerrain(map, 4, 4, 'terrain-hills');
    setTerrain(map, 4, 5, 'terrain-plains');
    expect(hasLineOfSight(map, tileAt(map, 4, 3), tileAt(map, 4, 5))).toBe(true);
  });

  it('does not let elevation-zero water block an elevation-zero corridor', () => {
    setTerrain(map, 4, 3, 'terrain-water');
    setTerrain(map, 4, 4, 'terrain-water');
    setTerrain(map, 4, 5, 'terrain-water');
    expect(hasLineOfSight(map, tileAt(map, 4, 3), tileAt(map, 4, 5))).toBe(true);
  });

  it('lets a per-tile override flip a blocked result', () => {
    setTerrain(map, 4, 3, 'terrain-plains');
    setTerrain(map, 4, 4, 'terrain-hills');
    setTerrain(map, 4, 5, 'terrain-plains');
    const middle = tileAt(map, 4, 4);
    expect(hasLineOfSight(map, tileAt(map, 4, 3), tileAt(map, 4, 5))).toBe(false);
    map.tilesById[middle].elevationOverride = 0;
    expect(hasLineOfSight(map, tileAt(map, 4, 3), tileAt(map, 4, 5))).toBe(true);
  });

  it('unions multiple observers', () => {
    map.sightRangeTiles = 1;
    const first = tileAt(map, 1, 1);
    const second = tileAt(map, 7, 7);
    const visible = computeVisibleTiles(map, [first, second]);
    expect(visible).toContain(tileAt(map, 1, 2));
    expect(visible).toContain(tileAt(map, 7, 6));
  });

  it('ignores observers that are not on the grid', () => {
    expect(computeVisibleTiles(map, ['outside'])).toEqual(new Set());
  });

  it('uses the default sight range and respects a map override', () => {
    expect(getSightRangeTiles(map)).toBe(DEFAULT_SIGHT_RANGE_TILES);
    map.sightRangeTiles = 3;
    expect(getSightRangeTiles(map)).toBe(3);
    const observer = tileAt(map, 4, 4);
    expect(computeVisibleTiles(map, [observer])).not.toContain(tileAt(map, 0, 0));
  });
});

describe('wall-aware line of sight', () => {
  function rooms() {
    const { map } = imageState([
      imageLayer({ id: 'A', x: 1, y: 1, footprint: defaultFootprint(4, 3) }),
      imageLayer({ id: 'B', x: 5, y: 1, width: 3, footprint: defaultFootprint(3, 3) }),
    ]);
    // All cells have the same floor, isolating edge blocking from elevation.
    for (const tile of Object.values(map.tilesById)) tile.elevationOverride = 0;
    map.sightRangeTiles = 20;
    return map;
  }
  const blocker = (map: MapModel) => makeEdgeBlocker(map, resolveEdges(map));

  it('blocks adjacent-through-wall and outside-corner diagonal before the neighbor shortcut', () => {
    const map = rooms();
    expect(hasLineOfSight(map, map.grid[2][0], map.grid[2][1], blocker(map))).toBe(false);
    expect(hasLineOfSight(map, map.grid[0][0], map.grid[1][1], blocker(map))).toBe(false);
    expect(hasLineOfSight(map, map.grid[1][1], map.grid[2][2], blocker(map))).toBe(true);
  });

  it('allows an inside diagonal in an L-shaped room when only one L-route is blocked', () => {
    const map = rooms();
    map.imageLayers = [imageLayer({ id: 'L', x: 1, y: 1, width: 2, height: 2, footprint: [[0, 0], [1, 0], [0, 1]] })];
    expect(hasLineOfSight(map, map.grid[1][2], map.grid[2][1], blocker(map))).toBe(true);
    expect(hasLineOfSight(map, map.grid[2][1], map.grid[1][2], blocker(map))).toBe(true);
    // Close the remaining route: each L-route now has at least one blocking edge.
    map.edgeOverrides = { [edgeKey(map.grid[1][1], map.grid[1][2])]: { kind: 'wall' } };
    expect(hasLineOfSight(map, map.grid[1][2], map.grid[2][1], blocker(map))).toBe(false);
  });

  it.each(['closed', 'open', 'locked'] as const)('%s door controls sight, including the final edge', (state) => {
    const map = rooms();
    map.edgeOverrides = { [edgeKey(map.grid[2][4], map.grid[2][5])]: { kind: 'door', state } };
    expect(hasLineOfSight(map, map.grid[2][2], map.grid[2][5], blocker(map))).toBe(state === 'open');
    expect(hasLineOfSight(map, map.grid[2][4], map.grid[2][5], blocker(map))).toBe(state === 'open');
  });

  it('excludes B until a shared door opens, and merges sight when every shared edge is open', () => {
    const map = rooms();
    const bTiles = [...indexFootprints(map).byLayer.get('B')!];
    const before = computeVisibleTiles(map, [map.grid[2][2]], blocker(map));
    expect(bTiles.every((id) => !before.has(id))).toBe(true);
    map.edgeOverrides = { [edgeKey(map.grid[2][4], map.grid[2][5])]: { kind: 'door', state: 'open' } };
    expect(computeVisibleTiles(map, [map.grid[2][2]], blocker(map))).toContain(map.grid[2][6]);
    for (let row = 1; row <= 3; row += 1) {
      map.edgeOverrides[edgeKey(map.grid[row][4], map.grid[row][5])] = { kind: 'open' };
    }
    const merged = computeVisibleTiles(map, [map.grid[1][1]], blocker(map));
    expect(bTiles.every((id) => merged.has(id))).toBe(true);
  });

  it('preserves elevation and range results without a blocker or with an empty edge map', () => {
    const map = rooms();
    map.sightRangeTiles = 3;
    map.tilesById[map.grid[2][3]].elevationOverride = 10;
    const observer = map.grid[2][2];
    const empty = makeEdgeBlocker(map, new Map());
    expect(computeVisibleTiles(map, [observer], empty)).toEqual(computeVisibleTiles(map, [observer]));
    for (const row of map.grid) for (const id of row) {
      expect(hasLineOfSight(map, observer, id, empty)).toBe(hasLineOfSight(map, observer, id));
    }
    expect(hasLineOfSight(map, observer, map.grid[2][4])).toBe(false);
  });
});

it('treats an off-map cell in a sparse ray as opaque only on the tactical tier', () => {
  const map = makeMap();
  const from = map.grid[0][0], to = map.grid[0][2];
  // A damaged/sparse grid exercises the hardened helper; normal rectangular rays stay in bounds.
  delete map.grid[0][1];
  expect(hasLineOfSight(map, from, to)).toBe(true);
  expect(hasLineOfSight({ ...map, scale: '1yd' }, from, to)).toBe(false);
});
