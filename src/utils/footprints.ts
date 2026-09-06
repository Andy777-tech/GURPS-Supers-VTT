import type { FootprintCell, ImageLayerId, MapImageLayer, MapModel, TileId } from '../types/map';
import { findTileGridPos, getTileIdAt } from './mapUtils';
import { normalizeRotation } from './imageLayerTransform';

export const cellKey = (dx: number, dy: number): string => `${dx},${dy}`;

export function cellSet(cells: readonly FootprintCell[]): Set<string> {
  return new Set(cells.map(([dx, dy]) => cellKey(dx, dy)));
}

/** Default footprint: the whole bounding box. */
export function defaultFootprint(width: number, height: number): FootprintCell[] {
  const cells: FootprintCell[] = [];
  for (let dy = 0; dy < Math.round(height); dy += 1) {
    for (let dx = 0; dx < Math.round(width); dx += 1) cells.push([dx, dy]);
  }
  return cells;
}

/** Integer anchor of the layer. A layer with a footprint keeps integer geometry (snap on enable). */
export function layerAnchor(layer: Pick<MapImageLayer, 'x' | 'y'>): { col: number; row: number } {
  return { col: Math.round(layer.x), row: Math.round(layer.y) };
}

export function sortCells(cells: FootprintCell[]): FootprintCell[] {
  return [...cells].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
}

/**
 * Rotate the cell set a quarter turn within the w×h box (cw in grid coords,
 * y down). The box becomes h×w. cw: (dx,dy) → (h-1-dy, dx). ccw: (dx,dy) → (dy, w-1-dx).
 * Matches step 2: cw moves the image's top-left cell to the top-right.
 */
export function rotateFootprint(
  cells: readonly FootprintCell[],
  width: number,
  height: number,
  direction: 'cw' | 'ccw'
): FootprintCell[] {
  const w = Math.round(width);
  const h = Math.round(height);
  return sortCells(cells.map(([dx, dy]) => (
    direction === 'cw' ? [h - 1 - dy, dx] : [dy, w - 1 - dx]
  )));
}

/**
 * Toggling mirrorX/mirrorY flips the *image*, before rotation. In rendered
 * (grid) space that is a horizontal flip when rotation is 0/180 and a vertical
 * flip when rotation is 90/270 (the mirror axis is conjugated by the rotation).
 */
export function mirrorFootprint(
  cells: readonly FootprintCell[],
  width: number,
  height: number,
  axis: 'mirrorX' | 'mirrorY',
  rotation: number | undefined
): FootprintCell[] {
  const w = Math.round(width);
  const h = Math.round(height);
  const quarter = normalizeRotation(rotation) === 90 || normalizeRotation(rotation) === 270;
  const flipHorizontal = (axis === 'mirrorX') !== quarter;
  return sortCells(cells.map(([dx, dy]) => (
    flipHorizontal ? [w - 1 - dx, dy] : [dx, h - 1 - dy]
  )));
}

/** Add/remove absolute tiles; out-of-box tiles are ignored. An undefined footprint starts from the box. */
export function editFootprint(
  map: Pick<MapModel, 'grid' | 'rows' | 'cols'>,
  layer: Pick<MapImageLayer, 'x' | 'y' | 'width' | 'height' | 'footprint'>,
  tileIds: readonly TileId[],
  mode: 'add' | 'remove'
): FootprintCell[] {
  const anchor = layerAnchor(layer);
  const w = Math.round(layer.width);
  const h = Math.round(layer.height);
  const keys = cellSet(layer.footprint ?? defaultFootprint(w, h));
  for (const tileId of tileIds) {
    const pos = findTileGridPos(map, tileId);
    if (!pos) continue;
    const dx = pos.col - anchor.col;
    const dy = pos.row - anchor.row;
    if (dx < 0 || dy < 0 || dx >= w || dy >= h) continue;
    if (mode === 'add') keys.add(cellKey(dx, dy));
    else keys.delete(cellKey(dx, dy));
  }
  return sortCells([...keys].map((key) => key.split(',').map(Number) as FootprintCell));
}

/** Absolute tiles covered by the footprint; off-grid cells are dropped and no footprint yields an empty set. */
export function projectFootprint(
  map: Pick<MapModel, 'grid' | 'rows' | 'cols'>,
  layer: Pick<MapImageLayer, 'x' | 'y' | 'width' | 'height' | 'footprint'>
): Set<TileId> {
  const tiles = new Set<TileId>();
  if (!layer.footprint) return tiles;
  const anchor = layerAnchor(layer);
  for (const [dx, dy] of layer.footprint) {
    const tileId = getTileIdAt(map, anchor.row + dy, anchor.col + dx);
    if (tileId) tiles.add(tileId);
  }
  return tiles;
}

export interface FootprintIndex {
  /** layerId → absolute tiles */
  byLayer: Map<ImageLayerId, Set<TileId>>;
  /** tileId → layer ids covering it */
  byTile: Map<TileId, ImageLayerId[]>;
  /** tiles covered by 2+ footprints */
  overlap: Set<TileId>;
}

export function indexFootprints(map: Pick<MapModel, 'grid' | 'rows' | 'cols' | 'imageLayers'>): FootprintIndex {
  const byLayer = new Map<ImageLayerId, Set<TileId>>();
  const byTile = new Map<TileId, ImageLayerId[]>();
  const overlap = new Set<TileId>();
  for (const layer of map.imageLayers ?? []) {
    if (!layer.footprint) continue;
    const tiles = projectFootprint(map, layer);
    byLayer.set(layer.id, tiles);
    for (const tileId of tiles) {
      const owners = byTile.get(tileId);
      if (owners) {
        owners.push(layer.id);
        overlap.add(tileId);
      } else {
        byTile.set(tileId, [layer.id]);
      }
    }
  }
  return { byLayer, byTile, overlap };
}

/** Drop cells outside the rounded box and return them in row/column order. */
export function clipFootprint(cells: readonly FootprintCell[], width: number, height: number): FootprintCell[] {
  const w = Math.round(width);
  const h = Math.round(height);
  return sortCells(cells.filter(([dx, dy]) => dx >= 0 && dy >= 0 && dx < w && dy < h));
}
