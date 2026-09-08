import { createMovementLogEntry } from './combatHelpers';
import { campaignReducer } from '../state/campaignReducer';
import type { CampaignState } from '../state/campaignReducer';
import type { TokenAction } from '../state/map/mapActions';
import { createLoadCombatStateAction } from './combatActions';
import { resolveParticipantToken } from './mapTokenSpatial';

/** Validate via the public reducer before dispatch; history is local and the drop persists once. */
export function commitTokenMove(state: CampaignState, dispatch: (action: TokenAction) => void,
  recordAction: (action: unknown) => void, action: Extract<TokenAction, { type: 'map/moveToken' }>): boolean {
  const actor = state.combat.activeSession?.participants.find(p => p.instanceId === action.payload.participantId);
  if (action.payload.mode === 'combat' && actor && state.combat.activeSession) {
    const combat = state.combat.activeSession;
    action = { ...action, payload: { ...action.payload, logEntry: createMovementLogEntry({
      round: combat.currentRound, turn: combat.currentTurnIndex, actorInstanceId: actor.instanceId,
      actorName: actor.name, yardsSpent: action.payload.costYards ?? 0,
    }) } };
  }
  const next = campaignReducer(state, action);
  if (next === state) return false;
  const before = state.combat.activeSession;
  const after = next.combat.activeSession;
  if (before && after && action.payload.participantId) {
    const p = after.participants.find(p => p.instanceId === action.payload.participantId);
    const prior = before.participants.find(p => p.instanceId === action.payload.participantId);
    const token = resolveParticipantToken(next.maps, p);
    const old = resolveParticipantToken(state.maps, prior);
    const map = state.maps.mapsById[action.payload.mapId];
    const historyAction = createLoadCombatStateAction(before, after);
    historyAction.label = 'Move token';
    historyAction.tokenMove = { tokenRef: p?.tokenRef,
      createdToken: old ? undefined : token,
      fromTileId: old && map.grid[old.position.row]?.[old.position.col],
      toTileId: token && map.grid[token.position.row]?.[token.position.col] };
    recordAction(historyAction);
  }
  dispatch(action);
  return true;
}

export function commitTokenRestoration(state: CampaignState, dispatch: (action: TokenAction) => void,
  payload: Extract<TokenAction, { type: 'map/restoreCombatMove' }>['payload']): boolean {
  const action = { type: 'map/restoreCombatMove', payload } as const;
  if (campaignReducer(state, action) === state) return false;
  dispatch(action);
  return true;
}
