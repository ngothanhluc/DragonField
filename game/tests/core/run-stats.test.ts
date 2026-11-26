import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { CHARACTERS_TUNING } from '../../assets/scripts/core/enemies/tuning';
import {
  applyCharacterBaseStats,
  applyCharacterPassive,
  applyUpgradesToBaseline,
  derivedStatsForRun,
  metaBaseline,
  statsForRun,
  utilityStatsFromSave,
} from '../../assets/scripts/core/meta/run-stats';
import { createDefaultUpgrades } from '../../assets/scripts/core/meta/upgrades';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';
import { computeDerivedStats } from '../../assets/scripts/core/skills/derived-stats';

describe('applyUpgradesToBaseline', () => {
  it('level 0 keeps the baseline', () => {
    expect(
      applyUpgradesToBaseline(DEFAULT_COMBAT, {
        maxHpBonus: 0,
        maxHeartsBonus: 0,
        damageMultiplier: 1,
        fireRateMultiplier: 1,
      }),
    ).toEqual({ ...DEFAULT_COMBAT, playerMaxHearts: DEFAULT_COMBAT.playerBaseMaxHp });
  });

  it('adds max HP, multiplies damage and fire rate on the base stats', () => {
    const base = applyUpgradesToBaseline(DEFAULT_COMBAT, {
      maxHpBonus: 60,
      maxHeartsBonus: 60,
      damageMultiplier: 1.2,
      fireRateMultiplier: 1.15,
    });

    expect(base.playerBaseMaxHp).toBe(DEFAULT_COMBAT.playerBaseMaxHp + 60);
    expect(base.playerMaxHearts).toBe(DEFAULT_COMBAT.playerBaseMaxHp + 60);
    expect(base.damage).toBeCloseTo(DEFAULT_COMBAT.damage * 1.2, 10);
    expect(base.fireRatePerSecond).toBeCloseTo(DEFAULT_COMBAT.fireRatePerSecond * 1.15, 10);
  });

  it('does not modify the passed baseline', () => {
    const before = { ...DEFAULT_COMBAT };
    applyUpgradesToBaseline(DEFAULT_COMBAT, {
      maxHpBonus: 40,
      maxHeartsBonus: 40,
      damageMultiplier: 1.5,
      fireRateMultiplier: 1.3,
    });
    expect(DEFAULT_COMBAT).toEqual(before);
  });

  it('a maxed save gives max bonus: +100 HP, +50% damage, +30% fire rate', () => {
    const state = {
      upgrades: { ...createDefaultUpgrades(), hearts: 5, damage: 10, fireRate: 10 },
    };
    const base = metaBaseline(DEFAULT_COMBAT, state);

    expect(base.playerBaseMaxHp).toBe(200);
    expect(base.playerMaxHearts).toBe(200);
    expect(base.damage).toBeCloseTo(1.5, 10);
    expect(base.fireRatePerSecond).toBeCloseTo(2.6, 10);
  });

  it('the skill layer adds on top of the meta baseline, never replacing it', () => {
    const base = metaBaseline(DEFAULT_COMBAT, {
      upgrades: { ...createDefaultUpgrades(), hearts: 1, damage: 2, fireRate: 0 },
    });
    const stats = computeDerivedStats(new Map<string, number>(), base);

    expect(stats.maxHp).toBe(120);
    expect(stats.maxHearts).toBe(120);
    expect(stats.damage).toBeCloseTo(1.1, 10);
    expect(stats.fireRatePerSecond).toBeCloseTo(2, 10);
  });

  it('broken data does not produce negative/NaN stats', () => {
    const base = applyUpgradesToBaseline(DEFAULT_COMBAT, {
      maxHpBonus: Number.NaN,
      maxHeartsBonus: Number.NaN,
      damageMultiplier: Number.NaN,
      fireRateMultiplier: -4,
    });

    expect(base.playerMaxHearts).toBeGreaterThanOrEqual(1);
    expect(base.damage).toBe(0);
    expect(base.fireRatePerSecond).toBe(0);
  });

  it('a new save without upgrades still runs', () => {
    const base = metaBaseline(DEFAULT_COMBAT, { upgrades: createDefaultUpgrades() });
    expect(base.damage).toBe(DEFAULT_COMBAT.damage);
    expect(base.fireRatePerSecond).toBe(DEFAULT_COMBAT.fireRatePerSecond);
    expect(base.playerBaseMaxHp).toBe(DEFAULT_COMBAT.playerBaseMaxHp);
    expect(base.playerMaxHearts).toBe(DEFAULT_COMBAT.playerBaseMaxHp);
  });
});

