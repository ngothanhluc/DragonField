/**
 * Acceptance — ticket #84: Ninja class-exclusive skills + Ảnh Sát Tuyệt Kỹ Evolution (M20,
 * ADR-027, GDD `docs/gdd/m19-m20-class-skills-and-art.md` §3 Ninja table).
 *
 * Two seams:
 * 1. The #83 class-hook seam `dispatchClassSkillEvent(event, 'ninja', owned, context)`: each
 *    mechanic's trigger rule and its GDD numbers, as `ClassSkillEffect` requests.
 * 2. `simulateRun`: the effect requests are actually applied in headless combat (damage dealt per
 *    class skill, smoke zones dropped), not returned and dropped.
 *
 * Effect contract (agreed in `.agent-auto/brief.md`):
 * - Shadow clone: `onDash` → 1 `spawn` at the player, `durationMs` 2500, `amount` 0.5 (clone
 *   shuriken damage ratio); with the Evolution the effect carries `crit: true`.
 * - Venom shuriken: `onShot` with `shotCount % 3 === 0` → 1 `spawn` (cloud `radiusTiles`,
 *   `durationMs`, `amount` = cloud damage, all > 0).
 * - Kunai burst: `onKill` → one `spawn` per kunai (4, +2/stack) at the corpse. No burst when the
 *   kill came from a kunai (`killedBy: 'ninja-kunai-burst'`), nor from a clone unless the Evolution
 *   is owned (`killedBy: 'ninja-shadow-clone'`).
 * - Smoke bomb: `onDash` and `onActive` → 1 `status` (slow `amount` 0.45) + 1 `buff` (fire rate
 *   `amount` 0.30), both `radiusTiles` 2.8, `durationMs` 3000, at the player.
 * - Stacks the GDD gives no number for: each extra stack is no weaker in any field and strictly
 *   stronger in at least one (numbers live in `tuning.json`).
 */
import { describe, expect, it } from "vitest";
import type {
  ClassSkillEffect,
  ClassSkillEventName,
  ClassSkillStackSource,
} from "../../assets/scripts/core/skills/class-skill-hooks";
import { dispatchClassSkillEvent } from "../../assets/scripts/core/skills/class-skills";
import {
  SIM_DEFAULT_MAX_DURATION_MS,
  simulateRun,
  smartActiveSkillPolicy,
  smartDashPolicy,
  type SimulationResult,
} from "../../assets/scripts/core/sim/run-simulation";
import { makeDodgePolicy } from "../helpers/dodge-policy";
import { loadChapterOne } from "../helpers/tmx-levels";

const CLONE = "ninja-shadow-clone";
const VENOM = "ninja-venom-shuriken";
const KUNAI = "ninja-kunai-burst";
const SMOKE = "ninja-smoke-bomb";
const EVOLUTION = "ninja-phantom-assassin";

const PLAYER = { x: 12, y: 7 } as const;
const CORPSE = { x: 20, y: 9 } as const;

function stacks(
  entries: Readonly<Record<string, number>>,
): ClassSkillStackSource {
  return (id) => entries[id] ?? 0;
}

/**
 * Dispatch one Ninja event. The context goes through a non-literal variable so the optional
 * `killedBy` field (added by #84) does not trip excess-property checks before it exists.
 */
