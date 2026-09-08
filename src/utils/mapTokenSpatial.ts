import { migrateCombatCoordinates } from './combatCoordinates';
import type { CellPosition, MapModel, MapTokenModel, MapTokenReference } from '../types/map';
import type { Participant, CombatState } from '../types/combatTracker';
import type { MapState } from '../types/map';
import { defaultFootprint } from './footprints';
import { findTileGridPos } from './mapUtils';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function isCellPosition(value: unknown): value is CellPosition {
  return isRecord(value) && Number.isSafeInteger(value.col) && Number.isSafeInteger(value.row);
}

export function isMapToken(value: unknown): value is MapTokenModel {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.label !== 'string'
    || !isCellPosition(value.position) || !Number.isInteger(value.facing)
    || typeof value.facing !== 'number' || value.facing < 0 || value.facing > 7
    || !Array.isArray(value.footprint) || !value.footprint.length) return false;
  if (value.partyCharacterId !== undefined && typeof value.partyCharacterId !== 'string') return false;
  if (value.libraryId !== undefined && typeof value.libraryId !== 'string') return false;
  if (value.partyCharacterId && value.libraryId) return false;
  if (value.playerDisplay !== undefined && (!isRecord(value.playerDisplay)
    || typeof value.playerDisplay.visible !== 'boolean' || typeof value.playerDisplay.label !== 'string')) return false;
  const cells = new Set<string>();
  for (const cell of value.footprint) {
    if (!Array.isArray(cell) || cell.length !== 2 || !cell.every(Number.isSafeInteger)) return false;
    const key = `${cell[0]},${cell[1]}`;
    if (cells.has(key)) return false;
    cells.add(key);
  }
  return true;
}

export function tokenFitsMap(map: Pick<MapModel, 'grid' | 'tilesById'>, token: unknown): token is MapTokenModel {
  return isMapToken(token) && token.footprint.every(([dx, dy]) => {
    const tile = map.grid[token.position.row + dy]?.[token.position.col + dx];
    return !!tile && !!map.tilesById[tile];
  });
}

export function resolveParticipantToken(maps: Pick<MapState, 'mapsById'>, participant: Pick<Participant, 'tokenRef'> | undefined): MapTokenModel | undefined {
  const ref = participant?.tokenRef;
  const map = ref && maps.mapsById[ref.mapId];
  const token = map && map.tokens?.[ref.tokenId];
  return token && tokenFitsMap(map, token) ? token : undefined;
}

export function participantPosition(map: MapModel | null | undefined, participant: Pick<Participant, 'tokenRef'> | undefined): CellPosition | undefined {
  return map ? resolveParticipantToken({ mapsById: { [map.id]: map } }, participant)?.position : undefined;
}

export function tokenAtCell(map: MapModel, row: number, col: number, preferredId?: string | null): MapTokenModel | undefined {
  const tokens = Object.values(map.tokens ?? {});
  if (preferredId) tokens.sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId));
  return tokens.find(token => tokenFitsMap(map, token) &&
    token.footprint.some(([dx, dy]) => token.position.col + dx === col && token.position.row + dy === row));
}

export function tokenTileIds(map: MapModel, token: MapTokenModel): string[] {
  return token.footprint.flatMap(([dx, dy]) => {
    const tile = map.grid[token.position.row + dy]?.[token.position.col + dx];
    return tile && map.tilesById[tile] ? [tile] : [];
  });
}

export function participantToken(participant: Participant, id: string, position: CellPosition): MapTokenModel {
  return { id, position, label: participant.name, facing: 0, footprint: defaultFootprint(1, 1),
    ...(participant.partyCharacterId ? { partyCharacterId: participant.partyCharacterId } :
      participant.libraryId ? { libraryId: participant.libraryId } : {}) };
}

