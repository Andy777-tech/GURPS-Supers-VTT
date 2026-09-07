import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MapScene } from '../MapScene';
import type { MapSceneFrameData } from '../MapScene';
import { createMemoryAssetStore, setAssetStoreForTests } from '../../../../assets/assetStore';
import { imageLayer, imageState } from '../../../../assets/__tests__/fixtures';
import { defaultFootprint } from '../../../../utils/footprints';
import { edgeKey, resolveEdges } from '../../../../utils/mapEdges';

vi.mock('three', async (importOriginal) => {
  const original = await importOriginal<typeof import('three')>();
  return {
    ...original,
    WebGLRenderer: class {
      setClearColor() {}
      setPixelRatio() {}
      setSize() {}
      render() {}
      dispose() {}
    },
  };
});

const scenes: MapScene[] = [];
function setup() {
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
  const callbacks = {
    onTileClick: vi.fn(), onTileContextMenu: vi.fn(), onTilePaintStart: vi.fn(),
    onTilePaintEnter: vi.fn(), onHoverTile: vi.fn(),
    onEdgeClick: vi.fn(() => true), onEdgeDoubleClick: vi.fn(),
  };
  const scene = new MapScene(canvas, callbacks);
  scenes.push(scene);
  const { map } = imageState([
    imageLayer({ id: 'A', x: 1, y: 1, footprint: defaultFootprint(4, 3), visible: false }),
    imageLayer({ id: 'B', x: 5, y: 1, width: 3, footprint: defaultFootprint(3, 3), visible: false }),
  ]);
  const frame: MapSceneFrameData = {
    gridLines: true,
    map, fog: 'gm', visibleTileIds: null, selectedTileIds: null, routeTileIds: null,
    reachableTileIds: null, tokens: null, paintModeActive: false, placingToken: false, alignMode: null, measureBox: null,
    footprints: null, edges: resolveEdges(map),
  };
  const add = vi.spyOn(THREE.Scene.prototype, 'add');
  const group = () => add.mock.calls.flat().reverse().find((object) => object.name === 'edges');
  const key = edgeKey(map.grid[2][4], map.grid[2][5]);
  const pick = (x = 4.9, z = 2.5, row = 2, col = 4) => {
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObject').mockReturnValue([{
      instanceId: row * map.cols + col, point: new THREE.Vector3(x, 0.06, z),
      distance: 1, object: new THREE.Object3D(),
    }]);
  };
  const event = (type: string, shiftKey = false) => canvas.dispatchEvent(new MouseEvent(type, {
    button: 0, clientX: 100, clientY: 100, shiftKey,
  }));
  const click = (shiftKey = false) => { event('pointerdown', shiftKey); event('pointerup', shiftKey); };
  return { scene, frame, map, canvas, callbacks, add, group, key, pick, event, click };
}

beforeEach(() => {
  vi.useFakeTimers();
  setAssetStoreForTests(createMemoryAssetStore());
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  for (const scene of scenes.splice(0)) scene.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setAssetStoreForTests(null);
});

