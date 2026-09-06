import type {
  ImageLayerId,
  ImageLayerRotation,
  MapImageLayer,
  MapStamp,
  StampCategory,
  StampId,
} from '../types/map';
import type { AlignBox } from './imageAlign';
import { MIN_ALIGN_BOX } from './imageAlign';
import { clipFootprint, defaultFootprint, rotateFootprint } from './footprints';

export const STAMP_CATEGORIES: readonly StampCategory[] = [
  'background',
  'room',
  'hallway',
  'stairs',
];
export interface MeasureBox {
  col: number;
  row: number;
  width: number;
  height: number;
}

export function snapMeasureBox(box: AlignBox): MeasureBox | null {
  if (box.width < MIN_ALIGN_BOX || box.height < MIN_ALIGN_BOX) return null;
  const col = Math.round(box.x);
  const row = Math.round(box.y);
  return {
    col,
    row,
    width: Math.max(1, Math.round(box.x + box.width) - col),
    height: Math.max(1, Math.round(box.y + box.height) - row),
  };
}

export function stampFits(
  stamp: Pick<MapStamp, 'width' | 'height'>,
  box: MeasureBox
): 0 | 90 | null {
  if (stamp.width <= box.width && stamp.height <= box.height) return 0;
  if (stamp.height <= box.width && stamp.width <= box.height) return 90;
  return null;
}

export function filterStamps(
  stamps: readonly MapStamp[],
  opts: {
    box: MeasureBox | null;
    category: StampCategory | 'all';
    onlyFitting: boolean;
  }
): { stamp: MapStamp; rotation: 0 | 90 }[] {
  return stamps
    .flatMap((stamp) => {
      if (opts.category !== 'all' && stamp.category !== opts.category) return [];
      const rotation = opts.box ? stampFits(stamp, opts.box) : 0;
      return rotation === null && opts.onlyFitting ? [] : [{ stamp, rotation: rotation ?? 0 }];
    })
    .sort((a, b) => a.stamp.name.localeCompare(b.stamp.name));
}

export function placeStamp(
  stamp: MapStamp,
  anchor: { col: number; row: number },
  rotation: ImageLayerRotation,
  layerId: ImageLayerId,
  elevation: number
): MapImageLayer {
  let { width, height } = stamp;
  let footprint = stamp.footprint ?? defaultFootprint(width, height);
  for (let turn = 0; turn < rotation / 90; turn++) {
    footprint = rotateFootprint(footprint, width, height, 'cw');
    [width, height] = [height, width];
  }
  return {
    id: layerId,
    name: stamp.name,
    assetId: stamp.assetId,
    mime: stamp.mime,
    x: anchor.col,
    y: anchor.row,
    width,
    height,
    rotation,
    mirrorX: false,
    mirrorY: false,
    locked: false,
    ...(stamp.category === 'background' ? {} : { footprint }),
    placement: stamp.placement,
    opacity: 1,
    visible: true,
    gmOnly: false,
    elevation,
  };
}

export function stampFromLayer(
  layer: MapImageLayer,
  id: StampId,
  category: StampCategory,
  createdAt: number
): MapStamp | null {
  if (!layer.assetId) return null;
  const width = Math.max(1, Math.round(layer.width));
  const height = Math.max(1, Math.round(layer.height));
  return {
    id,
    name: layer.name,
    category,
    createdAt,
    assetId: layer.assetId,
    mime: layer.mime,
    placement: layer.placement,
    width,
    height,
    ...(layer.footprint === undefined
      ? {}
      : { footprint: clipFootprint(layer.footprint, width, height) }),
  };
}

/** Clip a measure box to the integer tile rectangle covered by a layer. */
export function clipMeasureBoxToLayer(
  layer: Pick<MapImageLayer, 'x' | 'y' | 'width' | 'height'>,
  box: MeasureBox
): MeasureBox | null {
  const col = Math.max(box.col, Math.floor(layer.x));
  const row = Math.max(box.row, Math.floor(layer.y));
  const right = Math.min(box.col + box.width, Math.ceil(layer.x + layer.width));
  const bottom = Math.min(box.row + box.height, Math.ceil(layer.y + layer.height));
  if (right <= col || bottom <= row) return null;
  return { col, row, width: right - col, height: bottom - row };
}

/** imageW/imageH describe the transformed image (already swapped for 90/270).
 * Only the affine mapping from the rendered tile box to those pixels is needed. */
export function layerPixelRect(
  layer: Pick<MapImageLayer, 'x' | 'y' | 'width' | 'height' | 'rotation'>,
  imageW: number,
  imageH: number,
  box: MeasureBox
): { sx: number; sy: number; sw: number; sh: number } | null {
  const x = Math.max(layer.x, box.col);
  const y = Math.max(layer.y, box.row);
  const right = Math.min(layer.x + layer.width, box.col + box.width);
  const bottom = Math.min(layer.y + layer.height, box.row + box.height);
  if (right <= x || bottom <= y || imageW <= 0 || imageH <= 0) return null;
  return {
    sx: ((x - layer.x) / layer.width) * imageW,
    sy: ((y - layer.y) / layer.height) * imageH,
    sw: ((right - x) / layer.width) * imageW,
    sh: ((bottom - y) / layer.height) * imageH,
  };
}

/** Metadata for the file import path. */
export function stampFromImage(
  fileName: string,
  image: Pick<MapStamp, 'assetId' | 'mime'> & { aspect: number },
  widthTiles: number,
  category: StampCategory,
  id: StampId,
  createdAt: number
): MapStamp {
  const width = Math.max(1, Math.round(widthTiles));
  return {
    id,
    createdAt,
    name: fileName.replace(/\.[^.]+$/, '') || 'Image',
    category,
    assetId: image.assetId,
    mime: image.mime,
    width,
    height: Math.max(1, Math.round(width * image.aspect)),
    placement: 'underlay',
  };
}

/** A slice owns its full measured tile box; the cropped pixels are a new asset. */
export function stampFromSlice(
  layer: Pick<MapImageLayer, 'name' | 'placement'>,
  image: Pick<MapStamp, 'assetId' | 'mime'>,
  box: MeasureBox,
  category: StampCategory,
  id: StampId,
  createdAt: number
): MapStamp {
  return {
    id,
    name: `${layer.name} slice`,
    category,
    ...image,
    width: box.width,
    height: box.height,
    footprint: defaultFootprint(box.width, box.height),
    placement: layer.placement,
    createdAt,
  };
}
