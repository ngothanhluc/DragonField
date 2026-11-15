/**
 * Sinh enemy theo wave từ dữ liệu phòng (GDD §8: wave nằm trong `LevelData`).
 *
 * `waveIndex` là **index 0-based** trong `level.waves`, khớp với
 * `nextWaveIndex`. Id enemy tất định — `r<room>-w<wave>-e<n>` — nên test,
 * log và save/replay đều so sánh được mà không cần thứ tự spawn.
 */
import type { LevelData } from '../level/level-data';
import { maxHealthFor, type EnemyState } from './behaviours';

/** Id tất định của một enemy trong wave. */
export function enemyId(room: number, waveIndex: number, enemyIndex: number): string {
  return `r${room}-w${waveIndex}-e${enemyIndex}`;
}

/**
 * Enemy của wave `waveIndex`, đã tính scale elite. Enemy mới đứng yên
 * (`idle`) và chờ hết cooldown trước đòn đầu — xem `behaviours.ts`.
 */
export function spawnWave(level: LevelData, waveIndex: number): EnemyState[] {
  const wave = level.waves[waveIndex];
  if (wave === undefined) {
    throw new Error(
      `Phòng ${level.id} không có wave ${waveIndex} (chỉ có ${level.waves.length} wave)`,
    );
  }

  return wave.enemies.map((enemy, index): EnemyState => {
    const maxHealth = maxHealthFor(enemy.role, enemy.elite);
    return {
      id: enemyId(level.room, waveIndex, index),
      role: enemy.role,
      elite: enemy.elite,
      position: { x: enemy.at.x, y: enemy.at.y },
      health: maxHealth,
      maxHealth,
      action: { kind: 'idle' },
      actionStartedMs: 0,
    };
  });
}

/** Wave sạch khi mọi enemy đã chết (máu <= 0 hoặc action `dead`). */
export function isWaveCleared(states: readonly EnemyState[]): boolean {
  return states.every((state) => state.health <= 0 || state.action.kind === 'dead');
}

/** Index wave kế tiếp, hoặc `null` khi đã hết wave cuối của phòng. */
export function nextWaveIndex(current: number, level: LevelData): number | null {
  if (!Number.isInteger(current) || current < 0) {
    throw new Error(`waveIndex phải là số nguyên >= 0, nhận ${current}`);
  }

  const next = current + 1;
  return next < level.waves.length ? next : null;
}
