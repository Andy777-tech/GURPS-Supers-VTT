import type { CombatState } from '../types/combatTracker';
import type { MapTokenReference, MapTokenModel } from '../types/map';
import { isRecord, isMapToken } from './mapTokenSpatial';

interface HistoryTarget { tokenRef?: MapTokenReference; tileId?: string; createdToken?: MapTokenModel; removeCreatedToken?: boolean }

/** Spatial portion of an undo/redo. Movement and maneuver changes use the same restoration path. */
export function combatTokenHistoryTarget(before: CombatState, after: CombatState, action: unknown, undo: boolean): HistoryTarget | undefined {
  const move = isRecord(action) && isRecord(action.tokenMove) ? action.tokenMove : undefined;
  if (move) {
    const ref = move.tokenRef;
    const tileId = move[undo ? 'fromTileId' : 'toTileId'];
    return {
      tokenRef: isRecord(ref) && typeof ref.mapId === 'string' && typeof ref.tokenId === 'string' ? { mapId: ref.mapId, tokenId: ref.tokenId } : undefined,
      tileId: typeof tileId === 'string' ? tileId : undefined,
      ...(isMapToken(move.createdToken) ? undo ? { removeCreatedToken: true } : { createdToken: move.createdToken } : {}),
    };
  }
  for (const key of new Set([...Object.keys(before.turnDecisions), ...Object.keys(after.turnDecisions)])) {
    const old = before.turnDecisions[key]?.movement;
    const next = after.turnDecisions[key]?.movement;
    if (!!old === !!next) continue;
    const participant = after.participants.find(p => key.endsWith(`_${p.instanceId}`));
    const tileId = next?.toTileId ?? old?.fromTileId;
    if (participant?.tokenRef && tileId) return { tokenRef: participant.tokenRef, tileId };
  }
  return undefined;
}
