import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MapScene } from '../MapScene';
import type { MapSceneFrameData } from '../MapScene';
import { createMemoryAssetStore, setAssetStoreForTests } from '../../../../assets/assetStore';
import { imageLayer, imageState } from '../../../../assets/__tests__/fixtures';
import { defaultFootprint } from '../../../../utils/footprints';

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
  setAssetStoreForTests(createMemoryAssetStore());
  const scene = new MapScene(document.createElement('canvas'), {
    onTileClick: vi.fn(), onTileContextMenu: vi.fn(), onTilePaintStart: vi.fn(),
    onTilePaintEnter: vi.fn(), onHoverTile: vi.fn(),
  });
  scenes.push(scene);
  const { map } = imageState([
    imageLayer({ id: 'A', x: 1, y: 1, footprint: defaultFootprint(4, 3).filter(([x, y]) => x !== 3 || y !== 2) }),
    imageLayer({ id: 'B', x: 3, y: 1, width: 3, footprint: defaultFootprint(3, 3) }),
  ]);
  const frame: MapSceneFrameData = {
    map, fog: 'gm', visibleTileIds: null, selectedTileIds: null, routeTileIds: null,
    reachableTileIds: null, tokens: null, paintModeActive: false, placingToken: false, alignMode: null,
    footprints: { editingLayerId: null, showTints: true }, edges: null,
  };
  const texture = new THREE.Texture<HTMLImageElement>();
  const load = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(texture);
  const add = vi.spyOn(THREE.Scene.prototype, 'add');
  const group = () => add.mock.calls.flat().reverse().find((object) => object.name === 'footprints');
  const meshes = () => group()?.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh) ?? [];
  return { scene, frame, add, load, group, meshes };
}

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  // jsdom does not implement canvas drawing; the checker algorithm still runs against this context.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return this.width === 4 ? { fillStyle: '', fillRect: vi.fn() } as unknown as CanvasRenderingContext2D : null;
  });
});
afterEach(() => {
  for (const scene of scenes.splice(0)) scene.dispose();
  vi.restoreAllMocks();
  setAssetStoreForTests(null);
});

describe('MapScene footprints', () => {
  it('renders layer tints and the 4×4 overlap checkerboard', () => {
    const { scene, frame, meshes } = setup();
    scene.update(frame);
    const rendered = meshes();
    expect(rendered.map((mesh) => mesh.count)).toEqual([11, 9, 5]);
    // Drawn after the underlay image planes (renderOrder 0) so the art cannot paint over them.
    expect(rendered.map((mesh) => mesh.renderOrder)).toEqual([900, 900, 901]);
    const [a, b, checker] = rendered.map((mesh) => mesh.material);
    expect(a).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(a).toMatchObject({ opacity: 0.18 });
    expect(b).toMatchObject({ opacity: 0.18 });
    if (!(checker instanceof THREE.MeshBasicMaterial)) throw new Error('Missing checker material');
    expect(checker.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(checker.map).toMatchObject({ magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
    expect(checker.map?.image).toMatchObject({ width: 4, height: 4 });
    expect((a as THREE.MeshBasicMaterial).color.getHexString()).toBe('22d3ee');
    const matrix = new THREE.Matrix4();
    rendered[0].getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeCloseTo(0.09);
  });

  it.each(['gm', 'player-open', 'player-los'] as const)('renders no footprint group with null feature data (%s)', (fog) => {
    const { scene, frame, group } = setup();
    scene.update({ ...frame, fog, footprints: null });
    expect(group()).toBeUndefined();
  });

  it('does not expose footprint geometry to players even if feature data is supplied', () => {
    const { scene, frame, group } = setup();
    scene.update({ ...frame, fog: 'player-open' });
    expect(group()).toBeUndefined();
  });

  it('rebuilds only footprints when editing changes, disposing the old geometry and keeping the checker texture', () => {
    const { scene, frame, group, meshes, add, load } = setup();
    scene.update(frame);
    const first = group();
    const initial = meshes();
    const instanceDispose = vi.spyOn(initial[0], 'dispose');
    const geometryDispose = vi.spyOn(initial[0].geometry, 'dispose');
    const material = initial[0].material;
    if (Array.isArray(material)) throw new Error('Unexpected material array');
    const materialDispose = vi.spyOn(material, 'dispose');
    const checker = initial[2].material;
    if (!(checker instanceof THREE.MeshBasicMaterial) || !checker.map) throw new Error('Missing checker');
    const texture = checker.map;
    const textureDispose = vi.spyOn(texture, 'dispose');
    add.mockClear();
    load.mockClear();
    scene.update({ ...frame, footprints: { editingLayerId: 'A', showTints: true } });
    expect(group()).not.toBe(first);
    expect(first?.parent).toBeNull();
    expect(instanceDispose).toHaveBeenCalledOnce();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledExactlyOnceWith(group());
    expect(load).not.toHaveBeenCalled();
    expect(meshes()[0].material).toMatchObject({ opacity: 0.45 });
    expect(meshes()[2].material).toMatchObject({ map: texture });
    const outline = group()?.children.find((child) => child instanceof THREE.LineSegments);
    expect(outline).toMatchObject({ renderOrder: 1500, material: { depthTest: false } });
    if (!(outline instanceof THREE.LineSegments)) throw new Error('Missing outline');
    const positions = outline.geometry.getAttribute('position');
    expect(positions.getY(0)).toBeCloseTo(0.4);
    const outlineDispose = vi.spyOn(outline.geometry, 'dispose');
    scene.update({ ...frame, footprints: null });
    expect(outlineDispose).toHaveBeenCalledOnce();
    expect(group()?.parent).toBeNull();
    scene.dispose();
    expect(textureDispose).toHaveBeenCalledOnce();
  });

  it('hides tints while preserving overlap and the editing highlight', () => {
    const { scene, frame, meshes } = setup();
    scene.update({ ...frame, footprints: { editingLayerId: null, showTints: false } });
    expect(meshes().map((mesh) => mesh.count)).toEqual([5]);
    scene.update({ ...frame, footprints: { editingLayerId: 'B', showTints: false } });
    expect(meshes().map((mesh) => mesh.count)).toEqual([9, 5]);
    expect(meshes()[0].material).toMatchObject({ opacity: 0.45 });
  });
});
