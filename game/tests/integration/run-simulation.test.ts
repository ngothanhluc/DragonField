import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { makeDodgePolicy } from '../helpers/dodge-policy';
import {
  LEVEL_UP_TARGET_MAX,
  LEVEL_UP_TARGET_MIN,
  TYPICAL_LOADOUT,
  typicalDoorChoice,
  typicalRerollPolicy,
  typicalSkillChoice,
} from '../helpers/sim-table';
import { CHASER_CONTACT_RANGE_TILES } from '../../assets/scripts/core/enemies/behaviours';
import {
  ACTIVE_SKILL_TUNING,
  DASH_TUNING,
  DOORS_TUNING,
} from '../../assets/scripts/core/enemies/tuning';
import { parseLevelData, type ChapterData, type LevelData } from '../../assets/scripts/core/level/level-data';
import { ROOMS_PER_CHAPTER } from '../../assets/scripts/core/run/run-state';
import {
  MAX_GOLD,
  applyGold,
  goldForRoomClear,
  summariseRun,
} from '../../assets/scripts/core/run/rewards';
import { createDefaultSave } from '../../assets/scripts/core/save/save-data';
import { MemorySaveStorage, SaveRepository } from '../../assets/scripts/core/save/storage';
import { isEvolutionId } from '../../assets/scripts/core/skills/evolutions';
import { simulateBossRun } from '../../assets/scripts/core/sim/boss-run';
import {
  SIM_DEFAULT_MAX_DURATION_MS,
  simulateRun,
  smartActiveSkillPolicy,
  smartDashPolicy,
  type InputPolicy,
} from '../../assets/scripts/core/sim/run-simulation';
import { xpDoorClearBonus, xpForKill, xpForNextLevel } from '../../assets/scripts/core/xp/xp-curve';
import { rerollCost } from '../../assets/scripts/core/xp/reroll';
import { levelUpResumeIframeMs } from '../../assets/scripts/core/xp/level-up-wave';
import { loadChapterOne, loadTmxLevels, LEVELS_ROOT } from '../helpers/tmx-levels';
import { chapterFromLevels } from '../../assets/scripts/core/level/chapter';
import { join } from 'node:path';

const chapterOne = loadChapterOne();

/**
 * Yield one real macrotask between tests. Every sim here is synchronous and the whole file adds
 * up to well over a minute (#41: whole-chapter runs at 8× enemies), while vitest's worker RPC
 * (`onTaskUpdate`) times out after 60 s of a blocked event loop — microtasks are not enough to
 * receive the reply. Without this tick vitest reports a spurious "Timeout calling
 * onTaskUpdate" although every test passed. It yields, it changes no timing or threshold.
 */
afterEach(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});

/** No keys pressed: used for both god mode and the "stand still" player. */
const standStill: InputPolicy = () => ({ up: false, down: false, left: false, right: false });

/** Circle around the room over time — deterministic, no dodging skill needed. */
const patrol: InputPolicy = ({ nowMs }) => {
  const phase = Math.floor(nowMs / 700) % 4;
  return {
    up: phase === 0,
    down: phase === 2,
    left: phase === 3,
    right: phase === 1,
  };
};

/** 9 rooms × (walk time to firing position + TTK) — wide bounds to avoid flakiness. */
const CHAPTER_CLEAR_MIN_MS = 300_000;
/**
 * M4: the real boss (60 HP Tengu + 3 phases) takes longer than the placeholder tank, so the cap
 * moved from 180 s to 240 s. A run still sits in the 8–12 minute range of GDD §2.
 */
const CHAPTER_CLEAR_MAX_MS = 1_500_000;
/**
 * Room 1 alone, god mode, no skills — measures room-clear pacing.
 * M9 (#41, owner decision 2026-11-22): rooms hold 8× the v1 enemies at unchanged player DPS and
 * the owner accepted a 30–60 min run, so every time bound here is re-baselined ~4× (v1: room 1
 * 15–60 s, chapter 60–240 s, loadout/dodge caps 300 s). The win/lose invariants are unchanged.
 */
const ROOM_ONE_CLEAR_MIN_MS = 60_000;
const ROOM_ONE_CLEAR_MAX_MS = 240_000;

describe('simulateRun — god mode clears chapter 1', () => {
  const result = simulateRun({
    seed: 7,
    level: chapterOne,
    policy: standStill,
    godMode: true,
    maxDurationMs: SIM_DEFAULT_MAX_DURATION_MS,
  });

  it('wins after 9 rooms and takes no damage', () => {
    expect(result.status).toBe('won');
    expect(result.roomsCleared).toBe(ROOMS_PER_CHAPTER);
    expect(result.events.filter((event) => event.kind === 'room-cleared')).toHaveLength(
      ROOMS_PER_CHAPTER,
    );
    expect(result.events.some((event) => event.kind === 'player-hit')).toBe(false);
  });

  it('time falls in a sensible bound (no hang, not instant)', () => {
    expect(result.durationMs).toBeGreaterThanOrEqual(CHAPTER_CLEAR_MIN_MS);
    expect(result.durationMs).toBeLessThanOrEqual(CHAPTER_CLEAR_MAX_MS);
  });

  it('gold is added exactly from kill and room-clear events', () => {
    const fromEvents = result.events.reduce((sum, event) => {
      if (event.kind === 'kill' || event.kind === 'room-cleared') return sum + event.gold;
      return sum;
    }, 0);
    const expectedRoomGold =
      (ROOMS_PER_CHAPTER - 1) * goldForRoomClear(false) + goldForRoomClear(true);

    expect(result.goldEarned).toBe(fromEvents);
    expect(result.goldEarned).toBeGreaterThanOrEqual(expectedRoomGold);
    expect(result.kills).toBeGreaterThan(0);
  });
});

