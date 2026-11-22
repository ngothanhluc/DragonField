import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT } from '../../assets/scripts/core/config';
import { makeDodgePolicy } from '../helpers/dodge-policy';
import { CHASER_CONTACT_RANGE_TILES } from '../../assets/scripts/core/enemies/behaviours';
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
import {
  SIM_DEFAULT_MAX_DURATION_MS,
  simulateRun,
  type InputPolicy,
} from '../../assets/scripts/core/sim/run-simulation';
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

/** A typical loadout of a player who picked up a few cards during the run. */
const SKILLED_LOADOUT: ReadonlyMap<string, number> = new Map([
  ['sharpen', 2],
  ['rapid-fire', 2],
  ['twin-shot', 1],
  ['vitality', 1],
  ['swift', 1],
  ['piercing', 1],
  ['crit-eye', 1],
  ['shield', 1],
]);

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
        skills: SKILLED_LOADOUT,
        maxDurationMs: 1_200_000,
      });

      expect(result.status, `chapter ${chapter}`).toBe('won');
      expect(result.roomsCleared, `chapter ${chapter}`).toBe(9);
    }
  });
});

describe('simulateRun — chapter 2 and 3 balance with a 0-skill run', () => {
  /**
   * Each chapter is a new run (GDD §2), so the ch2/ch3 entrance must be proven
   * playable **without skills**: standing still still loses within the first 3 rooms, while dodging
   * with no skills must survive at least 2× and clear at least 3 rooms.
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

    it(`chapter ${chapter}: dodging with no skills survives ≥2× and clears ≥3 rooms`, () => {
      for (const seed of BALANCE_SEEDS) {
        const idle = simulateRun({ seed, level, policy: standStill });
        const dodging = simulateRun({
          seed,
          level,
          policy: makeDodgePolicy(),
          maxDurationMs: 1_500_000,
        });

        expect(dodging.durationMs, `chapter ${chapter} seed ${seed}`).toBeGreaterThanOrEqual(
          idle.durationMs * 2,
        );
        expect(dodging.roomsCleared, `chapter ${chapter} seed ${seed}`).toBeGreaterThanOrEqual(3);
      }
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