describe('MapScene edges', () => {
  it('renders one group with one child per resolved boundary and places vertical edges at the higher floor', () => {
    const { scene, frame, map, group, key, add } = setup();
    map.tilesById[map.grid[2][5]].elevationOverride = 3;
    scene.update(frame);
    expect(add.mock.calls.flat().filter((object) => object.name === 'edges')).toHaveLength(1);
    expect(group()?.children).toHaveLength(frame.edges!.size);
    const wall = group()?.getObjectByName(key)?.children[0];
    expect(wall?.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(wall?.position.x).toBe(5);
    expect(wall?.position.z).toBe(2.5);
    expect(wall?.position.y).toBeCloseTo(3 * 0.35 + 0.16);
    expect(wall).toMatchObject({ geometry: { parameters: { width: 1, height: 0.32, depth: 0.08 } } });
  });

  it.each(['closed', 'open', 'locked'] as const)('renders %s doors with the specified shape and colour', (state) => {
    const { scene, frame, map, group, key } = setup();
    map.edgeOverrides = { [key]: { kind: 'door', state } };
    scene.update({ ...frame, edges: resolveEdges(map) });
    const children = group()?.getObjectByName(key)?.children ?? [];
    expect(children).toHaveLength(state === 'open' ? 2 : 1);
    for (const child of children) {
      if (!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshBasicMaterial)) throw new Error('Expected door box');
      expect(child.material.color.getHexString()).toBe(state === 'locked' ? 'dc2626' : 'd97706');
      expect(child.geometry.parameters.width).toBeCloseTo(state === 'open' ? 0.1 : 0.7);
      expect(child.geometry.parameters.height).toBe(0.26);
      expect(child.geometry.parameters.depth).toBe(0.12);
    }
    if (state === 'open') expect(Math.abs(children[1].position.z - children[0].position.z)).toBeCloseTo(0.6);
  });

  it('rebuilds only edges on identity change and disposes geometry when edges become null', () => {
    const { scene, frame, group, add } = setup();
    scene.update(frame);
    const first = group();
    const mesh = first?.children[0].children[0];
    if (!(mesh instanceof THREE.Mesh)) throw new Error('Expected wall');
    const dispose = vi.spyOn(mesh.geometry, 'dispose');
    add.mockClear();
    scene.update({ ...frame, edges: new Map(frame.edges!) });
    expect(first?.parent).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledExactlyOnceWith(group());
    const second = group();
    scene.update({ ...frame, edges: null });
    expect(second?.parent).toBeNull();
  });

  it('cancels a pending click when switching maps', () => {
    const { scene, frame, callbacks, pick, click } = setup();
    scene.update(frame); pick(); click();
    scene.update({ ...frame, map: { ...frame.map, id: 'another-map' } });
    vi.advanceTimersByTime(300);
    expect(callbacks.onEdgeClick).not.toHaveBeenCalled();
    expect(callbacks.onTileClick).not.toHaveBeenCalled();
  });

  it('distinguishes exterior, interior, and free-standing wall colours', () => {
    const { scene, frame, map, group, key } = setup();
    const outsideKey = edgeKey(map.grid[2][0], map.grid[2][1]);
    const freeKey = edgeKey(map.grid[6][2], map.grid[6][3]);
    map.edgeOverrides = { [freeKey]: { kind: 'wall' } };
    scene.update({ ...frame, edges: resolveEdges(map) });
    for (const [wallKey, color] of [[outsideKey, '4a3728'], [key, '7c5a3c'], [freeKey, '3f4f6b']]) {
      const mesh = group()?.getObjectByName(wallKey)?.children[0];
      if (!(mesh instanceof THREE.Mesh) || !(mesh.material instanceof THREE.MeshBasicMaterial)) throw new Error('Expected wall');
      expect(mesh.material.color.getHexString()).toBe(color);
    }
  });

  it('renders nothing for edges: null', () => {
    const { scene, frame, group } = setup();
    scene.update({ ...frame, edges: null });
    expect(group()).toBeUndefined();
  });

  it('hides edges when both tiles are fog-hidden, showing an edge when either tile is visible or revealed', () => {
    const { scene, frame, map, group, key } = setup();
    map.revealedTileIds = new Set();
    scene.update({ ...frame, fog: 'player-los', visibleTileIds: new Set() });
    expect(group()?.children).toHaveLength(0);
    scene.update({ ...frame, fog: 'player-los', visibleTileIds: new Set([map.grid[2][4]]) });
    expect(group()?.getObjectByName(key)).toBeDefined();
    map.revealedTileIds = new Set([map.grid[2][5]]);
    scene.update({ ...frame, fog: 'player-los', visibleTileIds: new Set() });
    expect(group()?.getObjectByName(key)).toBeDefined();
  });

  it('picks the east side and cancels both deferred singles on double-click', () => {
    const { scene, frame, callbacks, key, pick, event, click, map } = setup();
    scene.update(frame); pick();
    click(); vi.advanceTimersByTime(100); click(); event('dblclick');
    vi.advanceTimersByTime(300);
    expect(callbacks.onEdgeDoubleClick).toHaveBeenCalledExactlyOnceWith({ a: map.grid[2][4], b: map.grid[2][5], key });
    expect(callbacks.onEdgeClick).not.toHaveBeenCalled();
    expect(callbacks.onTileClick).not.toHaveBeenCalled();
  });

  it('tile center clicks immediately fall through without an edge callback', () => {
    const { scene, frame, callbacks, pick, click } = setup();
    scene.update(frame); pick(4.5); click();
    expect(callbacks.onTileClick).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(300);
    expect(callbacks.onEdgeClick).not.toHaveBeenCalled();
  });

  it.each([true, false])('defers by 250 ms and falls through to tile only if unconsumed (%s)', (consumed) => {
    const { scene, frame, callbacks, pick, click } = setup();
    callbacks.onEdgeClick.mockReturnValue(consumed);
    scene.update(frame); pick(); click(true);
    vi.advanceTimersByTime(249);
    expect(callbacks.onEdgeClick).not.toHaveBeenCalled();
    expect(callbacks.onTileClick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callbacks.onEdgeClick).toHaveBeenCalledOnce();
    expect(callbacks.onEdgeClick.mock.calls[0]).toEqual([expect.anything(), expect.objectContaining({ shiftKey: true })]);
    expect(callbacks.onTileClick).toHaveBeenCalledTimes(consumed ? 0 : 1);
  });

  it('dispose cancels pending clicks and unbinds double-click', () => {
    const { scene, frame, callbacks, pick, click, event } = setup();
    scene.update(frame); pick(); click(); scene.dispose(); event('dblclick');
    vi.advanceTimersByTime(300);
    expect(callbacks.onEdgeClick).not.toHaveBeenCalled();
    expect(callbacks.onEdgeDoubleClick).not.toHaveBeenCalled();
    expect(callbacks.onTileClick).not.toHaveBeenCalled();
  });

  it('any canvas double-click cancels a pending edge click, including a tile-center double-click', () => {
    const { scene, frame, callbacks, pick, click, event } = setup();
    scene.update(frame); pick(); click(); pick(4.5); event('dblclick');
    vi.advanceTimersByTime(300);
    expect(callbacks.onEdgeClick).not.toHaveBeenCalled();
    expect(callbacks.onEdgeDoubleClick).not.toHaveBeenCalled();
    expect(callbacks.onTileClick).not.toHaveBeenCalled();
  });

  it('shows a white hover group for players and clears it on pointer leave', () => {
    const { scene, frame, add, pick, event } = setup();
    scene.update({ ...frame, fog: 'player-open' }); pick();
    add.mockClear(); event('pointermove');
    const hover = add.mock.calls.flat().find((object) => object instanceof THREE.Group);
    const mesh = hover?.children[0];
    expect(mesh).toMatchObject({ geometry: { parameters: { height: 0.06 } } });
    if (!(mesh instanceof THREE.Mesh) || !(mesh.material instanceof THREE.MeshBasicMaterial)) throw new Error('Expected hover box');
    expect(mesh.material.color.getHexString()).toBe('ffffff');
    event('pointerleave');
    expect(hover?.parent).toBeNull();
  });
});
