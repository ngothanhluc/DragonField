/**
 * Ticket #85 acceptance (M20, GDD `docs/gdd/m19-m20-class-skills-and-art.md` §3 Archer table,
 * ADR-027): the 4 Archer class-exclusive skills + the `archer-sky-tempest` Class Evolution.
 *
 * Seam: the class-hook dispatcher from #83 (`dispatchClassSkillEvent(event, 'archer', …)`). The
 * hooks return effect requests; the combat loop / sim apply them. Every assertion here is on those
 * requests, so it is pure and engine-free.
 *
 * GDD values: every 5th shot, 2.2-tile rain, 2 split arrows at ±18°, mark detonates on crit,
 * Wind momentum caps at 10. Per-stack numbers (not in the GDD) are the ticket's chosen
 * `tuning.json` defaults, written in `.agent-auto/brief.md`:
 * - rain damage ratio 0.8 / 1.2 / 1.6 × shot damage
 * - split arrow damage ratio 0.5 / 0.7 / 0.9 × hit damage
 * - mark lasts 4000 ms; detonation 1.6 tiles, 1.5 / 2.25 × hit damage
 * - Wind: per momentum stack +1% fire rate and +2% projectile speed per skill stack; momentum
 *   resets when the gap since the last hit exceeds 1500 ms (the buff lasts 1500 ms)
 * - Sky Tempest: each rain impact also fires 6 piercing arrows radially (60° apart), 0.5 × damage
 */
import { describe, expect, it } from "vitest";
import type { CharacterId } from "../../assets/scripts/core/characters/roster";
import type { Vec2 } from "../../assets/scripts/core/math/vec2";
import { SeededRng } from "../../assets/scripts/core/rng";
import type {
  ClassSkillEffect,
  ClassSkillEventContext,
  ClassSkillEventName,
} from "../../assets/scripts/core/skills/class-skill-hooks";
import { dispatchClassSkillEvent } from "../../assets/scripts/core/skills/class-skills";

const RAIN = "archer-arrow-rain";
const SPLIT = "archer-split-arrow";
const MARK = "archer-hunters-mark";
const WIND = "archer-wind-arrow";
const TEMPEST = "archer-sky-tempest";

type Ctx = Omit<ClassSkillEventContext, "characterId" | "owned">;

function fire(
  event: ClassSkillEventName,
  owned: Readonly<Record<string, number>>,
  context: Ctx,
  characterId: CharacterId = "archer",
): readonly ClassSkillEffect[] {
  return dispatchClassSkillEvent(event, characterId, (id) => owned[id] ?? 0, {
    rng: new SeededRng(1),
    ...context,
  });
}

function bySkill(
  effects: readonly ClassSkillEffect[],
  skillId: string,
): ClassSkillEffect[] {
  return effects.filter((effect) => effect.skillId === skillId);
}

function angleDeg(direction: Vec2 | undefined): number {
  expect(direction).toBeDefined();
  const d = direction as Vec2;
  const deg = (Math.atan2(d.y, d.x) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360);
}

const TARGET: Vec2 = { x: 10, y: 6 };
const ORIGIN: Vec2 = { x: 4, y: 6 };

function shot(shotCount: number, extra: Partial<Ctx> = {}): Ctx {
  return {
    shotCount,
    position: ORIGIN,
    targetPosition: TARGET,
    damage: 10,
    ...extra,
  };
}

describe("#85 Mưa Tên (archer-arrow-rain): every 5th shot drops a 2.2-tile volley on the target", () => {
  it("fires on shots 5 and 10 only, at the target position, with fx.arrow-rain", () => {
    const owned = { [RAIN]: 1 };
    for (const n of [1, 2, 3, 4, 6, 7, 8, 9]) {
      expect(bySkill(fire("onShot", owned, shot(n)), RAIN)).toEqual([]);
    }
    for (const n of [5, 10]) {
      const rain = bySkill(fire("onShot", owned, shot(n)), RAIN);
      expect(rain).toHaveLength(1);
      expect(rain[0]!.kind).toBe("damage");
      expect(rain[0]!.position).toEqual(TARGET);
      expect(rain[0]!.radiusTiles).toBeCloseTo(2.2, 5);
      expect(rain[0]!.fx).toBe("fx.arrow-rain");
    }
  });

  it("scales damage per stack: 0.8 / 1.2 / 1.6 × shot damage", () => {
    const expected = [8, 12, 16];
    for (const [i, stacks] of [1, 2, 3].entries()) {
      const rain = bySkill(fire("onShot", { [RAIN]: stacks }, shot(5)), RAIN);
      expect(rain).toHaveLength(1);
      expect(rain[0]!.amount).toBeCloseTo(expected[i]!, 5);
    }
  });

  it("does nothing with no target, or for a non-Archer character", () => {
    expect(
      bySkill(
        fire("onShot", { [RAIN]: 3 }, shot(5, { targetPosition: undefined })),
        RAIN,
      ),
    ).toEqual([]);
    expect(fire("onShot", { [RAIN]: 3 }, shot(5), "ninja")).toEqual([]);
  });
});