/**
 * Hand-built room with a chaser spawned next to the player: measures the i-frame and the loss
 * flow without depending on chapter 1 balance. Same `LevelData` schema, same
 * `behaviours`/`waves` — only the spawn position differs.
 */
function meleeRoom(roomNumber: number): LevelData {
  return parseLevelData({
    id: `melee-r${roomNumber}`,
    chapter: 1,
    room: roomNumber,
    isBossRoom: false,
    size: { cols: 32, rows: 18 },
    tileSizePx: 16,
    playerStart: { x: 16, y: 16 },
    waves: [
      {
        enemies: [
          { role: 'chaser', at: { x: 16, y: 14.5 }, elite: false },
          { role: 'chaser', at: { x: 17.5, y: 16 }, elite: false },
          { role: 'chaser', at: { x: 14.5, y: 16 }, elite: false },
          { role: 'chaser', at: { x: 16, y: 17.5 }, elite: false },
        ],
      },
    ],
    obstacles: [],
    doors: [],
  });
}

const meleeChapter: ChapterData = {
  chapter: 1,
  rooms: [meleeRoom(1), meleeRoom(2), meleeRoom(3)],
};

describe('simulateRun — player stands still', () => {
  const result = simulateRun({ seed: 11, level: meleeChapter, policy: standStill });

  it('dies within the first 3 rooms', () => {
    expect(result.status).toBe('lost');
    expect(result.roomsCleared).toBeLessThan(3);
    expect(result.events.some((event) => event.kind === 'run-lost')).toBe(true);
  });

  it('the 0.8 s i-frame is respected between two hits', () => {
    const hitTimes = result.events.flatMap((event) =>
      event.kind === 'player-hit' ? [event.nowMs] : [],
    );

    expect(hitTimes.length).toBeGreaterThan(1);
    for (let index = 1; index < hitTimes.length; index += 1) {
      const previous = hitTimes[index - 1];
      const current = hitTimes[index];
      if (previous === undefined || current === undefined) continue;
      expect(current - previous).toBeGreaterThanOrEqual(DEFAULT_COMBAT.invulnerabilityMs);
    }
  });

  it('summary keeps the right shape and sanitised numbers', () => {
    // The result screen treats timeout as a loss; `summariseRun` only knows RunStatus.
    const status = result.status === 'won' ? 'won' : 'lost';
    const summary = summariseRun({
      roomsCleared: result.roomsCleared,
      kills: result.kills,
      goldEarned: result.goldEarned,
      durationMs: result.durationMs,
      status,
    });

    expect(summary).toEqual({
      status: 'lost',
      roomsCleared: result.roomsCleared,
      kills: result.kills,
      goldEarned: result.goldEarned,
      durationMs: result.durationMs,
      durationSeconds: Math.round(result.durationMs / 100) / 10,
      won: false,
      roomLabel: `${result.roomsCleared}/${ROOMS_PER_CHAPTER}`,
    });
    expect(summary.goldEarned).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(summary.durationSeconds)).toBe(true);
  });
});

describe('simulateRun — determinism', () => {
  it('same seed + same policy gives the same result', () => {
    const first = simulateRun({
      seed: 4242,
      level: chapterOne,
      policy: patrol,
      godMode: true,
    });
    const second = simulateRun({
      seed: 4242,
      level: chapterOne,
      policy: patrol,
      godMode: true,
    });

    expect({
      status: second.status,
      roomsCleared: second.roomsCleared,
      kills: second.kills,
      goldEarned: second.goldEarned,
    }).toEqual({
      status: first.status,
      roomsCleared: first.roomsCleared,
      kills: first.kills,
      goldEarned: first.goldEarned,
    });
    expect(second.events).toEqual(first.events);
  });

  it('a different seed only changes random details, not the rules', () => {
    const a = simulateRun({ seed: 1, level: chapterOne, policy: standStill, godMode: true });
    const b = simulateRun({ seed: 2, level: chapterOne, policy: standStill, godMode: true });

    expect(a.status).toBe('won');
    expect(b.status).toBe('won');
    expect(a.roomsCleared).toBe(b.roomsCleared);
  });
});

describe('simulateRun — room 1 balance', () => {
  it('average over 20 seeds stays inside the recorded range', () => {
    const singleRoom: ChapterData = { chapter: 1, rooms: chapterOne.rooms.slice(0, 1) };
    const times: number[] = [];

    for (let seed = 0; seed < 20; seed += 1) {
      const result = simulateRun({ seed, level: singleRoom, policy: standStill, godMode: true });
      expect(result.status).toBe('won');
      expect(result.roomsCleared).toBe(1);
      times.push(result.durationMs);
    }

    const average = times.reduce((sum, value) => sum + value, 0) / times.length;
    expect(average).toBeGreaterThanOrEqual(ROOM_ONE_CLEAR_MIN_MS);
    expect(average).toBeLessThanOrEqual(ROOM_ONE_CLEAR_MAX_MS);
  });
});

/**
 * Chapter 1 balance, measured by the simulation itself:
 *
 * - Standing still **must lose**: otherwise the game has no gameplay (the original defect).
 * - Dodging **must survive clearly longer**: this proves attacks are still dodgeable, not
 *   one-shot enemies.
 * - A caster must land at least one shot before dying, otherwise
 *   "telegraph then fire" is dead code.
 * - At least one enemy must reach contact range while the player stands still, otherwise
 *   melee is never a threat.
 */
