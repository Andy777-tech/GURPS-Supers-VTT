import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MapScene } from '../MapScene';
import type { TokenDragTile } from '../MapScene';
import { createNewMap } from '../../../../utils/mapUtils';
import { campaignReducer, createCampaignState } from '../../../../state/campaignReducer';
import { tokenAtCell } from '../../../../utils/mapTokenSpatial';
import { defaultFootprint } from '../../../../utils/footprints';

vi.mock('three', async importOriginal => ({ ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class { setClearColor() {} setPixelRatio() {} setSize() {} render() {} dispose() {} },
}));
const scenes: MapScene[] = [];
beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { scenes.splice(0).forEach(scene => scene.dispose()); vi.restoreAllMocks(); });

function setup() {
  const map = createNewMap({ name: 'Tokens', scale: '1yd', startTerrainId: 'terrain-plains' });
  map.tokens.ogre = { id: 'ogre', label: 'Ogre', facing: 0, footprint: defaultFootprint(2, 2), position: { col: 2, row: 2 } };
  let state = createCampaignState(); state.maps = { ...state.maps, mapsById: { [map.id]: map } };
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
  let updates = 0;
  const drop = vi.fn((from: TokenDragTile, to: TokenDragTile) => {
    const live = state.maps.mapsById[map.id];
    const token = tokenAtCell(live, from.row, from.col);
    if (!token) return;
    const next = campaignReducer(state, { type: 'map/moveToken', payload: { mapId: map.id, tokenId: token.id, mode: 'gm',
      position: { col: token.position.col + to.col - from.col, row: token.position.row + to.row - from.row } } });
    if (next !== state) updates++;
    state = next;
  });
  const scene = new MapScene(canvas, { onTileClick: vi.fn(), onTileContextMenu: vi.fn(), onTilePaintStart: vi.fn(),
    onTilePaintEnter: vi.fn(), onHoverTile: vi.fn(), onTokenDragStart: () => true, onTokenDrop: drop });
  scenes.push(scene);
  const internal = scene as unknown as { pick: (x: number, y: number) => TokenDragTile | null };
  const pick = vi.spyOn(internal, 'pick').mockImplementation(x => {
    const cell = x < 10 ? 3 : 5;
    return { tileId: map.grid[cell][cell], row: cell, col: cell };
  });
  const add = vi.spyOn(THREE.Scene.prototype, 'add');
  scene.update({ map, gridLines: true, fog: 'gm', visibleTileIds: null, selectedTileIds: null,
    routeTileIds: null, reachableTileIds: null, paintModeActive: false, placingToken: false, alignMode: null,
    measureBox: null, footprints: null, edges: new Map(),
    tokens: [{ id: 'ogre', tileId: map.grid[2][2], occupiedTileIds: [map.grid[2][2], map.grid[2][3], map.grid[3][2], map.grid[3][3]], color: '#38bdf8' }],
  });
  const pointer = (type: string, x: number, pointerType = 'mouse') => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { clientX: x, clientY: 5, button: 0, pointerId: 1, pointerType, shiftKey: false });
    canvas.dispatchEvent(event);
  };
  return { scene, pointer, pick, drop, add, map, getState: () => state, updates: () => updates };
}

describe('MapScene token drop transaction', () => {
  it.each(['mouse', 'touch'])('previews %s movement without writes, then commits exactly once from an interior cell', pointerType => {
    const test = setup();
    test.pointer('pointerdown', 1, pointerType);
    test.pointer('pointermove', 20, pointerType);
    test.pointer('pointermove', 25, pointerType);
    expect(test.updates()).toBe(0); expect(test.drop).not.toHaveBeenCalled();
    expect(test.getState().maps.mapsById[test.map.id].tokens.ogre.position).toEqual({ col: 2, row: 2 });
    test.pointer('pointerup', 25, pointerType);
    expect(test.updates()).toBe(1); expect(test.drop).toHaveBeenCalledTimes(1);
    expect(test.getState().maps.mapsById[test.map.id].tokens.ogre.position).toEqual({ col: 4, row: 4 });
  });
  it.each(['mouse', 'touch'])('cancels %s dragging without persisting a drop', pointerType => {
    const test = setup();
    test.pointer('pointerdown', 1, pointerType); test.pointer('pointermove', 20, pointerType);
    test.pointer('pointercancel', 20, pointerType); test.pointer('pointerup', 20, pointerType);
    expect(test.updates()).toBe(0); expect(test.drop).not.toHaveBeenCalled();
  });
  it('does not emit unchanged or off-surface drops', () => {
    const test = setup();
    test.pointer('pointerdown', 1); test.pointer('pointermove', 20); test.pointer('pointerup', 1);
    expect(test.drop).not.toHaveBeenCalled();
    test.pointer('pointerdown', 1); test.pointer('pointermove', 20); test.pick.mockReturnValue(null); test.pointer('pointerup', 20);
    expect(test.updates()).toBe(0); expect(test.drop).not.toHaveBeenCalled();
  });
  it('draws every occupied cell rather than only the anchor icon', () => {
    const test = setup();
    const cells = test.add.mock.calls.flat().flatMap(object => object.children).filter(object => object.renderOrder === 960);
    expect(cells).toHaveLength(4);
    expect(new Set(cells.map(cell => `${cell.position.x},${cell.position.z}`)).size).toBe(4);
  });
});
