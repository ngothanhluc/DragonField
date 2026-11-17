import { describe, expect, it } from 'vitest';
import { BOSS_IDS, type BossId, type BossPhase } from '../../assets/scripts/core/boss/boss-defs';
import { holdPosition, simulateBossRun } from '../../assets/scripts/core/sim/boss-run';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';

/**
 * "Mỗi phase có ít nhất 1 pattern buộc phải di chuyển" (M4 acceptance) được
 * chứng minh bằng đúng mô phỏng combat: player **đứng yên** ở `playerStart`,
 * boss chạy pattern thật, và phase đó phải gây được ít nhất một hit.
 *
 * Máu player đặt rất cao và DPS = 0 để boss không chết/không đổi phase giữa
 * phép đo — đây là harness test, không phải balance.
 */
interface Arena {
  readonly playerStart: Vec2;
  readonly bossStart: Vec2;
}

const ARENAS: Readonly<Record<BossId, Arena>> = {
  tengu: { playerStart: { x: 16, y: 16 }, bossStart: { x: 16, y: 5 } },
  squid: { playerStart: { x: 16, y: 16 }, bossStart: { x: 16, y: 8 } },
  // Samurai charge ngang: player đứng cùng hàng, lệch sang phải (arena ch3).
  samurai: { playerStart: { x: 27, y: 6 }, bossStart: { x: 16, y: 6 } },
};

const PHASE_FRACTION: Readonly<Record<BossPhase, number>> = { 1: 1, 2: 0.6, 3: 0.2 };

function hitsWhileStandingStill(id: BossId, phase: BossPhase): number {
  const arena = ARENAS[id];
  const result = simulateBossRun({
    bossId: id,
    seed: 2026 + phase,
    maxDurationMs: 40_000,
    playerDamagePerShot: 0,
    playerMaxHearts: 999,
    bossHealthFraction: PHASE_FRACTION[phase],
    policy: holdPosition,
    playerStart: arena.playerStart,
    bossStart: arena.bossStart,
  });

  return result.events.filter((event) => event.kind === 'player-hit').length;
}

describe('boss — mỗi phase buộc phải di chuyển', () => {
  for (const id of BOSS_IDS) {
    for (const phase of [1, 2, 3] as const) {
      it(`${id} phase ${phase}: đứng yên ở playerStart vẫn bị trúng đòn`, () => {
        expect(hitsWhileStandingStill(id, phase), `${id} p${phase}`).toBeGreaterThan(0);
      });
    }
  }
});