describe('4-class Layer 1 base stats & Layer 2 starting passives (M14)', () => {
  it('Ninja Layer 1 matches DEFAULT_COMBAT identically and Layer 2 Shadow Agility grants +10% speed & -15% Dash cooldown', () => {
    const ninjaBase = applyCharacterBaseStats(DEFAULT_COMBAT, 'ninja');
    expect(ninjaBase.playerBaseMaxHp).toBe(DEFAULT_COMBAT.playerBaseMaxHp);
    expect(ninjaBase.damage).toBe(DEFAULT_COMBAT.damage);
    expect(ninjaBase.fireRatePerSecond).toBe(DEFAULT_COMBAT.fireRatePerSecond);
    expect(ninjaBase.moveSpeedTilesPerSecond).toBe(DEFAULT_COMBAT.moveSpeedTilesPerSecond);
    expect(ninjaBase.projectileSpeedTilesPerSecond).toBe(
      DEFAULT_COMBAT.projectileSpeedTilesPerSecond,
    );
    expect(ninjaBase.targetingRangeTiles).toBe(DEFAULT_COMBAT.targetingRangeTiles);

    const save = createDefaultSave();
    const derived = derivedStatsForRun(save, new Map(), 'ninja');
    expect(derived.maxHp).toBe(100);
    expect(derived.damage).toBe(1);
    expect(derived.fireRatePerSecond).toBe(2);
    expect(derived.moveSpeedTilesPerSecond).toBeCloseTo(DEFAULT_COMBAT.moveSpeedTilesPerSecond * 1.1, 6);
    expect(derived.dashCooldownMult).toBeCloseTo(0.85, 6);
    expect(derived.pierce).toBe(0);
    expect(derived.critChance).toBe(0);
  });

  it('Archer has fast long-range arrows and Keen Sight (+1 pierce, +12% crit at 2x)', () => {
    const save = createDefaultSave();
    const derived = derivedStatsForRun(save, new Map(), 'archer');
    const tuning = CHARACTERS_TUNING.archer;

    expect(derived.maxHp).toBe(DEFAULT_COMBAT.playerBaseMaxHp + tuning.baseStats.maxHpDelta);
    expect(derived.maxHp).toBe(85);
    expect(derived.damage).toBeCloseTo(DEFAULT_COMBAT.damage * tuning.baseStats.damageMult, 4);
    expect(derived.fireRatePerSecond).toBeCloseTo(
      DEFAULT_COMBAT.fireRatePerSecond * tuning.baseStats.fireRateMult,
      4,
    );
    expect(derived.projectileSpeedTilesPerSecond).toBeGreaterThan(
      DEFAULT_COMBAT.projectileSpeedTilesPerSecond,
    );
    expect(derived.targetingRangeTiles).toBeGreaterThan(DEFAULT_COMBAT.targetingRangeTiles);
    expect(derived.pierce).toBe(1);
    expect(derived.critChance).toBeCloseTo(0.12, 6);
    expect(derived.critMultiplier).toBe(2);

    // Skills stack cleanly on top of Keen Sight (Piercing +1 -> 2, Crit Eye +15% -> 27%).
    const stacked = derivedStatsForRun(
      save,
      new Map([
        ['piercing', 1],
        ['crit-eye', 1],
      ]),
      'archer',
    );
    expect(stacked.pierce).toBe(2);
    expect(stacked.critChance).toBeCloseTo(0.27, 6);
  });

  it('Mage has heavier bolts and Arcane Attunement (-20% Active cooldown, +25% Active/AoE power)', () => {
    const save = createDefaultSave();
    const derived = derivedStatsForRun(save, new Map(), 'mage');
    const tuning = CHARACTERS_TUNING.mage;

    expect(derived.maxHp).toBe(DEFAULT_COMBAT.playerBaseMaxHp + tuning.baseStats.maxHpDelta);
    expect(derived.maxHp).toBe(85);
    expect(derived.damage).toBeCloseTo(DEFAULT_COMBAT.damage * tuning.baseStats.damageMult, 4);
    expect(derived.activeCooldownMult).toBeCloseTo(0.8, 6);
    expect(derived.activePowerMult).toBeCloseTo(1.25, 6);
    expect(derived.aoePowerMult).toBeCloseTo(1.25, 6);

    // Shadow Conduit (×0.82) and Arcane Surge (+0.35) stack multiplicatively/additively on top.
    const stacked = derivedStatsForRun(
      save,
      new Map([
        ['shadow-conduit', 1],
        ['arcane-surge', 1],
      ]),
      'mage',
    );
    expect(stacked.activeCooldownMult).toBeCloseTo(0.8 * 0.82, 6);
    expect(stacked.activePowerMult).toBeCloseTo(1.25 + 0.35, 6);
  });

  it('Cultivator has sturdy 120 HP and Sword Heart (+15% damage, +10% execute bonus <30% HP)', () => {
    const save = createDefaultSave();
    const derived = derivedStatsForRun(save, new Map(), 'cultivator');
    const tuning = CHARACTERS_TUNING.cultivator;

    expect(derived.maxHp).toBe(120);
    expect(derived.damage).toBeCloseTo(
      DEFAULT_COMBAT.damage * tuning.baseStats.damageMult * (1 + tuning.passive.damageBonus),
      4,
    );
    expect(derived.executeThreshold).toBeCloseTo(0.3, 6);
    expect(derived.executeBonus).toBeCloseTo(0.1, 6);

    // Executioner stacks its +50% execute bonus on top of Sword Heart's +10% -> +60%.
    const stacked = derivedStatsForRun(save, new Map([['executioner', 1]]), 'cultivator');
    expect(stacked.executeThreshold).toBeCloseTo(0.3, 6);
    expect(stacked.executeBonus).toBeCloseTo(0.6, 6);
  });

  it('statsForRun composes Layer 1 -> Meta upgrades -> Layer 2 without mutating inputs', () => {
    const save = {
      ...createDefaultSave(),
      upgrades: { ...createDefaultUpgrades(), hearts: 2, damage: 4, fireRate: 5 },
      chaptersUnlocked: 4,
      selectedCharacter: 'cultivator' as const,
    };
    const snapshot = structuredClone(DEFAULT_COMBAT);
    const runBase = statsForRun(save);

    // Cultivator: 100 + 20 (class) + 40 (2 meta levels × 20 HP) = 160 HP.
    expect(runBase.playerBaseMaxHp).toBe(160);
    expect(runBase.playerMaxHearts).toBe(160);
    // Damage: 1 * 1.1 (class) * 1.2 (meta) * 1.15 (Sword Heart passive) = 1.518.
    expect(runBase.damage).toBeCloseTo(1.1 * 1.2 * 1.15, 4);
    expect(DEFAULT_COMBAT).toEqual(snapshot);

    // applyCharacterPassive is pure and composable directly.
    const manual = applyCharacterPassive(DEFAULT_COMBAT, 'archer');
    expect(manual.pierce).toBe(1);
    expect(manual.critChance).toBeCloseTo(0.12, 6);
  });
});

