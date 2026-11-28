/**
 * Acceptance — ticket #87: Cultivator class-exclusive skills + Vạn Kiếm Quy Tông Evolution (M20,
 * ADR-027, GDD `docs/gdd/m19-m20-class-skills-and-art.md` §3 Cultivator table).
 *
 * Two seams:
 * 1. The #83 class-hook seam `dispatchClassSkillEvent(event, 'cultivator', owned, context)`: each
 *    mechanic's trigger rule and its GDD numbers, as `ClassSkillEffect` requests.
 * 2. `simulateRun`: the effect requests are actually applied in headless combat (damage dealt per
 *    class skill), not returned and dropped.
 *
 * Effect contract (agreed in `.agent-auto/brief.md`):
 * - Orbit swords: `tick` (with `nowMs` + `dtMs`) on each slash-cadence crossing → one `spawn` per
 *   sword (2, +1/stack: 2 / 3 / 4) at the player, `amount` > 0 (slash damage ratio), `radiusTiles`
 *   > 0 (dart reach). Every other tick returns the shared `NO_CLASS_SKILL_EFFECTS`.
 * - Sword array: `onActive`, and `onKill` of an Elite → 1 `spawn` (`radiusTiles` 3.2, `durationMs`
 *   3000, `amount` > 0) at the player / corpse. Normal kills plant nothing.
 * - Sword qi: `onShot` with `shotCount % 3 === 0` → 1 `spawn` at the shot origin (`amount`,
 *   `radiusTiles` = wave half-width, `durationMs` = travel lifetime, all > 0).
 * - Qi barrier: `onHit` → 1 `buff` whose `amount` is the gauge charge per hit, in (0, 1].
 * - Evolution: on each orbit-slash crossing every sword also emits 1 `spawn` with `skillId`
 *   `cultivator-myriad-swords` (mini wave); `tick` also plants a `cultivator-sword-array` `spawn`
 *   at the player periodically (period ≤ 15 s). Needs both prerequisites.
 * - Stacks the GDD gives no number for: each extra stack is no weaker in any field and strictly
 *   stronger in at least one (numbers live in `tuning.json`).
 */
import { describe, expect, it } from "vitest";
import type {
  ClassSkillEffect,
  ClassSkillEventName,
  ClassSkillStackSource,
} from "../../assets/scripts/core/skills/class-skill-hooks";
import { NO_CLASS_SKILL_EFFECTS } from "../../assets/scripts/core/skills/class-skill-hooks";
import { dispatchClassSkillEvent } from "../../assets/scripts/core/skills/class-skills";
import {
  SIM_DEFAULT_MAX_DURATION_MS,
  SIM_STEP_MS,
  simulateRun,
  smartActiveSkillPolicy,
  smartDashPolicy,
} from "../../sim/run-simulation";
import { makeDodgePolicy } from "../helpers/dodge-policy";
import { loadChapterOne } from "../helpers/tmx-levels";

const ORBIT = "cultivator-orbit-swords";
const ARRAY = "cultivator-sword-array";
const QI = "cultivator-sword-qi";
const BARRIER = "cultivator-qi-barrier";
const EVOLUTION = "cultivator-myriad-swords";

const PLAYER = { x: 12, y: 7 } as const;
const CORPSE = { x: 20, y: 9 } as const;
const TARGET = { x: 15, y: 7 } as const;

/** Sweep length for periodic `tick` mechanics. */
const SWEEP_MS = 30_000;

function stacks(
  entries: Readonly<Record<string, number>>,
): ClassSkillStackSource {
  return (id) => entries[id] ?? 0;
}

/**
 * Dispatch one Cultivator event. The context goes through a non-literal variable so the optional
 * `nowMs` field (added by #87 or a sibling class ticket) does not trip excess-property checks.
 */
function fire(
  event: ClassSkillEventName,
  owned: Readonly<Record<string, number>>,
  context: Record<string, unknown>,
): readonly ClassSkillEffect[] {
  const ctx = context as Parameters<typeof dispatchClassSkillEvent>[3];
  return dispatchClassSkillEvent(event, "cultivator", stacks(owned), ctx);
}

