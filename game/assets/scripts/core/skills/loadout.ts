/**
 * Loadout của một run: skill nào đang sở hữu và bao nhiêu stack.
 *
 * Đây là **state duy nhất** của skill trong một run. Cả game adapter và
 * simulation đều đi qua lớp này, nên luật "kẹp theo `maxStacks`" và "chỉ số
 * suy ra từ stack" không thể lệch giữa hai bên.
 *
 * Không import `cc`, không đọc giờ hệ thống: mọi hàm thuần hoặc chỉ sửa state
 * nội bộ của instance.
 */
import { DEFAULT_COMBAT } from '../config';
import { computeDerivedStats, type DerivedStats, type StatsBaseline } from './derived-stats';
import { getSkill, resolveOwnedSkills, type OwnedSkillStacks, type SkillDef } from './pool';

/** Kết quả một lần nhặt skill — đủ để UI/run quyết âm thanh, hồi máu, log. */
export interface AcquireResult {
  /** `false` khi skill đã đạt trần (hoặc id lạ) nên không có gì đổi. */
  readonly acquired: boolean;
  /** Số stack vừa cộng thêm (0 khi bị chặn). */
  readonly added: number;
  /** Stack hiện có sau lần nhặt. */
  readonly stacks: number;
  /** Số tim hồi ngay lúc nhặt (GDD §6: Vitality "hồi 1 tim ngay"). */
  readonly healNow: number;
}

/**
 * Số stack hiện có của mọi skill. Map được giữ **private** để không ai vô tình
 * ghi đè trần; muốn đổi phải đi qua `acquire`.
 */
export class SkillLoadout {
  private readonly owned = new Map<string, number>();

  /** Dựng loadout từ một map có sẵn (save/debug/sim), đã kẹp theo trần. */
  static from(entries: ReadonlyMap<string, number>): SkillLoadout {
    const loadout = new SkillLoadout();
    for (const skill of resolveOwnedSkills(entries)) {
      loadout.owned.set(skill.def.id, skill.stacks);
    }
    return loadout;
  }

  /** Stack của một skill; 0 nếu chưa sở hữu hoặc id lạ. */
  stacks(id: string): number {
    return this.owned.get(id) ?? 0;
  }

  /** Các skill đang sở hữu, theo thứ tự `SKILLS` (tất định). */
  get entries(): OwnedSkillStacks[] {
    return resolveOwnedSkills(this.owned);
  }

  get size(): number {
    return this.entries.length;
  }

  /** Bản sao chỉ đọc — dùng cho `rollChoices`, HUD, test. */
  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.owned);
  }

  /**
   * Nhặt `stacks` stack của skill `id`.
   *
   * - Id lạ trả `acquired: false` thay vì ném lỗi: save/debug cũ không làm chết run.
   * - Kẹp theo `maxStacks`; nhặt khi đã đầy là no-op (UI không nên cho chọn thẻ đã đầy).
   * - `healNow` lấy từ tag `max-hearts` của **một** stack (Vitality).
   */
  acquire(id: string, stacks = 1): AcquireResult {
    const def = findSkill(id);
    if (def === undefined) {
      return { acquired: false, added: 0, stacks: 0, healNow: 0 };
    }

    const current = this.stacks(id);
    const room = Math.max(0, def.maxStacks - current);
    const added = Math.min(Math.floor(Math.max(0, stacks)), room);
    if (added <= 0) {
      return { acquired: false, added: 0, stacks: current, healNow: 0 };
    }

    this.owned.set(id, current + added);
    return {
      acquired: true,
      added,
      stacks: current + added,
      healNow: pickupHeal(def) * added,
    };
  }

  /** Chỉ số cuối của loadout, dùng chung cho game và simulation. */
  stats(base: StatsBaseline = DEFAULT_COMBAT): DerivedStats {
    return computeDerivedStats(this.owned, base);
  }
}

/** Tra skill nhưng trả `undefined` thay vì ném — `acquire` phải chịu được id lạ. */
function findSkill(id: string): SkillDef | undefined {
  try {
    return getSkill(id);
  } catch {
    return undefined;
  }
}

/**
 * Tim hồi ngay khi nhặt một stack: cộng các tag `max-hearts`.
 *
 * Tách khỏi `DerivedStats` vì đây là hiệu ứng **một lần lúc nhặt**, không phải
 * chỉ số thường trực — nhặt 2 lần Vitality hồi 2 tim nhưng max chỉ tăng 2.
 */
export function pickupHeal(def: SkillDef): number {
  let heal = 0;
  for (const tag of def.tags) {
    if (tag.kind === 'max-hearts') heal += tag.amount;
  }
  return Math.max(0, Math.floor(heal));
}