describe('utilityStatsFromSave (M15 Meta Shop Utility tracks)', () => {
  it('returns neutral 1x multipliers and 0 free rerolls for a fresh save', () => {
    const stats = utilityStatsFromSave(createDefaultSave());
    expect(stats).toEqual({
      xpMagnetMult: 1,
      goldBonusMult: 1,
      freeRerolls: 0,
    });
  });

  it('derives xpMagnetMult (+15%/lv), goldBonusMult (+12%/lv), and freeRerolls (+1/lv) cleanly', () => {
    const mid = {
      ...createDefaultSave(),
      upgrades: {
        ...createDefaultUpgrades(),
        xpMagnet: 3,
        goldBonus: 2,
        freeRerolls: 1,
      },
    };
    expect(utilityStatsFromSave(mid)).toEqual({
      xpMagnetMult: 1.45,
      goldBonusMult: 1.24,
      freeRerolls: 1,
    });

    const maxed = {
      ...createDefaultSave(),
      upgrades: {
        ...createDefaultUpgrades(),
        xpMagnet: 5,
        goldBonus: 5,
        freeRerolls: 3,
      },
    };
    expect(utilityStatsFromSave(maxed)).toEqual({
      xpMagnetMult: 1.75,
      goldBonusMult: 1.6,
      freeRerolls: 3,
    });
  });

  it('clamps corrupt or out-of-range utility levels without mutating the save', () => {
    const broken = {
      ...createDefaultSave(),
      upgrades: {
        ...createDefaultUpgrades(),
        xpMagnet: 50,
        goldBonus: -2,
        freeRerolls: 99,
      },
    };
    expect(utilityStatsFromSave(broken)).toEqual({
      xpMagnetMult: 1.75,
      goldBonusMult: 1,
      freeRerolls: 3,
    });
    expect(broken.upgrades.xpMagnet).toBe(50);
  });
});