function only(
  effects: readonly ClassSkillEffect[],
  skillId: string,
  kind?: ClassSkillEffect["kind"],
) {
  return effects.filter(
    (effect) =>
      effect.skillId === skillId &&
      (kind === undefined || effect.kind === kind),
  );
}

function single(
  effects: readonly ClassSkillEffect[],
  skillId: string,
  kind?: ClassSkillEffect["kind"],
) {
  const matches = only(effects, skillId, kind);
  expect(matches).toHaveLength(1);
  const [effect] = matches;
  if (effect === undefined) throw new Error(`no ${skillId} effect`);
  return effect;
}

/** Each numeric field of `next` ≥ `prev`, and at least one strictly greater. */
function expectStronger(prev: ClassSkillEffect, next: ClassSkillEffect): void {
  const fields = ["amount", "radiusTiles", "durationMs"] as const;
  let strictlyBetter = false;
  for (const field of fields) {
    const before = prev[field] ?? 0;
    const after = next[field] ?? 0;
    expect(
      after,
      `${prev.skillId}.${field} must not shrink with stacks`,
    ).toBeGreaterThanOrEqual(before);
    if (after > before) strictlyBetter = true;
  }
  expect(
    strictlyBetter,
    `${prev.skillId}: an extra stack must strengthen something`,
  ).toBe(true);
}

/** Every `tick` of a `SWEEP_MS` run at the sim step, with the effects it returned. */
function sweepTicks(
  owned: Readonly<Record<string, number>>,
): { nowMs: number; effects: readonly ClassSkillEffect[] }[] {
  const ticks: { nowMs: number; effects: readonly ClassSkillEffect[] }[] = [];
  for (let nowMs = SIM_STEP_MS; nowMs <= SWEEP_MS; nowMs += SIM_STEP_MS) {
    ticks.push({
      nowMs,
      effects: fire("tick", owned, {
        dtMs: SIM_STEP_MS,
        nowMs,
        position: PLAYER,
      }),
    });
  }
  return ticks;
}

describe("#87 Ngự Kiếm Hộ Thể (cultivator-orbit-swords)", () => {
  it("2 swords (+1 per stack: 2 / 3 / 4) dart out on a periodic slash cadence", () => {
    for (const [owned, swords] of [
      [1, 2],
      [2, 3],
      [3, 4],
    ] as const) {
      const ticks = sweepTicks({ [ORBIT]: owned });
      const slashTicks = ticks.filter(
        (tick) => only(tick.effects, ORBIT).length > 0,
      );
      expect(
        slashTicks.length,
        `slashes in ${SWEEP_MS} ms at ${owned} stack(s)`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        slashTicks.length,
        "swords slash on a cadence, not every frame",
      ).toBeLessThanOrEqual(ticks.length / 4);
      for (const tick of slashTicks) {
        const slashes = only(tick.effects, ORBIT);
        expect(slashes, `swords at ${owned} stack(s)`).toHaveLength(swords);
        for (const slash of slashes) {
          expect(slash.kind).toBe("spawn");
          expect(slash.position).toEqual(PLAYER);
          expect(slash.amount ?? 0).toBeGreaterThan(0);
          expect(slash.radiusTiles ?? 0).toBeGreaterThan(0);
        }
      }
    }
  });

  it("quiet ticks return the shared empty list (no per-frame allocation)", () => {
    const quiet = sweepTicks({ [ORBIT]: 3, [QI]: 1, [BARRIER]: 1 }).filter(
      (tick) => tick.effects.length === 0,
    );
    expect(quiet.length).toBeGreaterThan(0);
    for (const tick of quiet) expect(tick.effects).toBe(NO_CLASS_SKILL_EFFECTS);
  });
});

