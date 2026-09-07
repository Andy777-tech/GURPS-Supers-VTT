import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MapScene } from '../MapScene';
import type { MapSceneFrameData } from '../MapScene';
import type { MapScale } from '../../../../types/map';
import { createInitialGrid, createNewMap } from '../../../../utils/mapUtils';
import { createMemoryAssetStore, setAssetStoreForTests } from '../../../../assets/assetStore';

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
function setup(scale: MapScale = '1yd', rows = 3, cols = 3) {
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
  const callbacks = {
    onTileClick: vi.fn(), onTileContextMenu: vi.fn(), onTilePaintStart: vi.fn(),
    onTilePaintEnter: vi.fn(), onHoverTile: vi.fn(), onEdgeClick: vi.fn(() => true),
  };
  const scene = new MapScene(canvas, callbacks);
  scenes.push(scene);
  const map = {
    ...createNewMap({ name: 'Grid', scale, startTerrainId: 'terrain-plains' }),
    ...createInitialGrid('terrain-plains', Math.max(rows, cols)), rows, cols,
  };
  map.grid = map.grid.slice(0, rows).map((row) => row.slice(0, cols));
  const tileIds = new Set(map.grid.flat());
  map.tilesById = Object.fromEntries(Object.entries(map.tilesById).filter(([id]) => tileIds.has(id)));
  const frame: MapSceneFrameData = {
    map, gridLines: true, fog: 'gm', visibleTileIds: null, selectedTileIds: null,
    routeTileIds: null, reachableTileIds: null, tokens: null, paintModeActive: false,
    placingToken: false, alignMode: null, measureBox: null, footprints: null, edges: new Map(),
  };
  const add = vi.spyOn(THREE.Scene.prototype, 'add');
  const group = (name: string) => add.mock.calls.flat().reverse().find((object) => object.name === name);
  const lines = () => group('grid-lines')?.children.find(
    (object): object is THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> =>
      object instanceof THREE.LineSegments && object.material instanceof THREE.LineBasicMaterial,
  );
  return { scene, canvas, callbacks, frame, map, add, group, lines };
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

describe('tactical grid lines', () => {
  it('draws four segments per rendered tile at its own height with the required material and ordering', () => {
    const { scene, frame, map, group, lines } = setup();
    map.tilesById[map.grid[0][0]].elevationOverride = 3;
    scene.update(frame);
    expect(group('grid-lines')?.children).toHaveLength(1);
    const grid = lines();
    if (!grid) throw new Error('Expected grid lines');
    expect(grid.renderOrder).toBe(950);
    expect(grid.material.color.getHexString()).toBe('05070a');
    expect(grid.material).toMatchObject({ transparent: true, opacity: 0.75, depthWrite: false });
    const positions = grid.geometry.getAttribute('position');
    expect(positions.count).toBe(9 * 8);
    expect(positions.array).toHaveLength(9 * 8 * 3);
    const expectedTile = [
      [0, 0], [1, 0], [1, 0], [1, 1], [1, 1], [0, 1], [0, 1], [0, 0],
    ];
    expectedTile.forEach(([x, z], index) => {
      expect(positions.getX(index)).toBe(x);
      expect(positions.getZ(index)).toBe(z);
      expect(positions.getY(index)).toBeCloseTo(3 * 0.35 + 0.012, 6);
    });
    expect(positions.getY(8)).toBeCloseTo(0.06 + 0.012, 6);
  });

  it.each<[MapScale, boolean]>([['1yd', false], ['12mi', true], ['50mi', true], ['457mi', true]])(
    'omits the grid for %s with the flag %s', (scale, gridLines) => {
      const { scene, frame, group } = setup(scale);
      scene.update({ ...frame, gridLines });
      expect(group('grid-lines')).toBeUndefined();
    },
  );

  it('toggles only the grid and disposes its resources while preserving the tile mesh', () => {
    const { scene, frame, add, group, lines } = setup();
    scene.update({ ...frame, gridLines: false });
    const tileMesh = add.mock.calls.flat().find((object) => object instanceof THREE.InstancedMesh);
    const world = tileMesh?.parent;
    expect(tileMesh).toBeDefined();
    add.mockClear();
    scene.update(frame);
    expect(add).toHaveBeenCalledExactlyOnceWith(group('grid-lines'));
    expect(tileMesh?.parent).toBe(world);
    const grid = lines();
    if (!grid) throw new Error('Expected grid');
    const geometryDisposed = vi.spyOn(grid.geometry, 'dispose');
    const materialDisposed = vi.spyOn(grid.material, 'dispose');
    const firstGroup = group('grid-lines');
    add.mockClear();
    scene.update({ ...frame, gridLines: false });
    expect(firstGroup?.parent).toBeNull();
    expect(geometryDisposed).toHaveBeenCalledOnce();
    expect(materialDisposed).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
    expect(tileMesh?.parent).toBe(world);
    scene.update(frame);
    expect(tileMesh?.parent).toBe(world);
    expect(group('grid-lines')?.parent).toBe(world);
  });

  it('uses only rendered tiles for both lines and border walls under player fog', () => {
    const { scene, frame, map, lines, group } = setup();
    map.revealedTileIds = new Set([map.grid[0][0]]);
    scene.update({ ...frame, fog: 'player-los', visibleTileIds: new Set([map.grid[1][1]]) });
    expect(lines()?.geometry.getAttribute('position').array).toHaveLength(2 * 8 * 3);
    expect(group('edges')?.children).toHaveLength(2);
  });
});

describe('implicit tactical border', () => {
  it('draws 2 × rows + 2 × cols wall meshes even without resolved edges', () => {
    const { scene, frame, group } = setup();
    scene.update({ ...frame, edges: null });
    const walls = group('edges')?.children ?? [];
    expect(walls).toHaveLength(12);
    for (const wall of walls) {
      expect(wall.name).toBe('boundary-wall');
      expect(wall.children).toHaveLength(1);
      const mesh = wall.children[0];
      if (!(mesh instanceof THREE.Mesh) || !(mesh.material instanceof THREE.MeshBasicMaterial)) throw new Error('Expected wall mesh');
      expect(mesh.material.color.getHexString()).toBe('4a3728');
      expect(mesh.geometry.parameters).toMatchObject({ width: 1, height: 0.32, depth: 0.08 });
    }
  });

  it('places all fourteen border walls on a two-row, five-column tactical map', () => {
    const { scene, frame, group } = setup('1yd', 2, 5);
    scene.update({ ...frame, edges: null });
    const walls = group('edges')?.children ?? [];
    expect(walls).toHaveLength(14);
    const eastWalls = walls.flatMap((wall) => wall.children).filter((mesh) => mesh.position.x === frame.map.cols);
    expect(eastWalls).toHaveLength(frame.map.rows);
    expect(eastWalls.map((wall) => wall.position.z).sort()).toEqual([0.5, 1.5]);
  });

  it.each<MapScale>(['12mi', '50mi', '457mi'])('omits the border on %s overland maps', (scale) => {
    const { scene, frame, group } = setup(scale);
    scene.update(frame);
    expect(group('edges')?.children).toHaveLength(0);
  });

  it.each([
    [0, 1, 1.5, 0.01], [2, 1, 1.5, 2.99], [1, 0, 0.01, 1.5], [1, 2, 2.99, 1.5],
  ])('does not pick a border side at row %s col %s', (row, col, x, z) => {
    const { scene, frame, canvas, callbacks } = setup();
    scene.update(frame);
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObject').mockReturnValue([{
      instanceId: row * 3 + col, point: new THREE.Vector3(x, 0.06, z),
      distance: 1, object: new THREE.Object3D(),
    }]);
    // Bracket access preserves the actual private method signature without a type cast.
    expect(scene['pickEdge'](100, 100)).toBeNull();
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 100, clientY: 100 }));
    vi.advanceTimersByTime(300);
    expect(callbacks.onEdgeClick).not.toHaveBeenCalled();
    expect(callbacks.onTileClick).toHaveBeenCalled();
  });
});
