import { describe, expect, it } from 'vitest';
import {
  resolveAttack,
  resolveDefense,
  resolveCombatInjury,
} from '../combatEngine';

describe('combatEngine checks', () => {
  it('resolves a successful attack with modifiers and margin', () => {
    const result = resolveAttack({
      base: 14,
      modifiers: [
        { label: 'Aim', value: 2 },
        { label: 'Range', value: -3 },
      ],
      rollTotal: 10,
    });

    expect(result.effective).toBe(13);
    expect(result.margin).toBe(3);
    expect(result.success).toBe(true);
  });

  it('resolves a failed defense from the same generic check rules', () => {
    const result = resolveDefense({
      base: 10,
      modifiers: [{ label: 'Stunned', value: -4 }],
      rollTotal: 9,
    });

    expect(result.effective).toBe(6);
    expect(result.margin).toBe(-3);
    expect(result.success).toBe(false);
  });
});

describe('combatEngine injury pipeline', () => {
  it('lets DR fully stop damage without changing HP', () => {
    const result = resolveCombatInjury({
      rawDamage: 4,
      damageType: 'cr',
      location: null,
      target: {
        hp: 10,
        currentHP: 10,
        dr: 5,
        ht: 10,
      },
    });

    expect(result.injury.penetrating).toBe(0);
    expect(result.injury.injury).toBe(0);
    expect(result.previousHP).toBe(10);
    expect(result.newHP).toBe(10);
    expect(result.effects).toHaveLength(0);
  });

  it('applies penetrating crushing damage and returns resulting effects', () => {
    const result = resolveCombatInjury({
      rawDamage: 8,
      damageType: 'cr',
      location: null,
      target: {
        hp: 10,
        currentHP: 10,
        dr: 2,
        ht: 11,
        name: 'Target',
      },
    });

    expect(result.injury.penetrating).toBe(6);
    expect(result.injury.injury).toBe(6);
    expect(result.newHP).toBe(4);
    expect(result.effects.some(effect => effect.type === 'shock')).toBe(true);
    expect(result.effects.some(effect => effect.type === 'majorWound')).toBe(true);
    expect(result.effects.some(effect => effect.type === 'knockdownStun')).toBe(true);
  });

  it('respects location-specific DR', () => {
    const result = resolveCombatInjury({
      rawDamage: 7,
      damageType: 'cr',
      location: {
        key: 'torso',
        label: 'Torso',
        toHitPenalty: 0,
      } as any,
      target: {
        hp: 12,
        currentHP: 12,
        dr: 1,
        drByLocation: { torso: 4 },
        ht: 10,
      },
    });

    expect(result.injury.locationDR).toBe(4);
    expect(result.injury.penetrating).toBe(3);
    expect(result.newHP).toBe(9);
  });
});