describe("#85 Tên Tách Chùm (archer-split-arrow): first hit splits into 2 arrows at ±18°", () => {
  const HIT_AT: Vec2 = { x: 7, y: 5 };
  function hit(extra: Partial<Ctx> = {}): Ctx {
    return {
      position: HIT_AT,
      targetPosition: HIT_AT,
      targetId: "e1",
      direction: { x: 1, y: 0 },
      firstHit: true,
      damage: 10,
      nowMs: 1000,
      ...extra,
    };
  }

  it("spawns 2 projectiles at the hit point, ±18° off the flight direction, skipping the victim", () => {
    const split = bySkill(fire("onHit", { [SPLIT]: 1 }, hit()), SPLIT);
    expect(split).toHaveLength(2);
    for (const arrow of split) {
      expect(arrow.kind).toBe("spawn");
      expect(arrow.position).toEqual(HIT_AT);
      expect(arrow.ignoreTargetId).toBe("e1");
    }
    expect(
      split.map((arrow) => angleDeg(arrow.direction)).sort((a, b) => a - b),
    ).toEqual([18, 342]);
  });

  it("rotates relative to the arrow flight direction", () => {
    const split = bySkill(
      fire("onHit", { [SPLIT]: 1 }, hit({ direction: { x: 0, y: 1 } })),
      SPLIT,
    );
    expect(
      split.map((arrow) => angleDeg(arrow.direction)).sort((a, b) => a - b),
    ).toEqual([72, 108]);
  });

  it("scales split damage per stack: 0.5 / 0.7 / 0.9 × hit damage", () => {
    const expected = [5, 7, 9];
    for (const [i, stacks] of [1, 2, 3].entries()) {
      const split = bySkill(fire("onHit", { [SPLIT]: stacks }, hit()), SPLIT);
      expect(split).toHaveLength(2);
      for (const arrow of split)
        expect(arrow.amount).toBeCloseTo(expected[i]!, 5);
    }
  });

  it("only splits on the first hit, and split arrows never split again", () => {
    expect(
      bySkill(fire("onHit", { [SPLIT]: 3 }, hit({ firstHit: false })), SPLIT),
    ).toEqual([]);
    expect(
      bySkill(
        fire("onHit", { [SPLIT]: 3 }, hit({ projectileSkillId: SPLIT })),
        SPLIT,
      ),
    ).toEqual([]);
  });
});

describe("#85 Ấn Ký Săn Mồi (archer-hunters-mark): hits mark, a crit on a marked enemy detonates", () => {
  const AT: Vec2 = { x: 9, y: 4 };
  function hit(
    nowMs: number,
    crit: boolean,
    targetId = "e1",
    damage = 20,
  ): Ctx {
    return {
      position: AT,
      targetPosition: AT,
      targetId,
      crit,
      damage,
      nowMs,
      firstHit: true,
    };
  }

  it("a hit marks the target for 4000 ms; a crit on the marked target bursts 1.6 tiles for 1.5×", () => {
    const memory = new Map<string, number>();
    const owned = { [MARK]: 1 };

    const marked = bySkill(
      fire("onHit", owned, { ...hit(1000, false), memory }),
      MARK,
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]!.kind).toBe("status");
    expect(marked[0]!.targetId).toBe("e1");
    expect(marked[0]!.durationMs).toBe(4000);

    const burst = bySkill(
      fire("onHit", owned, { ...hit(2000, true), memory }),
      MARK,
    ).filter((effect) => effect.kind === "damage");
    expect(burst).toHaveLength(1);
    expect(burst[0]!.position).toEqual(AT);
    expect(burst[0]!.radiusTiles).toBeCloseTo(1.6, 5);
    expect(burst[0]!.amount).toBeCloseTo(30, 5);

    // The mark was consumed: the next crit right after does not detonate again.
    const again = bySkill(
      fire("onHit", owned, { ...hit(2100, true), memory }),
      MARK,
    );
    expect(again.filter((effect) => effect.kind === "damage")).toEqual([]);
  });

  it("scales the burst per stack: 1.5 / 2.25 × hit damage", () => {
    for (const [stacks, expected] of [
      [1, 30],
      [2, 45],
    ] as const) {
      const memory = new Map<string, number>();
      fire("onHit", { [MARK]: stacks }, { ...hit(0, false), memory });
      const burst = bySkill(
        fire("onHit", { [MARK]: stacks }, { ...hit(500, true), memory }),
        MARK,
      ).filter((effect) => effect.kind === "damage");
      expect(burst).toHaveLength(1);
      expect(burst[0]!.amount).toBeCloseTo(expected, 5);
    }
  });

  it("does not detonate on an unmarked enemy, another enemy, or after the mark expired", () => {
    const owned = { [MARK]: 2 };
    const memory = new Map<string, number>();
    const firstCrit = bySkill(
      fire("onHit", owned, { ...hit(0, true, "e2"), memory }),
      MARK,
    );
    expect(firstCrit.filter((effect) => effect.kind === "damage")).toEqual([]);
    expect(firstCrit.filter((effect) => effect.kind === "status")).toHaveLength(
      1,
    );

    fire("onHit", owned, { ...hit(1000, false, "e1"), memory });
    const expired = bySkill(
      fire("onHit", owned, { ...hit(5001, true, "e1"), memory }),
      MARK,
    );
    expect(expired.filter((effect) => effect.kind === "damage")).toEqual([]);
  });
});

