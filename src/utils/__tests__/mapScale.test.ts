import { describe, expect, it } from 'vitest';
import type { MapScale } from '../../types/map';
import { MAP_SCALES, SCALE_DEFINITIONS, SCALE_TO_MODES, getTravelModeDefinition } from '../../constants/map';
import {
  formatMapScale, initialGridSizeForScale, isRoutableMap, isTacticalScale,
  legacyScaleToRung, overlandMilesPerTile, travelModesForScale,
} from '../mapScale';

describe('unit-carrying map scales', () => {
  it.each<[MapScale, string, number | null, number]>([
    ['1yd', '1 yd/square', null, 30],
    ['12mi', '12 mi' + '/tile', 12, 9],
    ['50mi', '50 mi' + '/tile', 50, 9],
    ['457mi', '457 mi' + '/tile', 457, 9],
  ])('defines every helper for %s', (scale, label, miles, size) => {
    expect(formatMapScale(scale)).toBe(label);
    expect(isTacticalScale(scale)).toBe(scale === '1yd');
    expect(isRoutableMap({ scale })).toBe(scale !== '1yd');
    expect(overlandMilesPerTile(scale)).toBe(miles);
    expect(initialGridSizeForScale(scale)).toBe(size);
    expect(travelModesForScale(scale)).toBe(SCALE_TO_MODES[scale]);
    expect(legacyScaleToRung(scale)).toBe(scale);
    expect(SCALE_DEFINITIONS[scale]).toMatchObject({
      id: scale, unit: miles === null ? 'yd' : 'mi', value: miles === null ? 1 : miles,
      tier: miles === null ? 'tactical' : 'overland', cellNoun: miles === null ? 'square' : 'tile',
    });
  });

  it('keeps picker order and mode availability exhaustive', () => {
    expect(MAP_SCALES).toEqual(Object.values(SCALE_DEFINITIONS));
    expect(MAP_SCALES.map(({ id }) => id)).toEqual(['1yd', '12mi', '50mi', '457mi']);
    expect(SCALE_TO_MODES).toEqual({
      '1yd': ['none'], '12mi': ['foot', 'boat', 'airship'],
      '50mi': ['boat', 'airship'], '457mi': ['airship'],
    });
    for (const mode of ['foot', 'boat', 'airship'] as const) {
      expect(getTravelModeDefinition(mode).id).toBe(mode);
    }
  });

  it.each<[unknown, MapScale]>([
    [12, '12mi'], [50, '50mi'], [457, '457mi'], ['1yd', '1yd'],
    ['12', '12mi'], [0, '12mi'], [undefined, '12mi'], [{}, '12mi'],
  ])('converts legacy %j to %s', (value, expected) => {
    expect(legacyScaleToRung(value)).toBe(expected);
  });
});
