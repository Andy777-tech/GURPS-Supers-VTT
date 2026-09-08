import { migrateLegacyPosition as position, migrateCombatCoordinates as movementTree } from './combatCoordinates';
import { isCellPosition, isMapToken, isRecord } from './mapTokenSpatial';

type RecordValue = Record<string, unknown>;
const own = (value: RecordValue, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const without = (value: RecordValue, keys: string[]): RecordValue => Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

function fits(map: RecordValue, token: unknown): boolean {
  if (!isMapToken(token) || !Array.isArray(map.grid) || !isRecord(map.tilesById)) return false;
  return token.footprint.every(([dx, dy]) => {
    const row: unknown = map.grid instanceof Array ? map.grid[token.position.row + dy] : undefined;
    const tile: unknown = Array.isArray(row) ? row[token.position.col + dx] : undefined;
    return typeof tile === 'string' && isRecord(map.tilesById) && !!map.tilesById[tile];
  });
}

export function validateMapTokenCollections(input: unknown): boolean {
  if (!isRecord(input)) return true;
  if (isRecord(input.maps) && isRecord(input.maps.mapsById)) {
    for (const map of Object.values(input.maps.mapsById)) {
      if (!isRecord(map) || map.tokens === undefined) continue;
      if (!isRecord(map.tokens) || Object.entries(map.tokens).some(([id, token]) => !isMapToken(token) || token.id !== id || !fits(map, token))) return false;
    }
  }
  return !isRecord(input.checkpoints) || !Array.isArray(input.checkpoints.entries)
    || input.checkpoints.entries.every(entry => !isRecord(entry) || validateMapTokenCollections(entry.snapshot));
}

/** Shared raw rewrite for imported campaigns and typed local hydration, including checkpoints.
 * Archives and invalid legacy placements retain legacySpatial; only the active combat creates
 * live tokens. Existing valid tokens always win, and NPC library ids never identify instances.
 */
export function migrateMapTokens<T>(input: T): T {
  if (!isRecord(input)) return input;
  let result: RecordValue = input;
  const set = (key: string, value: unknown) => { if (value !== result[key]) result = { ...result, [key]: value }; };
  const mapsSlice = isRecord(input.maps) ? input.maps : undefined;
  const originalMaps = mapsSlice && isRecord(mapsSlice.mapsById) ? mapsSlice.mapsById : {};
  let maps = originalMaps;
  let legacyMaps = mapsSlice?.legacyMaps;
  const setMap = (id: string, map: unknown) => { if (map !== maps[id]) maps = { ...maps, [id]: map }; };
  for (const [id, map] of Object.entries(maps)) {
    if (!isRecord(map)) {
      maps = { ...maps }; delete maps[id];
      legacyMaps = { ...(isRecord(legacyMaps) ? legacyMaps : {}), [id]: map };
      continue;
    }
    if (isRecord(map) && !isRecord(map.tokens)) setMap(id, { ...map, tokens: {} });
    else if (isRecord(map) && isRecord(map.tokens)) {
      const invalid = Object.entries(map.tokens).filter(([key, token]) => !fits(map, token) || !isMapToken(token) || token.id !== key);
      if (invalid.length) setMap(id, { ...map,
        tokens: Object.fromEntries(Object.entries(map.tokens).filter(([key]) => !invalid.some(([bad]) => bad === key))),
        legacyTokens: { ...(isRecord(map.legacyTokens) ? map.legacyTokens : {}), ...Object.fromEntries(invalid) },
      });
    }
  }
  const fixCombat = (value: unknown, archive: boolean): unknown => {
    if (!isRecord(value)) return value;
    let combat = movementTree(value) as RecordValue;
    if (!Array.isArray(combat.participants)) return combat;
    let changed = false;
    const participants = combat.participants.map((participant: unknown, index: number) => {
      if (!isRecord(participant)) return participant;
      const hasRef = own(participant, 'tokenRef') && participant.tokenRef != null;
      const ref = isRecord(participant.tokenRef) ? participant.tokenRef : undefined;
      const refMap = ref && typeof ref.mapId === 'string' ? maps[ref.mapId] : undefined;
      const existing = isRecord(refMap) && isRecord(refMap.tokens) && typeof ref?.tokenId === 'string' ? refMap.tokens[ref.tokenId] : undefined;
      const validRef = isRecord(refMap) && fits(refMap, existing);
      const hasLegacy = own(participant, 'position') || own(participant, 'facing');
      if (!hasLegacy && (!hasRef || validRef)) return participant;
      let next = without(participant, ['position', 'facing', 'tokenRef']);
      if (validRef) next.tokenRef = participant.tokenRef;
      else if (!archive && hasLegacy && typeof combat.mapId === 'string') {
        const map = maps[combat.mapId];
        const pos = position(participant.position);
        const tokenId = `legacy:${encodeURIComponent(String(combat.id ?? 'combat'))}:${encodeURIComponent(String(participant.instanceId ?? participant.id ?? index))}`;
        const tokens = isRecord(map) && isRecord(map.tokens) ? map.tokens : {};
        const token = tokens[tokenId] ?? { id: tokenId, position: pos, facing: participant.facing ?? 0,
          footprint: [[0, 0]], label: typeof participant.name === 'string' ? participant.name : 'Token',
          ...(typeof participant.partyCharacterId === 'string' ? { partyCharacterId: participant.partyCharacterId } :
            typeof participant.libraryId === 'string' ? { libraryId: participant.libraryId } : {}) };
        if (isRecord(map) && isCellPosition(pos) && fits(map, token)) {
          if (!tokens[tokenId]) setMap(combat.mapId, { ...map, tokens: { ...tokens, [tokenId]: token } });
          next.tokenRef = { mapId: combat.mapId, tokenId };
        }
      }
      if (hasLegacy || (hasRef && !validRef)) next.legacySpatial = {
        ...(isRecord(participant.legacySpatial) ? participant.legacySpatial : {}),
        mapId: combat.mapId,
        ...(hasLegacy ? { position: position(participant.position), facing: participant.facing } : {}),
        ...(hasRef && !validRef ? { tokenRef: participant.tokenRef } : {}),
      };
      changed = true;
      return next;
    });
    if (changed) combat = { ...combat, participants };
    const map = typeof combat.mapId === 'string' ? maps[combat.mapId] : undefined;
    if (!archive && isRecord(map) && Array.isArray(map.grid) && isRecord(combat.turnDecisions)) {
      let decisionsChanged = false;
      const turnDecisions = Object.fromEntries(Object.entries(combat.turnDecisions).map(([key, decision]) => {
        if (!isRecord(decision) || !isRecord(decision.movement)) return [key, decision];
        let movement = decision.movement;
        for (const [positionKey, tileKey] of [['fromPosition', 'fromTileId'], ['toPosition', 'toTileId']]) {
          const pos = movement[positionKey];
          if (movement[tileKey] !== undefined || !isCellPosition(pos)) continue;
          const row: unknown = Array.isArray(map.grid) ? map.grid[pos.row] : undefined;
          const tile: unknown = Array.isArray(row) ? row[pos.col] : undefined;
          if (typeof tile === 'string') movement = { ...movement, [tileKey]: tile };
        }
        if (movement === decision.movement) return [key, decision];
        decisionsChanged = true;
        return [key, { ...decision, movement }];
      }));
      if (decisionsChanged) combat = { ...combat, turnDecisions };
    }
    return combat;
  };
  if (isRecord(input.combat)) {
    let combat = input.combat;
    for (const key of ['activeSession', 'active']) {
      const next = fixCombat(combat[key], false);
      if (next !== combat[key]) combat = { ...combat, [key]: next };
    }
    set('combat', combat);
  }
  const fixArchive = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const entries = value.map(fixArchive);
      return entries.some((entry, i) => entry !== value[i]) ? entries : value;
    }
    if (!isRecord(value)) return value;
    const root = Array.isArray(value.participants) ? fixCombat(value, true) as RecordValue : value;
    let changed = root !== value;
    const entries = Object.entries(root).map(([key, child]) => {
      const next = key === 'participants' ? child : fixArchive(child);
      changed ||= next !== child;
      return [key, next];
    });
    return changed ? Object.fromEntries(entries) : root;
  };
  if (own(input, 'combatActive')) set('combatActive', fixCombat(input.combatActive, false));
  if (Array.isArray(input.combatHistory)) {
    const history = input.combatHistory.map(value => fixCombat(value, true));
    if (history.some((value, i) => value !== (input.combatHistory as unknown[])[i])) set('combatHistory', history);
  }
  if (own(input, 'combatActiveHistory')) set('combatActiveHistory', fixArchive(movementTree(input.combatActiveHistory)));
  if (isRecord(input.entities) && Array.isArray(input.entities.combatHistory)) {
    const old = input.entities.combatHistory;
    const history = old.map(value => fixCombat(value, true));
    if (history.some((value, i) => value !== old[i])) set('entities', { ...input.entities, combatHistory: history });
  }
  if (mapsSlice && maps !== originalMaps) set('maps', { ...mapsSlice, mapsById: maps, ...(legacyMaps !== mapsSlice.legacyMaps ? { legacyMaps } : {}) });
  if (isRecord(input.checkpoints) && Array.isArray(input.checkpoints.entries)) {
    const old = input.checkpoints.entries;
    const entries = old.map((entry: unknown) => {
      if (!isRecord(entry) || !isRecord(entry.snapshot)) return entry;
      const snapshot = migrateMapTokens(entry.snapshot);
      return snapshot === entry.snapshot ? entry : { ...entry, snapshot };
    });
    if (entries.some((entry, i) => entry !== old[i])) set('checkpoints', { ...input.checkpoints, entries });
  }
  return result as T;
}
