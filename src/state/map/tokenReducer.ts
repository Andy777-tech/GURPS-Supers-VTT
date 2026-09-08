import type { Draft } from 'immer';
import type { CampaignState } from '../campaignReducer';
import type { TokenAction } from './mapActions';
import type { MapModel, MapTokenModel } from '../../types/map';
import { isCellPosition, isRecord, participantToken, rebaseCombatMovement, tokenFitsMap } from '../../utils/mapTokenSpatial';
import { getMovementBudgetYards } from '../../constants/maneuvers';
import { findTileGridPos } from '../../utils/mapUtils';

/** Only persisted tokens occupy cells; presentation group/vehicle markers do not. */
function overlapsAnotherToken(map: MapModel, token: MapTokenModel): boolean {
  const cells = new Set(token.footprint.map(([dx, dy]) => `${token.position.col + dx},${token.position.row + dy}`));
  return Object.values(map.tokens ?? {}).some(other => other.id !== token.id &&
    other.footprint.some(([dx, dy]) => cells.has(`${other.position.col + dx},${other.position.row + dy}`)));
}

export function handleTokenAction(draft: Draft<CampaignState>, action: TokenAction): void {
  const payload = action.payload;
  if (!isRecord(payload)) return;
  if (action.type === 'map/restoreCombatMove') {
    const { combat, tokenRef, tileId } = action.payload;
    if (draft.combat.activeSession?.id !== combat.id) return;
    if (tokenRef) {
      const map = draft.maps.mapsById[tokenRef.mapId];
      const token = map?.tokens?.[tokenRef.tokenId];
      const position = map && tileId ? findTileGridPos(map, tileId) : undefined;
      if (action.payload.removeCreatedToken && token) delete map.tokens[tokenRef.tokenId];
      else if (token) {
        if (!position || !tokenFitsMap(map, { ...token, position }) || overlapsAnotherToken(map, { ...token, position })) return;
        token.position = position;
      } else if (map && position && action.payload.createdToken?.id === tokenRef.tokenId) {
        const restored = { ...action.payload.createdToken, position };
        if (!tokenFitsMap(map, restored) || overlapsAnotherToken(map, restored)) return;
        map.tokens ??= {};
        map.tokens[tokenRef.tokenId] = restored;
      }
    }
    draft.combat.activeSession = rebaseCombatMovement(combat, draft.maps);
    return;
  }
  const map = draft.maps.mapsById[action.payload.mapId];
  if (!map) return;
  if (action.type === 'map/addToken') {
    const token = action.payload.token;
    if (!tokenFitsMap(map, token) || map.tokens?.[token.id] || overlapsAnotherToken(map, token)) return;
    map.tokens ??= {};
    map.tokens[token.id] = token;
  } else if (action.type === 'map/updateToken') {
    const token = map.tokens?.[action.payload.tokenId];
    if (!token || !isRecord(action.payload.changes)) return;
    const next = { ...token };
    for (const key of ['label', 'facing', 'footprint', 'partyCharacterId', 'libraryId'] as const) {
      if (Object.prototype.hasOwnProperty.call(action.payload.changes, key)) Object.assign(next, { [key]: action.payload.changes[key] });
    }
    if (!tokenFitsMap(map, next)) return;
    const resized = next.footprint.length !== token.footprint.length || next.footprint.some(([dx, dy], i) =>
      dx !== token.footprint[i][0] || dy !== token.footprint[i][1]);
    if (resized && overlapsAnotherToken(map, next)) return;
    map.tokens[token.id] = next;
  } else if (action.type === 'map/removeToken') {
    if (!map.tokens?.[action.payload.tokenId]) return;
    delete map.tokens[action.payload.tokenId];
    // Consumers resolve missing references safely; retaining them prevents a later placement
    // from accidentally binding the participant to another instance with the same library id.
  } else if (action.type === 'map/moveToken') {
    const { position, participantId, mode, path = [], costYards = 0 } = action.payload;
    if (!isCellPosition(position) || (mode !== 'gm' && mode !== 'combat')) return;
    if (!Number.isFinite(costYards) || costYards < 0 || !Array.isArray(path)
      || !path.every(id => typeof id === 'string' && !!map.tilesById[id])) return;
    const combat = draft.combat.activeSession;
    const participant = participantId ? combat?.participants.find(p => p.instanceId === participantId) : undefined;
    if (participantId && !participant) return;
    if (participant?.tokenRef && participant.tokenRef.mapId !== map.id) return;
    if (participant?.tokenRef && action.payload.tokenId && action.payload.tokenId !== participant.tokenRef.tokenId) return;
    const tokenId = participant?.tokenRef?.tokenId ?? action.payload.tokenId ?? (participant ? `participant:${combat?.id}:${participant.instanceId}` : undefined);
    if (!tokenId) return;
    let token = map.tokens?.[tokenId];
    // A deleted reference stays unresolved until the GM explicitly places that participant again.
    if (!token && (!participant || mode !== 'gm')) return;
    const next = token ? { ...token, position } : participant ? participantToken(participant, tokenId, position) : undefined;
    if (!next || !tokenFitsMap(map, next) || overlapsAnotherToken(map, next)) return;
    if (token && token.position.col === position.col && token.position.row === position.row) return;
    const key = combat && participant ? `${combat.currentRound}_${combat.currentTurnIndex}_${participant.instanceId}` : undefined;
    if (mode === 'combat') {
      if (!combat || !participant || !key || !token || combat.turnOrder[combat.currentTurnIndex] !== participant.instanceId) return;
      const decision = combat.turnDecisions[key];
      const budget = decision?.maneuverId ? getMovementBudgetYards(decision.maneuverId, participant.basicMove, true) : 0;
      if (decision?.movement || !Number.isFinite(costYards) || costYards <= 0 || costYards > budget
        || !Array.isArray(path) || !path.every(id => typeof id === 'string' && !!map.tilesById[id])) return;
      if (action.payload.logEntry) combat.log.push(action.payload.logEntry);
      combat.turnDecisions[key] = { ...decision, movement: {
        fromPosition: { ...token.position }, toPosition: position, path, costYards,
        fromTileId: map.grid[token.position.row]?.[token.position.col], toTileId: map.grid[position.row]?.[position.col],
      } };
    }
    map.tokens ??= {};
    map.tokens[tokenId] = next;
    if (participant) participant.tokenRef = { mapId: map.id, tokenId };
  }
}
