import { describe, expect, it } from 'vitest';
import type { FootprintCell } from '../../types/map';
import { imageLayer } from '../../assets/__tests__/fixtures';
import { createNewMap, expandMap } from '../mapUtils';
import {
  cellKey, clipFootprint, defaultFootprint, editFootprint, indexFootprints,
  layerAnchor, mirrorFootprint, projectFootprint, rotateFootprint, sortCells,
} from '../footprints';

const makeMap = () => createNewMap({ name: 'Rooms', scale: '12mi', startTerrainId: 'terrain-plains' });
const carved = () => defaultFootprint(4, 3).filter(([dx, dy]) => dx !== 3 || dy !== 2);

describe('footprint cells', () => {
  it('fills a 4×3 box in row/column order without mutating sort input', () => {
    const expected: FootprintCell[] = [
      [0, 0], [1, 0], [2, 0], [3, 0],
      [0, 1], [1, 1], [2, 1], [3, 1],
      [0, 2], [1, 2], [2, 2], [3, 2],
    ];
    expect(defaultFootprint(4, 3)).toEqual(expected);
    const backwards = [...expected].reverse();
    expect(sortCells(backwards)).toEqual(expected);
    expect(backwards[0]).toEqual([3, 2]);
    expect(cellKey(3, 2)).toBe('3,2');
    expect(layerAnchor({ x: 1.4, y: 2.6 })).toEqual({ col: 1, row: 3 });
  });

  it('rotates the missing bottom-right cell to bottom-left; ccw is its inverse', () => {
    const cw = rotateFootprint(carved(), 4, 3, 'cw');
    expect(cw).toEqual(defaultFootprint(3, 4).filter(([dx, dy]) => dx !== 0 || dy !== 3));
    expect(rotateFootprint(cw, 3, 4, 'ccw')).toEqual(carved());
  });

  it('returns to the same cells after four clockwise turns', () => {
    let cells = carved();
    let width = 4;
    let height = 3;
    for (let turn = 0; turn < 4; turn++) {
      cells = rotateFootprint(cells, width, height, 'cw');
      [width, height] = [height, width];
    }
    expect(cells).toEqual(carved());
  });

  it.each([
    [0, 'mirrorX', [3, 1]], [90, 'mirrorX', [0, 3]],
    [180, 'mirrorX', [3, 1]], [270, 'mirrorX', [0, 3]],
    [0, 'mirrorY', [0, 3]], [90, 'mirrorY', [3, 1]],
    [180, 'mirrorY', [0, 3]], [270, 'mirrorY', [3, 1]],
  ] as const)('conjugates %s° %s in grid space', (rotation, axis, expected) => {
    expect(mirrorFootprint([[0, 1]], 4, 5, axis, rotation)).toEqual([expected]);
  });

  it('clips all four sides of the rounded box and sorts the result', () => {
    expect(clipFootprint([[2, 1], [-1, 0], [0, -1], [3, 0], [0, 2], [0, 0]], 3.2, 2.2))
      .toEqual([[0, 0], [2, 1]]);
  });

  it('adds and removes brush tiles, ignores out-of-box and missing ids, and defaults to the box', () => {
    const map = makeMap();
    const layer = imageLayer({ x: 1, y: 1, width: 4, height: 3 });
    const ids = [map.grid[1][1], map.grid[3][4], map.grid[0][0], 'missing'];
    const removed = editFootprint(map, layer, ids, 'remove');
    expect(removed).toHaveLength(10);
    expect(removed).not.toContainEqual([0, 0]);
    expect(removed).not.toContainEqual([3, 2]);
    expect(editFootprint(map, { ...layer, footprint: removed }, ids, 'add')).toEqual(defaultFootprint(4, 3));
    expect(editFootprint(map, layer, ids, 'add')).toEqual(defaultFootprint(4, 3));
    expect(editFootprint(map, { ...layer, footprint: [] }, ids, 'add')).toEqual([[0, 0], [3, 2]]);
  });
});

describe('footprint projection and overlap', () => {
  it('keeps stable tile ids when rows and columns are prepended', () => {
    const map = makeMap();
    const layer = imageLayer({ x: 1, y: 1, footprint: carved() });
    map.imageLayers = [layer];
    const before = projectFootprint(map, layer);
    expect(before.size).toBe(11);
    const expanded = expandMap(map, { top: 2, left: 1, bottom: 0, right: 0 });
    expect(projectFootprint(expanded, expanded.imageLayers![0])).toEqual(before);
    expect(expanded.imageLayers![0].footprint).toEqual(layer.footprint);
  });

  it('drops off-grid cells and gives plain images no tiles', () => {
    const map = makeMap();
    expect(projectFootprint(map, imageLayer())).toEqual(new Set());
    expect(projectFootprint(map, imageLayer({ x: -1, y: -1, footprint: defaultFootprint(2, 2) })))
      .toEqual(new Set([map.grid[0][0]]));
  });

  it('indexes the five overlapping cells of the two carved rooms', () => {
    const map = makeMap();
    map.imageLayers = [
      imageLayer({ id: 'A', x: 1, y: 1, footprint: carved() }),
      imageLayer({ id: 'B', x: 3, y: 1, width: 3, footprint: defaultFootprint(3, 3) }),
      imageLayer({ id: 'plain' }),
    ];
    const index = indexFootprints(map);
    expect(index.byLayer.get('A')?.size).toBe(11);
    expect(index.byLayer.get('B')?.size).toBe(9);
    expect(index.byLayer.has('plain')).toBe(false);
    expect(index.overlap).toEqual(new Set([
      map.grid[1][3], map.grid[1][4], map.grid[2][3], map.grid[2][4], map.grid[3][3],
    ]));
    expect(index.byTile.get(map.grid[1][3])).toEqual(['A', 'B']);
  });
});
