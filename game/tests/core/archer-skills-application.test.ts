/**
 * #85 application tests: the pure stateful pieces the combat loop / sim lean on.
 *
 * The hook contract lives in `archer-skills.acceptance.test.ts`; here we cover the plumbing the
 * acceptance test cannot see — the bullet marker that makes a split arrow stop splitting, the
 * pre-seeded victim id, and the headless sim actually applying the Archer kit's effects.
 */
import { describe, expect, it } from "vitest";
import { BulletPool } from "../../assets/scripts/core/combat/bullets";
import { simulateRun, type InputPolicy } from "../../assets/scripts/core/sim/run-simulation";
import { loadChapterOne } from "../helpers/tmx-levels";

const chapterOne = loadChapterOne();

/** Circle around the room over time, deterministic and seed-independent in shape. */
const patrol: InputPolicy = ({ nowMs }) => {
  const phase = Math.floor(nowMs / 700) % 4;
  return {
    up: phase === 0,
    down: phase === 2,
    left: phase === 3,
    right: phase === 1,
  };
};

describe("#85 class-skill bullets", () => {
  it("keeps the class-skill marker and a pre-seeded ignored victim on the bullet", () => {
    const pool = new BulletPool(4);
    const bullet = pool.spawn({
      position: { x: 1, y: 1 },
      velocity: { x: 4, y: 0 },
      radiusTiles: 0.15,
      damage: 5,
      owner: "player",
      ttlMs: 1000,
      pierceRemaining: 2,
      classSkillId: "archer-split-arrow",
    });
    bullet.hitIds.push("e1");

    const snapshot = pool.snapshot()[0]!;
    expect(snapshot.classSkillId).toBe("archer-split-arrow");
    expect(snapshot.hitIds).toEqual(["e1"]);
    expect(snapshot.pierceRemaining).toBe(2);

    // A recycled slot must not leak the previous bullet's marker.
    pool.consume(bullet.id);
    pool.spawn({
      position: { x: 0, y: 0 },
      velocity: { x: 1, y: 0 },
      radiusTiles: 0.15,
      damage: 1,
      owner: "player",
      ttlMs: 1000,
    });
    expect(pool.snapshot()[0]!.classSkillId).toBeUndefined();
  });
});

describe("#85 the balance sim applies the Archer kit", () => {
  const KIT = new Map<string, number>([
    ["archer-arrow-rain", 1],
    ["archer-split-arrow", 1],
    ["archer-hunters-mark", 1],
    ["archer-wind-arrow", 1],
    ["archer-sky-tempest", 1],
  ]);

  it("a fixed-seed room kill-counter moves when the kit is owned", () => {
    const base = {
      level: chapterOne,
      seed: 20261127,
      characterId: "archer" as const,
      policy: patrol,
      godMode: true,
      maxDurationMs: 60_000,
    };
    const bare = simulateRun(base);
    const kitted = simulateRun({ ...base, skills: KIT });

    // Deterministic on a fixed seed; the kit must have teeth, not merely not crash.
    expect(kitted.kills).toBeGreaterThan(bare.kills);
  });
});