const BALANCE_SEEDS = [1, 7, 42];

describe('simulateRun — balance chapter 1', () => {
  it('a standing player loses within the first 3 rooms', () => {
    for (const seed of BALANCE_SEEDS) {
      const result = simulateRun({ seed, level: chapterOne, policy: standStill });

      expect(result.status, `seed ${seed}`).toBe('lost');
      expect(result.roomsCleared, `seed ${seed}`).toBeLessThan(3);
      expect(result.events.some((event) => event.kind === 'run-lost')).toBe(true);
    }
  });

  it('a dodging player survives at least 2× longer than standing still', () => {
    for (const seed of BALANCE_SEEDS) {
      const idle = simulateRun({ seed, level: chapterOne, policy: standStill });
      const dodging = simulateRun({ seed, level: chapterOne, policy: makeDodgePolicy() });

      expect(idle.status, `seed ${seed}`).toBe('lost');
      expect(dodging.durationMs, `seed ${seed}`).toBeGreaterThanOrEqual(idle.durationMs * 2);
    }
  });

  it('every caster lands at least one shot before dying', () => {
    const seenBullets = new Set<number>();
    const castersThatFired = new Set<string>();
    const castersSeen = new Set<string>();

    const spy: InputPolicy = (world) => {
      for (const enemy of world.enemies) {
        if (enemy.role === 'caster' && enemy.health > 0 && enemy.action.kind !== 'dead') {
          castersSeen.add(enemy.id);
        }
      }

      const casters = world.enemies.filter(
        (enemy) => enemy.role === 'caster' && enemy.health > 0 && enemy.action.kind !== 'dead',
      );

      for (const bullet of world.bullets) {
        if (bullet.owner !== 'enemy' || seenBullets.has(bullet.id)) continue;
        seenBullets.add(bullet.id);
        // Enemy bullets spawn exactly at the caster centre, and in this frame only fly
        // 0.064 tiles — so a small distance is enough to attribute them to the caster.
        for (const caster of casters) {
          const gap = Math.hypot(
            bullet.position.x - caster.position.x,
            bullet.position.y - caster.position.y,
          );
          if (gap <= 0.6) castersThatFired.add(caster.id);
        }
      }

      return standStill(world);
    };

    // God mode so no caster gets "lucky" and dies before the next wave arrives.
    const result = simulateRun({ seed: 7, level: chapterOne, policy: spy, godMode: true });

    expect(result.status).toBe('won');
    expect(castersSeen.size).toBeGreaterThan(0);
    expect(seenBullets.size).toBeGreaterThan(0);
    expect([...castersSeen].filter((id) => !castersThatFired.has(id))).toEqual([]);
  });

  it('an enemy reaches contact range while the player stands still', () => {
    let closestGap = Number.POSITIVE_INFINITY;

    const measure: InputPolicy = (world) => {
      for (const enemy of world.enemies) {
        const gap = Math.hypot(
          enemy.position.x - world.player.x,
          enemy.position.y - world.player.y,
        );
        closestGap = Math.min(closestGap, gap);
      }
      return standStill(world);
    };

    const result = simulateRun({ seed: 7, level: chapterOne, policy: measure });
    const contactHits = result.events.filter(
      (event) => event.kind === 'player-hit' && event.source === 'contact',
    );

    expect(result.status).toBe('lost');
    expect(contactHits.length).toBeGreaterThan(0);
    expect(closestGap).toBeLessThanOrEqual(CHASER_CONTACT_RANGE_TILES);
  });
});

