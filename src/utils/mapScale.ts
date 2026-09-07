import type { MapModel, MapScale, TravelMode } from '../types/map';
import { INITIAL_GRID_SIZE, SCALE_DEFINITIONS, SCALE_TO_MODES, TACTICAL_INITIAL_GRID_SIZE } from '../constants/map';

export function isTacticalScale(scale: MapScale): boolean {
  return SCALE_DEFINITIONS[scale].tier === 'tactical';
}

export function isRoutableMap(map: Pick<MapModel, 'scale'>): boolean {
  return SCALE_DEFINITIONS[map.scale].tier === 'overland';
}

export function overlandMilesPerTile(scale: MapScale): number | null {
  const definition = SCALE_DEFINITIONS[scale];
  return definition.tier === 'overland' ? definition.value : null;
}

export function formatMapScale(scale: MapScale): string {
  const { value, unit, cellNoun } = SCALE_DEFINITIONS[scale];
  return `${value} ${unit}/${cellNoun}`;
}

export function travelModesForScale(scale: MapScale): readonly TravelMode[] {
  return SCALE_TO_MODES[scale];
}

export function legacyScaleToRung(value: unknown): MapScale {
  switch (value) {
    case '1yd': return value;
    case 12: case '12mi': return '12mi';
    case 50: case '50mi': return '50mi';
    case 457: case '457mi': return '457mi';
    default: return '12mi';
  }
}

export function initialGridSizeForScale(scale: MapScale): number {
  return isTacticalScale(scale) ? TACTICAL_INITIAL_GRID_SIZE : INITIAL_GRID_SIZE;
}
