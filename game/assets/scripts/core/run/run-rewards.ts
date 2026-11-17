/**
 * Vàng kiếm được trong **một run** (GDD §2, §7, §9).
 *
 * `core/run/rewards.ts` biết một enemy/phòng đáng bao nhiêu vàng; file này giữ
 * tổng của run, áp hệ số Greed (`DerivedStats.goldMultiplier`) và đếm số kill
 * cho màn hình kết quả. Không biết gì về engine hay localStorage.
 *
 * Vàng chỉ được ghi vào save ở **cuối run** (chết, thắng, thoát, restart) —
 * xem `game/run-end.ts`. Nhờ vậy HUD có một con số sống trong run, còn
 * `SaveData.gold` không bị ghi localStorage mỗi lần giết quái.
 */
import type { EnemyRole } from '../level/level-data';
import { MAX_GOLD, goldForKill, goldForRoomClear } from './rewards';

/**
 * Nhân thưởng rồi làm tròn. Greed +20% trên tank (3 vàng) phải thành 4, không
 * phải 3 — làm tròn xuống sẽ làm skill vô dụng ở đúng enemy đáng tiền nhất.
 */
function scaled(base: number, multiplier: number): number {
  if (!Number.isFinite(base) || base <= 0) return 0;
  const factor = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.max(0, Math.round(base * factor));
}

function clampGold(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_GOLD, Math.max(0, Math.trunc(value)));
}

/** Tổng vàng/kill của run hiện tại. Mọi method là pure-ish: chỉ sửa state nội bộ. */
export class RunRewards {
  private earned = 0;
  private kills = 0;

  get goldEarned(): number {
    return this.earned;
  }

  get killCount(): number {
    return this.kills;
  }

  /** Giết một enemy; trả số vàng vừa cộng. Elite đã được tính trong `goldForKill`. */
  awardKill(role: EnemyRole, elite: boolean, goldMultiplier = 1): number {
    this.kills += 1;
    const amount = scaled(goldForKill(role, elite), goldMultiplier);
    this.earned = clampGold(this.earned + amount);
    return amount;
  }

  /** Dọn sạch phòng; boss thưởng `GOLD.boss`, phòng thường `GOLD.roomClear`. */
  awardRoomClear(isBossRoom: boolean, goldMultiplier = 1): number {
    const amount = scaled(goldForRoomClear(isBossRoom), goldMultiplier);
    this.earned = clampGold(this.earned + amount);
    return amount;
  }

  /** Chỉ đọc: tổng thưởng của một enemy theo luật, dùng cho tooltip/test. */
  static killValue(role: EnemyRole, elite: boolean, goldMultiplier = 1): number {
    return scaled(goldForKill(role, elite), goldMultiplier);
  }
}
