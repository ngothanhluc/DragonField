import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import * as Tuning from "../../assets/scripts/core/enemies/tuning";
import {
  TUNING,
  TUNING_SOURCE,
  parseTuning,
  type ActiveSkillTuning,
  type ArrowRainTuning,
  type CharacterBaseStatsTuning,
  type CharacterPassiveTuning,
  type CharacterSignatureTuning,
  type CharactersTuning,
  type CharacterTuning,
  type ClassSkillsTuning,
  type CombatTuning,
  type NinjaShadowCloneTuning,
  type TuningCharacterId,
} from "../../assets/scripts/core/enemies/tuning";
import {
  blockFields,
  type BlockSpec,
} from "../../assets/scripts/core/enemies/tuning-spec";

/**
 * Acceptance for moving the player (`combat`), `activeSkill`, `classSkills` and `characters`
 * blocks onto the declarative tuning spec: no hand-written interface, field list, zero or
 * parser remains for them, the validated data is unchanged, and invalid input is still
 * rejected with the same messages.
 */

const SCHEMA_PATH = new URL(
  "../../assets/scripts/core/enemies/tuning-schema.ts",
  import.meta.url,
);

function readText(url: URL): string {
  try {
    return readFileSync(url, "utf8");
  } catch {
    return "";
  }
}

const MIGRATED_BLOCKS = [
  "combat",
  "activeSkill",
  "classSkills",
  "characters",
] as const;

/** Every type that used to be a hand-written interface for the migrated blocks. */
const MIGRATED_TYPES = [
  "CombatTuning",
  "ActiveSkillTuning",
  "ClassSkillsTuning",
  "NinjaClassSkillsTuning",
  "NinjaShadowCloneTuning",
  "NinjaVenomShurikenTuning",
  "NinjaKunaiBurstTuning",
  "NinjaSmokeBombTuning",
  "ArcherClassSkillTuning",
  "ArrowRainTuning",
  "SplitArrowTuning",
  "HuntersMarkTuning",
  "WindArrowTuning",
  "SkyTempestTuning",
  "MageClassSkillsTuning",
  "MageMeteorTuning",
  "MageFrostOrbsTuning",
  "MageStormStrikeTuning",
  "MageArcanePulseTuning",
  "MageEvolutionTuning",
  "CultivatorClassSkillsTuning",
  "CultivatorOrbitSwordsTuning",
  "CultivatorSwordArrayTuning",
  "CultivatorSwordQiTuning",
  "CultivatorQiBarrierTuning",
  "CultivatorMyriadSwordsTuning",
  "CharacterTuning",
  "CharacterBaseStatsTuning",
  "CharacterPassiveTuning",
  "CharacterSignatureTuning",
] as const;

/** Every hand-written field list of the migrated blocks. */
const MIGRATED_FIELD_LISTS = [
  "COMBAT_FIELDS",
  "ACTIVE_SKILL_FIELDS",
  "CLASS_SKILLS_FIELDS",
  "NINJA_CLASS_SKILLS_FIELDS",
  "NINJA_SHADOW_CLONE_FIELDS",
  "NINJA_VENOM_SHURIKEN_FIELDS",
  "NINJA_KUNAI_BURST_FIELDS",
  "NINJA_SMOKE_BOMB_FIELDS",
  "ARCHER_CLASS_SKILL_FIELDS",
  "ARROW_RAIN_FIELDS",
  "SPLIT_ARROW_FIELDS",
  "HUNTERS_MARK_FIELDS",
  "WIND_ARROW_FIELDS",
  "SKY_TEMPEST_FIELDS",
  "MAGE_FIELDS",
  "MAGE_METEOR_FIELDS",
  "MAGE_FROST_ORBS_FIELDS",
  "MAGE_STORM_STRIKE_FIELDS",
  "MAGE_ARCANE_PULSE_FIELDS",
  "MAGE_EVOLUTION_FIELDS",
  "CULTIVATOR_CLASS_SKILLS_FIELDS",
  "CULTIVATOR_ORBIT_SWORDS_FIELDS",
  "CULTIVATOR_SWORD_ARRAY_FIELDS",
  "CULTIVATOR_SWORD_QI_FIELDS",
  "CULTIVATOR_QI_BARRIER_FIELDS",
  "CULTIVATOR_MYRIAD_SWORDS_FIELDS",
  "CHARACTER_FIELDS",
  "CHARACTER_BASE_STATS_FIELDS",
  "CHARACTER_PASSIVE_FIELDS",
  "CHARACTER_SIGNATURE_FIELDS",
] as const;

