import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MapScene } from '../MapScene';
import type { MapSceneFrameData } from '../MapScene';
import { createMemoryAssetStore, setAssetStoreForTests } from '../../../../assets/assetStore';
import { imageLayer, imageState } from '../../../../assets/__tests__/fixtures';
import { snapMeasureBox } from '../../../../utils/stamps';

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
    onTileClick: vi.fn(),
    onTileContextMenu: vi.fn(),
    onTilePaintStart: vi.fn(),
    onTilePaintEnter: vi.fn(),
    onHoverTile: vi.fn(),
    onAlignBoxComplete: vi.fn(),
  };
  const scene = new MapScene(canvas, callbacks);
  scenes.push(scene);
  const { map } = imageState([]);
  const frame: MapSceneFrameData = {
    map,
    fog: 'gm',
    visibleTileIds: null,
    selectedTileIds: null,
    routeTileIds: null,
    reachableTileIds: null,
    tokens: null,
    paintModeActive: false,
    placingToken: false,
    alignMode: null,
    footprints: null,
    edges: null,
    measureBox: { col: 2, row: 1, width: 4, height: 3 },
  };
  const add = vi.spyOn(THREE.Scene.prototype, 'add');
  const group = () =>
    add.mock.calls
      .flat()
      .reverse()
      .find((object) => object.name === 'measureBox');
  return { scene, frame, map, add, group, canvas, callbacks };
}
beforeEach(() => {
  setAssetStoreForTests(createMemoryAssetStore());
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  for (const scene of scenes.splice(0)) scene.dispose();
  vi.restoreAllMocks();
  setAssetStoreForTests(null);
});

describe('MapScene align drag plane', () => {
  const planeHeight = (elevation: number) => Math.max(elevation * 0.35, 0.06) + 0.02;

  function setupDrag(alignMode: NonNullable<MapSceneFrameData['alignMode']>, tileHit = true) {
    const context = setup();
    const { scene, frame, map, canvas, add } = context;
    // The review repro uses elevationOverride = 6 on every terrain tile.
    for (const tile of Object.values(map.tilesById)) tile.elevationOverride = 6;
    scene.update({ ...frame, alignMode, measureBox: null });
    const intersectObject = vi.spyOn(THREE.Raycaster.prototype, 'intersectObject').mockReturnValue(tileHit ? [{
      instanceId: 3 * map.cols + 3,
      point: new THREE.Vector3(3.2, planeHeight(6), 3.2),
      distance: 1,
      object: new THREE.Object3D(),
    }] : []);
    const setFromCamera = vi.spyOn(THREE.Raycaster.prototype, 'setFromCamera');
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 300 }));
    const camera = setFromCamera.mock.calls[0]?.[1];
    if (!camera) throw new Error('Expected hover to supply the scene camera');
    expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);
    intersectObject.mockClear();
    add.mockClear();
    const intersectPlane = vi.spyOn(THREE.Ray.prototype, 'intersectPlane');
    const event = (type: string, x: number, y: number, z: number) => {
      const ndc = new THREE.Vector3(x, y, z).project(camera);
      canvas.dispatchEvent(new MouseEvent(type, {
        button: 0, clientX: (ndc.x + 1) / 2 * 800, clientY: (1 - ndc.y) / 2 * 600,
      }));
    };
    const expectPlanes = (elevation: number, count = 3) => {
      expect(intersectPlane).toHaveBeenCalledTimes(count);
      for (const [plane] of intersectPlane.mock.calls) {
        expect(plane.constant).toBeCloseTo(-planeHeight(elevation));
      }
    };
    return { ...context, event, intersectObject, intersectPlane, expectPlanes };
  }

  it('measures the review repro as a 2×2 box on the elevation-6 floor', () => {
    const { event, callbacks, expectPlanes, add } = setupDrag({ elevation: 1, planeFromPointerTile: true });
    const y6 = planeHeight(6);
    event('pointerdown', 3.2, y6, 3.2);
    const preview = add.mock.calls.flat().find((object) => object instanceof THREE.Group);
    event('pointermove', 4.8, y6, 4.8);
    event('pointerup', 4.8, y6, 4.8);
    expect(callbacks.onAlignBoxComplete).toHaveBeenCalledOnce();
    expect.soft(snapMeasureBox(callbacks.onAlignBoxComplete.mock.calls[0][0])).toEqual({
      col: 3, row: 3, width: 2, height: 2,
    });
    expectPlanes(6);
    expect(preview?.position.y).toBeCloseTo(y6);
  });

  it('keeps the plane locked when the pointer leaves the tile mesh mid-drag', () => {
    const { event, intersectObject, intersectPlane, expectPlanes, callbacks } = setupDrag({
      elevation: 1, planeFromPointerTile: true,
    });
    const y6 = planeHeight(6);
    event('pointerdown', 3.2, y6, 3.2);
    expect(intersectObject).toHaveBeenCalledOnce();
    intersectObject.mockReturnValue([]).mockClear();
    intersectPlane.mockClear();
    event('pointermove', 4.8, y6, 4.8);
    expect(intersectObject).not.toHaveBeenCalled();
    event('pointerup', 4.8, y6, 4.8);
    // Pointer-up still performs its ordinary post-drag hover pick.
    expect(intersectObject).toHaveBeenCalledOnce();
    expect(callbacks.onAlignBoxComplete).toHaveBeenCalledOnce();
    expectPlanes(6, 2);
  });

  it('uses the slice or align elevation even over a higher tile', () => {
    const { event, expectPlanes, intersectObject, callbacks } = setupDrag({ elevation: 3 });
    const y3 = planeHeight(3);
    event('pointerdown', 3.2, y3, 3.2);
    event('pointermove', 4.8, y3, 4.8);
    expect(intersectObject).not.toHaveBeenCalled();
    event('pointerup', 4.8, y3, 4.8);
    expect(callbacks.onAlignBoxComplete).toHaveBeenCalledOnce();
    expectPlanes(3);
  });

  it('falls back to the prop elevation when measure starts off-map', () => {
    const { event, expectPlanes, callbacks } = setupDrag({ elevation: 1, planeFromPointerTile: true }, false);
    const y1 = planeHeight(1);
    expect(() => {
      event('pointerdown', -2, y1, -2);
      event('pointermove', -4, y1, -4);
      event('pointerup', -4, y1, -4);
    }).not.toThrow();
    expect(callbacks.onAlignBoxComplete).toHaveBeenCalledOnce();
    expectPlanes(1);
  });
});

