import { describe, expect, it } from 'vitest';
import { BOSS_IDS, type BossId, type BossPhase } from '../../assets/scripts/core/boss/boss-defs';
import { holdPosition, simulateBossRun } from '../../assets/scripts/core/sim/boss-run';
import type { Vec2 } from '../../assets/scripts/core/math/vec2';

/**
 * "Every phase has at least 1 pattern that forces movement" (M4 acceptance) is
 * proven by the real combat simulation: the player **stands still** at `playerStart`,
 * the boss runs its real pattern, and that phase must land at least one hit.
 *
 * Player health is set very high and DPS = 0 so the boss never dies or changes phase during
 * the measurement — this is a test harness, not balance.
 */
interface Arena {
  readonly playerStart: Vec2;
  readonly bossStart: Vec2;
}

const ARENAS: Readonly<Record<BossId, Arena>> = {
  tengu: { playerStart: { x: 16, y: 16 }, bossStart: { x: 16, y: 5 } },
  squid: { playerStart: { x: 16, y: 16 }, bossStart: { x: 16, y: 8 } },
  // Samurai charges sideways: the player stands on the same row, offset to the right (ch3 arena).
  samurai: { playerStart: { x: 27, y: 6 }, bossStart: { x: 16, y: 6 } },
  // Pool alternatives (#43) — the same arena the acceptance test uses.
  frog: { playerStart: { x: 16, y: 16 }, bossStart: { x: 16, y: 5 } },
  slime: { playerStart: { x: 16, y: 16 }, bossStart: { x: 16, y: 6 } },
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

describe('boss — every phase forces movement', () => {
  for (const id of BOSS_IDS) {
    for (const phase of [1, 2, 3] as const) {
      it(`${id} phase ${phase}: standing still at playerStart still gets hit`, () => {
        expect(hitsWhileStandingStill(id, phase), `${id} p${phase}`).toBeGreaterThan(0);
      });
    }
  }
});
