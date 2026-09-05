import type { ImageLayerRotation, MapImageLayer } from '../types/map';

export type ImageLayerGeometry = Pick<MapImageLayer, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/** Keys frozen by `locked` (see MapImageLayer.locked). */
export const LOCKED_IMAGE_LAYER_KEYS: ReadonlySet<keyof MapImageLayer> = new Set([
  'x', 'y', 'width', 'height', 'rotation', 'mirrorX', 'mirrorY', 'elevation',
]);

/** Coerce to the nearest quarter turn in [0, 360). Non-finite/undefined → 0. */
export function normalizeRotation(value: number | undefined): ImageLayerRotation {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return (((Math.round(value / 90) % 4) + 4) % 4 * 90) as ImageLayerRotation;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Swap footprint dimensions around the same center, rounding to 3 decimals. */
export function rotateImageLayer(layer: ImageLayerGeometry, direction: 'cw' | 'ccw'): ImageLayerGeometry {
  return {
    x: round3(layer.x + (layer.width - layer.height) / 2),
    y: round3(layer.y + (layer.height - layer.width) / 2),
    width: round3(layer.height),
    height: round3(layer.width),
    rotation: normalizeRotation(normalizeRotation(layer.rotation) + (direction === 'cw' ? 90 : -90)),
  };
}

/** Strip frozen keys, even alongside locked:false. Preserve identity when nothing is stripped. */
export function stripLockedChanges(changes: Partial<Omit<MapImageLayer, 'id'>>): Partial<Omit<MapImageLayer, 'id'>> {
  let result = changes;
  for (const key of LOCKED_IMAGE_LAYER_KEYS) {
    if (key === 'id' || !Object.prototype.hasOwnProperty.call(changes, key)) continue;
    if (result === changes) result = { ...changes };
    delete result[key];
  }
  return result;
}