describe('simulateRun — skills really matter', () => {
  it('a DPS skill clears room 1 clearly faster (god mode, standing still)', () => {
    const singleRoom: ChapterData = { chapter: 1, rooms: chapterOne.rooms.slice(0, 1) };
    const base = simulateRun({ seed: 7, level: singleRoom, policy: standStill, godMode: true });
    const combo = simulateRun({
      seed: 7,
      level: singleRoom,
      policy: standStill,
      godMode: true,
      skills: new Map([
        ['sharpen', 2],
        ['rapid-fire', 2],
        ['twin-shot', 1],
      ]),
    });

    expect(base.status).toBe('won');
    expect(combo.status).toBe('won');
    expect(combo.durationMs).toBeLessThan(base.durationMs * 0.7);
  });

  it('a typical loadout clears all 3 chapters, boss included (dodge policy)', () => {
    for (const chapter of [1, 2, 3]) {
      const level = chapterFromLevels(
        loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`)),
      );
      const result = simulateRun({
        seed: 7,
        level,
        policy: makeDodgePolicy(),
        skills: TYPICAL_LOADOUT,
        maxDurationMs: 1_200_000,
      });

      expect(result.status, `chapter ${chapter}`).toBe('won');
      expect(result.roomsCleared, `chapter ${chapter}`).toBe(9);
    }
  });
});

describe('simulateRun — chapter 2 and 3 balance with a 0-skill run', () => {
  /**
   * Each chapter is a new run (GDD §2), so the ch2/ch3 entrance must be proven readable
   * **without skills** while still posing genuine danger (M11 T6 Tier 1):
   * - Standing still loses within the first 3 rooms.
   * - Dodging with 0 skills survives well past standing still (≥ 5× duration, proving attacks
   *   are dodgeable on entry) and clears rooms across the seed sample (real runs pick Skill #1
   *   right after Room 1), yet still loses before finishing the chapter without skills.
   */
  for (const chapter of [2, 3]) {
    const level = chapterFromLevels(loadTmxLevels(join(LEVELS_ROOT, `chapter-${chapter}`)));

    it(`chapter ${chapter}: standing still loses within the first 3 rooms`, () => {
      for (const seed of BALANCE_SEEDS) {
        const result = simulateRun({ seed, level, policy: standStill });
        expect(result.status, `chapter ${chapter} seed ${seed}`).toBe('lost');
        expect(result.roomsCleared, `chapter ${chapter} seed ${seed}`).toBeLessThan(3);
      }
    });

    it(`chapter ${chapter}: dodging with no skills survives ≥5× yet still faces lethal danger`, () => {
      let totalRoomsCleared = 0;
      for (const seed of BALANCE_SEEDS) {
        const idle = simulateRun({ seed, level, policy: standStill });
        const dodging = simulateRun({
          seed,
          level,
          policy: makeDodgePolicy(),
          maxDurationMs: 1_500_000,
        });

        expect(dodging.durationMs, `chapter ${chapter} seed ${seed}`).toBeGreaterThanOrEqual(
          idle.durationMs * 5,
        );
        expect(dodging.status, `chapter ${chapter} seed ${seed}`).not.toBe('won');
        expect(dodging.roomsCleared, `chapter ${chapter} seed ${seed}`).toBeGreaterThanOrEqual(1);
        totalRoomsCleared += dodging.roomsCleared;
      }
      expect(totalRoomsCleared, `chapter ${chapter} total rooms cleared`).toBeGreaterThanOrEqual(4);
    }, 120_000);
  }
});

describe('simulateRun — save integration', () => {
  it('won-run gold is added to the save and round-trips through SaveRepository', () => {
    const result = simulateRun({
      seed: 7,
      level: chapterOne,
      policy: standStill,
      godMode: true,
    });
    expect(result.status).toBe('won');

    const base = createDefaultSave();
    const { save, gold } = applyGold(base, result.goldEarned);
    expect(gold).toBe(result.goldEarned);
    expect(save.gold).toBe(result.goldEarned);
    expect(base.gold).toBe(0);

    const repository = new SaveRepository(new MemorySaveStorage());
    repository.save(save);
    const loaded = repository.load();

    expect(loaded.gold).toBe(gold);
    expect(loaded.version).toBe(save.version);
    expect(loaded.upgrades).toEqual(save.upgrades);
    expect(repository.lastLoadError).toBeNull();
  });

  it('applyGold respects the save cap: never exceeds MAX_GOLD', () => {
    const { gold, save } = applyGold(createDefaultSave(), Number.MAX_VALUE);

    expect(gold).toBe(MAX_GOLD);
    expect(save.gold).toBe(MAX_GOLD);
    expect(Number.isFinite(save.gold)).toBe(true);
  });
});

describe('simulateRun — M12 unified XP level-up economy (ADR-021)', () => {
  it('earns 12–16 level-ups in a full Chapter 1 run with mid-combat picks and 0 starting skills', () => {
    const result = simulateRun({
      seed: 1,
      level: chapterOne,
      policy: makeDodgePolicy(),
      chooseSkill: typicalSkillChoice,
      shouldReroll: typicalRerollPolicy,
      chooseDoor: typicalDoorChoice,
      maxDurationMs: SIM_DEFAULT_MAX_DURATION_MS,
    });

    expect(result.status).toBe('won');
    expect(result.roomsCleared).toBe(ROOMS_PER_CHAPTER);
    expect(result.levelUps).toBeGreaterThanOrEqual(LEVEL_UP_TARGET_MIN);
    expect(result.levelUps).toBeLessThanOrEqual(LEVEL_UP_TARGET_MAX);
    expect(result.finalLevel).toBe(result.levelUps + 1);
    expect(result.xpEarned).toBeGreaterThan(0);

    const levelUpEvents = result.events.filter((event) => event.kind === 'level-up');
    expect(levelUpEvents).toHaveLength(result.levelUps);

    const totalStacks = Array.from(result.acquiredSkills.values()).reduce((a, b) => a + b, 0);
    expect(totalStacks).toBe(result.levelUps);

    // At least one level-up occurs mid-combat (strictly before the first room clears).
    const firstClearMs =
      result.events.find((event) => event.kind === 'room-cleared')?.nowMs ?? 0;
    expect(levelUpEvents.some((event) => event.nowMs < firstClearMs)).toBe(true);

    // Entering an `'xp'` door room grants `xpDoorClearBonus` on clear.
    const xpRewards = result.events.filter(
      (event) => event.kind === 'reward' && event.reward === 'xp' && event.room > 1,
    );
    expect(xpRewards.length).toBeGreaterThan(0);
    for (const reward of xpRewards) {
      if (reward.kind === 'reward') {
        expect(reward.xp).toBe(xpDoorClearBonus(1));
      }
    }
  });

  it('skill-roll sub-seed is strictly independent from combat RNG (same seed, different combat paths)', () => {
    const twoRooms: ChapterData = { chapter: 1, rooms: chapterOne.rooms.slice(0, 2) };
    const alwaysFirst = () => 0;

    // Two runs with the SAME seed but completely different movement/combat trajectories.
    const standing = simulateRun({
      seed: 77,
      level: twoRooms,
      policy: standStill,
      godMode: true,
      chooseSkill: alwaysFirst,
    });
    const patrolling = simulateRun({
      seed: 77,
      level: twoRooms,
      policy: patrol,
      godMode: true,
      chooseSkill: alwaysFirst,
    });

    const standOffers = standing.events.flatMap((event) =>
      event.kind === 'level-up' ? [event.offers] : [],
    );
    const patrolOffers = patrolling.events.flatMap((event) =>
      event.kind === 'level-up' ? [event.offers] : [],
    );

    const sharedCount = Math.min(standOffers.length, patrolOffers.length);
    expect(sharedCount).toBeGreaterThanOrEqual(2);
    // Combat trajectories genuinely diverged in timing, yet offered skill hands stay identical.
    expect(standing.durationMs).not.toBe(patrolling.durationMs);
    expect(standOffers.slice(0, sharedCount)).toEqual(patrolOffers.slice(0, sharedCount));
  });

  it('0-skill mode tracks XP/level-ups without acquiring any skills', () => {
    const singleRoom: ChapterData = { chapter: 1, rooms: chapterOne.rooms.slice(0, 1) };
    const result = simulateRun({
      seed: 7,
      level: singleRoom,
      policy: standStill,
      godMode: true,
    });

    expect(result.status).toBe('won');
    expect(result.xpEarned).toBeGreaterThan(0);
    expect(result.levelUps).toBeGreaterThan(0);
    expect(result.acquiredSkills.size).toBe(0);
    for (const event of result.events) {
      if (event.kind === 'level-up') {
        expect(event.offers).toEqual([]);
        expect(event.chosen).toBeNull();
      }
    }
  });

  it('splitling kills grant 0 XP so splitters cannot be farmed', () => {
    const splitterRoom: LevelData = parseLevelData({
      id: 'splitter-xp-room',
      chapter: 1,
      room: 1,
      isBossRoom: false,
      size: { cols: 32, rows: 18 },
      tileSizePx: 16,
      playerStart: { x: 16, y: 12 },
      waves: [
        {
          enemies: [{ role: 'splitter', at: { x: 16, y: 8 }, elite: false }],
        },
      ],
      obstacles: [],
      doors: [],
    });
    const result = simulateRun({
      seed: 1,
      level: { chapter: 1, rooms: [splitterRoom] },
      policy: standStill,
      godMode: true,
    });

    expect(result.status).toBe('won');
    const splitlingKills = result.events.filter(
      (event) => event.kind === 'kill' && event.role === 'splitling',
    );
    expect(splitlingKills.length).toBeGreaterThanOrEqual(2);
    // Only the parent splitter awards XP; all splitlings yield 0 XP.
    expect(result.xpEarned).toBe(xpForKill('splitter', false));
  });

  it('mid-combat level-up pushes nearby enemies radially, grants 0.6 s i-frame, and keeps enemy bullets live', () => {
    // 3 elite casters (= 3 × 30 = 90 XP > ch1 Lv1 threshold 70, 8 HP each) inside auto-aim +
    // magnet radius, plus a nearby chaser inside knockback radius (5.5 tiles) and a far caster
    // that fires a live bullet before the level-up triggers.
    const needXp = xpForNextLevel(1, 1);
    const eliteCasterXp = xpForKill('caster', true);
    expect(eliteCasterXp * 3).toBeGreaterThanOrEqual(needXp);

    const waveRoom: LevelData = parseLevelData({
      id: 'level-up-safety-room',
      chapter: 1,
      room: 1,
      isBossRoom: false,
      size: { cols: 32, rows: 18 },
      tileSizePx: 16,
      playerStart: { x: 16, y: 10 },
      waves: [
        {
          enemies: [
            // Nearest targets (1.8–2.2 tiles): killed first to drop 90 XP (> 70) mid-combat.
            { role: 'caster', at: { x: 16, y: 8.2 }, elite: true },
            { role: 'caster', at: { x: 16, y: 8.0 }, elite: true },
            { role: 'caster', at: { x: 16, y: 7.8 }, elite: true },
            // Nearby survivor inside knockback radius (5.5 tiles) to observe radial push.
            { role: 'tank', at: { x: 20.5, y: 10 }, elite: false },
            // Far caster firing a live enemy bullet that must survive the level-up resume wave.
            { role: 'caster', at: { x: 10, y: 10 }, elite: false },
          ],
        },
      ],
      obstacles: [],
      doors: [],
    });

    const skills = new Map([
      ['sharpen', 3],
      ['rapid-fire', 1],
    ]);

    const firstPass = simulateRun({
      seed: 5,
      level: { chapter: 1, rooms: [waveRoom] },
      policy: standStill,
      skills,
      chooseSkill: () => 0,
    });
    const firstLevelUp = firstPass.events.find((event) => event.kind === 'level-up');
    expect(firstLevelUp).toBeDefined();
    const levelUpAtMs = firstLevelUp?.nowMs ?? 0;
    expect(levelUpAtMs).toBeGreaterThan(0);

    // Re-run deterministically to inspect exact enemy distance and enemy bullet survival across `levelUpAtMs`.
    let bulletsBefore = 0;
    let bulletsAfter = 0;
    let tankDistAtLevelUp = 0;
    let tankMaxDistSoonAfter = 0;

    const verified = simulateRun({
      seed: 5,
      level: { chapter: 1, rooms: [waveRoom] },
      policy: (world) => {
        const enemyBullets = world.bullets.filter((bullet) => bullet.owner === 'enemy').length;
        const tank = world.enemies.find(
          (enemy) => enemy.role === 'tank' && enemy.health > 0 && enemy.action.kind !== 'dead',
        );
        if (world.nowMs < levelUpAtMs) {
          bulletsBefore = Math.max(bulletsBefore, enemyBullets);
          if (tank !== undefined) {
            tankDistAtLevelUp = Math.hypot(
              tank.position.x - world.player.x,
              tank.position.y - world.player.y,
            );
          }
        } else if (world.nowMs <= levelUpAtMs + 48) {
          bulletsAfter = Math.max(bulletsAfter, enemyBullets);
        }
        if (tank !== undefined && world.nowMs > levelUpAtMs && world.nowMs <= levelUpAtMs + 260) {
          const gap = Math.hypot(
            tank.position.x - world.player.x,
            tank.position.y - world.player.y,
          );
          tankMaxDistSoonAfter = Math.max(tankMaxDistSoonAfter, gap);
        }
        return standStill(world);
      },
      skills,
      chooseSkill: () => 0,
    });

    // Resume i-frame window: zero player hits in [levelUpAtMs, levelUpAtMs + 600ms).
    const iframeMs = levelUpResumeIframeMs();
    const hitsDuringResumeIframe = verified.events.filter(
      (event) =>
        event.kind === 'player-hit' &&
        event.nowMs >= levelUpAtMs &&
        event.nowMs < levelUpAtMs + iframeMs,
    );
    expect(hitsDuringResumeIframe).toEqual([]);
    // Nearby tank was pushed radially outward by the knockback wave.
    expect(tankDistAtLevelUp).toBeGreaterThan(0);
    expect(tankMaxDistSoonAfter).toBeGreaterThan(tankDistAtLevelUp + 1);
    // Enemy bullets fired before the level-up remained live immediately after resuming.
    expect(bulletsBefore).toBeGreaterThan(0);
    expect(bulletsAfter).toBeGreaterThan(0);
  });

  it('gold reroll deducts escalating gold and avoids repeating the previous offer', () => {
    const singleRoom: ChapterData = { chapter: 1, rooms: chapterOne.rooms.slice(0, 1) };
    let rerollCalls = 0;
    const result = simulateRun({
      seed: 9,
      level: singleRoom,
      policy: standStill,
      godMode: true,
      chooseSkill: () => 0,
      shouldReroll: (_offers, _owned, _gold, _nextCost, used) => {
        if (used >= 2) return false;
        rerollCalls += 1;
        return true;
      },
    });

    const rerolls = result.events.filter((event) => event.kind === 'skill-reroll');
    expect(rerollCalls).toBe(2);
    expect(rerolls).toHaveLength(2);
    expect(rerolls[0]?.kind === 'skill-reroll' ? rerolls[0].cost : 0).toBe(rerollCost(0));
    expect(rerolls[1]?.kind === 'skill-reroll' ? rerolls[1].cost : 0).toBe(rerollCost(1));

    const earnedFromEvents = result.events.reduce((sum, event) => {
      if (event.kind === 'kill' || event.kind === 'room-cleared') return sum + event.gold;
      if (event.kind === 'skill-reroll') return sum - event.cost;
      return sum;
    }, 0);
    expect(result.goldEarned).toBe(earnedFromEvents);
    expect(DOORS_TUNING.xpRoomXpMultiplier).toBeGreaterThanOrEqual(1);
  });
});

describe('simulateRun — M13 active kit, Evolutions, and Tier-2 AI (ADR-022)', () => {
  it('Dash honors cooldown scaling (phantom-dash), fires Dash Nova burst, and grants i-frames', () => {
    const novaRoom: LevelData = parseLevelData({
      id: 'm13-dash-nova-room',
      chapter: 1,
      room: 1,
      isBossRoom: false,
      size: { cols: 32, rows: 18 },
      tileSizePx: 16,
      playerStart: { x: 16, y: 9 },
      waves: [
        {
          enemies: [
            // 2 HP splitling inside Dash Nova radius (2.2 tiles) dies immediately on dash start.
            { role: 'splitling', at: { x: 17.5, y: 9 }, elite: false },
            // Distant tank keeps the room alive long enough to observe multiple dash cooldowns.
            { role: 'tank', at: { x: 28, y: 9 }, elite: true },
          ],
        },
      ],
      obstacles: [],
      doors: [],
    });

    const spamDash = () => ({ x: -1, y: 0 });
    const baseDash = simulateRun({
      seed: 3,
      level: { chapter: 1, rooms: [novaRoom] },
      policy: standStill,
      chooseDash: spamDash,
      godMode: true,
      maxDurationMs: 6000,
    });
    const fastDash = simulateRun({
      seed: 3,
      level: { chapter: 1, rooms: [novaRoom] },
      policy: standStill,
      chooseDash: spamDash,
      skills: new Map([
        ['phantom-dash', 3],
        ['dash-nova', 1],
      ]),
      godMode: true,
      maxDurationMs: 6000,
    });

    expect(baseDash.dashesUsed).toBeGreaterThanOrEqual(2);
    expect(fastDash.dashesUsed).toBeGreaterThan(baseDash.dashesUsed);

    const baseDashTimes = baseDash.events.flatMap((event) =>
      event.kind === 'dash' ? [event.nowMs] : [],
    );
    expect(baseDashTimes.length).toBeGreaterThanOrEqual(2);
    const firstGap = (baseDashTimes[1] ?? 0) - (baseDashTimes[0] ?? 0);
    expect(firstGap).toBeGreaterThanOrEqual(DASH_TUNING.cooldownMs);

    // Dash Nova kills the nearby splitling on the exact opening dash frame (16 ms).
    const firstSplitlingKill = fastDash.events.find(
      (event) => event.kind === 'kill' && event.role === 'splitling',
    );
    expect(firstSplitlingKill?.nowMs).toBeLessThanOrEqual(64);
  });

  it('Signature Active (Shadow Barrage) casts volley, scales with Arcane Surge, and accelerates via hits/kills', () => {
    const activeRoom: LevelData = parseLevelData({
      id: 'm13-active-room',
      chapter: 1,
      room: 1,
      isBossRoom: false,
      size: { cols: 32, rows: 18 },
      tileSizePx: 16,
      playerStart: { x: 16, y: 9 },
      waves: [
        {
          enemies: [
            { role: 'tank', at: { x: 22, y: 8 }, elite: true },
            { role: 'tank', at: { x: 22, y: 10 }, elite: true },
            { role: 'tank', at: { x: 23, y: 9 }, elite: true },
            { role: 'tank', at: { x: 24, y: 9 }, elite: true },
          ],
        },
      ],
      obstacles: [],
      doors: [],
    });

    const baseActive = simulateRun({
      seed: 5,
      level: { chapter: 1, rooms: [activeRoom] },
      policy: standStill,
      chooseActive: smartActiveSkillPolicy,
      godMode: true,
      maxDurationMs: 30_000,
    });
    const surgedActive = simulateRun({
      seed: 5,
      level: { chapter: 1, rooms: [activeRoom] },
      policy: standStill,
      chooseActive: smartActiveSkillPolicy,
      skills: new Map([
        ['arcane-surge', 2],
        ['shadow-conduit', 2],
      ]),
      godMode: true,
      maxDurationMs: 30_000,
    });

    expect(baseActive.status).toBe('won');
    expect(baseActive.activeSkillsUsed).toBeGreaterThanOrEqual(2);
    const activeEvents = baseActive.events.flatMap((event) =>
      event.kind === 'active-skill' ? [event] : [],
    );
    expect(activeEvents[0]?.skillId).toBe('shadow-barrage');
    expect(activeEvents[0]?.projectiles).toBe(ACTIVE_SKILL_TUNING.barrageProjectiles);
    // Hit + kill CDR brings the second cast well below the 10 s base cooldown.
    const castGapMs = (activeEvents[1]?.nowMs ?? 0) - (activeEvents[0]?.nowMs ?? 0);
    expect(castGapMs).toBeLessThan(ACTIVE_SKILL_TUNING.cooldownMs);

    const surgedCast = surgedActive.events.find((event) => event.kind === 'active-skill');
    expect(
      surgedCast?.kind === 'active-skill' ? surgedCast.projectiles : 0,
    ).toBeGreaterThan(ACTIVE_SKILL_TUNING.barrageProjectiles);
    expect(surgedActive.durationMs).toBeLessThan(baseActive.durationMs);
  });

  it('Burn DoT (ignite), Chain Lightning (chain-lightning), Status Amp (corrosive), and Iron Skin ward work in combat', () => {
    const clusterRoom: LevelData = parseLevelData({
      id: 'm13-elemental-room',
      chapter: 1,
      room: 1,
      isBossRoom: false,
      size: { cols: 32, rows: 18 },
      tileSizePx: 16,
      playerStart: { x: 10, y: 9 },
      waves: [
        {
          enemies: [
            { role: 'tank', at: { x: 15, y: 9 }, elite: true },
            { role: 'tank', at: { x: 16.5, y: 8 }, elite: true },
            { role: 'tank', at: { x: 16.5, y: 10 }, elite: true },
          ],
        },
      ],
      obstacles: [],
      doors: [],
    });

    const plain = simulateRun({
      seed: 9,
      level: { chapter: 1, rooms: [clusterRoom] },
      policy: standStill,
      godMode: true,
    });
    const burn = simulateRun({
      seed: 9,
      level: { chapter: 1, rooms: [clusterRoom] },
      policy: standStill,
      skills: new Map([['ignite', 2]]),
      godMode: true,
    });
    const burnCorrosive = simulateRun({
      seed: 9,
      level: { chapter: 1, rooms: [clusterRoom] },
      policy: standStill,
      skills: new Map([
        ['ignite', 2],
        ['corrosive', 2],
      ]),
      godMode: true,
    });
    const shock = simulateRun({
      seed: 9,
      level: { chapter: 1, rooms: [clusterRoom] },
      policy: standStill,
      skills: new Map([['chain-lightning', 2]]),
      godMode: true,
    });

    expect(burn.durationMs).toBeLessThan(plain.durationMs);
    expect(burnCorrosive.durationMs).toBeLessThan(burn.durationMs);
    expect(shock.durationMs).toBeLessThan(plain.durationMs);

    const warded = simulateRun({
      seed: 1,
      level: meleeChapter,
      policy: standStill,
      skills: new Map([
        ['iron-skin', 3],
        ['vitality', 5],
      ]),
    });
    expect(warded.events.some((event) => event.kind === 'ward-block')).toBe(true);
  });

  it('acquires Legendary Evolutions and exercises Dash + Active during a full Chapter 1 run', () => {
    const result = simulateRun({
      seed: 1,
      level: chapterOne,
      policy: makeDodgePolicy(),
      chooseDash: smartDashPolicy,
      chooseActive: smartActiveSkillPolicy,
      chooseSkill: typicalSkillChoice,
      shouldReroll: typicalRerollPolicy,
      chooseDoor: typicalDoorChoice,
      maxDurationMs: SIM_DEFAULT_MAX_DURATION_MS,
    });

    expect(result.status).toBe('won');
    expect(result.roomsCleared).toBe(ROOMS_PER_CHAPTER);
    expect(result.dashesUsed).toBeGreaterThan(0);
    expect(result.activeSkillsUsed).toBeGreaterThan(0);
    expect(result.evolutions.length).toBeGreaterThan(0);
    for (const evoId of result.evolutions) {
      expect(isEvolutionId(evoId)).toBe(true);
      expect(result.acquiredSkills.get(evoId)).toBe(1);
    }
  });

  it('Bomber fuse blasts threaten standing players (evadable via Dash) and Buffer hastes allies', () => {
    const bomberRoom: LevelData = parseLevelData({
      id: 'm13-bomber-room',
      chapter: 2,
      room: 2,
      isBossRoom: false,
      size: { cols: 32, rows: 18 },
      tileSizePx: 16,
      playerStart: { x: 16, y: 9 },
      waves: [
        {
          enemies: [{ role: 'bomber', at: { x: 17.5, y: 9 }, elite: true }],
        },
      ],
      obstacles: [],
      doors: [],
    });

    const bomberStanding = simulateRun({
      seed: 1,
      level: { chapter: 2, rooms: [bomberRoom] },
      policy: standStill,
      maxDurationMs: 5000,
    });
    const bomberHits = bomberStanding.events.filter((event) => event.kind === 'player-hit');
    expect(bomberHits.length).toBeGreaterThanOrEqual(1);

    const bomberDashed = simulateRun({
      seed: 1,
      level: { chapter: 2, rooms: [bomberRoom] },
      policy: standStill,
      chooseDash: smartDashPolicy,
      maxDurationMs: 5000,
    });
    expect(bomberDashed.dashesUsed).toBeGreaterThanOrEqual(1);
    expect(bomberDashed.events.filter((event) => event.kind === 'player-hit').length).toBeLessThan(
      bomberHits.length,
    );

    // Buffer haste aura genuinely accelerates a nearby melee ally to reach contact sooner.
    const makeBufferTestRoom = (includeBuffer: boolean): LevelData =>
      parseLevelData({
        id: includeBuffer ? 'm13-buffer-on' : 'm13-buffer-off',
        chapter: 2,
        room: 2,
        isBossRoom: false,
        size: { cols: 32, rows: 18 },
        tileSizePx: 16,
        playerStart: { x: 26, y: 9 },
        waves: [
          {
            enemies: [
              // Closer than the buffer on frame 1 so auto-aim stays locked on the 16 HP elite
              // splitter while the elite buffer stands inside [4.5, 6.8] and fires its haste aura.
              { role: 'splitter', at: { x: 19.4, y: 9 }, elite: true },
              ...(includeBuffer
                ? [{ role: 'buffer' as const, at: { x: 19.4, y: 10.4 }, elite: true }]
                : []),
            ],
          },
        ],
        obstacles: [],
        doors: [],
      });

    const withoutBuffer = simulateRun({
      seed: 4,
      level: { chapter: 2, rooms: [makeBufferTestRoom(false)] },
      policy: standStill,
      maxDurationMs: 12_000,
    });
    const withBuffer = simulateRun({
      seed: 4,
      level: { chapter: 2, rooms: [makeBufferTestRoom(true)] },
      policy: standStill,
      maxDurationMs: 12_000,
    });
    const firstContactWithout = withoutBuffer.events.find(
      (event) => event.kind === 'player-hit' && event.source === 'contact',
    );
    const firstContactWith = withBuffer.events.find(
      (event) => event.kind === 'player-hit' && event.source === 'contact',
    );
    expect(firstContactWithout).toBeDefined();
    expect(firstContactWith).toBeDefined();
    expect(firstContactWith!.nowMs).toBeLessThan(firstContactWithout!.nowMs);
  });

  it('Boss Phase 2/3 wide sweeps fire >= 9 bullets and exercise Dash + Shadow Barrage in boss arenas', () => {
    const bossResult = simulateBossRun({
      bossId: 'redtengu',
      seed: 2,
      skills: new Map([
        ['sharpen', 2],
        ['rapid-fire', 1],
        ['twin-shot', 1],
      ]),
      chooseDash: (world) =>
        smartDashPolicy({
          nowMs: world.nowMs,
          room: 17,
          wave: 0,
          player: world.player,
          hearts: world.hearts,
          shieldCharges: 0,
          enemies: [
            {
              id: 'boss',
              role: 'chaser',
              elite: false,
              position: world.boss,
              health: world.bossHealth,
              maxHealth: 1,
              action: { kind: 'idle' },
              actionStartedMs: world.nowMs,
            },
          ],
          bullets: world.bullets,
          moveDir: world.moveDir,
          dashState: world.dashState,
          pendingBlasts: [],
        }),
      chooseActive: (world) =>
        smartActiveSkillPolicy({
          nowMs: world.nowMs,
          room: 17,
          wave: 0,
          player: world.player,
          hearts: world.hearts,
          shieldCharges: 0,
          enemies: [
            {
              id: 'boss',
              role: 'chaser',
              elite: false,
              position: world.boss,
              health: world.bossHealth,
              maxHealth: 1,
              action: { kind: 'idle' },
              actionStartedMs: world.nowMs,
            },
          ],
          bullets: world.bullets,
          activeState: world.activeState,
        }),
      godMode: true,
    });

    expect(bossResult.outcome).toBe('won');
    expect(bossResult.phaseChanges).toEqual([2, 3]);
    expect(bossResult.dashesUsed).toBeGreaterThan(0);
    expect(bossResult.activeSkillsUsed).toBeGreaterThan(0);
    // Red Tengu Phase 2/3 includes dense wide sweep / ring volleys (>= 9 projectiles in one volley).
    expect(
      bossResult.events.some((event) => event.kind === 'boss-shoot' && event.bullets >= 9),
    ).toBe(true);
  });
});
