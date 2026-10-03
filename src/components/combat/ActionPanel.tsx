import { useState, useEffect } from 'react';
import type { CombatState, RevealState } from '../../types/combatTracker';
import AttackAssist from './AttackAssist';
import DefenseAssist from './DefenseAssist';
import ActionPanelHeader from './action-panel/ActionPanelHeader';
import ActionPanelCollapsedView from './action-panel/ActionPanelCollapsedView';
import ActionPanelDamageWorkflow from './action-panel/ActionPanelDamageWorkflow';
import ActionPanelConditionsWorkflow from './action-panel/ActionPanelConditionsWorkflow';
import ActionPanelNoteWorkflow from './action-panel/ActionPanelNoteWorkflow';
import ActionPanelItemsWorkflow from './action-panel/ActionPanelItemsWorkflow';
import ActionPanelWorkflowSelector from './action-panel/ActionPanelWorkflowSelector';
import ActionPanelManeuverPrompts from './action-panel/ActionPanelManeuverPrompts';
import { getPublicDefenderLabel } from '../../utils/combatViewSelectors';
import { ViewMode } from '../../utils/combatViewFilter';
import { hasCondition } from '../../utils/conditionsEngine';
import { ConditionId } from '../../constants/conditions';
import { resolveAttackSequence } from '../../utils/combatEngine';
import type {
  Participant,
  ManeuverPrompts,
  ManeuverWorkflow,
  ManeuverSelection,
  TurnDecision,
  ConditionDuration,
  ConditionInstance,
  PendingCombatAction,
} from '../../types/combatTracker';
import type {
  HitLocation,
  LocationRoll,
  WorkflowType,
} from './action-panel/types';

interface AttackData {
  name: string;
  baseSkill: number;
  modifiers: Array<{ label: string; value: number }>;
  injectedModifiers: Array<{ label: string; value: number }>;
  effectiveSkill: number;
  rollTotal: number | null;
  margin: number | null;
  success: boolean | null;
  damage?: string;
  notes?: string;
  hitLocation: HitLocation | null;
  hitLocationRoll: LocationRoll | null;
}

interface ActionData {
  maneuver: string | null;
  kind: 'attack' | 'defense' | 'injury' | 'note';
  attack?: {
    name: string;
    skill: number;
    damage?: string;
    hitLocation?: HitLocation | null;
    hitLocationRoll?: LocationRoll | null;
    success?: boolean;
  };
  defense?: {
    type: string;
    baseDefense: number;
    effectiveDefense: number;
    rollTotal?: number | null;
    margin?: number | null;
    success?: boolean | null;
  };
  injury?: { targetInstanceId?: string; newHP?: number };
  note?: string;
  targetInstanceId?: string | null;
  newHP?: number;
}

interface ActionPanelProps {
  currentActor: Participant | undefined;
  participants: Participant[];
  combatState?: CombatState | null;
  revealState?: RevealState | null;
  viewMode?: string;
  onActionComplete: (data: ActionData) => void;
  onPendingActionChange?: (action: PendingCombatAction | null) => void;
  /** GM-only handoff when a remote active defense failed. */
  remoteDamageAction?: PendingCombatAction | null;
  onRemoteDamageConsumed?: () => void;
  combatRulesPreset?: string;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  maneuverSelection?: ManeuverSelection | null;
  onManeuverWorkflow?: (update: {
    type: string;
    targetInstanceId?: string;
    turnsAimed?: number;
    triggerText?: string;
  }) => void;
  turnDecision?: TurnDecision | null;
  currentRound?: number;
  currentTurn?: number;
  onAddCondition?: (condition: ConditionInstance) => void;
  onRemoveCondition?: (conditionInstanceId: string) => void;
  onUpdateCondition?: (
    conditionInstanceId: string,
    newDuration: ConditionDuration,
  ) => void;
  onCycleRevealed?: (conditionInstanceId: string) => void;
}

/**
 * ActionPanel — Phase 11a (decomposed).
 * Main action interface for the active combatant.
 */