describe("#87 Kiếm Trận (cultivator-sword-array)", () => {
  it("casting the Active (E) plants a 3.2-tile, 3 s Sword Array at the player", () => {
    const array = single(
      fire("onActive", { [ARRAY]: 1 }, { position: PLAYER }),
      ARRAY,
    );
    expect(array.kind).toBe("spawn");
    expect(array.position).toEqual(PLAYER);
    expect(array.radiusTiles).toBeCloseTo(3.2, 6);
    expect(array.durationMs).toBe(3000);
    expect(array.amount ?? 0).toBeGreaterThan(0);
  });

  it("slaying an Elite plants one at the corpse; a normal kill plants none", () => {
    const elite = single(
      fire(
        "onKill",
        { [ARRAY]: 1 },
        { position: CORPSE, targetPosition: CORPSE, elite: true },
      ),
      ARRAY,
    );
    expect(elite.kind).toBe("spawn");
    expect(elite.position).toEqual(CORPSE);
    expect(elite.radiusTiles).toBeCloseTo(3.2, 6);
    expect(elite.durationMs).toBe(3000);

    expect(
      only(
        fire(
          "onKill",
          { [ARRAY]: 2 },
          { position: CORPSE, targetPosition: CORPSE, elite: false },
        ),
        ARRAY,
      ),
    ).toHaveLength(0);
  });

  it("dashing and shooting plant nothing", () => {
    expect(
      only(fire("onDash", { [ARRAY]: 2 }, { position: PLAYER }), ARRAY),
    ).toHaveLength(0);
    expect(
      only(
        fire("onShot", { [ARRAY]: 2 }, { position: PLAYER, shotCount: 3 }),
        ARRAY,
      ),
    ).toHaveLength(0);
  });

  it("gets stronger at stack 2 (max)", () => {
    expectStronger(
      single(fire("onActive", { [ARRAY]: 1 }, { position: PLAYER }), ARRAY),
      single(fire("onActive", { [ARRAY]: 2 }, { position: PLAYER }), ARRAY),
    );
  });
});

describe("#87 Kiếm Khí Bán Nguyệt (cultivator-sword-qi)", () => {
  it("every 3rd shot unleashes exactly one crescent Sword Qi wave", () => {
    const qiShots: number[] = [];
    for (let shotCount = 1; shotCount <= 9; shotCount += 1) {
      const effects = only(
        fire("onShot", { [QI]: 1 }, { position: PLAYER, shotCount }),
        QI,
      );
      if (effects.length > 0) {
        expect(effects).toHaveLength(1);
        qiShots.push(shotCount);
      }
    }
    expect(qiShots).toEqual([3, 6, 9]);

    const wave = single(
      fire("onShot", { [QI]: 1 }, { position: PLAYER, shotCount: 3 }),
      QI,
    );
    expect(wave.kind).toBe("spawn");
    expect(wave.position).toEqual(PLAYER);
    expect(wave.amount ?? 0).toBeGreaterThan(0);
    expect(wave.radiusTiles ?? 0).toBeGreaterThan(0);
    expect(wave.durationMs ?? 0).toBeGreaterThan(0);
  });

  it("gets stronger with every stack up to 3", () => {
    const byStack = [1, 2, 3].map((n) =>
      single(
        fire("onShot", { [QI]: n }, { position: PLAYER, shotCount: 6 }),
        QI,
      ),
    );
    expectStronger(byStack[0]!, byStack[1]!);
    expectStronger(byStack[1]!, byStack[2]!);
  });
});

describe("#87 Hộ Tâm Linh Khí (cultivator-qi-barrier)", () => {
  const hit = { position: TARGET, targetPosition: TARGET };

  it("each damaging hit charges the Qi gauge by a fraction in (0, 1]", () => {
    const charge = single(fire("onHit", { [BARRIER]: 1 }, hit), BARRIER);
    expect(charge.kind).toBe("buff");
    expect(charge.amount ?? 0).toBeGreaterThan(0);
    expect(charge.amount ?? 0).toBeLessThanOrEqual(1);
  });

  it("only hits charge the gauge", () => {
    expect(
      only(
        fire("onShot", { [BARRIER]: 3 }, { position: PLAYER, shotCount: 3 }),
        BARRIER,
      ),
    ).toHaveLength(0);
    expect(
      only(fire("onDash", { [BARRIER]: 3 }, { position: PLAYER }), BARRIER),
    ).toHaveLength(0);
    expect(
      only(
        fire("onKill", { [BARRIER]: 3 }, { position: CORPSE, elite: true }),
        BARRIER,
      ),
    ).toHaveLength(0);
  });

  it("gets stronger with every stack up to 3", () => {
    const byStack = [1, 2, 3].map((n) =>
      single(fire("onHit", { [BARRIER]: n }, hit), BARRIER),
    );
    expectStronger(byStack[0]!, byStack[1]!);
    expectStronger(byStack[1]!, byStack[2]!);
  });
});

