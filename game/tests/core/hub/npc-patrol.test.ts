/**
 * Unit tests for `core/hub/npc-patrol.ts` (deterministic waypoint loop, pause + look-around,
 * player-proximity yield + hysteresis, and dialog lock).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOOK_AROUND_INTERVAL_MS,
  DEFAULT_YIELD_EXIT_RADIUS_TILES,
  DEFAULT_YIELD_RADIUS_TILES,
  createNpcPatrolState,
  stepNpcPatrol,
  type HubWaypoint,
} from '../../../assets/scripts/core/hub';

const ROUTE: readonly HubWaypoint[] = [
  { npcId: 'villager-1', order: 0, at: { x: 10, y: 10 }, pauseMs: 1500 },
  { npcId: 'villager-1', order: 1, at: { x: 14, y: 10 }, pauseMs: 1500 },
  { npcId: 'villager-1', order: 2, at: { x: 14, y: 13 }, pauseMs: 1500 },
];

describe('NPC waypoint patrol & proximity yield AI', () => {
  it('walks slowly along waypoints, pauses to glance around, and loops deterministically', () => {
    let npc = createNpcPatrolState('villager-1', { x: 10, y: 10 }, 'right', ROUTE);
    expect(npc.mode).toBe('patrol');
    expect(npc.targetIndex).toBe(1);
    expect(npc.facing).toBe('right');
    expect(npc.animMode).toBe('walk');
    expect(npc.animKey).toBe('npc.villager-1-step.right');

    // Walk right at `1.0 tile/s` for `4000 ms` → arrives at `(14, 10)` and enters `pause`.
    npc = stepNpcPatrol(npc, {
      dtMs: 4000,
      playerPos: null,
      tuning: { speedTilesPerSec: 1.0 },
    });
    expect(npc.position).toEqual({ x: 14, y: 10 });
    expect(npc.mode).toBe('pause');
    expect(npc.animMode).toBe('stand');
    expect(npc.pauseRemainingMs).toBe(1500);

    // During pause, advancing past `lookAroundIntervalMs` glances to an adjacent direction.
    const glanced = stepNpcPatrol(npc, {
      dtMs: DEFAULT_LOOK_AROUND_INTERVAL_MS + 50,
      playerPos: null,
    });
    expect(glanced.mode).toBe('pause');
    expect(glanced.facing).not.toBe(npc.facing);

    // Finish pause (`1500 ms` total) → advances `targetIndex` to `2` (`(14, 13)`, south = `'down'`).
    const resumed = stepNpcPatrol(glanced, {
      dtMs: 1500,
      playerPos: null,
      tuning: { speedTilesPerSec: 1.0 },
    });
    expect(resumed.mode).toBe('patrol');
    expect(resumed.targetIndex).toBe(2);
    expect(resumed.facing).toBe('down');
    expect(resumed.position.y).toBeGreaterThan(10);
  });

  it('yields and turns toward an approaching player with hysteresis, then resumes cleanly', () => {
    let npc = createNpcPatrolState('villager-2', { x: 10, y: 10 }, 'right', [
      { npcId: 'villager-2', order: 0, at: { x: 10, y: 10 }, pauseMs: 1000 },
      { npcId: 'villager-2', order: 1, at: { x: 16, y: 10 }, pauseMs: 1000 },
    ]);
    npc = stepNpcPatrol(npc, { dtMs: 1000, playerPos: null, tuning: { speedTilesPerSec: 1.0 } });
    const posBeforeYield = { ...npc.position };

    // Player approaches from NORTH (`y = 8.8 < 10`, distance `1.2 <= DEFAULT_YIELD_RADIUS_TILES`).
    const yielded = stepNpcPatrol(npc, {
      dtMs: 500,
      playerPos: { x: posBeforeYield.x, y: posBeforeYield.y - 1.2 },
    });
    expect(yielded.mode).toBe('yield');
    expect(yielded.position).toEqual(posBeforeYield);
    expect(yielded.facing).toBe('up');
    expect(yielded.animMode).toBe('stand');
    expect(yielded.animKey).toBe('npc.villager-2-stand.up');

    // Hysteresis band (`yieldRadius < dist <= yieldExitRadius`): stays yielded without jittering!
    const midBandDist = (DEFAULT_YIELD_RADIUS_TILES + DEFAULT_YIELD_EXIT_RADIUS_TILES) / 2;
    const stillYielded = stepNpcPatrol(yielded, {
      dtMs: 200,
      playerPos: { x: posBeforeYield.x, y: posBeforeYield.y + midBandDist },
    });
    expect(stillYielded.mode).toBe('yield');
    expect(stillYielded.facing).toBe('down');

    // Player steps beyond `DEFAULT_YIELD_EXIT_RADIUS_TILES`: resumes eastward patrol cleanly!
    const freed = stepNpcPatrol(stillYielded, {
      dtMs: 500,
      playerPos: { x: posBeforeYield.x, y: posBeforeYield.y + DEFAULT_YIELD_EXIT_RADIUS_TILES + 0.5 },
      tuning: { speedTilesPerSec: 1.0 },
    });
    expect(freed.mode).toBe('patrol');
    expect(freed.facing).toBe('right');
    expect(freed.position.x).toBeGreaterThan(posBeforeYield.x);
  });

  it('keeps yielding while actively engaged in dialog even if player stands slightly beyond yield radius', () => {
    const npc = createNpcPatrolState('villager-3', { x: 10, y: 10 }, 'left', [
      { npcId: 'villager-3', order: 0, at: { x: 10, y: 10 }, pauseMs: 1000 },
      { npcId: 'villager-3', order: 1, at: { x: 6, y: 10 }, pauseMs: 1000 },
    ]);
    const talking = stepNpcPatrol(npc, {
      dtMs: 1000,
      playerPos: { x: 10, y: 12.5 },
      talkingNpcId: 'villager-3',
    });
    expect(talking.mode).toBe('yield');
    expect(talking.position).toEqual({ x: 10, y: 10 });
    expect(talking.facing).toBe('down');
  });
});
