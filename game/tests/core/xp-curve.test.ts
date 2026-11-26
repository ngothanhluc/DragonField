/**
 * M12-T1 unit tests: XP curve determinism, chapter pacing (12–16 level-ups per full chapter run),
 * splitling non-farming, multi-level-up queuing, and `xp` / `doors` tuning schema validation.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOORS_TUNING,
  TUNING,
  TUNING_SOURCE,
  XP_TUNING,
  parseTuning,
} from '../../assets/scripts/core/enemies/tuning';
import { roomEnemyTotal } from '../../assets/scripts/core/enemies/wave-scheduler';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import { drawRunRooms } from '../../assets/scripts/core/run/room-draw';
import {
  XpTracker,
  chapterXpMultiplier,
  consumePendingLevelUp,
  createXpState,
  grantXp,
  xpDoorClearBonus,
  xpForKill,
  xpForNextLevel,
  xpProgressRatio,
} from '../../assets/scripts/core/xp/xp-curve';
import { LEVELS_ROOT, loadTmxLevels } from '../helpers/tmx-levels';

function cloneSource(): Record<string, unknown> {
  return structuredClone(TUNING_SOURCE) as Record<string, unknown>;
}

describe('xp-curve — thresholds and role XP', () => {
  it('is deterministic and monotonically non-decreasing across levels', () => {
    for (let chapter = 1; chapter <= 4; chapter += 1) {
      let previous = 0;
      for (let level = 1; level <= 25; level += 1) {
        const threshold = xpForNextLevel(level, chapter);
        expect(xpForNextLevel(level, chapter)).toBe(threshold);
        expect(threshold).toBeGreaterThanOrEqual(previous);
        expect(threshold).toBeGreaterThanOrEqual(1);
        previous = threshold;
      }
    }
  });

  it('scales thresholds across chapters from tuning.json without hardcoding', () => {
    expect(chapterXpMultiplier(1)).toBe(XP_TUNING.curve.chapterMultipliers[0]);
    expect(chapterXpMultiplier(4)).toBe(XP_TUNING.curve.chapterMultipliers[3]);
    expect(xpForNextLevel(1, 4)).toBeGreaterThan(xpForNextLevel(1, 1));

    const customRaw = cloneSource();
    ((customRaw.xp as Record<string, unknown>).curve as Record<string, unknown>).baseThreshold =
      200;
    const customTuning = parseTuning(customRaw).xp;
    expect(xpForNextLevel(1, 1, customTuning)).toBe(200);
    expect(xpForNextLevel(1, 1)).toBe(XP_TUNING.curve.baseThreshold);
  });

  it('splitling XP is 0 so splitters cannot be farmed even as elites or in xp rooms', () => {
    expect(XP_TUNING.roles.splitling).toBe(0);
    expect(xpForKill('splitling', false)).toBe(0);
    expect(xpForKill('splitling', true)).toBe(0);
    expect(xpForKill('splitling', true, XP_TUNING, DOORS_TUNING.xpRoomXpMultiplier)).toBe(0);
    expect(xpForKill('splitter', false)).toBeGreaterThan(0);
  });

  it('role XP scales by eliteMultiplier and roomMultiplier', () => {
    const chaser = xpForKill('chaser', false);
    const eliteChaser = xpForKill('chaser', true);
    const boostedChaser = xpForKill('chaser', false, XP_TUNING, DOORS_TUNING.xpRoomXpMultiplier);
    const tank = xpForKill('tank', false);

    expect(chaser).toBe(XP_TUNING.roles.chaser);
    expect(tank).toBeGreaterThan(chaser);
    expect(eliteChaser).toBe(Math.round(chaser * XP_TUNING.eliteMultiplier));
    expect(boostedChaser).toBe(Math.round(chaser * DOORS_TUNING.xpRoomXpMultiplier));
    expect(xpDoorClearBonus(1)).toBe(
      Math.round(DOORS_TUNING.xpBonus * chapterXpMultiplier(1)),
    );
    expect(xpDoorClearBonus(4)).toBeGreaterThan(xpDoorClearBonus(1));
  });
});

describe('xp-curve — grantXp and XpTracker multi-level-up queuing', () => {
  it('supports single and multi-level-up bursts with exact XP carryover', () => {
    const start = createXpState(1);
    const t1 = xpForNextLevel(1, 1);
    const t2 = xpForNextLevel(2, 1);
    const t3 = xpForNextLevel(3, 1);

    const burst = t1 + t2 + 17;
    const res = grantXp(start, burst);

    expect(res.levelsGained).toBe(2);
    expect(res.gainedXp).toBe(burst);
    expect(res.state.level).toBe(3);
    expect(res.state.currentXp).toBe(17);
    expect(res.state.nextLevelXp).toBe(t3);
    expect(res.state.totalXp).toBe(burst);
    expect(res.state.pendingLevelUps).toBe(2);
    expect(xpProgressRatio(res.state)).toBeCloseTo(17 / t3, 10);

    const afterOne = consumePendingLevelUp(res.state);
    expect(afterOne.pendingLevelUps).toBe(1);
    const afterTwo = consumePendingLevelUp(afterOne);
    expect(afterTwo.pendingLevelUps).toBe(0);
    // Consuming when 0 is a safe no-op.
    expect(consumePendingLevelUp(afterTwo).pendingLevelUps).toBe(0);
  });

  it('ignores zero, negative, and non-finite grants safely', () => {
    const start = createXpState(1);
    for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const res = grantXp(start, bad);
      expect(res.levelsGained).toBe(0);
      expect(res.gainedXp).toBe(0);
      expect(res.state).toEqual(start);
    }
  });

  it('XpTracker tracks state transitions, consumeLevelUp, and reset cleanly', () => {
    const tracker = new XpTracker(2);
    expect(tracker.level).toBe(1);
    expect(tracker.chapter).toBe(2);
    expect(tracker.pendingLevelUps).toBe(0);
    expect(tracker.consumeLevelUp()).toBe(false);

    const needTwo = xpForNextLevel(1, 2) + xpForNextLevel(2, 2);
    const result = tracker.grant(needTwo + 5);
    expect(result.levelsGained).toBe(2);
    expect(tracker.level).toBe(3);
    expect(tracker.currentXp).toBe(5);
    expect(tracker.totalXp).toBe(needTwo + 5);
    expect(tracker.pendingLevelUps).toBe(2);
    expect(tracker.progress).toBeCloseTo(5 / tracker.nextLevelXp, 10);

    expect(tracker.consumeLevelUp()).toBe(true);
    expect(tracker.pendingLevelUps).toBe(1);
    expect(tracker.consumeLevelUp()).toBe(true);
    expect(tracker.pendingLevelUps).toBe(0);
    expect(tracker.consumeLevelUp()).toBe(false);

    tracker.reset(3);
    expect(tracker.level).toBe(1);
    expect(tracker.chapter).toBe(3);
    expect(tracker.totalXp).toBe(0);
  });
});

describe('xp-curve — 12–16 level-ups per full chapter run across Ch1–Ch4', () => {
  for (const chapterNum of [1, 2, 3, 4] as const) {
    it(`chapter ${chapterNum} lands strictly within 12–16 level-ups across seeds and door routes`, () => {
      const chapter = chapterFromLevels(
        loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapterNum}`)),
      );

      for (let seed = 1; seed <= 10; seed += 1) {
        const normalRooms = drawRunRooms(chapter, seed).filter((room) => !room.isBossRoom);
        const roomXps = normalRooms.map((room) => {
          const total = roomEnemyTotal(room, seed);
          const authored = room.waves.flatMap((wave) => wave.enemies);
          let sum = 0;
          for (let i = 0; i < total; i += 1) {
            const enemy = authored[i % authored.length];
            if (enemy === undefined) continue;
            sum += xpForKill(enemy.role, enemy.elite);
          }
          return sum;
        });

        // Baseline: 8 normal combat rooms.
        const baselineTotal = roomXps.reduce((a, b) => a + b, 0);
        const baselineLevels = grantXp(createXpState(chapterNum), baselineTotal).levelsGained;
        expect(baselineLevels, `ch${chapterNum} seed ${seed} baseline`).toBeGreaterThanOrEqual(12);
        expect(baselineLevels, `ch${chapterNum} seed ${seed} baseline`).toBeLessThanOrEqual(16);

        // Aggressive XP route: 8 normal rooms with 4 of them being `xp` doors.
        const avgRoomXp = baselineTotal / Math.max(1, roomXps.length);
        const xpDoorExtra =
          Math.round(avgRoomXp * (DOORS_TUNING.xpRoomXpMultiplier - 1)) +
          xpDoorClearBonus(chapterNum);
        const xpRouteLevels = grantXp(
          createXpState(chapterNum),
          baselineTotal + 4 * xpDoorExtra,
        ).levelsGained;
        expect(xpRouteLevels, `ch${chapterNum} seed ${seed} xp-route`).toBeGreaterThanOrEqual(12);
        expect(xpRouteLevels, `ch${chapterNum} seed ${seed} xp-route`).toBeLessThanOrEqual(16);
      }
    });
  }
});

describe('tuning — xp & xp-door schema validation', () => {
  it('xp block matches config/tuning.json', () => {
    const raw = cloneSource();
    expect(TUNING.xp).toEqual(raw.xp);
    expect(TUNING.doors.weights.xp).toBeGreaterThan(0);
    expect(TUNING.doors.xpBonus).toBeGreaterThan(0);
    expect(TUNING.doors.xpRoomXpMultiplier).toBeGreaterThanOrEqual(1);
  });

  it('rejects missing or invalid xp tuning fields with clear paths', () => {
    const missingXp = cloneSource();
    delete missingXp.xp;
    expect(() => parseTuning(missingXp)).toThrowError(/xp.*must be an object/);

    const badPickup = cloneSource();
    const orbs = (badPickup.xp as { orbs: Record<string, unknown> }).orbs;
    orbs.pickupRadiusTiles = (orbs.magnetRadiusTiles as number) + 1;
    expect(() => parseTuning(badPickup)).toThrowError(/xp\.orbs\.pickupRadiusTiles.*must be <=/);

    const badEliteMult = cloneSource();
    (badEliteMult.xp as Record<string, unknown>).eliteMultiplier = 0.5;
    expect(() => parseTuning(badEliteMult)).toThrowError(/xp\.eliteMultiplier.*must be >= 1/);

    const badDoorMult = cloneSource();
    (badDoorMult.doors as Record<string, unknown>).xpRoomXpMultiplier = 0.8;
    expect(() => parseTuning(badDoorMult)).toThrowError(/doors\.xpRoomXpMultiplier.*must be >= 1/);
  });
});
