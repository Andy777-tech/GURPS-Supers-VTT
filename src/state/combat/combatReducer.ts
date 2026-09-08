/**
 * Combat Reducer
 *
 * Handles state mutations for combat-related operations using Immer draft.
 * This reducer operates on both the combat slice and entities slice of campaign state.
 */

import type { Draft } from 'immer';
import { attachEncounterTokens, reassignCombatMap } from '../../utils/mapTokenSpatial';
import { getCombatView, ViewMode } from '../../utils/combatViewFilter';
import { getRevealForInstance, hasAnyReveals } from '../../utils/combatReveal';
import type { CombatState } from '../../types/combatTracker';
import type { CampaignState } from '../campaignReducer';
import {
  type CombatAction,
  COMBAT_CHARACTER_ADD,
  COMBAT_CHARACTER_UPDATE,
  COMBAT_CHARACTER_REMOVE,
  COMBAT_CHARACTERS_SET,
  COMBAT_ACTIVE_SET,
  COMBAT_ACTIVE_UPDATE,
  COMBAT_HISTORY_SET,
  COMBAT_TOMBSTONES_SET,
  COMBAT_RULES_PRESET_SET,
  COMBAT_ITEMS_SET,
  COMBAT_ITEM_ADD,
  COMBAT_REVEAL_STATE_SET,
  ENCOUNTER_TEMPLATE_ADD,
  ENCOUNTER_TEMPLATE_UPDATE,
  ENCOUNTER_TEMPLATE_REMOVE,
  ENCOUNTER_TEMPLATES_SET
} from './combatActions';

/** Keep the last player projection when a token outlives its combat participant. */
function retainDepartingTokenDisplay(draft: Draft<CampaignState>, next: CombatState | null): void {
  const prior = draft.combat.activeSession;
  if (!prior || !Array.isArray(prior.participants) || prior.participants.length === 0) return;
  const reveal = draft.combat.revealState ?? undefined;
  const view = getCombatView(prior, reveal, ViewMode.PLAYER);
  for (const p of prior.participants) {
    const ref = p.tokenRef;
    if (!ref || next?.participants.some(other => other.tokenRef?.mapId === ref.mapId && other.tokenRef.tokenId === ref.tokenId)) continue;
    const token = draft.maps.mapsById[ref.mapId]?.tokens?.[ref.tokenId];
    if (!token) continue;
    token.playerDisplay = { visible: hasAnyReveals(getRevealForInstance(reveal, p.instanceId, p.category)),
      label: view?.participants.find(other => other.instanceId === p.instanceId)?.name ?? 'Token' };
  }
}

/** Process combat actions within the campaign reducer's Immer draft. */
export function handleCombatAction(
  draft: Draft<CampaignState>,
  action: CombatAction
): boolean {
  switch (action.type) {
    // ========================================================================
    // COMBAT CHARACTER ACTIONS
    // ========================================================================
    case COMBAT_CHARACTER_ADD:
      draft.entities.combatCharacters[action.payload.id] = action.payload;
      return true;

    case COMBAT_CHARACTER_UPDATE:
      if (draft.entities.combatCharacters[action.payload.id]) {
        draft.entities.combatCharacters[action.payload.id] = {
          ...draft.entities.combatCharacters[action.payload.id],
          ...action.payload.changes
        };
      }
      return true;

    case COMBAT_CHARACTER_REMOVE:
      delete draft.entities.combatCharacters[action.payload];
      return true;

    case COMBAT_CHARACTERS_SET:
      draft.entities.combatCharacters = action.payload;
      return true;

    // ========================================================================
    // COMBAT SESSION ACTIONS
    // ========================================================================
    case COMBAT_ACTIVE_SET: {
      const next = action.payload && action.payload.mapId !== draft.combat.activeSession?.mapId
        ? reassignCombatMap(action.payload, draft.maps)
        : action.payload && action.payload.id !== draft.combat.activeSession?.id ? attachEncounterTokens(action.payload, draft.maps) : action.payload;
      retainDepartingTokenDisplay(draft, next);
      draft.combat.activeSession = next;
      return true;
    }

    case COMBAT_ACTIVE_UPDATE:
      if (draft.combat.activeSession) {
        let next = {
          ...draft.combat.activeSession,
          ...action.payload
        };
        if (next.mapId !== draft.combat.activeSession.mapId) next = reassignCombatMap(next, draft.maps);
        retainDepartingTokenDisplay(draft, next);
        draft.combat.activeSession = next;
      }
      return true;

    // ========================================================================
    // COMBAT HISTORY ACTIONS
    // ========================================================================
    case COMBAT_HISTORY_SET:
      draft.entities.combatHistory = action.payload;
      return true;

    case COMBAT_TOMBSTONES_SET:
      draft.entities.combatTombstones = action.payload;
      return true;

    // ========================================================================
    // COMBAT RULES ACTIONS
    // ========================================================================
    case COMBAT_RULES_PRESET_SET:
      draft.combat.rulesPreset = action.payload;
      return true;

    // ========================================================================
    // COMBAT ITEM ACTIONS
    // ========================================================================
    case COMBAT_ITEMS_SET:
      draft.entities.combatItems = action.payload;
      return true;

    case COMBAT_ITEM_ADD:
      draft.entities.combatItems[action.payload.id] = action.payload;
      return true;

    // ========================================================================
    // COMBAT REVEAL STATE ACTIONS (Phase 5)
    // ========================================================================
    case COMBAT_REVEAL_STATE_SET:
      draft.combat.revealState = action.payload;
      return true;

    // ========================================================================
    // ENCOUNTER TEMPLATE ACTIONS (Phase 11c)
    // ========================================================================
    case ENCOUNTER_TEMPLATE_ADD:
      draft.entities.encounterTemplates[action.payload.id] = action.payload;
      return true;

    case ENCOUNTER_TEMPLATE_UPDATE:
      if (draft.entities.encounterTemplates[action.payload.id]) {
        draft.entities.encounterTemplates[action.payload.id] = {
          ...draft.entities.encounterTemplates[action.payload.id],
          ...action.payload.changes
        };
      }
      return true;

    case ENCOUNTER_TEMPLATE_REMOVE:
      delete draft.entities.encounterTemplates[action.payload];
      return true;

    case ENCOUNTER_TEMPLATES_SET:
      draft.entities.encounterTemplates = action.payload;
      return true;

    default:
      return false;
  }
}
