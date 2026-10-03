/**
 * Pure combat resolution primitives for the V1 playable core.
 *
 * UI components may collect choices and rolls, but rules math belongs here.
 * Keeping this module free of React/store dependencies also lets the future
 * battle simulator reuse the exact same calculations as live combat.
 */

import { calculateEffective, type Modifier } from './modifiers';
import { applyInjuryToHP, resolveInjury, type InjuryResolution, type InjuryTarget } from './injuryEngine';
import { generateEffectsPrompts } from './effectsEngine';
import type { HitLocation } from './wounding';

export interface ResolveCheckInput {
  base: number;
  modifiers?: Modifier[];
  rollTotal: number;
}

export interface ResolvedCheck {
  base: number;
  modifiers: Modifier[];
  effective: number;
  rollTotal: number;
  margin: number;
  success: boolean;
}

export function resolveCheck({
  base,
  modifiers = [],
  rollTotal,
}: ResolveCheckInput): ResolvedCheck {
  const effective = calculateEffective(base, modifiers);
  return {
    base,
    modifiers,
    effective,
    rollTotal,
    margin: effective - rollTotal,
    success: rollTotal <= effective,
  };
}

export const resolveAttack = resolveCheck;
export const resolveDefense = resolveCheck;

export interface CombatInjuryTarget extends InjuryTarget {
  hp: number;
  currentHP: number;
  ht?: number;
  id?: string;
  instanceId?: string;
  name?: string;
}

export interface ResolveCombatInjuryInput {
  rawDamage: number;
  damageType: string;
  location: HitLocation | null;
  target: CombatInjuryTarget;
  combatRulesPreset?: string;
}

export interface CombatInjuryResolution {
  injury: InjuryResolution;
  previousHP: number;
  newHP: number;
  effects: ReturnType<typeof generateEffectsPrompts>;
}

export function resolveCombatInjury({
  rawDamage,
  damageType,
  location,
  target,
  combatRulesPreset = 'standard',
}: ResolveCombatInjuryInput): CombatInjuryResolution {
  const injury = resolveInjury({
    rawDamage,
    damageType,
    location,
    target,
    combatRulesPreset,
  });
  const newHP = applyInjuryToHP(target.currentHP, injury.injury);
  const effects = generateEffectsPrompts({
    injury: injury.injury,
    injuryResult: injury,
    currentHP: target.currentHP,
    newHP,
    maxHP: target.hp,
    combatRulesPreset,
    target,
  });

  return {
    injury,
    previousHP: target.currentHP,
    newHP,
    effects,
  };
}


export type AttackSequenceStage =
  | 'attack-missed'
  | 'awaiting-defense'
  | 'defended'
  | 'awaiting-damage';

export interface AttackSequenceResolution {
  stage: AttackSequenceStage;
  attack: ResolvedCheck;
  defense: ResolvedCheck | null;
  hit: boolean;
  needsDefense: boolean;
  needsDamage: boolean;
}

export interface ResolveAttackSequenceInput {
  attack: ResolveCheckInput;
  /** Whether this target is currently allowed and able to attempt an active defense. */
  canDefend: boolean;
  /** Supplied only after the defender has chosen a defense and rolled it. */
  defense?: ResolveCheckInput | null;
}

/**
 * Resolves the decision boundary between attack, active defense, and damage.
 *
 * This intentionally does not roll dice or choose a defense. Those are player
 * decisions/UI concerns. The function is deterministic so the same transition
 * can be used by local play, multiplayer, and the future battle simulator.
 */
export function resolveAttackSequence({
  attack: attackInput,
  canDefend,
  defense: defenseInput = null,
}: ResolveAttackSequenceInput): AttackSequenceResolution {
  const attack = resolveAttack(attackInput);

  if (!attack.success) {
    return {
      stage: 'attack-missed',
      attack,
      defense: null,
      hit: false,
      needsDefense: false,
      needsDamage: false,
    };
  }

  if (canDefend && !defenseInput) {
    return {
      stage: 'awaiting-defense',
      attack,
      defense: null,
      hit: false,
      needsDefense: true,
      needsDamage: false,
    };
  }

  const defense = canDefend && defenseInput
    ? resolveDefense(defenseInput)
    : null;

  if (defense?.success) {
    return {
      stage: 'defended',
      attack,
      defense,
      hit: false,
      needsDefense: false,
      needsDamage: false,
    };
  }

  return {
    stage: 'awaiting-damage',
    attack,
    defense,
    hit: true,
    needsDefense: false,
    needsDamage: true,
  };
}
