/**
 * Ticket #44 acceptance: GiantBamboo joins the ch3 pool; chapter 4's pool is GiantRacoon and
 * the red Tengu variant; each has its own music and forces movement in every phase.
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
import { holdPosition, simulateBossRun } from '../../sim/boss-run';

const RESOURCES = join(dirname(fileURLToPath(import.meta.url)), '../../assets/resources');
const byId = BOSSES as Readonly<Record<string, BossDef | undefined>>;
const ids = BOSS_IDS as readonly string[];

const NEW_BOSSES = [
  { id: 'bamboo', sprite: 'GiantBamboo', chapter: 3 },
  { id: 'racoon', sprite: 'GiantRacoon', chapter: 4 },
  { id: 'redtengu', sprite: 'TenguRed', chapter: 4 },
] as const;

describe('new bosses', () => {
  for (const boss of NEW_BOSSES) {
    it(`${boss.sprite} is a chapter ${boss.chapter} boss using chapter ${boss.chapter} health from tuning`, () => {
      expect(ids).toContain(boss.id);
      expect(byId[boss.id]?.spriteName).toBe(boss.sprite);
      expect(byId[boss.id]?.chapter).toBe(boss.chapter);
      expect(byId[boss.id]?.maxHealth).toBe(BOSS_TUNING.healthByChapter[boss.chapter - 1]);
      expect(bossForSpriteName(boss.sprite)?.id).toBe(boss.id);
    });
  }

  it('the red Tengu is stronger than the blue one (more health)', () => {
    expect(byId.redtengu?.maxHealth ?? 0).toBeGreaterThan(BOSSES.tengu.maxHealth);
  });
});

describe('boss pool', () => {
  it('ch3 = Samurai or GiantBamboo, ch4 = GiantRacoon or red Tengu; ch1/ch2 unchanged', () => {
    expect([...(BOSS_POOLS[1] ?? [])].sort()).toEqual(['frog', 'tengu']);
    expect([...(BOSS_POOLS[2] ?? [])].sort()).toEqual(['slime', 'squid']);
    expect([...(BOSS_POOLS[3] ?? [])].sort()).toEqual(['bamboo', 'samurai']);
    expect([...(BOSS_POOLS[4] ?? [])].sort()).toEqual(['racoon', 'redtengu']);
  });

  it('the pick is deterministic per seed and both bosses come up across seeds', () => {
    for (const chapter of [3, 4]) {
      const seen = new Set<BossId>();
      for (let seed = 1; seed <= 64; seed += 1) {
        const pick = pickBoss(chapter, seed);
        expect(pickBoss(chapter, seed)).toBe(pick);
        expect(BOSS_POOLS[chapter]).toContain(pick);
        seen.add(pick);
      }
      expect(seen.size, `chapter ${chapter}`).toBe(2);
    }
  });
});

describe('music per boss', () => {
  it('every boss still has its own staged track', () => {
    const paths = BOSS_IDS.map((id) => bossMusicPath(id));
    expect(new Set(paths).size).toBe(BOSS_IDS.length);
    for (const boss of NEW_BOSSES) expect(ids).toContain(boss.id);
    for (const path of paths) {
      expect(existsSync(join(RESOURCES, `${path}.mp3`)), path).toBe(true);
    }
  });
});

describe('new bosses force movement in every phase', () => {
  const arenas: Readonly<Record<string, { playerStart: Vec2; bossStart: Vec2 }>> = {
    bamboo: { playerStart: { x: 16, y: 16 }, bossStart: { x: 16, y: 5 } },
    racoon: { playerStart: { x: 16, y: 16 }, bossStart: { x: 16, y: 5 } },
    redtengu: { playerStart: { x: 16, y: 16 }, bossStart: { x: 16, y: 5 } },
  };
  const fraction = { 1: 1, 2: 0.6, 3: 0.2 } as const;

  for (const boss of NEW_BOSSES) {
    for (const phase of [1, 2, 3] as const) {
      it(`${boss.id} phase ${phase}: standing still at playerStart gets hit`, () => {
        expect(ids).toContain(boss.id);
        const arena = arenas[boss.id];
        if (arena === undefined) throw new Error('arena');
        const result = simulateBossRun({
          bossId: boss.id as BossId,
          seed: 4400 + phase,
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