export function attachEncounterTokens(combat: CombatState, maps: MapState): CombatState {
  const map = combat.mapId ? maps.mapsById[combat.mapId] : undefined;
  if (!map) return combat;
  const used = new Set(combat.participants.flatMap(p => p.tokenRef?.mapId === map.id ? [p.tokenRef.tokenId] : []));
  let changed = false;
  const participants = combat.participants.map(p => {
    if (p.tokenRef) return p;
    const token = Object.values(map.tokens ?? {}).find(t => !used.has(t.id) && tokenFitsMap(map, t) &&
      (p.partyCharacterId ? t.partyCharacterId === p.partyCharacterId : !!p.libraryId && t.libraryId === p.libraryId));
    if (!token) return p;
    used.add(token.id);
    changed = true;
    return { ...p, tokenRef: { mapId: map.id, tokenId: token.id } };
  });
  return changed ? { ...combat, participants } : combat;
}

/** Reassigning the selected combat map leaves the old scene intact and unplaces foreign references. */
export function reassignCombatMap(combat: CombatState, maps: MapState): CombatState {
  const detached = new Set<string>();
  const participants = combat.participants.map(p => {
    if (!p.tokenRef || p.tokenRef.mapId === combat.mapId) return p;
    detached.add(p.instanceId);
    const { tokenRef: _ref, ...rest } = p;
    return rest;
  });
  const turnDecisions = Object.fromEntries(Object.entries(combat.turnDecisions).map(([key, decision]) =>
    [...detached].some(id => key.endsWith(`_${id}`)) ? [key, { ...decision, movement: undefined }] : [key, decision]));
  return attachEncounterTokens({ ...combat, participants, turnDecisions }, maps);
}

/** Combat-only imports have no campaign identity. Never bind foreign ids to local maps. */
export function detachImportedCombat(combat: CombatState): CombatState {
  combat = migrateCombatCoordinates(combat);
  const { mapId, ...rest } = combat;
  return { ...rest, participants: combat.participants.map(p => {
    const raw = p as Participant & { position?: unknown; facing?: unknown };
    const { tokenRef, position, facing, ...participant } = raw;
    return tokenRef || position !== undefined || facing !== undefined
      ? { ...participant, legacySpatial: { ...participant.legacySpatial, mapId, tokenRef, position, facing } } : participant;
  }) };
}

/** Stable tile ids make movement records portable across top/left expansion and history replay. */
export function rebaseCombatMovement(combat: CombatState, maps: MapState): CombatState {
  let changed = false;
  const turnDecisions = Object.fromEntries(Object.entries(combat.turnDecisions).map(([key, decision]) => {
    const movement = decision.movement;
    if (!movement) return [key, decision];
    const participant = combat.participants.find(p => key.endsWith(`_${p.instanceId}`));
    const map = maps.mapsById[participant?.tokenRef?.mapId ?? combat.mapId ?? ''];
    if (!map) return [key, decision];
    const from = movement.fromTileId && findTileGridPos(map, movement.fromTileId);
    const to = movement.toTileId && findTileGridPos(map, movement.toTileId);
    if (!from && !to) return [key, decision];
    if ((!from || (from.col === movement.fromPosition.col && from.row === movement.fromPosition.row)) &&
      (!to || (to.col === movement.toPosition.col && to.row === movement.toPosition.row))) return [key, decision];
    changed = true;
    return [key, { ...decision, movement: { ...movement, fromPosition: from || movement.fromPosition, toPosition: to || movement.toPosition } }];
  }));
  return changed ? { ...combat, turnDecisions } : combat;
}

export interface TokenMoveHistory {
  tokenRef: MapTokenReference;
  fromTileId: string;
  toTileId: string;
}

export function translateCombatMovement(combat: CombatState, mapId: string, col: number, row: number): CombatState {
  let changed = false;
  const turnDecisions = Object.fromEntries(Object.entries(combat.turnDecisions ?? {}).map(([key, decision]) => {
    const p = combat.participants.find(p => key.endsWith(`_${p.instanceId}`));
    if (!decision.movement || (p?.tokenRef?.mapId ?? combat.mapId) !== mapId) return [key, decision];
    changed = true;
    const m = decision.movement;
    return [key, { ...decision, movement: { ...m,
      fromPosition: { col: m.fromPosition.col + col, row: m.fromPosition.row + row },
      toPosition: { col: m.toPosition.col + col, row: m.toPosition.row + row },
    } }];
  }));
  return changed ? { ...combat, turnDecisions } : combat;
}