function fire(
  event: ClassSkillEventName,
  owned: Readonly<Record<string, number>>,
  context: Record<string, unknown>,
): readonly ClassSkillEffect[] {
  const ctx = context as Parameters<typeof dispatchClassSkillEvent>[3];
  return dispatchClassSkillEvent(event, "ninja", stacks(owned), ctx);
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

function critOf(effect: ClassSkillEffect): boolean {
  return (
    (effect as ClassSkillEffect & { readonly crit?: boolean }).crit === true
  );
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

describe("#84 Phân Thân Ám Ảnh (ninja-shadow-clone)", () => {
  it("dashing spawns one stationary 2.5 s decoy at the player firing 50% damage shurikens", () => {
    const clone = single(
      fire("onDash", { [CLONE]: 1 }, { position: PLAYER }),
      CLONE,
    );
    expect(clone.kind).toBe("spawn");
    expect(clone.position).toEqual(PLAYER);
    expect(clone.durationMs).toBe(2500);
    expect(clone.amount).toBeCloseTo(0.5, 6);
    expect(critOf(clone)).toBe(false);
  });

  it("only dashing spawns a clone, and only when the skill is owned", () => {
    expect(
      only(fire("onDash", { [KUNAI]: 1 }, { position: PLAYER }), CLONE),
    ).toHaveLength(0);
    expect(
      only(fire("onActive", { [CLONE]: 1 }, { position: PLAYER }), CLONE),
    ).toHaveLength(0);
    expect(
      only(
        fire("onShot", { [CLONE]: 1 }, { position: PLAYER, shotCount: 3 }),
        CLONE,
      ),
    ).toHaveLength(0);
  });

  it("gets stronger with every stack up to 3", () => {
    const byStack = [1, 2, 3].map((n) =>
      single(fire("onDash", { [CLONE]: n }, { position: PLAYER }), CLONE),
    );
    expectStronger(byStack[0]!, byStack[1]!);
    expectStronger(byStack[1]!, byStack[2]!);
  });
});

describe("#84 Phi Tiêu Độc Vụ (ninja-venom-shuriken)", () => {
  it("every 3rd shot throws exactly one venom shuriken that leaves a poison cloud", () => {
    const venomShots: number[] = [];
    for (let shotCount = 1; shotCount <= 9; shotCount += 1) {
      const effects = only(
        fire("onShot", { [VENOM]: 1 }, { position: PLAYER, shotCount }),
        VENOM,
      );
      if (effects.length > 0) {
        expect(effects).toHaveLength(1);
        venomShots.push(shotCount);
      }
    }
    expect(venomShots).toEqual([3, 6, 9]);

    const venom = single(
      fire("onShot", { [VENOM]: 1 }, { position: PLAYER, shotCount: 3 }),
      VENOM,
    );
    expect(venom.kind).toBe("spawn");
    expect(venom.position).toEqual(PLAYER);
    expect(venom.radiusTiles ?? 0).toBeGreaterThan(0);
    expect(venom.durationMs ?? 0).toBeGreaterThan(0);
    expect(venom.amount ?? 0).toBeGreaterThan(0);
  });

  it("gets stronger with every stack up to 3", () => {
    const byStack = [1, 2, 3].map((n) =>
      single(
        fire("onShot", { [VENOM]: n }, { position: PLAYER, shotCount: 6 }),
        VENOM,
      ),
    );
    expectStronger(byStack[0]!, byStack[1]!);
    expectStronger(byStack[1]!, byStack[2]!);
  });
});

describe("#84 Liên Hoàn Kunai (ninja-kunai-burst)", () => {
  const kill = { position: CORPSE, targetPosition: CORPSE, elite: false };

  it("a kill bursts 4 kunai from the corpse, +2 per stack (4 / 6 / 8)", () => {
    for (const [owned, expected] of [
      [1, 4],
      [2, 6],
      [3, 8],
    ] as const) {
      const kunai = only(fire("onKill", { [KUNAI]: owned }, kill), KUNAI);
      expect(kunai, `kunai at ${owned} stack(s)`).toHaveLength(expected);
      for (const effect of kunai) {
        expect(effect.kind).toBe("spawn");
        expect(effect.position).toEqual(CORPSE);
        expect(effect.amount ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("kunai kills do not chain into more kunai", () => {
    expect(
      only(fire("onKill", { [KUNAI]: 3 }, { ...kill, killedBy: KUNAI }), KUNAI),
    ).toHaveLength(0);
  });

  it("clone kills do not burst kunai without the Evolution", () => {
    expect(
      only(
        fire(
          "onKill",
          { [KUNAI]: 1, [CLONE]: 1 },
          { ...kill, killedBy: CLONE },
        ),
        KUNAI,
      ),
    ).toHaveLength(0);
  });
});

describe("#84 Bom Khói Ẩn Thân (ninja-smoke-bomb)", () => {
  for (const event of ["onDash", "onActive"] as const) {
    it(`${event} drops a 2.8-tile, 3 s smoke zone: enemies −45% speed, player +30% fire rate`, () => {
      const effects = fire(event, { [SMOKE]: 1 }, { position: PLAYER });
      const slow = single(effects, SMOKE, "status");
      const haste = single(effects, SMOKE, "buff");
      for (const zone of [slow, haste]) {
        expect(zone.position).toEqual(PLAYER);
        expect(zone.radiusTiles).toBeCloseTo(2.8, 6);
        expect(zone.durationMs).toBe(3000);
      }
      expect(slow.amount).toBeCloseTo(0.45, 6);
      expect(haste.amount).toBeCloseTo(0.3, 6);
    });
  }

  it("shots and kills drop no smoke", () => {
    expect(
      only(
        fire("onShot", { [SMOKE]: 2 }, { position: PLAYER, shotCount: 3 }),
        SMOKE,
      ),
    ).toHaveLength(0);
    expect(
      only(
        fire(
          "onKill",
          { [SMOKE]: 2 },
          { position: CORPSE, targetPosition: CORPSE },
        ),
        SMOKE,
      ),
    ).toHaveLength(0);
  });

  it("gets stronger at stack 2 (max)", () => {
    const one = fire("onDash", { [SMOKE]: 1 }, { position: PLAYER });
    const two = fire("onDash", { [SMOKE]: 2 }, { position: PLAYER });
    expectStronger(single(one, SMOKE, "status"), single(two, SMOKE, "status"));
    expectStronger(single(one, SMOKE, "buff"), single(two, SMOKE, "buff"));
  });
});

describe("#84 Evolution Ảnh Sát Tuyệt Kỹ (ninja-phantom-assassin)", () => {
  const evolved = { [CLONE]: 1, [KUNAI]: 1, [EVOLUTION]: 1 };

  it("clones fire guaranteed-crit shurikens", () => {
    const clone = single(fire("onDash", evolved, { position: PLAYER }), CLONE);
    expect(critOf(clone)).toBe(true);
    expect(clone.durationMs).toBe(2500);
  });

  it("clone kills trigger Liên Hoàn Kunai", () => {
    const kunai = only(
      fire("onKill", evolved, {
        position: CORPSE,
        targetPosition: CORPSE,
        killedBy: CLONE,
      }),
      KUNAI,
    );
    expect(kunai).toHaveLength(4);
  });
});

describe("#84 Ninja skills are applied in headless combat (simulateRun)", () => {
  const chapterOne = loadChapterOne();
  const result = simulateRun({
    seed: 84,
    characterId: "ninja",
    level: chapterOne,
    policy: makeDodgePolicy(),
    chooseDash: smartDashPolicy,
    chooseActive: smartActiveSkillPolicy,
    godMode: true,
    skills: new Map([
      [CLONE, 1],
      [VENOM, 1],
      [KUNAI, 1],
      [SMOKE, 1],
    ]),
    maxDurationMs: SIM_DEFAULT_MAX_DURATION_MS,
  });

  /** `classSkillDamage` / `classSkillProcs` are added to `SimulationResult` by #84. */
  function perSkill(
    field: "classSkillDamage" | "classSkillProcs",
    id: string,
  ): number {
    const map = (
      result as SimulationResult &
        Partial<Record<typeof field, ReadonlyMap<string, number>>>
    )[field];
    return map?.get(id) ?? 0;
  }

  it("the run still clears the chapter", () => {
    expect(result.status).toBe("won");
    expect(result.dashesUsed).toBeGreaterThan(0);
  });

  it("clone shurikens, venom clouds and kunai each deal damage", () => {
    expect(perSkill("classSkillDamage", CLONE)).toBeGreaterThan(0);
    expect(perSkill("classSkillDamage", VENOM)).toBeGreaterThan(0);
    expect(perSkill("classSkillDamage", KUNAI)).toBeGreaterThan(0);
  });

  it("smoke zones are dropped", () => {
    expect(perSkill("classSkillProcs", SMOKE)).toBeGreaterThan(0);
  });
});