const COMBAT_ORDER = [
  "fireRatePerSecond",
  "damage",
  "projectiles",
  "projectileSpeedTilesPerSecond",
  "moveSpeedTilesPerSecond",
  "roomClearSpeedMultiplier",
  "playerBaseMaxHp",
  "invulnerabilityMs",
  "contactDamage",
  "targetingRangeTiles",
  "playerKnockbackDistanceTiles",
  "playerKnockbackDurationMs",
  "enemyKnockbackDistanceTiles",
  "enemyKnockbackDurationMs",
  "enemyHitstopMs",
  "enemyStaggerMs",
];

function exportedSpec(name: string): BlockSpec {
  const value = (Tuning as unknown as Record<string, unknown>)[name];
  expect(value, `tuning-schema.ts must export ${name}`).toBeDefined();
  return value as BlockSpec;
}

function cloneSource(): Record<string, unknown> {
  return structuredClone(TUNING_SOURCE) as Record<string, unknown>;
}

/** Walk a dotted path inside a cloned config (`classSkills.ninja.shadowClone`). */
function at(root: Record<string, unknown>, path: string): Record<string, unknown> {
  let node: unknown = root;
  for (const key of path.split(".")) {
    node = (node as Record<string, unknown>)[key];
  }
  return node as Record<string, unknown>;
}

function parseError(mutate: (root: Record<string, unknown>) => void): string {
  const root = cloneSource();
  mutate(root);
  try {
    parseTuning(root);
  } catch (error) {
    return (error as Error).message;
  }
  return "<accepted>";
}

function oneProblem(line: string): string {
  return `config/tuning.json is invalid (1 problem(s))\n  - ${line}`;
}

