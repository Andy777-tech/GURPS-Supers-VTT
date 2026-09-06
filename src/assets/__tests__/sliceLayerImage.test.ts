import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { sliceLayerImage } from '../sliceLayerImage';
import { createMemoryAssetStore, setAssetStoreForTests } from '../assetStore';
import { imageLayer } from './fixtures';
import type { ImageLayerRotation } from '../../types/map';

beforeEach(() => {
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 800;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      set src(_src: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setAssetStoreForTests(null);
});

function setup() {
  const contexts: {
    canvas: HTMLCanvasElement;
    matrix: THREE.Matrix4;
    drawImage: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    const matrix = new THREE.Matrix4();
    const drawImage = vi.fn();
    contexts.push({ canvas: this, matrix, drawImage });
    return {
      translate: (x: number, y: number) =>
        matrix.multiply(new THREE.Matrix4().makeTranslation(x, y, 0)),
      rotate: (angle: number) => matrix.multiply(new THREE.Matrix4().makeRotationZ(angle)),
      scale: (x: number, y: number) => matrix.multiply(new THREE.Matrix4().makeScale(x, y, 1)),
      drawImage,
    } as unknown as CanvasRenderingContext2D;
  });
  const bytes = new Uint8Array([1, 2, 3]);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  Object.defineProperty(blob, 'arrayBuffer', { value: async () => bytes.buffer });
  const encode = vi
    .spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((callback) => callback(blob));
  const store = createMemoryAssetStore();
  const url = vi.spyOn(store, 'getObjectUrl').mockResolvedValue('blob:asset');
  const put = vi.spyOn(store, 'put').mockResolvedValue('new-asset');
  setAssetStoreForTests(store);
  return { contexts, encode, url, put, bytes };
}

describe('sliceLayerImage', () => {
  it.each([0, 90, 180, 270] as const)(
    'matches MapScene corner transforms for %s degrees and all mirrors',
    async (rotation: ImageLayerRotation) => {
      for (const mirrorX of [false, true])
        for (const mirrorY of [false, true]) {
          const { contexts } = setup();
          const quarter = rotation === 90 || rotation === 270;
          const layer = imageLayer({
            assetId: 'asset',
            x: 2,
            y: 1,
            width: quarter ? 3 : 4,
            height: quarter ? 4 : 3,
            rotation,
            mirrorX,
            mirrorY,
            locked: true,
          });
          await sliceLayerImage(layer, {
            col: 2,
            row: 1,
            width: layer.width,
            height: layer.height,
          });
          const { matrix, canvas } = contexts[0];
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
          mesh.rotation.set(-Math.PI / 2, 0, (-rotation * Math.PI) / 180);
          mesh.scale.set(4 * (mirrorX ? -1 : 1), 3 * (mirrorY ? -1 : 1), 1);
          mesh.position.set(2 + layer.width / 2, 0, 1 + layer.height / 2);
          mesh.updateMatrixWorld();
          for (const [x, y] of [
            [0, 0],
            [800, 0],
            [0, 600],
            [800, 600],
          ]) {
            const pixel = new THREE.Vector3(x - 400, y - 300, 0).applyMatrix4(matrix);
            const world = new THREE.Vector3(x / 800 - 0.5, 0.5 - y / 600, 0).applyMatrix4(
              mesh.matrixWorld
            );
            expect(2 + (pixel.x / canvas.width) * layer.width).toBeCloseTo(world.x);
            expect(1 + (pixel.y / canvas.height) * layer.height).toBeCloseTo(world.z);
          }
          mesh.geometry.dispose();
          if (!Array.isArray(mesh.material)) mesh.material.dispose();
          vi.restoreAllMocks();
        }
    }
  );
  it('crops transformed pixels and stores JPEG 0.85 bytes, including locked layers', async () => {
    const { contexts, encode, url, put, bytes } = setup();
    expect(
      await sliceLayerImage(imageLayer({ assetId: 'asset', x: 2, y: 1, locked: true }), {
        col: 3,
        row: 1,
        width: 2,
        height: 2,
      })
    ).toEqual({ assetId: 'new-asset', mime: 'image/jpeg' });
    expect(url).toHaveBeenCalledWith('asset');
    expect(contexts[0].drawImage).toHaveBeenCalledExactlyOnceWith(expect.any(Image), -400, -300);
    expect(contexts[1].drawImage).toHaveBeenCalledWith(
      contexts[0].canvas,
      200,
      0,
      400,
      400,
      0,
      0,
      400,
      400
    );
    expect(encode).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
    expect(put).toHaveBeenCalledWith(bytes, 'image/jpeg');
  });
  it('supports legacy src and returns null for missing or disjoint images', async () => {
    const { put, url } = setup();
    await expect(
      sliceLayerImage(imageLayer(), { col: 1, row: 1, width: 1, height: 1 })
    ).resolves.toMatchObject({ assetId: 'new-asset' });
    expect(url).not.toHaveBeenCalled();
    put.mockClear();
    expect(await sliceLayerImage(imageLayer(), { col: 8, row: 8, width: 1, height: 1 })).toBeNull();
    url.mockResolvedValue(null);
    expect(
      await sliceLayerImage(imageLayer({ assetId: 'missing' }), {
        col: 1,
        row: 1,
        width: 1,
        height: 1,
      })
    ).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });
  it('rejects encoding failure without storing an asset', async () => {
    const { encode, put } = setup();
    encode.mockImplementation((callback) => callback(null));
    await expect(
      sliceLayerImage(imageLayer(), { col: 1, row: 1, width: 1, height: 1 })
    ).rejects.toThrow('Failed to encode image');
    expect(put).not.toHaveBeenCalled();
  });
});
