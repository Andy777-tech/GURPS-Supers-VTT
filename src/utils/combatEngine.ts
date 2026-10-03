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
