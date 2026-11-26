/**
 * Ticket #43 acceptance: boss pool per chapter (1 of 2 by run seed) with GiantFrog (ch1) and
 * GiantSlime (ch2), and one music track per boss.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BOSSES,
  BOSS_IDS,
  bossForSpriteName,
  type BossDef,
  type BossId,
} from '../../assets/scripts/core/boss/boss-defs';
import { BOSS_POOLS, bossMusicPath, pickBoss } from '../../assets/scripts/core/boss/boss-pool';
import { BOSS_TUNING } from '../../assets/scripts/core/enemies/tuning';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';
import { holdPosition, simulateBossRun } from '../../assets/scripts/core/sim/boss-run';

const RESOURCES = join(dirname(fileURLToPath(import.meta.url)), '../../assets/resources');
const byId = BOSSES as Readonly<Record<string, BossDef | undefined>>;
const ids = BOSS_IDS as readonly string[];

describe('new bosses', () => {
  it('GiantFrog is a chapter 1 boss using chapter 1 boss health from tuning', () => {
    expect(ids).toContain('frog');
    expect(byId.frog?.spriteName).toBe('GiantFrog');
    expect(byId.frog?.chapter).toBe(1);
    expect(byId.frog?.maxHealth).toBe(BOSS_TUNING.healthByChapter[0]);
    expect(bossForSpriteName('GiantFrog')?.id).toBe('frog');
  });

  it('GiantSlime is a chapter 2 boss using chapter 2 boss health from tuning', () => {
    expect(ids).toContain('slime');
    expect(byId.slime?.spriteName).toBe('GiantSlime');
    expect(byId.slime?.chapter).toBe(2);
    expect(byId.slime?.maxHealth).toBe(BOSS_TUNING.healthByChapter[1]);
    expect(bossForSpriteName('GiantSlime')?.id).toBe('slime');
  });
});

describe('boss pool', () => {
  it('ch1 = Tengu or GiantFrog, ch2 = Squid or GiantSlime, ch3 = Samurai or GiantBamboo', () => {
    expect([...(BOSS_POOLS[1] ?? [])].sort()).toEqual(['frog', 'tengu']);
    expect([...(BOSS_POOLS[2] ?? [])].sort()).toEqual(['slime', 'squid']);
    // #44 superseded the single-boss ch3: GiantBamboo joins the pool.
    expect([...(BOSS_POOLS[3] ?? [])].sort()).toEqual(['bamboo', 'samurai']);
  });

  it('the pick is deterministic per seed and both bosses come up across seeds', () => {
    for (const chapter of [1, 2]) {
      const seen = new Set<BossId>();
      for (let seed = 1; seed <= 64; seed += 1) {
        const pick = pickBoss(chapter, seed);
        expect(pickBoss(chapter, seed)).toBe(pick);
        expect(BOSS_POOLS[chapter]).toContain(pick);
        seen.add(pick);
      }
      expect(seen.size, `chapter ${chapter}`).toBe(2);
    }
    // #44: ch3 now has a pool too (the new ticket's contract covers both picks per seed).
    for (let seed = 1; seed <= 16; seed += 1) {
      expect(BOSS_POOLS[3]).toContain(pickBoss(3, seed));
    }
  });
});

describe('music per boss', () => {
  it('every boss has its own staged track, Tengu keeps the current one', () => {
    const paths = BOSS_IDS.map((id) => bossMusicPath(id));
    expect(new Set(paths).size).toBe(BOSS_IDS.length);
    expect(bossMusicPath('tengu')).toBe('audio/music/boss');
    for (const path of paths) {
      expect(existsSync(join(RESOURCES, `${path}.mp3`)), path).toBe(true);
    }
  });
});

describe('new bosses force movement in every phase', () => {
  const arenas: Readonly<Record<string, { playerStart: Vec2; bossStart: Vec2 }>> = {
    frog: { playerStart: { x: 16, y: 16 }, bossStart: { x: 16, y: 5 } },
    slime: { playerStart: { x: 16, y: 16 }, bossStart: { x: 16, y: 5 } },
  };
  const fraction = { 1: 1, 2: 0.6, 3: 0.2 } as const;

  for (const id of ['frog', 'slime']) {
    for (const phase of [1, 2, 3] as const) {
      it(`${id} phase ${phase}: standing still at playerStart gets hit`, () => {
        expect(ids).toContain(id);
        const arena = arenas[id];
        if (arena === undefined) throw new Error('arena');
        const result = simulateBossRun({
          bossId: id as BossId,
          seed: 4300 + phase,
          maxDurationMs: 40_000,
          playerDamagePerShot: 0,
          playerMaxHearts: 999,
          bossHealthFraction: fraction[phase],
          policy: holdPosition,
          playerStart: arena.playerStart,
          bossStart: arena.bossStart,
        });
        const hits = result.events.filter((event) => event.kind === 'player-hit').length;
        expect(hits).toBeGreaterThan(0);
      });
    }
  }
});