describe("#87 Evolution Vạn Kiếm Quy Tông (cultivator-myriad-swords)", () => {
  const evolved = { [ORBIT]: 1, [ARRAY]: 1, [EVOLUTION]: 1 };

  it("every orbiting sword fires a mini Sword Qi wave when it slashes", () => {
    const slashTicks = sweepTicks(evolved).filter(
      (tick) => only(tick.effects, ORBIT).length > 0,
    );
    expect(slashTicks.length).toBeGreaterThanOrEqual(2);
    for (const tick of slashTicks) {
      const waves = only(tick.effects, EVOLUTION, "spawn");
      expect(waves).toHaveLength(only(tick.effects, ORBIT).length);
      for (const wave of waves) {
        expect(wave.amount ?? 0).toBeGreaterThan(0);
        expect(wave.radiusTiles ?? 0).toBeGreaterThan(0);
        expect(wave.durationMs ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("periodically plants Sword Arrays on its own (3.2 tiles, 3 s at stack 1)", () => {
    const arrays = sweepTicks(evolved).flatMap((tick) =>
      only(tick.effects, ARRAY, "spawn"),
    );
    expect(arrays.length).toBeGreaterThanOrEqual(2);
    for (const array of arrays) {
      expect(array.position).toEqual(PLAYER);
      expect(array.radiusTiles).toBeCloseTo(3.2, 6);
      expect(array.durationMs).toBe(3000);
    }
  });

  it("does nothing without the Evolution or without both prerequisites", () => {
    for (const owned of <Record<string, number>[]>[
      { [ORBIT]: 3, [ARRAY]: 2 },
      { [ORBIT]: 1, [EVOLUTION]: 1 },
    ]) {
      const effects = sweepTicks(owned).flatMap((tick) => tick.effects);
      expect(only(effects, EVOLUTION)).toHaveLength(0);
      expect(only(effects, ARRAY)).toHaveLength(0);
    }
  });
});

describe("#87 Cultivator skills are applied in headless combat (simulateRun)", () => {
  const chapterOne = loadChapterOne();
  const result = simulateRun({
    seed: 87,
    characterId: "cultivator",
    level: chapterOne,
    policy: makeDodgePolicy(),
    chooseDash: smartDashPolicy,
    chooseActive: smartActiveSkillPolicy,
    godMode: true,
    skills: new Map([
      [ORBIT, 1],
      [ARRAY, 1],
      [QI, 1],
      [BARRIER, 1],
      [EVOLUTION, 1],
    ]),
    maxDurationMs: SIM_DEFAULT_MAX_DURATION_MS,
  });

  function perSkill(
    field: "classSkillDamage" | "classSkillProcs",
    id: string,
  ): number {
    const map: ReadonlyMap<string, number> = result[field];
    return map.get(id) ?? 0;
  }

  it("the run still clears the chapter", () => {
    expect(result.status).toBe("won");
    expect(result.activeSkillsUsed).toBeGreaterThan(0);
  });

  it("orbit swords, sword arrays, sword qi, qi-barrier waves and the Evolution each deal damage", () => {
    for (const id of [ORBIT, ARRAY, QI, BARRIER, EVOLUTION]) {
      expect(perSkill("classSkillDamage", id), `${id} damage`).toBeGreaterThan(
        0,
      );
    }
  });

  it("the Qi gauge charges and Sword Arrays are planted", () => {
    expect(perSkill("classSkillProcs", BARRIER)).toBeGreaterThan(0);
    expect(perSkill("classSkillProcs", ARRAY)).toBeGreaterThan(0);
  });
});