export default function ActionPanel({
  currentActor: currentActorProp,
  participants,
  combatState,
  revealState,
  viewMode = ViewMode.GM,
  onActionComplete,
  onPendingActionChange,
  remoteDamageAction = null,
  onRemoteDamageConsumed,
  combatRulesPreset = 'standard',
  expanded = true,
  onToggleExpanded,
  maneuverSelection = null,
  onManeuverWorkflow,
  turnDecision = null,
  currentRound = 0,
  currentTurn = 0,
  onAddCondition,
  onRemoveCondition,
  // onUpdateCondition is not used in this component
  onCycleRevealed,
}: ActionPanelProps) {
  // The tracker can transiently have no matching actor while persisted turn
  // data is being reconciled. Keep the existing runtime contract while the
  // prop type truthfully represents the value supplied by Array.find().
  const currentActor = currentActorProp!;
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowType>(null);
  const [noteText, setNoteText] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [boundTargetId, setBoundTargetId] = useState<string | null>(null);
  const [boundHitLocation, setBoundHitLocation] = useState<HitLocation | null>(null);
  const [boundHitLocationRoll, setBoundHitLocationRoll] = useState<LocationRoll | null>(null);
  const [boundDamageExpression, setBoundDamageExpression] = useState<string | null>(null);
  const [forceTargetSelection, setForceTargetSelection] = useState(false);
  const [pendingAttack, setPendingAttack] = useState<AttackData | null>(null);

  const selectedManeuver = maneuverSelection?.selectedId || null;
  const maneuverPrompts = (maneuverSelection?.prompts || {}) as ManeuverPrompts;
  const maneuverWorkflow = (maneuverSelection?.workflow || {}) as ManeuverWorkflow;

  const targets = participants.filter((p) => p.instanceId !== currentActor.instanceId);
  const boundTarget = targets.find((t) => t.instanceId === boundTargetId) || null;
  const truthParticipants = (combatState as { participants?: Participant[] })?.participants || participants;
  const getTruthParticipant = (id: string) => truthParticipants.find((p) => p.instanceId === id);
  const boundTargetTruth = boundTargetId ? getTruthParticipant(boundTargetId) : null;
  const truthTargets = targets.map((t) => getTruthParticipant(t.instanceId)).filter(Boolean) as Participant[];

  // ---- Workflow handlers ----

  const canTargetDefend = (targetId: string | null): boolean => {
    if (!targetId) return false;
    const t = getTruthParticipant(targetId);
    if (!t || t.isDead || hasCondition(t, ConditionId.UNCONSCIOUS) || hasCondition(t, ConditionId.STUNNED)) return false;
    const vals = [t.defenses?.dodge ?? t.dodge, t.defenses?.parry ?? t.parry, t.defenses?.block ?? t.block];
    return vals.some((v) => v !== null && v !== undefined);
  };

  const handleAttackComplete = (data: { targetInstanceId: string | null; attack: AttackData }) => {
    const { targetInstanceId, attack } = data;
    setBoundTargetId(targetInstanceId || null);
    setBoundHitLocation(attack?.hitLocation || null);
    setBoundHitLocationRoll(attack?.hitLocationRoll || null);
    setBoundDamageExpression(attack?.damage || null);
    setForceTargetSelection(false);
    if (targetInstanceId) setSelectedTargetId(targetInstanceId);

    onActionComplete({
      maneuver: selectedManeuver,
      kind: 'attack',
      attack: attack
        ? { name: attack.name, skill: attack.baseSkill, damage: attack.damage, hitLocation: attack.hitLocation, hitLocationRoll: attack.hitLocationRoll, success: attack.success ?? undefined }
        : undefined,
      targetInstanceId,
    });

    if (attack.rollTotal === null) {
      // Manual/no-roll logging preserves the existing behavior: do not infer
      // an outcome that the player did not roll.
      setPendingAttack(null);
      setActiveWorkflow(null);
      return;
    }

    const sequence = resolveAttackSequence({
      attack: {
        base: attack.baseSkill,
        modifiers: [...attack.injectedModifiers, ...attack.modifiers],
        rollTotal: attack.rollTotal,
      },
      canDefend: !!targetInstanceId && canTargetDefend(targetInstanceId),
    });

    if (sequence.stage === 'awaiting-defense' && targetInstanceId) {
      setPendingAttack(attack);
      onPendingActionChange?.({
        id: `${currentActor.instanceId}:${targetInstanceId}:${currentRound}:${currentTurn}`,
        kind: 'active-defense',
        stage: 'awaiting-defense',
        attackerInstanceId: currentActor.instanceId,
        defenderInstanceId: targetInstanceId,
        createdAt: Date.now(),
        round: currentRound,
        turn: currentTurn,
        maneuverId: selectedManeuver,
        attack: {
          name: attack.name,
          baseSkill: attack.baseSkill,
          modifiers: [...attack.injectedModifiers, ...attack.modifiers],
          rollTotal: attack.rollTotal!,
          effectiveSkill: attack.effectiveSkill,
          margin: attack.margin ?? 0,
          damage: attack.damage,
          hitLocation: attack.hitLocation,
          hitLocationRoll: attack.hitLocationRoll,
        },
      });
      setActiveWorkflow('defense');
      return;
    }
    setPendingAttack(null);
    if (sequence.stage === 'awaiting-damage') { setActiveWorkflow('damage'); return; }
    setActiveWorkflow(null);
  };

  const handleDefenseComplete = (defenseData: { defense?: ActionData['defense'] }) => {
    onActionComplete({
      maneuver: selectedManeuver,
      kind: 'defense',
      defense: defenseData.defense,
      targetInstanceId: boundTarget?.instanceId || null,
    });
    const defense = defenseData.defense;
    if (pendingAttack?.rollTotal !== null && pendingAttack?.rollTotal !== undefined &&
        defense?.rollTotal !== null && defense?.rollTotal !== undefined) {
      const sequence = resolveAttackSequence({
        attack: {
          base: pendingAttack.baseSkill,
          modifiers: [...pendingAttack.injectedModifiers, ...pendingAttack.modifiers],
          rollTotal: pendingAttack.rollTotal,
        },
        canDefend: true,
        defense: {
          base: defense.baseDefense,
          // DefenseAssist has already combined its UI/injected modifiers.
          // Represent that effective delta here so the engine reproduces the
          // exact same target without coupling ActionPanel to its internals.
          modifiers: [{
            label: 'Resolved defense modifiers',
            value: defense.effectiveDefense - defense.baseDefense,
          }],
          rollTotal: defense.rollTotal,
        },
      });
      setPendingAttack(null);
      onPendingActionChange?.(null);
      if (sequence.stage === 'awaiting-damage') { setActiveWorkflow('damage'); return; }
      setActiveWorkflow(null);
      return;
    }

    // Preserve manual/no-roll defense logging without inventing an outcome.
    setPendingAttack(null);
    onPendingActionChange?.(null);
    setActiveWorkflow(null);
  };

  const handleDamageComplete = (injuryData: { targetInstanceId?: string; newHP?: number }) => {
    onActionComplete({
      maneuver: selectedManeuver,
      kind: 'injury',
      injury: injuryData,
      targetInstanceId: injuryData.targetInstanceId || boundTargetId || targets[0]?.instanceId,
      newHP: injuryData.newHP,
    });
    setActiveWorkflow(null);
  };

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    onActionComplete({ maneuver: selectedManeuver, kind: 'note', note: noteText });
    setNoteText('');
    setActiveWorkflow(null);
  };

  // A validated remote defense may fail on another device. Rehydrate the
  // original attack into this existing damage workflow so the GM never has to
  // re-enter target, damage expression or hit location.
  useEffect(() => {
    if (!remoteDamageAction || remoteDamageAction.kind !== 'active-defense') return;
    setBoundTargetId(remoteDamageAction.defenderInstanceId);
    setSelectedTargetId(remoteDamageAction.defenderInstanceId);
    setBoundDamageExpression(remoteDamageAction.attack.damage || null);
    setBoundHitLocation((remoteDamageAction.attack.hitLocation as HitLocation | null) || null);
    setBoundHitLocationRoll((remoteDamageAction.attack.hitLocationRoll as LocationRoll | null) || null);
    setForceTargetSelection(false);
    setActiveWorkflow('damage');
    onRemoteDamageConsumed?.();
  }, [remoteDamageAction, onRemoteDamageConsumed]);

  // Reset bound state when maneuver changes
  useEffect(() => {
    setBoundTargetId(null);
    setBoundHitLocation(null);
    setBoundHitLocationRoll(null);
    setBoundDamageExpression(null);
    setForceTargetSelection(false);
    setPendingAttack(null);
    if (!selectedManeuver) { setActiveWorkflow(null); return; }
    if (maneuverPrompts?.allowsAttackPanel) { setActiveWorkflow('attack'); return; }
    if (maneuverPrompts?.allowsDefensePanel) { setActiveWorkflow('defense'); return; }
    setActiveWorkflow(null);
  }, [selectedManeuver, maneuverPrompts]);

  // ---- Collapsed state ----
  if (!expanded) {
    return <ActionPanelCollapsedView onToggleExpanded={onToggleExpanded} />;
  }

  // ---- Render ----
  return (
    <div className="bg-surface-1 rounded-lg p-4 space-y-4">
      <ActionPanelHeader onToggleExpanded={onToggleExpanded} />

      {/* Maneuver-specific aim/wait widgets */}
      {!activeWorkflow && <ActionPanelManeuverPrompts maneuverPrompts={maneuverPrompts} turnDecision={turnDecision} targets={targets} onManeuverWorkflow={onManeuverWorkflow} />}

      {/* Action type selection grid */}
      {!activeWorkflow && <ActionPanelWorkflowSelector selectedManeuver={selectedManeuver} allowsAttackPanel={maneuverPrompts?.allowsAttackPanel} allowsDefensePanel={maneuverPrompts?.allowsDefensePanel} onSelectWorkflow={setActiveWorkflow} />}

      {/* Active workflows */}
      {activeWorkflow === 'attack' && (
        <div className="border-t border-edge pt-4">
          <h4 className="text-lg font-semibold mb-3">Attack Workflow</h4>
          <AttackAssist actor={currentActor} targets={targets} injectedModifiers={maneuverWorkflow?.attack?.modifiers || []} onComplete={handleAttackComplete} onCancel={() => setActiveWorkflow(null)} />
        </div>
      )}

      {activeWorkflow === 'defense' && (
        <div className="border-t border-edge pt-4">
          <h4 className="text-lg font-semibold mb-3">Defense Workflow</h4>
          <div className="mb-3 text-sm text-fg-secondary">
            Defender: <span className="font-semibold">{getPublicDefenderLabel(combatState, revealState, boundTarget?.instanceId || currentActor.instanceId)}</span>
          </div>
          <DefenseAssist defender={boundTarget || currentActor} defenderId={boundTarget?.instanceId || currentActor.instanceId} combatState={combatState} revealState={revealState} viewMode={viewMode} injectedModifiers={maneuverWorkflow?.defense?.modifiers || []} onComplete={handleDefenseComplete} onCancel={() => setActiveWorkflow(null)} />
        </div>
      )}

      {activeWorkflow === 'damage' && (
        <ActionPanelDamageWorkflow
          currentActor={currentActor}
          targets={targets}
          selectedTargetId={selectedTargetId}
          boundTarget={boundTarget}
          resolvedTarget={(boundTargetTruth || getTruthParticipant(selectedTargetId!) || truthTargets[0]) ?? null}
          combatState={combatState}
          revealState={revealState}
          combatRulesPreset={combatRulesPreset}
          damageModifiers={maneuverWorkflow?.damage?.modifiers || []}
          boundDamageExpression={boundDamageExpression}
          boundHitLocation={boundHitLocation}
          boundHitLocationRoll={boundHitLocationRoll}
          forceTargetSelection={forceTargetSelection}
          onSelectTarget={setSelectedTargetId}
          onForceTargetSelection={() => setForceTargetSelection(true)}
          onComplete={handleDamageComplete}
          onCancel={() => setActiveWorkflow(null)}
        />
      )}

      {activeWorkflow === 'note' && (
        <ActionPanelNoteWorkflow
          noteText={noteText}
          onNoteTextChange={setNoteText}
          onSubmit={handleAddNote}
          onCancel={() => setActiveWorkflow(null)}
        />
      )}

      {activeWorkflow === 'conditions' && onAddCondition && onRemoveCondition && (
        <ActionPanelConditionsWorkflow
          currentActor={currentActor}
          currentRound={currentRound}
          currentTurn={currentTurn}
          onAddCondition={onAddCondition}
          onRemoveCondition={onRemoveCondition}
          onCycleRevealed={viewMode === ViewMode.GM ? onCycleRevealed : undefined}
          onClose={() => setActiveWorkflow(null)}
        />
      )}

      {activeWorkflow === 'items' && (
        <ActionPanelItemsWorkflow
          currentActor={currentActor}
          currentRound={currentRound}
          currentTurn={currentTurn}
          onClose={() => setActiveWorkflow(null)}
        />
      )}
    </div>
  );
}
