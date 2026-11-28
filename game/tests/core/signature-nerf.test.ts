/**
 * Ticket #108 acceptance: Signature Active (E) nerf + once-per-cast hitstop for active-skill hits,
 * and the balance-floor contract that replaces "every sim:table row wins 9/9".
 *
 * Expected numbers are copied from the ticket and the owner's answer (cooldowns ×1.5, recharge 0,
 * −20% damage; floor = the measured ×1.5 sim:table), not recomputed from the old values.
 */
import { describe, expect, it } from "vitest";
import {
  activeSkillConfigFor,
  SIGNATURE_SPECS,
} from "../../assets/scripts/core/input/active-skill";
import {
  ACTIVE_SKILL_TUNING,
  CHARACTERS_TUNING,
} from "../../assets/scripts/core/enemies/tuning";
import type * as HitHitstop from "../../assets/scripts/core/combat/hit-hitstop";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHARACTER_IDS,
  type CharacterId,
} from "../../assets/scripts/core/characters/roster";
import {
  classEvolutionFor,
  classSkillsFor,
} from "../../assets/scripts/core/skills/class-skills";
import * as simTableHelpers from "../helpers/sim-table";
import type { SimTableRow } from "../helpers/sim-table";

type HitHitstopModule = typeof HitHitstop;

/** Loaded lazily so a missing module fails as an assertion, not as a file-level import error. */
async function loadHitHitstop(): Promise<HitHitstopModule> {
  const mod =
    await import("../../assets/scripts/core/combat/hit-hitstop").catch(
      () => null,
    );
  expect(
    mod,
    "core/combat/hit-hitstop.ts must exist and export the hitstop helper",
  ).not.toBeNull();
  return mod as HitHitstopModule;
}

describe("#108 Signature Active nerf (characters.*.signature)", () => {
  it("cuts damageMultiplier by 20% for all 4 characters (mage nova too)", () => {
    expect(CHARACTERS_TUNING.ninja.signature.damageMultiplier).toBeCloseTo(
      1.2,
      9,
    );
    expect(CHARACTERS_TUNING.archer.signature.damageMultiplier).toBeCloseTo(
      1.68,
      9,
    );
    expect(CHARACTERS_TUNING.mage.signature.damageMultiplier).toBeCloseTo(
      1.08,
      9,
    );
    expect(CHARACTERS_TUNING.mage.signature.novaDamageMultiplier).toBeCloseTo(
      2.56,
      9,
    );
    expect(CHARACTERS_TUNING.cultivator.signature.damageMultiplier).toBeCloseTo(
      1.08,
      9,
    );
  });

  it("raises cooldownMs ×1.5 for all 4 characters", () => {
    expect(CHARACTERS_TUNING.ninja.signature.cooldownMs).toBe(15000);
    expect(CHARACTERS_TUNING.archer.signature.cooldownMs).toBe(14250);
    expect(CHARACTERS_TUNING.mage.signature.cooldownMs).toBe(15750);
    expect(CHARACTERS_TUNING.cultivator.signature.cooldownMs).toBe(16500);
  });

  it("removes hit and kill cooldown reduction for all 4 characters", () => {
    for (const id of ["ninja", "archer", "mage", "cultivator"] as const) {
      expect(CHARACTERS_TUNING[id].signature.hitCooldownReductionMs, id).toBe(
        0,
      );
      expect(CHARACTERS_TUNING[id].signature.killCooldownReductionMs, id).toBe(
        0,
      );
    }
  });

  it("flows through the Signature specs and recharge configs the game reads", () => {
    expect(activeSkillConfigFor("shadow-barrage")).toEqual({
      cooldownMs: 15000,
      hitCooldownReductionMs: 0,
      killCooldownReductionMs: 0,
    });
    expect(activeSkillConfigFor("piercing-volley").cooldownMs).toBe(14250);
    expect(activeSkillConfigFor("arcane-nova").cooldownMs).toBe(15750);
    expect(activeSkillConfigFor("ten-thousand-swords").cooldownMs).toBe(16500);
    expect(SIGNATURE_SPECS["shadow-barrage"].damageMultiplier).toBeCloseTo(
      1.2,
      9,
    );
    expect(SIGNATURE_SPECS["piercing-volley"].damageMultiplier).toBeCloseTo(
      1.68,
      9,
    );
  });

  it("keeps the mage passive active-cooldown modifier (×0.8)", () => {
    expect(CHARACTERS_TUNING.mage.passive.activeCooldownMult).toBe(0.8);
  });

  it("keeps only the action buffer in the top-level activeSkill block", () => {
    // Cooldown, recharge and damage live in characters.*.signature; the old duplicates were dropped.
    expect(ACTIVE_SKILL_TUNING).toEqual({ bufferMs: 150 });
  });
});

