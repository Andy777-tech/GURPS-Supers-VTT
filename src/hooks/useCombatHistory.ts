import { rebaseCombatMovement } from '../utils/mapTokenSpatial';
import { commitTokenRestoration } from '../utils/commitTokenMove';
import { useCampaignStore } from '../state/campaignStore';
import { combatTokenHistoryTarget } from '../utils/combatTokenHistory';
/**
 * useCombatHistory — persistent undo/redo history for combat.
 *
 * Extracted from CombatTracker (Phase 11a decomposition).
 * Shares history per campaign store across combat and map consumers
 * and triggers re-renders when canUndo/canRedo change.
 *
 * The history resets whenever the active combat's ID or selected map changes.
 */

import { useSyncExternalStore, useCallback, useEffect, useRef } from 'react';
import { useCombatStore } from './useCombatStore';
import {
  createHistoryState,
  createSnapshot,
  addAction,
  canUndo as histCanUndo,
  canRedo as histCanRedo,
  undo as histUndo,
  redo as histRedo,
} from '../utils/combatHistory';
import { syncRevealStateForParticipants } from '../utils/combatReveal';
import type {
  CombatState,
  HistoryState,
  RevealState,
} from '../types/combatTracker';
import type { UndoRedoResult } from '../utils/combatHistory';

export interface CombatHistoryResult {
  /** Current history state (for UI display — canUndo, canRedo, counts) */
  history: HistoryState;
  /** Record an action into the undo/redo stack */
  recordAction: (action: unknown) => void;
  /** Undo the last action */
  handleUndo: () => void;
  /** Redo the next action */
  handleRedo: () => void;
}

interface SharedHistory {
  value: HistoryState;
  combatId: string | null;
  listeners: Set<() => void>;
  get: () => HistoryState;
  subscribe: (listener: () => void) => () => void;
  set: (value: HistoryState) => void;
}
const histories = new WeakMap<object, SharedHistory>();
function historyFor(scope: object, combatId: string | null): SharedHistory {
  const existing = histories.get(scope);
  if (existing) return existing;
  const history: SharedHistory = {
    value: createHistoryState(), combatId, listeners: new Set(),
    get: () => history.value,
    subscribe: listener => { history.listeners.add(listener); return () => { history.listeners.delete(listener); }; },
    set: value => { history.value = value; history.listeners.forEach(listener => listener()); },
  };
  histories.set(scope, history);
  return history;
}

export function useCombatHistory(): CombatHistoryResult {
  const { state: campaignState, actions: { dispatchTokenAction: dispatch } } = useCampaignStore();
  const {
    combatActive,
    combatReveal,
    saveCombatActive,
    saveCombatReveal,
  } = useCombatStore();

  const combat = combatActive;
  const reveal = combatReveal as RevealState | null;

  const shared = historyFor(dispatch, combat ? `${combat.id}:${combat.mapId ?? ''}` : null);
  const history = useSyncExternalStore(shared.subscribe, shared.get, shared.get);
  const setHistory = shared.set;
  useEffect(() => {
    if (shared.combatId !== (combat ? `${combat.id}:${combat.mapId ?? ''}` : null)) {
      shared.combatId = combat ? `${combat.id}:${combat.mapId ?? ''}` : null;
      shared.set(createHistoryState());
    }
  }, [shared, combat?.id, combat?.mapId]);

  // Keep a ref to the latest combat/reveal so callbacks don't go stale
  const combatRef = useRef(combat);
  combatRef.current = combat;
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const historyRef = useRef(history);
  historyRef.current = history;

  const recordAction = useCallback((action: unknown) => {
    const currentCombat = combatRef.current;
    const currentReveal = revealRef.current;
    const currentHistory = shared.get();
    if (!currentCombat || !currentHistory) return;

    const newHistory = addAction(
      currentHistory,
      action as Record<string, unknown>,
      currentCombat,
      currentReveal ?? undefined,
    ) as HistoryState;

    setHistory(newHistory);
    historyRef.current = newHistory;
  }, [shared, setHistory]);

  const handleUndo = useCallback(() => {
    const currentCombat = combatRef.current;
    const currentReveal = revealRef.current;
    const currentHistory = shared.get();
    if (!currentCombat || !currentHistory || !histCanUndo(currentHistory)) return;

    const baseState = createSnapshot(currentCombat);
    const result: UndoRedoResult = histUndo(
      baseState,
      currentHistory,
      currentCombat,
      currentReveal ?? undefined,
    );

    const newState: CombatState = rebaseCombatMovement(result.newCombatState, campaignState.maps);
    const newHistory: HistoryState = result.newHistory;

    const target = combatTokenHistoryTarget(currentCombat, newState, currentHistory.actions[currentHistory.cursor - 1], true);
    if (target) {
      if (!commitTokenRestoration(campaignState, dispatch, { combat: newState, ...target })) return;
    } else saveCombatActive(newState);
    setHistory(newHistory);
    historyRef.current = newHistory;

    if (result.newRevealState) {
      const syncedReveal = syncRevealStateForParticipants(
        result.newRevealState,
        newState.participants,
      );
      saveCombatReveal(syncedReveal ?? null);
    }
  }, [campaignState, shared, setHistory, dispatch, saveCombatActive, saveCombatReveal]);

  const handleRedo = useCallback(() => {
    const currentCombat = combatRef.current;
    const currentReveal = revealRef.current;
    const currentHistory = shared.get();
    if (!currentCombat || !currentHistory || !histCanRedo(currentHistory)) return;

    const baseState = createSnapshot(currentCombat);
    const result: UndoRedoResult = histRedo(
      baseState,
      currentHistory,
      currentCombat,
      currentReveal ?? undefined,
    );

    const newState: CombatState = rebaseCombatMovement(result.newCombatState, campaignState.maps);
    const newHistory: HistoryState = result.newHistory;

    const target = combatTokenHistoryTarget(currentCombat, newState, currentHistory.actions[currentHistory.cursor], false);
    if (target) {
      if (!commitTokenRestoration(campaignState, dispatch, { combat: newState, ...target })) return;
    } else saveCombatActive(newState);
    setHistory(newHistory);
    historyRef.current = newHistory;

    if (result.newRevealState) {
      const syncedReveal = syncRevealStateForParticipants(
        result.newRevealState,
        newState.participants,
      );
      saveCombatReveal(syncedReveal ?? null);
    }
  }, [campaignState, shared, setHistory, dispatch, saveCombatActive, saveCombatReveal]);

  return { history, recordAction, handleUndo, handleRedo };
}
