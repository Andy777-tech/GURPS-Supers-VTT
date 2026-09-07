import { selectEdgeBlocker } from '../../state/selectors/mapEdges';
import { describe, expect, it } from 'vitest';
import type { EdgeOverride } from '../../types/map';
import { imageLayer, imageState } from '../../assets/__tests__/fixtures';
import { defaultFootprint, indexFootprints } from '../footprints';
import {
  boundaryBlocksSight, makeEdgeBlocker, cycleEdge, deriveBoundaryEdges, doorClickOverride, edgeBlocksSight, edgeKey,
  nextOverride, resolveEdges, splitEdgeKey,
} from '../mapEdges';

function rooms() {
  return imageState([
    imageLayer({ id: 'A', x: 1, y: 1, footprint: defaultFootprint(4, 3) }),
    imageLayer({ id: 'B', x: 5, y: 1, width: 3, footprint: defaultFootprint(3, 3) }),
  ]).map;
}

describe('map edges', () => {
  it('keys are symmetric and lexicographically sorted', () => {
    expect(edgeKey('tile-2', 'tile-10')).toBe('tile-10|tile-2');
    expect(edgeKey('tile-10', 'tile-2')).toBe('tile-10|tile-2');
    expect(splitEdgeKey('tile-10|tile-2')).toEqual(['tile-10', 'tile-2']);
  });

  it('derives 23 boundaries with three shared walls; carving keeps A perimeter at 14', () => {
    const map = rooms();
    expect([map.rows, map.cols]).toEqual([9, 9]);
    const edges = deriveBoundaryEdges(map, indexFootprints(map));
    expect(edges.size).toBe(23);
    expect([...edges.values()].filter((owners) => owners.length === 2)).toHaveLength(3);
    const a = map.imageLayers![0];
    a.footprint = a.footprint!.filter(([x, y]) => x !== 3 || y !== 2);
    const carved = deriveBoundaryEdges(map, indexFootprints(map));
    expect([...carved.values()].filter((owners) => owners.includes('A'))).toHaveLength(14);
    expect([...carved.values()].filter((owners) => owners.length === 2)).toHaveLength(2);
  });

  it('resolves overrides, discards open-on-open, and marks free-standing walls', () => {
    const map = rooms();
    const shared = edgeKey(map.grid[2][4], map.grid[2][5]);
    const free = edgeKey(map.grid[6][2], map.grid[6][3]);
    const inert = edgeKey(map.grid[6][3], map.grid[6][4]);
    map.edgeOverrides = { [shared]: { kind: 'door', state: 'closed' }, [free]: { kind: 'wall' }, [inert]: { kind: 'open' } };
    const edges = resolveEdges(map);
    expect(edges.get(shared)).toEqual({ kind: 'door', state: 'closed', derived: true, layerIds: ['A', 'B'] });
    expect(edges.get(free)).toEqual({ kind: 'wall', derived: false, layerIds: [] });
    expect(edges.has(inert)).toBe(false);
  });

  it('cycles wall → door → open → derived wall, deleting the final override', () => {
    expect(cycleEdge('wall')).toEqual({ kind: 'door', state: 'closed' });
    expect(cycleEdge('door')).toEqual({ kind: 'open' });
    expect(cycleEdge('open')).toEqual({ kind: 'wall' });
    const metadata = { derived: true, layerIds: ['A'] };
    expect(nextOverride({ kind: 'wall', ...metadata })).toEqual({ kind: 'door', state: 'closed' });
    expect(nextOverride({ kind: 'door', state: 'closed', ...metadata })).toEqual({ kind: 'open' });
    expect(nextOverride({ kind: 'open', ...metadata })).toBeNull();
    expect(nextOverride(undefined)).toEqual({ kind: 'wall' });
    expect(nextOverride({ kind: 'door', state: 'closed', derived: false, layerIds: [] })).toBeNull();
  });

  it.each<[EdgeOverride | undefined, boolean]>([
    [undefined, false], [{ kind: 'wall' }, true], [{ kind: 'open' }, false],
    [{ kind: 'door', state: 'closed' }, true], [{ kind: 'door', state: 'open' }, false],
    [{ kind: 'door', state: 'locked' }, true],
  ])('sight blocking for %j is %s', (override, expected) => {
    expect(edgeBlocksSight(override && { ...override, layerIds: [], derived: false })).toBe(expected);
  });

  it('consumes locked player door clicks without changing state; GM clicks open and shift-clicks lock/unlock', () => {
    const locked = { kind: 'door', state: 'locked', derived: true, layerIds: ['A'] } as const;
    const state = { ...locked, layerIds: ['A'] };
    expect(doorClickOverride(state, false)).toBeUndefined();
    expect(doorClickOverride(state, false, true)).toBeUndefined();
    expect(state.state).toBe('locked');
    expect(doorClickOverride(state, true)).toEqual({ kind: 'door', state: 'open' });
    expect(doorClickOverride(state, true, true)).toEqual({ kind: 'door', state: 'closed' });
    expect(doorClickOverride({ ...state, state: 'closed' }, true, true)).toEqual({ kind: 'door', state: 'locked' });
    expect(doorClickOverride({ ...state, state: 'closed' }, false)).toEqual({ kind: 'door', state: 'open' });
    expect(doorClickOverride({ ...state, state: 'open' }, false)).toEqual({ kind: 'door', state: 'closed' });
    expect(doorClickOverride(undefined, true)).toBeUndefined();
  });
});

describe('implicit boundary walls', () => {
  it.each([
    [{ row: 0, col: 0 }, { row: -1, col: 0 }],
    [{ row: 0, col: 0 }, { row: -1, col: -1 }],
    [{ row: -1, col: 0 }, { row: 0, col: 0 }],
    [{ row: 8, col: 8 }, { row: 9, col: 8 }],
    [{ row: 8, col: 8 }, { row: 8, col: 9 }],
  ])('blocks steps to/from off-map cells only when enabled: %j → %j', (a, b) => {
    const { map } = imageState([]);
    expect(makeEdgeBlocker(map, new Map())(a, b)).toBe(false);
    expect(makeEdgeBlocker(map, new Map(), { boundaryBlocks: true })(a, b)).toBe(true);
  });

  it('caches a blocker for edge-less tactical maps and keeps overland borders transparent', () => {
    const { map } = imageState([]);
    expect(boundaryBlocksSight(map)).toBe(false);
    expect(selectEdgeBlocker(map)).toBeUndefined();
    const tactical = { ...map, scale: '1yd' as const };
    expect(boundaryBlocksSight(tactical)).toBe(true);
    const blocker = selectEdgeBlocker(tactical);
    expect(blocker).toBeDefined();
    expect(selectEdgeBlocker(tactical)).toBe(blocker);
    expect(blocker?.({ row: 0, col: 0 }, { row: 0, col: -1 })).toBe(true);
    expect(blocker?.({ row: 0, col: 0 }, { row: 1, col: 1 })).toBe(false);
    expect(selectEdgeBlocker({ ...tactical, scale: '12mi' })).toBeUndefined();
  });
});
