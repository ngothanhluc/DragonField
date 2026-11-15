import type { SeededRng } from '../rng';
import { RARITIES, SKILLS, luckPoints, type Rarity, type SkillDef } from './pool';

/** Trọng số rarity gốc của GDD §6: common 70 / rare 25 / epic 5 (tổng 100). */
export const BASE_RARITY_WEIGHTS: Readonly<Record<Rarity, number>> = {
  common: 70,
  rare: 25,
  epic: 5,
};

/** Số thẻ mỗi lần chọn (GDD §6: chọn 1 trong 3). */
export const DEFAULT_CHOICE_COUNT = 3;

/**
 * Công thức luck — mỗi điểm luck (1 stack Luck = 0.01 điểm, xem `luck-add`)
 * dịch trọng số từ common sang rarity cao, giữ tổng ≈ 100:
 *
 * ```text
 * epic   = 5  + 100 × L
 * rare   = 25 +  50 × L
 * common = max(0, 100 − epic − rare)
 * ```
 *
 * Ví dụ: 3 stack Luck (L = 0.03) → common 65.5 / rare 26.5 / epic 8.
 *
 * Khi một rarity đã hết thẻ hợp lệ (mọi skill của rarity đó đạt maxStacks),
 * trọng số của nó bị bỏ khỏi lần quay — `weightedIndex` tự chuẩn hoá lại theo
 * các rarity còn mặt, nên xác suất tương đối giữa chúng không đổi.
 *
 * `L` bị kẹp vào [0, 0.5]: pool hiện tại chỉ cho tối đa 0.03, nhưng kẹp lại để
 * một save hỏng không thể làm trọng số âm hoặc lấn hết common.
 */
export function rarityWeights(luck: number): Record<Rarity, number> {
  const clampedLuck = Number.isFinite(luck) ? Math.min(Math.max(luck, 0), 0.5) : 0;
  const epic = BASE_RARITY_WEIGHTS.epic + 100 * clampedLuck;
  const rare = BASE_RARITY_WEIGHTS.rare + 50 * clampedLuck;
  const common = Math.max(0, 100 - epic - rare);

  return { common, rare, epic };
}

export interface RollChoicesArgs {
  readonly rng: SeededRng;
  /** id → số stack hiện có. Skill đạt `maxStacks` không còn xuất hiện. */
  readonly owned: ReadonlyMap<string, number>;
  /** Số thẻ muốn quay, mặc định 3. */
  readonly count?: number;
}

/**
 * Quay `count` thẻ skill: không trùng trong cùng một lần, không trả skill đã đạt
 * `maxStacks`, và **không ném lỗi khi cạn pool** — trả về ít hơn `count` (kể cả
 * mảng rỗng). Người gọi phải chịu được 0–3 thẻ: UI chỉ vẽ số thẻ nhận được.
 *
 * Mỗi thẻ: chọn rarity theo trọng số luck, rồi chọn đều trong các skill còn lại
 * của rarity đó. Thẻ vừa chọn bị loại khỏi pool nên lần chọn sau không lặp lại.
 */
export function rollChoices(args: RollChoicesArgs): SkillDef[] {
  const count = args.count ?? DEFAULT_CHOICE_COUNT;
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`rollChoices cần count là số nguyên >= 0, nhận ${count}`);
  }

  const candidates = SKILLS.filter(
    (skill) => (args.owned.get(skill.id) ?? 0) < skill.maxStacks,
  );
  const chosen: SkillDef[] = [];
  const target = Math.min(count, candidates.length);
  const weights = rarityWeights(luckPoints(args.owned));

  while (chosen.length < target) {
    const byRarity: Record<Rarity, SkillDef[]> = { common: [], rare: [], epic: [] };
    for (const skill of candidates) byRarity[skill.rarity].push(skill);

    const availableRarities = RARITIES.filter((rarity) => byRarity[rarity].length > 0);
    const rarityIndex = args.rng.weightedIndex(
      availableRarities.map((rarity) => weights[rarity]),
    );
    const rarity = availableRarities[rarityIndex];
    if (rarity === undefined) {
      throw new Error('rollChoices: không chọn được rarity dù pool còn thẻ');
    }

    const skill = args.rng.pick(byRarity[rarity]);
    chosen.push(skill);
    candidates.splice(candidates.indexOf(skill), 1);
  }

  return chosen;
}
