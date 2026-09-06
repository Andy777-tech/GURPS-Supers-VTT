import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MapScene } from '../MapScene';
import type { MapSceneFrameData } from '../MapScene';
import type { MapImageLayer } from '../../../../types/map';
import { createMemoryAssetStore, setAssetStoreForTests } from '../../../../assets/assetStore';
import { imageLayer, imageState } from '../../../../assets/__tests__/fixtures';

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

function setup(layer: MapImageLayer) {
  setAssetStoreForTests(createMemoryAssetStore());
  const canvas = document.createElement('canvas');
  const scene = new MapScene(canvas, {
    onTileClick: vi.fn(), onTileContextMenu: vi.fn(), onTilePaintStart: vi.fn(),
    onTilePaintEnter: vi.fn(), onHoverTile: vi.fn(),
  });
  scenes.push(scene);
  const { map } = imageState([layer]);
  const frame: MapSceneFrameData = {
    map, fog: 'gm', visibleTileIds: null, selectedTileIds: null, routeTileIds: null,
    reachableTileIds: null, tokens: null, paintModeActive: false, placingToken: false, alignMode: null, footprints: null, edges: null,
  };
  const texture = new THREE.Texture<HTMLImageElement>();
  vi.spyOn(THREE.TextureLoader.prototype, 'load').mockReturnValue(texture);
  const add = vi.spyOn(THREE.Scene.prototype, 'add');
  const imageMesh = () => {
    const meshes = add.mock.calls.flat().flatMap((object) => object.children).filter(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh
        && child.material instanceof THREE.MeshBasicMaterial && child.material.map === texture,
    );
    const mesh = meshes[meshes.length - 1];
    if (!mesh) throw new Error('Missing image mesh');
    return mesh;
  };
  return { scene, frame, imageMesh };
}

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => {
  for (const scene of scenes.splice(0)) scene.dispose();
  vi.restoreAllMocks();
  setAssetStoreForTests(null);
});

function projectCorners(mesh: THREE.Mesh) {
  mesh.updateMatrixWorld(true);
  const position = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  return [[0, 1], [1, 1], [0, 0]].map(([u, v]) => {
    for (let i = 0; i < uv.count; i++) {
      if (uv.getX(i) === u && uv.getY(i) === v) {
        const projected = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        return [projected.x, projected.z];
      }
    }
    throw new Error(`Missing UV (${u}, ${v})`);
  });
}

const footprint = { x: 2, y: 1, width: 4, height: 3 };
const turnedFootprint = { x: 2.5, y: 0.5, width: 3, height: 4 };
const cases = [
  { ...footprint, rotation: 0, mirrorX: false, mirrorY: false, corners: [[2, 1], [6, 1], [2, 4]] },
  { ...turnedFootprint, rotation: 90, mirrorX: false, mirrorY: false, corners: [[5.5, 0.5], [5.5, 4.5], [2.5, 0.5]] },
  { ...footprint, rotation: 180, mirrorX: false, mirrorY: false, corners: [[6, 4], [2, 4], [6, 1]] },
  { ...turnedFootprint, rotation: 270, mirrorX: false, mirrorY: false, corners: [[2.5, 4.5], [2.5, 0.5], [5.5, 4.5]] },
  { ...footprint, rotation: 0, mirrorX: true, mirrorY: false, corners: [[6, 1], [2, 1], [6, 4]] },
  { ...footprint, rotation: 0, mirrorX: false, mirrorY: true, corners: [[2, 4], [6, 4], [2, 1]] },
  { ...turnedFootprint, rotation: 90, mirrorX: true, mirrorY: false, corners: [[5.5, 4.5], [5.5, 0.5], [2.5, 4.5]] },
] as const;

function expectCorners(actual: number[][], expected: readonly (readonly number[])[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach(([x, z], index) => {
    expect(x).toBeCloseTo(expected[index][0], 3);
    expect(z).toBeCloseTo(expected[index][1], 3);
  });
}

describe('MapScene image transforms', () => {
  it.each(cases)('projects image corners at $rotation°, mirrorX=$mirrorX, mirrorY=$mirrorY', ({ corners, ...geometry }) => {
    const { scene, frame, imageMesh } = setup(imageLayer(geometry));
    scene.update(frame);
    expectCorners(projectCorners(imageMesh()), corners);
  });

  it.each([
    { label: 'rotation', changes: { ...turnedFootprint, rotation: 90 }, corners: cases[1].corners },
    { label: 'mirrorX', changes: { mirrorX: true }, corners: cases[4].corners },
    { label: 'mirrorY', changes: { mirrorY: true }, corners: cases[5].corners },
  ] as const)('rebuilds when only $label (and its footprint) changes', ({ changes, corners }) => {
    const layer = imageLayer({ ...footprint, rotation: 0 });
    const { scene, frame, imageMesh } = setup(layer);
    scene.update(frame);
    const first = imageMesh();
    const original = projectCorners(first);
    expectCorners(original, cases[0].corners);
    scene.update({ ...frame, map: { ...frame.map, imageLayers: [{ ...layer, ...changes }] } });
    const second = imageMesh();
    expect(second).not.toBe(first);
    const projected = projectCorners(second);
    expect(projected).not.toEqual(original);
    expectCorners(projected, corners);
  });
});