describe("#108 hitstop for player hits (core/combat/hit-hitstop.ts)", () => {
  const DURATIONS = { normalMs: 70, critMs: 110 };

  it("isRealCrit compares a bullet against its own base damage", async () => {
    const { isRealCrit } = await loadHitHitstop();
    // Ninja blade with player damage 10: base = 10 × 1.2 = 12. Not a crit (the old check said yes).
    expect(isRealCrit(12, 12)).toBe(false);
    expect(isRealCrit(10, 10)).toBe(false);
    // A normal shot rolled crit ×2 at fire time.
    expect(isRealCrit(20, 10)).toBe(true);
  });

  it("a Signature cast requests hitstop only on its first hit (70 ms when not a crit)", async () => {
    const { PlayerHitHitstop } = await loadHitHitstop();
    const gate = new PlayerHitHitstop(DURATIONS);
    const blade = { damage: 12, baseDamage: 12, signatureCastId: 1 };
    expect(gate.hitstopFor(blade)).toBe(70);
    expect(gate.hitstopFor(blade)).toBe(0);
    expect(gate.hitstopFor(blade)).toBe(0);
  });

  it("a Signature cast whose first hit is a real crit requests 110 ms, then nothing", async () => {
    const { PlayerHitHitstop } = await loadHitHitstop();
    const gate = new PlayerHitHitstop(DURATIONS);
    expect(
      gate.hitstopFor({ damage: 24, baseDamage: 12, signatureCastId: 7 }),
    ).toBe(110);
    expect(
      gate.hitstopFor({ damage: 24, baseDamage: 12, signatureCastId: 7 }),
    ).toBe(0);
  });

  it("each new cast gets its own first-hit hitstop", async () => {
    const { PlayerHitHitstop } = await loadHitHitstop();
    const gate = new PlayerHitHitstop(DURATIONS);
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 1 }),
    ).toBe(70);
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 1 }),
    ).toBe(0);
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 2 }),
    ).toBe(70);
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 2 }),
    ).toBe(0);
  });

  it("normal (non-Signature) shots keep hitstop on every hit: 70 ms, 110 ms on a real crit", async () => {
    const { PlayerHitHitstop } = await loadHitHitstop();
    const gate = new PlayerHitHitstop(DURATIONS);
    const shot = { damage: 10, baseDamage: 10, signatureCastId: null };
    expect(gate.hitstopFor(shot)).toBe(70);
    expect(gate.hitstopFor(shot)).toBe(70);
    expect(
      gate.hitstopFor({ damage: 20, baseDamage: 10, signatureCastId: null }),
    ).toBe(110);
    expect(
      gate.hitstopFor({ damage: 20, baseDamage: 10, signatureCastId: null }),
    ).toBe(110);
  });

  it("reset() forgets which casts already stopped (room change)", async () => {
    const { PlayerHitHitstop } = await loadHitHitstop();
    const gate = new PlayerHitHitstop(DURATIONS);
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 3 }),
    ).toBe(70);
    gate.reset();
    expect(
      gate.hitstopFor({ damage: 12, baseDamage: 12, signatureCastId: 3 }),
    ).toBe(70);
  });
});

/** The API `tests/helpers/sim-table.ts` must add for the #108 balance-floor contract. */
interface FloorCount {
  readonly won: number;
  readonly rows: number;
}
interface BalanceFloorApi {
  /** Minimum rows whose dodge + kit run wins 9/9, out of the exact sim:table matrix. */
  readonly BALANCE_FLOOR: {
    readonly total: FloorCount;
    readonly byClass: Readonly<Record<CharacterId, FloorCount>>;
  };
  /** Seeds per boss of the `bun run sim:table` matrix, per class. */
  readonly SIM_TABLE_SEEDS_PER_BOSS: Readonly<Record<CharacterId, number>>;
  /** Every reason the sim:table exit gate fails; `[]` = the gate passes. */
  simTableGateFailures(rows: readonly SimTableRow[]): string[];
}

