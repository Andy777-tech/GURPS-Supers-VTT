import { describe, expect, it } from 'vitest';
import type { MapImageLayer } from '../../types/map';
import { LOCKED_IMAGE_LAYER_KEYS, normalizeRotation, rotateImageLayer, stripLockedChanges } from '../imageLayerTransform';
import type { ImageLayerGeometry } from '../imageLayerTransform';

const original: ImageLayerGeometry = { x: 2, y: 1, width: 4, height: 3, rotation: 0 };

describe('image layer transforms', () => {
  it.each([['cw', 90], ['ccw', 270]] as const)('rotates %s around the footprint center', (direction, rotation) => {
    expect(rotateImageLayer(original, direction)).toEqual({ x: 2.5, y: 0.5, width: 3, height: 4, rotation });
    expect(original).toEqual({ x: 2, y: 1, width: 4, height: 3, rotation: 0 });
  });

  it('returns exactly to the original geometry after four clockwise turns', () => {
    let layer = original;
    for (let i = 0; i < 4; i++) layer = rotateImageLayer(layer, 'cw');
    expect(layer).toEqual(original);
  });

  it('defaults missing rotation and rounds geometry to three decimals', () => {
    expect(rotateImageLayer({ x: 0.12345, y: 0.23456, width: 4, height: 3 }, 'cw'))
      .toEqual({ x: 0.623, y: -0.265, width: 3, height: 4, rotation: 90 });
  });

  it.each([[450, 90], [-90, 270], [NaN, 0], [100, 90], [undefined, 0], [Infinity, 0], [360, 0]] as const)(
    'normalizes %s to %s', (value, expected) => expect(normalizeRotation(value)).toBe(expected),
  );

  it('strips all frozen keys, keeps all other changes, and does not mutate the input', () => {
    const allowed = {
      name: 'N', visible: false, opacity: 0.5, placement: 'overlay', gmOnly: true,
      locked: true, assetId: 'asset', mime: 'image/png', src: 'legacy',
    } satisfies Partial<MapImageLayer>;
    const changes = { ...allowed, x: 9, y: 8, width: 7, height: 6, rotation: 90, mirrorX: true, mirrorY: true, elevation: 5 } satisfies Partial<MapImageLayer>;
    const result = stripLockedChanges(changes);
    expect(result).toEqual(allowed);
    expect(result).not.toBe(changes);
    for (const key of LOCKED_IMAGE_LAYER_KEYS) {
      expect(changes).toHaveProperty(key);
      expect(result).not.toHaveProperty(key);
    }
  });

  it('preserves object identity when no keys need stripping', () => {
    const changes = { name: 'N', locked: false };
    expect(stripLockedChanges(changes)).toBe(changes);
  });

  it('requires unlocking and geometry edits to happen in separate steps', () => {
    expect(stripLockedChanges({ locked: false, x: 9, rotation: 90 })).toEqual({ locked: false });
  });
});
