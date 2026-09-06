import { describe, expect, it } from 'vitest';
import type { MapStamp } from '../../types/map';
import { imageLayer } from '../../assets/__tests__/fixtures';
import { defaultFootprint } from '../footprints';
import { MIN_ALIGN_BOX } from '../imageAlign';
import {
  clipMeasureBoxToLayer,
  stampFromSlice,
  filterStamps,
  layerPixelRect,
  placeStamp,
  snapMeasureBox,
  stampFits,
  stampFromImage,
  stampFromLayer,
} from '../stamps';

const stamp: MapStamp = {
  id: 'room',
  name: 'Room',
  category: 'room',
  assetId: 'asset',
  width: 4,
  height: 3,
  placement: 'underlay',
  createdAt: 1,
};
const box = { col: 2, row: 1, width: 4, height: 2 };

describe('stamp geometry', () => {
  it('preserves PNG overlay metadata through copying and placement', () => {
    const copied = stampFromLayer(imageLayer({ assetId: 'png', mime: 'image/png', placement: 'overlay' }), 's', 'room', 1);
    expect(copied).toMatchObject({ mime: 'image/png', placement: 'overlay' });
    if (!copied) throw new Error('Expected stamp');
    expect(placeStamp(copied, { col: 2, row: 2 }, 0, 'layer', 1)).toMatchObject({
      mime: 'image/png', placement: 'overlay',
    });
  });
  it('preserves an explicit notched footprint at rotation zero', () => {
    const footprint = defaultFootprint(4, 3).filter(([x, y]) => x !== 3 || y !== 2);
    expect(placeStamp({ ...stamp, footprint }, { col: 2, row: 2 }, 0, 'l', 1).footprint).toEqual(footprint);
  });
  it('returns rotation zero for a non-fitting stamp when fit filtering is off', () => {
    expect(filterStamps([stamp], { box: { col: 0, row: 0, width: 1, height: 1 }, category: 'all', onlyFitting: false }))
      .toEqual([{ stamp, rotation: 0 }]);
  });
  it('clips right and bottom pixel edges with independent scales and handles fractional layer coordinates', () => {
    // 200 pixels/tile horizontally, 100 vertically; intersection is 1×1 tiles.
    expect(layerPixelRect(imageLayer({ x: 2, y: 1, width: 4, height: 3 }), 800, 300,
      { col: 5, row: 3, width: 4, height: 4 })).toEqual({ sx: 600, sy: 200, sw: 200, sh: 100 });
    expect(layerPixelRect(imageLayer({ x: 2.5, y: 1.5, width: 4.5, height: 3.5 }), 900, 700,
      { col: 3, row: 2, width: 2, height: 2 })).toEqual({ sx: 100, sy: 100, sw: 400, sh: 400 });
  });
  it('rounds imported width and keeps short images at least one tile high', () => {
    expect(stampFromImage('room.png', { assetId: 'a', aspect: 1 }, 3.6, 'room', 's', 1).width).toBe(4);
    expect(stampFromImage('room.png', { assetId: 'a', aspect: 0.1 }, 1, 'room', 's', 1).height).toBe(1);
  });
  it('gives a 4×2 slice exactly its eight footprint cells', () => {
    const sliced = stampFromSlice(imageLayer(), { assetId: 'slice' }, box, 'room', 's', 1);
    expect(sliced.footprint).toEqual(defaultFootprint(4, 2));
    expect(sliced.footprint).toHaveLength(8);
  });
  it('clips measure boxes to the layer tile rectangle', () => {
    const layer = imageLayer({ x: 2, y: 2, width: 4, height: 3 });
    expect(clipMeasureBoxToLayer(layer, { col: 4, row: 1, width: 4, height: 4 }))
      .toEqual({ col: 4, row: 2, width: 2, height: 3 });
    const inside = { col: 3, row: 2, width: 2, height: 2 };
    expect(clipMeasureBoxToLayer(layer, inside)).toEqual(inside);
    expect(clipMeasureBoxToLayer(layer, { col: 6, row: 2, width: 1, height: 1 })).toBeNull();
    expect(clipMeasureBoxToLayer(imageLayer({ x: 2.5, y: 1.5, width: 4.5, height: 3.5 }), inside)).toEqual(inside);
  });

  it('snaps each corner independently and keeps dimensions at least one', () => {
    expect(snapMeasureBox({ x: 2.4, y: 0.6, width: 3.3, height: 1.9 })).toEqual({
      col: 2,
      row: 1,
      width: 4,
      height: 2,
    });
    expect(snapMeasureBox({ x: 0, y: 0, width: MIN_ALIGN_BOX, height: MIN_ALIGN_BOX })).toEqual({
      col: 0,
      row: 0,
      width: 1,
      height: 1,
    });
    expect(snapMeasureBox({ x: 0, y: 0, width: 0.24, height: 1 })).toBeNull();
    expect(snapMeasureBox({ x: 0, y: 0, width: 1, height: 0.24 })).toBeNull();
  });
  it.each([
    [4, 2, 0],
    [2, 4, 90],
    [5, 5, null],
    [1, 1, 0],
    [4, 3, null],
  ] as const)('fits %s×%s with rotation %s', (width, height, rotation) => {
    expect(stampFits({ width, height }, box)).toBe(rotation);
  });
  it('filters category and fit, preserving rotation and sorting by name', () => {
    const stamps: MapStamp[] = [
      { ...stamp, id: 'z', name: 'Z', width: 5, height: 5 },
      { ...stamp, id: 'b', name: 'B', width: 2, height: 4, category: 'hallway' },
      { ...stamp, id: 'a', name: 'A', width: 4, height: 2 },
    ];
    expect(
      filterStamps(stamps, { box, category: 'all', onlyFitting: true }).map(
        ({ stamp: s, rotation }) => [s.id, rotation]
      )
    ).toEqual([
      ['a', 0],
      ['b', 90],
    ]);
    expect(
      filterStamps(stamps, { box, category: 'room', onlyFitting: false }).map(
        ({ stamp: s }) => s.id
      )
    ).toEqual(['a', 'z']);
    expect(
      filterStamps(stamps, { box: null, category: 'all', onlyFitting: true }).map(
        ({ rotation }) => rotation
      )
    ).toEqual([0, 0, 0]);
  });
  it('places ordinary and rotated footprints with their anchor and elevation', () => {
    expect(placeStamp(stamp, { col: 2, row: 1 }, 0, 'layer', 4)).toEqual({
      id: 'layer',
      name: 'Room',
      assetId: 'asset',
      mime: undefined,
      x: 2,
      y: 1,
      width: 4,
      height: 3,
      rotation: 0,
      mirrorX: false,
      mirrorY: false,
      locked: false,
      footprint: defaultFootprint(4, 3),
      placement: 'underlay',
      opacity: 1,
      visible: true,
      gmOnly: false,
      elevation: 4,
    });
    expect(placeStamp(stamp, { col: 2, row: 1 }, 90, 'layer', 2)).toMatchObject({
      x: 2,
      y: 1,
      width: 3,
      height: 4,
      rotation: 90,
      footprint: defaultFootprint(3, 4),
      elevation: 2,
    });
    const notched = {
      ...stamp,
      footprint: defaultFootprint(4, 3).filter(([x, y]) => x !== 3 || y !== 2),
    };
    expect(placeStamp(notched, { col: 0, row: 0 }, 90, 'layer', 1).footprint).toEqual(
      defaultFootprint(3, 4).filter(([x, y]) => x !== 0 || y !== 3)
    );
    expect(
      placeStamp({ ...notched, category: 'background' }, { col: 0, row: 0 }, 90, 'layer', 1)
    ).not.toHaveProperty('footprint');
    expect(placeStamp(notched, { col: 0, row: 0 }, 270, 'layer', 1).footprint).toEqual(
      defaultFootprint(3, 4).filter(([x, y]) => x !== 2 || y !== 0)
    );
  });
  it('copies asset metadata from a layer, clips footprint, and requires assetId', () => {
    const layer = imageLayer({
      assetId: 'asset',
      width: 3.6,
      height: 2.3,
      footprint: [
        [3, 1],
        [0, 0],
        [4, 0],
        [0, 2],
      ],
    });
    expect(stampFromLayer(layer, 'stamp', 'stairs', 42)).toEqual({
      id: 'stamp',
      name: layer.name,
      category: 'stairs',
      createdAt: 42,
      assetId: 'asset',
      mime: undefined,
      width: 4,
      height: 2,
      footprint: [
        [0, 0],
        [3, 1],
      ],
      placement: 'underlay',
    });
    expect(
      stampFromLayer(imageLayer({ assetId: 'asset', width: 0.1, height: 0.1 }), 's', 'room', 0)
    ).toMatchObject({ width: 1, height: 1 });
    expect(stampFromLayer(imageLayer({ assetId: 'asset' }), 's', 'room', 0)).not.toHaveProperty(
      'footprint'
    );
    expect(stampFromLayer(imageLayer(), 's', 'room', 0)).toBeNull();
  });
  it('derives file stamp dimensions and name', () => {
    expect(
      stampFromImage(
        'room.map.png',
        { assetId: 'a', mime: 'image/jpeg', aspect: 0.5 },
        3,
        'room',
        's',
        42
      )
    ).toMatchObject({ name: 'room.map', width: 3, height: 2, assetId: 'a', createdAt: 42 });
  });
  it('maps tile intersections to transformed image pixels', () => {
    const layer = imageLayer({ x: 2, y: 1, width: 4, height: 3 });
    expect(layerPixelRect(layer, 800, 600, { col: 3, row: 1, width: 2, height: 2 })).toEqual({
      sx: 200,
      sy: 0,
      sw: 400,
      sh: 400,
    });
    expect(
      layerPixelRect({ ...layer, width: 3, height: 4, rotation: 90 }, 600, 800, {
        col: 3,
        row: 2,
        width: 2,
        height: 2,
      })
    ).toEqual({ sx: 200, sy: 200, sw: 400, sh: 400 });
    expect(layerPixelRect(layer, 800, 600, { col: 1, row: 0, width: 2, height: 2 })).toEqual({
      sx: 0,
      sy: 0,
      sw: 200,
      sh: 200,
    });
    expect(layerPixelRect(layer, 800, 600, { col: 6, row: 1, width: 2, height: 2 })).toBeNull();
  });
});