describe("criterion 1 — migrated blocks have no hand-written parse/zero/field list", () => {
  const schema = readText(SCHEMA_PATH);

  it("no hand-written interface remains for the migrated types; each is a derived type alias", () => {
    expect(schema, "tuning-schema.ts must exist").not.toBe("");
    for (const name of MIGRATED_TYPES) {
      expect(schema, `interface ${name}`).not.toMatch(
        new RegExp(`interface\\s+${name}\\b`),
      );
      const alias = new RegExp(`type\\s+${name}\\s*=\\s*([^;]+);`).exec(schema);
      expect(alias, `type ${name} = … must exist`).not.toBeNull();
      expect(
        alias?.[1] ?? "",
        `type ${name} must be derived from a spec, not an object literal`,
      ).not.toMatch(/[{]|\breadonly\b/);
    }
  });

  it("no hand-written field list remains for the migrated blocks", () => {
    for (const name of MIGRATED_FIELD_LISTS) {
      expect(schema, name).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("no per-block zero/default/parse function remains for the migrated blocks", () => {
    const perBlock =
      /function\s+((?:zero|default|parse|read)(?:Combat|ActiveSkill|ClassSkills|Ninja|Archer|Mage|Cultivator|Character)\w*)/g;
    const found = Array.from(schema.matchAll(perBlock), (match) => match[1]);
    expect(found).toEqual([]);
  });

  it("the block specs are exported and list the fields in JSON order", () => {
    expect(blockFields(exportedSpec("COMBAT_SPEC"))).toEqual(COMBAT_ORDER);
    expect(blockFields(exportedSpec("ACTIVE_SKILL_SPEC"))).toEqual([
      "bufferMs",
    ]);
    expect(blockFields(exportedSpec("CLASS_SKILLS_SPEC"))).toEqual([
      "ninja",
      "archer",
      "mage",
      "cultivator",
    ]);
    expect(blockFields(exportedSpec("CHARACTER_SPEC"))).toEqual([
      "unlockChapter",
      "unlockGoldCost",
      "baseStats",
      "passive",
      "signature",
    ]);
  });

  it("the derived types keep their exact public shape (tsc checks this)", () => {
    expectTypeOf<ActiveSkillTuning>().toEqualTypeOf<{
      readonly bufferMs: number;
    }>();
    expectTypeOf<CombatTuning>().toEqualTypeOf<{
      readonly fireRatePerSecond: number;
      readonly damage: number;
      readonly projectiles: number;
      readonly projectileSpeedTilesPerSecond: number;
      readonly moveSpeedTilesPerSecond: number;
      readonly roomClearSpeedMultiplier: number;
      readonly playerBaseMaxHp: number;
      readonly invulnerabilityMs: number;
      readonly contactDamage: number;
      readonly targetingRangeTiles: number;
      readonly playerKnockbackDistanceTiles: number;
      readonly playerKnockbackDurationMs: number;
      readonly enemyKnockbackDistanceTiles: number;
      readonly enemyKnockbackDurationMs: number;
      readonly enemyHitstopMs: number;
      readonly enemyStaggerMs: number;
    }>();
    expectTypeOf<NinjaShadowCloneTuning>().toEqualTypeOf<{
      readonly damageRatioByStack: readonly number[];
      readonly durationMs: number;
      readonly fireIntervalMs: number;
      readonly rangeTiles: number;
      readonly projectileSpeedTilesPerSecond: number;
      readonly projectileTtlMs: number;
    }>();
    expectTypeOf<ArrowRainTuning>().toEqualTypeOf<{
      readonly everyShots: number;
      readonly radiusTiles: number;
      readonly damageRatioByStack: readonly number[];
    }>();
    expectTypeOf<CharacterSignatureTuning>().toEqualTypeOf<{
      readonly cooldownMs: number;
      readonly hitCooldownReductionMs: number;
      readonly killCooldownReductionMs: number;
      readonly projectileCount: number;
      readonly maxProjectileCount: number;
      readonly fanArcDegrees: number;
      readonly speedTilesPerSecond: number;
      readonly radiusTiles: number;
      readonly ttlMs: number;
      readonly damageMultiplier: number;
      readonly pierceCount: number;
      readonly homing: boolean;
      readonly novaRadiusTiles: number;
      readonly novaDamageMultiplier: number;
      readonly novaSlowFactor: number;
      readonly novaSlowDurationMs: number;
      readonly hideAttachmentMs: number;
    }>();
    expectTypeOf<CharacterTuning>().toEqualTypeOf<{
      readonly unlockChapter: number;
      readonly unlockGoldCost: number;
      readonly baseStats: CharacterBaseStatsTuning;
      readonly passive: CharacterPassiveTuning;
      readonly signature: CharacterSignatureTuning;
    }>();
    expectTypeOf<CharactersTuning>().toEqualTypeOf<
      Readonly<Record<TuningCharacterId, CharacterTuning>>
    >();
    expectTypeOf<keyof ClassSkillsTuning>().toEqualTypeOf<
      "ninja" | "archer" | "mage" | "cultivator"
    >();
  });
});

describe("criterion 2 — generated tuning data is unchanged", () => {
  it.each(MIGRATED_BLOCKS)(
    "%s serialises byte-for-byte like the source JSON (same values, same key order)",
    (block) => {
      const source = TUNING_SOURCE as Record<string, unknown>;
      expect(JSON.stringify(TUNING[block])).toBe(JSON.stringify(source[block]));
      const reparsed = parseTuning(cloneSource());
      expect(JSON.stringify(reparsed[block])).toBe(
        JSON.stringify(source[block]),
      );
    },
  );

  it("the whole config still deep-equals the source JSON, in the same block order", () => {
    expect(TUNING).toEqual(TUNING_SOURCE);
    expect(Object.keys(TUNING)).toEqual(
      Object.keys(TUNING_SOURCE as Record<string, unknown>),
    );
  });

  it("spot values from config/tuning.json survive", () => {
    expect(TUNING.combat.roomClearSpeedMultiplier).toBe(1.45);
    expect(TUNING.activeSkill).toEqual({ bufferMs: 150 });
    expect(TUNING.characters.archer.signature).toMatchObject({
      projectileCount: 7,
      maxProjectileCount: 9,
      fanArcDegrees: 36,
      homing: false,
    });
    expect(TUNING.characters.cultivator.unlockChapter).toBe(3);
    expect(TUNING.classSkills.cultivator.qiBarrier.chargeByStack).toEqual([
      0.34, 0.45, 0.56,
    ]);
    expect(TUNING.classSkills.archer.arrowRain).toEqual({
      everyShots: 5,
      radiusTiles: 2.2,
      damageRatioByStack: [0.8, 1.2, 1.6],
    });
  });

  it("migrated blocks stay deep-frozen", () => {
    expect(Object.isFrozen(TUNING.combat)).toBe(true);
    expect(Object.isFrozen(TUNING.characters)).toBe(true);
    expect(Object.isFrozen(TUNING.characters.mage.signature)).toBe(true);
    expect(Object.isFrozen(TUNING.classSkills.ninja.shadowClone)).toBe(true);
    expect(
      Object.isFrozen(TUNING.classSkills.ninja.shadowClone.damageRatioByStack),
    ).toBe(true);
  });
});

describe("criterion 2 — invalid input is rejected with the same messages", () => {
  it.each<[string, (root: Record<string, unknown>) => void, string]>([
    [
      "combat: non-positive fire rate",
      (root) => (at(root, "combat").fireRatePerSecond = 0),
      "combat.fireRatePerSecond: must be > 0, got 0",
    ],
    [
      "combat: fractional projectiles",
      (root) => (at(root, "combat").projectiles = 1.5),
      "combat.projectiles: must be an integer, got 1.5",
    ],
    [
      "combat: room-clear multiplier below 1",
      (root) => (at(root, "combat").roomClearSpeedMultiplier = 0.5),
      "combat.roomClearSpeedMultiplier: must be >= 1, got 0.5",
    ],
    [
      "combat: negative damage",
      (root) => (at(root, "combat").damage = -1),
      "combat.damage: must not be negative, got -1",
    ],
    [
      "activeSkill: fractional buffer",
      (root) => (at(root, "activeSkill").bufferMs = 1.5),
      "activeSkill.bufferMs: must be an integer, got 1.5",
    ],
    [
      "characters: unlockChapter past the last chapter",
      (root) => (at(root, "characters.mage").unlockChapter = 4),
      "characters.mage.unlockChapter: must be within 0..3, got 4",
    ],
    [
      "characters: negative unlockChapter uses the range message",
      (root) => (at(root, "characters.mage").unlockChapter = -1),
      "characters.mage.unlockChapter: must be within 0..3, got -1",
    ],
    [
      "characters: fractional unlockGoldCost",
      (root) => (at(root, "characters.cultivator").unlockGoldCost = 1.5),
      "characters.cultivator.unlockGoldCost: must be an integer, got 1.5",
    ],
    [
      "characters: maxHpDelta below range",
      (root) => (at(root, "characters.ninja.baseStats").maxHpDelta = -81),
      "characters.ninja.baseStats.maxHpDelta: must be within -80..200, got -81",
    ],
    [
      "characters: fractional maxHpDelta",
      (root) => (at(root, "characters.ninja.baseStats").maxHpDelta = 1.5),
      "characters.ninja.baseStats.maxHpDelta: must be an integer, got 1.5",
    ],
    [
      "characters: crit multiplier below 1",
      (root) => (at(root, "characters.archer.passive").critMultiplier = 0.5),
      "characters.archer.passive.critMultiplier: must be >= 1, got 0.5",
    ],
    [
      "characters: crit chance above 1",
      (root) => (at(root, "characters.archer.passive").critChanceAdd = 1.5),
      "characters.archer.passive.critChanceAdd: must be within 0..1, got 1.5",
    ],
    [
      "characters: homing not a boolean",
      (root) => (at(root, "characters.mage.signature").homing = "yes"),
      'characters.mage.signature.homing: must be a boolean, got "yes"',
    ],
    [
      "characters: maxProjectileCount below projectileCount",
      (root) => (at(root, "characters.archer.signature").maxProjectileCount = 6),
      "characters.archer.signature.maxProjectileCount: must be >= projectileCount (7), got 6",
    ],
    [
      "characters: fan arc above 360",
      (root) => (at(root, "characters.archer.signature").fanArcDegrees = 361),
      "characters.archer.signature.fanArcDegrees: must be within 0..360, got 361",
    ],
    [
      "characters: slow factor above 1",
      (root) => (at(root, "characters.mage.signature").novaSlowFactor = 1.2),
      "characters.mage.signature.novaSlowFactor: must be within 0..1, got 1.2",
    ],
    [
      "ninja: per-stack table with the wrong length",
      (root) =>
        (at(root, "classSkills.ninja.shadowClone").damageRatioByStack = [1, 2]),
      "classSkills.ninja.shadowClone.damageRatioByStack: must have exactly 3 elements (one per stack), got 2",
    ],
    [
      "ninja: per-stack table not an array",
      (root) => (at(root, "classSkills.ninja.venomShuriken").damageByStack = "x"),
      'classSkills.ninja.venomShuriken.damageByStack: must be an array of numbers, got "x"',
    ],
    [
      "ninja: zero entry in a positive per-stack table",
      (root) =>
        (at(root, "classSkills.ninja.shadowClone").damageRatioByStack = [
          1, 0, 2,
        ]),
      "classSkills.ninja.shadowClone.damageRatioByStack[1]: must be > 0, got 0",
    ],
    [
      "ninja: positive scalar at 0",
      (root) => (at(root, "classSkills.ninja.kunaiBurst").damage = 0),
      "classSkills.ninja.kunaiBurst.damage: must be > 0, got 0",
    ],
    [
      "cultivator: per-stack entry above its max",
      (root) =>
        (at(root, "classSkills.cultivator.qiBarrier").chargeByStack = [
          0.5, 1.5, 0.5,
        ]),
      "classSkills.cultivator.qiBarrier.chargeByStack[1]: must be <= 1, got 1.5",
    ],
    [
      "cultivator: fractional entry in an integer per-stack table",
      (root) =>
        (at(root, "classSkills.cultivator.orbitSwords").swordsByStack = [
          2, 2.5, 4,
        ]),
      "classSkills.cultivator.orbitSwords.swordsByStack[1]: must be an integer, got 2.5",
    ],
    [
      "archer: empty per-stack list",
      (root) =>
        (at(root, "classSkills.archer.arrowRain").damageRatioByStack = []),
      "classSkills.archer.arrowRain.damageRatioByStack: must be a non-empty array of numbers, got array",
    ],
    [
      "archer: zero entry in a per-stack list",
      (root) =>
        (at(root, "classSkills.archer.splitArrow").damageRatioByStack = [1, 0]),
      "classSkills.archer.splitArrow.damageRatioByStack[1]: must be a finite number > 0, got 0",
    ],
    [
      "archer: fractional momentum cap",
      (root) => (at(root, "classSkills.archer.windArrow").momentumCap = 1.5),
      "classSkills.archer.windArrow.momentumCap: must be an integer, got 1.5",
    ],
    [
      "mage: proc chance above 1",
      (root) => (at(root, "classSkills.mage.stormStrike").procChance = 1.2),
      "classSkills.mage.stormStrike.procChance: must be within 0..1, got 1.2",
    ],
    [
      "mage: fractional orb count",
      (root) => (at(root, "classSkills.mage.frostOrbs").baseCount = 1.5),
      "classSkills.mage.frostOrbs.baseCount: must be an integer, got 1.5",
    ],
  ])("%s", (_name, mutate, line) => {
    expect(parseError(mutate)).toBe(oneProblem(line));
  });

  it("a missing nested field reports 'missing field' then the type problem, as before", () => {
    expect(
      parseError((root) => delete at(root, "classSkills.mage.meteor").radiusTiles),
    ).toBe(
      "config/tuning.json is invalid (2 problem(s))\n" +
        "  - classSkills.mage.meteor.radiusTiles: missing field\n" +
        "  - classSkills.mage.meteor.radiusTiles: must be a finite number, got undefined (missing field?)",
    );
    expect(
      parseError((root) => delete at(root, "characters.archer.signature").homing),
    ).toBe(
      "config/tuning.json is invalid (2 problem(s))\n" +
        "  - characters.archer.signature.homing: missing field\n" +
        "  - characters.archer.signature.homing: must be a boolean, got undefined (missing field?)",
    );
  });

  it.each<[string, (root: Record<string, unknown>) => void, string]>([
    [
      "combat",
      (root) => delete root.combat,
      "combat: must be an object { fireRatePerSecond, damage, projectiles, projectileSpeedTilesPerSecond, moveSpeedTilesPerSecond, roomClearSpeedMultiplier, playerBaseMaxHp, invulnerabilityMs, contactDamage, targetingRangeTiles, playerKnockbackDistanceTiles, playerKnockbackDurationMs, enemyKnockbackDistanceTiles, enemyKnockbackDurationMs, enemyHitstopMs, enemyStaggerMs }, got undefined (missing field?)",
    ],
    [
      "classSkills.ninja",
      (root) => delete at(root, "classSkills").ninja,
      "classSkills.ninja: must be an object { shadowClone, venomShuriken, kunaiBurst, smokeBomb }, got undefined (missing field?)",
    ],
    [
      "characters.mage",
      (root) => delete at(root, "characters").mage,
      "characters.mage: must be an object { unlockChapter, unlockGoldCost, baseStats, passive, signature }, got undefined (missing field?)",
    ],
    [
      "characters.mage.signature",
      (root) => (at(root, "characters.mage").signature = []),
      "characters.mage.signature: must be an object { cooldownMs, hitCooldownReductionMs, killCooldownReductionMs, projectileCount, maxProjectileCount, fanArcDegrees, speedTilesPerSecond, radiusTiles, ttlMs, damageMultiplier, pierceCount, homing, novaRadiusTiles, novaDamageMultiplier, novaSlowFactor, novaSlowDurationMs, hideAttachmentMs }, got array",
    ],
    [
      "classSkills.archer.windArrow",
      (root) => (at(root, "classSkills.archer").windArrow = null),
      "classSkills.archer.windArrow: must be an object { momentumCap, resetMs, buffDurationMs, fireRatePerMomentum, projectileSpeedPerMomentum }, got null",
    ],
  ])("a missing or non-object %s block is reported at the block path", (_name, mutate, line) => {
    const message = parseError(mutate);
    expect(message).toMatch(/^config\/tuning\.json is invalid/);
    expect(message).toContain(`  - ${line}`);
  });

  it("problems from several migrated blocks keep the top-level block order", () => {
    expect(
      parseError((root) => {
        at(root, "characters.cultivator").unlockGoldCost = 1.5;
        at(root, "classSkills.ninja.kunaiBurst").damage = 0;
        at(root, "activeSkill").bufferMs = 1.5;
        at(root, "combat").damage = -1;
      }),
    ).toBe(
      "config/tuning.json is invalid (4 problem(s))\n" +
        "  - combat.damage: must not be negative, got -1\n" +
        "  - activeSkill.bufferMs: must be an integer, got 1.5\n" +
        "  - classSkills.ninja.kunaiBurst.damage: must be > 0, got 0\n" +
        "  - characters.cultivator.unlockGoldCost: must be an integer, got 1.5",
    );
  });

  it("the same edge values are still accepted, and unknown keys are dropped", () => {
    const root = cloneSource();
    at(root, "combat").roomClearSpeedMultiplier = 1;
    at(root, "combat").extra = "ignored";
    at(root, "characters.ninja").unlockChapter = 3;
    at(root, "characters.ninja.baseStats").maxHpDelta = -80;
    at(root, "characters.archer.baseStats").maxHpDelta = 200;
    at(root, "characters.archer.passive").critMultiplier = 1;
    at(root, "characters.archer.passive").critChanceAdd = 1;
    at(root, "characters.archer.signature").maxProjectileCount = 7;
    at(root, "characters.archer.signature").fanArcDegrees = 360;
    at(root, "characters.mage.signature").homing = true;
    at(root, "classSkills.ninja.smokeBomb").fireRateBonusByStack = [0, 0.35];
    at(root, "classSkills.cultivator.qiBarrier").chargeByStack = [1, 1, 1];
    at(root, "classSkills.archer.arrowRain").damageRatioByStack = [
      0.8, 1.2, 1.6, 2,
    ];
    at(root, "classSkills.archer.skyTempest").pierce = 0;

    const parsed = parseTuning(root);
    expect(parsed.combat.roomClearSpeedMultiplier).toBe(1);
    expect(Object.keys(parsed.combat)).toEqual(COMBAT_ORDER);
    expect(parsed.characters.ninja.unlockChapter).toBe(3);
    expect(parsed.characters.ninja.baseStats.maxHpDelta).toBe(-80);
    expect(parsed.characters.archer.baseStats.maxHpDelta).toBe(200);
    expect(parsed.characters.archer.passive.critMultiplier).toBe(1);
    expect(parsed.characters.archer.passive.critChanceAdd).toBe(1);
    expect(parsed.characters.archer.signature.maxProjectileCount).toBe(7);
    expect(parsed.characters.archer.signature.fanArcDegrees).toBe(360);
    expect(parsed.characters.mage.signature.homing).toBe(true);
    expect(parsed.classSkills.ninja.smokeBomb.fireRateBonusByStack).toEqual([
      0, 0.35,
    ]);
    expect(parsed.classSkills.cultivator.qiBarrier.chargeByStack).toEqual([
      1, 1, 1,
    ]);
    expect(parsed.classSkills.archer.arrowRain.damageRatioByStack).toEqual([
      0.8, 1.2, 1.6, 2,
    ]);
    expect(parsed.classSkills.archer.skyTempest.pierce).toBe(0);
  });
});