function floorApi(): BalanceFloorApi {
  const api = simTableHelpers as unknown as Partial<BalanceFloorApi>;
  expect(
    typeof api.simTableGateFailures,
    "tests/helpers/sim-table.ts must export simTableGateFailures",
  ).toBe("function");
  expect(
    api.BALANCE_FLOOR,
    "tests/helpers/sim-table.ts must export BALANCE_FLOOR",
  ).toBeDefined();
  expect(
    api.SIM_TABLE_SEEDS_PER_BOSS,
    "tests/helpers/sim-table.ts must export SIM_TABLE_SEEDS_PER_BOSS",
  ).toBeDefined();
  return api as BalanceFloorApi;
}

type Outcome = SimTableRow["loadout"];

function outcome(overrides: Partial<Outcome>): Outcome {
  return {
    status: "won",
    roomsCleared: 9,
    durationMs: 300_000,
    hits: 3,
    levelUps: 16,
    finalLevel: 17,
    xpEarned: 9000,
    dashesUsed: 40,
    activeSkillsUsed: 15,
    evolutions: [],
    classSkills: [],
    doors: ["xp", "xp", "xp", "shop", "xp", "xp", "xp", "xp"],
    ...overrides,
  };
}

function row(
  characterId: CharacterId,
  index: number,
  loadout: Partial<Outcome>,
): SimTableRow {
  return {
    characterId,
    chapter: (index % 4) + 1,
    seed: index + 1,
    boss: "tengu" as SimTableRow["boss"],
    standStill: {
      ...outcome({
        status: "lost",
        roomsCleared: 0,
        durationMs: 5_000,
        levelUps: 0,
        finalLevel: 1,
        xpEarned: 0,
        dashesUsed: 0,
        activeSkillsUsed: 0,
      }),
    },
    loadout: outcome(loadout),
  };
}

/** A losing dodge run: dies early, few level-ups, no class skill (as measured for the losing rows). */
const LOST: Partial<Outcome> = {
  status: "lost",
  roomsCleared: 1,
  durationMs: 90_000,
  levelUps: 4,
  finalLevel: 5,
  xpEarned: 600,
  doors: ["xp"],
};

/**
 * 72 rows shaped like the measured ×1.5 table: ninja 19/24, archer 12/16, mage 8/16,
 * cultivator 16/16 win 9/9 (55/72). Winners own a class skill, except one archer winner that owns
 * none while one archer loser owns one (archer class-skill rows still 12/16, as measured).
 * Row 0 of each class unlocks its Class Evolution plus a shared Evolution.
 */
function measuredTable(wins: Readonly<Record<CharacterId, number>>): SimTableRow[] {
  const sizes: Record<CharacterId, number> = {
    ninja: 24,
    archer: 16,
    mage: 16,
    cultivator: 16,
  };
  const rows: SimTableRow[] = [];
  for (const characterId of CHARACTER_IDS) {
    const own = classSkillsFor(characterId)[0]!.id;
    const evo = classEvolutionFor(characterId).id;
    for (let i = 0; i < sizes[characterId]; i += 1) {
      const won = i < wins[characterId];
      let classSkills: string[] = won ? [own] : [];
      if (characterId === "archer" && won && i === wins.archer - 1) classSkills = [];
      if (characterId === "archer" && !won && i === wins.archer) classSkills = [own];
      if (i === 0) classSkills = [own, evo];
      rows.push(
        row(characterId, i, {
          ...(won ? {} : LOST),
          classSkills,
          evolutions: i === 0 ? ["phantom-volley", evo] : [],
        }),
      );
    }
  }
  return rows;
}

const MEASURED_WINS: Readonly<Record<CharacterId, number>> = {
  ninja: 19,
  archer: 12,
  mage: 8,
  cultivator: 16,
};