describe("#85 Phong Tiễn (archer-wind-arrow): consecutive hits stack Wind momentum up to 10", () => {
  function windAfterHits(
    stacks: number,
    hitTimesMs: readonly number[],
  ): ClassSkillEffect {
    const memory = new Map<string, number>();
    let last: ClassSkillEffect | undefined;
    for (const nowMs of hitTimesMs) {
      const wind = bySkill(
        fire(
          "onHit",
          { [WIND]: stacks },
          {
            position: TARGET,
            targetPosition: TARGET,
            targetId: `e${nowMs}`,
            damage: 10,
            firstHit: true,
            nowMs,
            memory,
          },
        ),
        WIND,
      );
      expect(wind).toHaveLength(1);
      last = wind[0];
    }
    return last as ClassSkillEffect;
  }

  it("one hit = 1 momentum: +1% fire rate, +2% projectile speed, buff lasts 1500 ms", () => {
    const buff = windAfterHits(1, [0]);
    expect(buff.kind).toBe("buff");
    expect(buff.fireRateMult).toBeCloseTo(1.01, 5);
    expect(buff.projectileSpeedMult).toBeCloseTo(1.02, 5);
    expect(buff.durationMs).toBe(1500);
  });

  it("caps at 10 momentum and scales per skill stack (×1 / ×2 / ×3)", () => {
    const twelveHits = Array.from({ length: 12 }, (_, i) => i * 100);
    const expected = [
      [1, 1.1, 1.2],
      [2, 1.2, 1.4],
      [3, 1.3, 1.6],
    ] as const;
    for (const [stacks, fireRate, speed] of expected) {
      const buff = windAfterHits(stacks, twelveHits);
      expect(buff.fireRateMult).toBeCloseTo(fireRate, 5);
      expect(buff.projectileSpeedMult).toBeCloseTo(speed, 5);
    }
  });

  it("resets momentum when more than 1500 ms pass between hits", () => {
    const buff = windAfterHits(1, [0, 100, 200, 1701]);
    expect(buff.fireRateMult).toBeCloseTo(1.01, 5);
    expect(buff.projectileSpeedMult).toBeCloseTo(1.02, 5);
  });
});

describe("#85 Thiên Tiễn Lôi Đình (archer-sky-tempest): Arrow Rain spawns piercing split volleys", () => {
  it("with the Evolution, each rain impact also fires 6 piercing arrows radially, 60° apart", () => {
    const owned = { [RAIN]: 1, [SPLIT]: 1, [TEMPEST]: 1 };
    const effects = fire("onShot", owned, shot(5));
    expect(bySkill(effects, RAIN)).toHaveLength(1);

    const volley = bySkill(effects, TEMPEST);
    expect(volley).toHaveLength(6);
    for (const arrow of volley) {
      expect(arrow.kind).toBe("spawn");
      expect(arrow.position).toEqual(TARGET);
      expect(arrow.pierce ?? 0).toBeGreaterThanOrEqual(1);
      expect(arrow.amount).toBeCloseTo(5, 5);
    }
    expect(
      volley.map((arrow) => angleDeg(arrow.direction)).sort((a, b) => a - b),
    ).toEqual([0, 60, 120, 180, 240, 300]);
  });

  it("without the Evolution, Arrow Rain spawns no volley; off-beat shots spawn nothing", () => {
    expect(
      bySkill(fire("onShot", { [RAIN]: 3, [SPLIT]: 3 }, shot(5)), TEMPEST),
    ).toEqual([]);
    expect(
      bySkill(
        fire("onShot", { [RAIN]: 1, [SPLIT]: 1, [TEMPEST]: 1 }, shot(4)),
        TEMPEST,
      ),
    ).toEqual([]);
  });
});