describe('MapScene measure highlight', () => {
  it('renders every measure mesh transparently above covering image overlays and disposes materials on clear', () => {
    const texture = new THREE.Texture(document.createElement('img'));
    vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(texture);
    const { scene, frame, map, group, add } = setup();
    map.imageLayers = [imageLayer({ x: 2, y: 1, width: 4, height: 3, placement: 'overlay' })];
    scene.update(frame);
    const imageMeshes = add.mock.calls.flat().flatMap((object) => object.children)
      .filter((object): object is THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> =>
        object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial &&
        object.material.map === texture);
    expect(imageMeshes).toHaveLength(1);
    const measureMeshes = group()?.children ?? [];
    expect(measureMeshes).toHaveLength(5);
    const materials = new Set<THREE.MeshBasicMaterial>();
    for (const mesh of measureMeshes) {
      if (!(mesh instanceof THREE.Mesh) || !(mesh.material instanceof THREE.MeshBasicMaterial))
        throw new Error('Expected measure mesh');
      expect(mesh.material.transparent).toBe(true);
      for (const image of imageMeshes) expect(mesh.renderOrder).toBeGreaterThan(image.renderOrder);
      materials.add(mesh.material);
    }
    expect(materials.size).toBe(2);
    const disposals = [...materials].map((material) => vi.spyOn(material, 'dispose'));
    scene.update({ ...frame, measureBox: null });
    for (const dispose of disposals) expect(dispose).toHaveBeenCalled();
  });

  it('centres the fill and four outline bars above the highest floor', () => {
    const { scene, frame, map, group } = setup();
    map.tilesById[map.grid[2][3]].elevationOverride = 4;
    scene.update(frame);
    expect(group()?.children).toHaveLength(5);
    const plane = group()?.children[0];
    expect(plane?.position.x).toBe(4);
    expect(plane?.position.z).toBe(2.5);
    expect(plane?.position.y).toBeCloseTo(4 * 0.35 + 0.02);
    if (!(plane instanceof THREE.Mesh) || !(plane.material instanceof THREE.MeshBasicMaterial))
      throw new Error('Expected plane');
    expect(plane.material.opacity).toBe(0.25);
    expect(plane.material.color.getHexString()).toBe('38bdf8');
    expect(group()?.children[1]).toMatchObject({ geometry: { parameters: { height: 0.06 } } });
    expect(group()?.children[3]).toMatchObject({ geometry: { parameters: { width: 0.06 } } });
  });
  it('renders nothing for null or players', () => {
    const { scene, frame, group } = setup();
    scene.update({ ...frame, measureBox: null });
    expect(group()).toBeUndefined();
    scene.update({ ...frame, fog: 'player-open' });
    expect(group()).toBeUndefined();
  });
  it('rebuilds only the measure group when the box changes, and disposes on clear', () => {
    const { scene, frame, group, add } = setup();
    scene.update(frame);
    const first = group();
    const mesh = first?.children[0];
    if (!(mesh instanceof THREE.Mesh)) throw new Error('Expected fill');
    const dispose = vi.spyOn(mesh.geometry, 'dispose');
    add.mockClear();
    scene.update(frame);
    expect(add).not.toHaveBeenCalled();
    scene.update({ ...frame, measureBox: { col: 1, row: 2, width: 2, height: 2 } });
    expect(first?.parent).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledExactlyOnceWith(group());
    const second = group();
    scene.update({ ...frame, measureBox: null });
    expect(second?.parent).toBeNull();
  });
  it('keeps tile-selection overlays intact when only the measure box changes', () => {
    const { scene, frame, map, add } = setup();
    frame.selectedTileIds = new Set([map.grid[2][2]]);
    scene.update(frame);
    add.mockClear();
    scene.update({ ...frame, measureBox: { col: 1, row: 1, width: 2, height: 2 } });
    expect(add.mock.calls.flat().map((object) => object.name)).toEqual(['measureBox']);
  });

  it('rebuilds the retained highlight when floor geometry changes', () => {
    const { scene, frame, map, group } = setup();
    scene.update(frame);
    const first = group();
    const tileId = map.grid[2][3];
    scene.update({
      ...frame,
      map: {
        ...map,
        tilesById: {
          ...map.tilesById,
          [tileId]: { ...map.tilesById[tileId], elevationOverride: 6 },
        },
      },
    });
    expect(first?.parent).toBeNull();
    expect(group()?.children[0].position.y).toBeCloseTo(6 * 0.35 + 0.02);
  });
});
