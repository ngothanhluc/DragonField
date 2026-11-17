/**
 * "Đòn thêm" của enemy elite (M3) và các hệ số hình ảnh của bản elite.
 *
 * GDD §4 nói elite chỉ đổi máu/sát thương; milestone M3 nâng lên **tint + scale +
 * 1 đòn thêm mỗi vai trò**. File này là chỗ duy nhất mô tả đòn thêm đó ở dạng
 * thuần số học, để cả adapter Cocos lẫn test đọc cùng một định nghĩa:
 *
 * | Vai trò | Thường | Elite |
 * |---|---|---|
 * | chaser | chỉ chạm người | thêm cú **lao** (telegraph → charge ngắn) |
 * | caster | 1 viên đạn | **loạt 3 viên** toả quạt |
 * | tank | 1 cú lao | **2 cú lao** liên tiếp, cú sau chốt hướng mới |
 *
 * Số liệu nằm trong `config/tuning.json` (`enemies.elite.*`), không hardcode.
 * Cú lao của elite chaser và cú lao thứ hai của elite tank nằm trong
 * `behaviours.ts` (chúng là action, không phải loạt đạn).
 */
import type { EnemyRole } from '../level/level-data';
import { ENEMY_TUNING, type EnemiesTuning } from './tuning';

/** Góc lệch mặc định giữa hai viên kề của elite caster, radian. */
export function eliteVolleyAngles(
  role: EnemyRole,
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
): number[] {
  if (role !== 'caster') return [];
  if (!elite) return [0];

  const { volleyShots, volleySpreadRadians } = tuning.elite.caster;
  // Lẻ để luôn có một viên đi thẳng vào player; chẵn vẫn chạy nhưng lệch tâm.
  const half = (volleyShots - 1) / 2;
  const angles: number[] = [];
  for (let index = 0; index < volleyShots; index += 1) {
    angles.push((index - half) * volleySpreadRadians);
  }
  return angles;
}

/** Scale node của elite so với bản thường (GDD §4: 1.15). */
export function eliteScale(tuning: EnemiesTuning = ENEMY_TUNING): number {
  return tuning.elite.scale;
}

/** Số cú lao **thêm** sau cú đầu của elite tank. */
export function eliteExtraCharges(
  role: EnemyRole,
  elite: boolean,
  tuning: EnemiesTuning = ENEMY_TUNING,
): number {
  if (!elite || role !== 'tank') return 0;
  return tuning.elite.tank.extraCharges;
}