describe("#108 balance floor replaces 'every sim:table row wins 9/9' (tests/helpers/sim-table.ts)", () => {
  it("pins the floor to the measured ×1.5 table: 55/72; ninja 19/24, archer 12/16, mage 8/16, cultivator 16/16", () => {
    const { BALANCE_FLOOR, SIM_TABLE_SEEDS_PER_BOSS } = floorApi();
    expect(BALANCE_FLOOR).toEqual({
      total: { won: 55, rows: 72 },
      byClass: {
        ninja: { won: 19, rows: 24 },
        archer: { won: 12, rows: 16 },
        mage: { won: 8, rows: 16 },
        cultivator: { won: 16, rows: 16 },
      },
    });
    expect(SIM_TABLE_SEEDS_PER_BOSS).toEqual({
      ninja: 3,
      archer: 2,
      mage: 2,
      cultivator: 2,
    });
  });

  it("a table exactly at the floor passes the gate; losing rows need no level-up band or class skill", () => {
    const { simTableGateFailures } = floorApi();
    expect(simTableGateFailures(measuredTable(MEASURED_WINS))).toEqual([]);
  });

  it("one class below its floor fails the gate (every class, one win short)", () => {
    const { simTableGateFailures } = floorApi();
    for (const characterId of CHARACTER_IDS) {
      const wins = { ...MEASURED_WINS, [characterId]: MEASURED_WINS[characterId] - 1 };
      // Give every losing row a class skill so only the win floor can trip the gate.
      const rows = measuredTable(wins).map((r) =>
        r.loadout.status === "won" || r.loadout.classSkills.length > 0
          ? r
          : { ...r, loadout: { ...r.loadout, classSkills: [classSkillsFor(r.characterId)[0]!.id] } },
      );
      expect(
        simTableGateFailures(rows).length,
        `${characterId} one win under the floor`,
      ).toBeGreaterThan(0);
    }
  });

  it("a winning row outside the 12–16 level-up band fails the gate", () => {
    const { simTableGateFailures } = floorApi();
    const rows = measuredTable(MEASURED_WINS);
    const index = rows.findIndex(
      (r) => r.characterId === "cultivator" && r.loadout.status === "won",
    );
    rows[index] = { ...rows[index]!, loadout: { ...rows[index]!.loadout, levelUps: 11, finalLevel: 12 } };
    expect(simTableGateFailures(rows).length).toBeGreaterThan(0);
  });

  it("a class whose class-skill rows drop under its win floor fails the gate", () => {
    const { simTableGateFailures } = floorApi();
    const rows = measuredTable(MEASURED_WINS);
    // Archer owns a class skill in exactly 12/16 rows; strip one more → 11/16 < 12.
    const index = rows.findIndex(
      (r) => r.characterId === "archer" && r.loadout.classSkills.length > 0 && !r.loadout.classSkills.includes(classEvolutionFor("archer").id),
    );
    rows[index] = { ...rows[index]!, loadout: { ...rows[index]!.loadout, classSkills: [] } };
    expect(simTableGateFailures(rows).length).toBeGreaterThan(0);
  });

  it("keeps the other gate checks for every row: stand still loses room 1, Ch2+ dashes, no class leak", () => {
    const { simTableGateFailures } = floorApi();

    const standStillWon = measuredTable(MEASURED_WINS);
    standStillWon[0] = {
      ...standStillWon[0]!,
      standStill: { ...standStillWon[0]!.standStill, roomsCleared: 1 },
    };
    expect(simTableGateFailures(standStillWon).length, "stand still cleared a room").toBeGreaterThan(0);

    const noDash = measuredTable(MEASURED_WINS);
    const lateIndex = noDash.findIndex((r) => r.chapter >= 2);
    noDash[lateIndex] = { ...noDash[lateIndex]!, loadout: { ...noDash[lateIndex]!.loadout, dashesUsed: 0 } };
    expect(simTableGateFailures(noDash).length, "a Ch2+ row never dashed").toBeGreaterThan(0);

    const leak = measuredTable(MEASURED_WINS);
    const ninjaIndex = leak.findIndex((r) => r.characterId === "ninja");
    leak[ninjaIndex] = {
      ...leak[ninjaIndex]!,
      loadout: {
        ...leak[ninjaIndex]!.loadout,
        classSkills: [...leak[ninjaIndex]!.loadout.classSkills, classSkillsFor("archer")[0]!.id],
      },
    };
    expect(simTableGateFailures(leak).length, "ninja owns an archer skill").toBeGreaterThan(0);
  });

  it("the floor only holds on the exact sim:table matrix (a 1-seed-per-boss table fails)", () => {
    const { simTableGateFailures } = floorApi();
    const small = CHARACTER_IDS.flatMap((characterId) =>
      Array.from({ length: 8 }, (_, i) => {
        const own = classSkillsFor(characterId)[0]!.id;
        const evo = classEvolutionFor(characterId).id;
        return row(characterId, i, {
          classSkills: i === 0 ? [own, evo] : [own],
          evolutions: i === 0 ? ["phantom-volley", evo] : [],
        });
      }),
    );
    expect(simTableGateFailures(small).length).toBeGreaterThan(0);
  });

  it("`bun run sim:table` exits through simTableGateFailures (one gate, not a hand-written copy)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const script = readFileSync(join(here, "../../scripts/sim-table.ts"), "utf8");
    expect(script).toContain("simTableGateFailures");
    expect(script).not.toMatch(/loadoutWon\s*!==\s*rows\.length/);
  });
});
