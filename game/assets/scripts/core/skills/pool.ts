/**
 * Pool 20 skill — bản đóng băng v1 (docs/gdd.md §6).
 *
 * Thẻ skill chỉ là **dữ liệu**: hiệu ứng cơ học nằm trong `tags`, không nằm
 * trong id hay tên. Nhờ vậy `derived-stats.ts` cộng dồn được mọi skill mà không
 * cần bảng `switch` riêng cho từng skill, và thêm skill mới = thêm một entry.
 *
 * Tên file/thư mục: kebab-case; id trùng tên skill đã kebab-case.
 */

export const RARITIES = ['common', 'rare', 'epic'] as const;

export type Rarity = (typeof RARITIES)[number];

/**
 * Một hiệu ứng cơ học của skill. Mọi tag đều là "mỗi stack cộng thêm chừng này";
 * tag nào cộng dồn kiểu nhân thì `derived-stats.ts` ghi rõ công thức ở đó.
 */
export type SkillTag =
  /** Cộng thẳng damage mỗi phát. */
  | { readonly kind: 'damage-add'; readonly amount: number }
  /** Cộng vào hệ số nhịp bắn: rate = base × (1 + Σ amount × stack). */
  | { readonly kind: 'fire-rate-mult'; readonly amount: number }
  /** Cộng thêm viên đạn mỗi phát (bắn chéo ±12°). */
  | { readonly kind: 'projectile-add'; readonly amount: number }
  /** Đạn xuyên thêm 1 enemy mỗi stack. */
  | { readonly kind: 'pierce-add' }
  /** Cộng cơ hội chí mạng; `multiplier` là hệ số damage khi chí mạng. */
  | { readonly kind: 'crit-chance'; readonly chance: number; readonly multiplier: number }
  /** Cộng tim tối đa. */
  | { readonly kind: 'max-hearts'; readonly amount: number }
  /** Hồi tim mỗi khi dọn phòng. */
  | { readonly kind: 'heal-per-room'; readonly amount: number }
  /** Chặn 1 đòn mỗi charge, hồi charge sau `cooldownMs`. */
  | { readonly kind: 'shield'; readonly cooldownMs: number }
  /** Enemy chạm vào player nhận `damage`. */
  | { readonly kind: 'thorns'; readonly damage: number }
  /** Cộng vào hệ số tốc chạy: speed = base × (1 + Σ amount × stack). */
  | { readonly kind: 'move-speed-mult'; readonly amount: number }
  /** Nhân i-frame mỗi stack: i-frame = base × amount^stack. */
  | { readonly kind: 'iframe-mult'; readonly amount: number }
  /** Trúng đòn làm chậm enemy. */
  | { readonly kind: 'slow-on-hit'; readonly factor: number; readonly durationMs: number }
  /** Gây damage theo thời gian. */
  | { readonly kind: 'poison'; readonly dps: number; readonly durationMs: number }
  /** Hồi máu theo % damage gây ra. */
  | { readonly kind: 'lifesteal'; readonly percent: number }
  /** Cộng vào hệ số vàng nhặt. */
  | { readonly kind: 'gold-mult'; readonly amount: number }
  /** Cộng trọng số rarity cao (xem công thức trong `roll.ts`). */
  | { readonly kind: 'luck-add'; readonly amount: number }
  /** Damage bonus khi enemy dưới `threshold` máu. */
  | { readonly kind: 'execute'; readonly threshold: number; readonly bonus: number }
  /** Đạn nảy sang enemy khác `bounces` lần. */
  | { readonly kind: 'ricochet-add'; readonly bounces: number }
  /** Đạn tự bám mục tiêu. */
  | { readonly kind: 'homing-add' }
  /** Đạn nổ AoE khi trúng. */
  | { readonly kind: 'explosive'; readonly radiusTiles: number; readonly damageRatio: number };

export interface SkillDef {
  readonly id: string;
  readonly name: string;
  readonly rarity: Rarity;
  readonly maxStacks: number;
  readonly tags: readonly SkillTag[];
}

/** Đúng 20 skill của GDD §6, giữ nguyên thứ tự bảng để dễ đối chiếu. */
export const SKILLS: readonly SkillDef[] = [
  {
    id: 'sharpen',
    name: 'Sharpen',
    rarity: 'common',
    maxStacks: 5,
    tags: [{ kind: 'damage-add', amount: 1 }],
  },
  {
    id: 'rapid-fire',
    name: 'Rapid Fire',
    rarity: 'common',
    maxStacks: 5,
    tags: [{ kind: 'fire-rate-mult', amount: 0.25 }],
  },
  {
    id: 'twin-shot',
    name: 'Twin Shot',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'projectile-add', amount: 1 }],
  },
  {
    id: 'piercing',
    name: 'Piercing',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'pierce-add' }],
  },
  {
    id: 'ricochet',
    name: 'Ricochet',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'ricochet-add', bounces: 1 }],
  },
  {
    id: 'homing',
    name: 'Homing',
    rarity: 'epic',
    maxStacks: 1,
    tags: [{ kind: 'homing-add' }],
  },
  {
    id: 'explosive',
    name: 'Explosive',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'explosive', radiusTiles: 1.5, damageRatio: 0.5 }],
  },
  {
    id: 'crit-eye',
    name: 'Crit Eye',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'crit-chance', chance: 0.15, multiplier: 2 }],
  },
  {
    id: 'vitality',
    name: 'Vitality',
    rarity: 'common',
    maxStacks: 5,
    // GDD còn ghi "hồi 1 tim ngay": đó là hiệu ứng lúc nhặt thẻ, do run xử lý,
    // không phải chỉ số thường trực nên không biểu diễn được bằng tag.
    tags: [{ kind: 'max-hearts', amount: 1 }],
  },
  {
    id: 'second-wind',
    name: 'Second Wind',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'heal-per-room', amount: 2 }],
  },
  {
    id: 'shield',
    name: 'Shield',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'shield', cooldownMs: 20_000 }],
  },
  {
    id: 'thorns',
    name: 'Thorns',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'thorns', damage: 2 }],
  },
  {
    id: 'swift',
    name: 'Swift',
    rarity: 'common',
    maxStacks: 5,
    tags: [{ kind: 'move-speed-mult', amount: 0.1 }],
  },
  {
    id: 'long-iframe',
    name: 'Long i-frame',
    rarity: 'rare',
    maxStacks: 2,
    tags: [{ kind: 'iframe-mult', amount: 1.375 }],
  },
  {
    id: 'freeze',
    name: 'Freeze',
    rarity: 'rare',
    maxStacks: 2,
    tags: [{ kind: 'slow-on-hit', factor: 0.4, durationMs: 1000 }],
  },
  {
    id: 'poison',
    name: 'Poison',
    rarity: 'rare',
    maxStacks: 2,
    tags: [{ kind: 'poison', dps: 1, durationMs: 3000 }],
  },
  {
    id: 'lifesteal',
    name: 'Lifesteal',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'lifesteal', percent: 0.05 }],
  },
  {
    id: 'greed',
    name: 'Greed',
    rarity: 'common',
    maxStacks: 4,
    tags: [{ kind: 'gold-mult', amount: 0.25 }],
  },
  {
    id: 'luck',
    name: 'Luck',
    rarity: 'rare',
    maxStacks: 3,
    tags: [{ kind: 'luck-add', amount: 0.01 }],
  },
  {
    id: 'executioner',
    name: 'Executioner',
    rarity: 'epic',
    maxStacks: 2,
    tags: [{ kind: 'execute', threshold: 0.3, bonus: 0.5 }],
  },
];

const SKILLS_BY_ID: ReadonlyMap<string, SkillDef> = new Map(SKILLS.map((s) => [s.id, s]));

/** Tra cứu skill theo id. Id lạ là bug (sai chính tả / pool cũ) nên ném lỗi. */
export function getSkill(id: string): SkillDef {
  const skill = SKILLS_BY_ID.get(id);
  if (skill === undefined) {
    throw new Error(`Skill không tồn tại trong pool: "${id}"`);
  }
  return skill;
}

export interface OwnedSkillStacks {
  readonly def: SkillDef;
  readonly stacks: number;
}

/**
 * Số stack hiệu lực của từng skill đang sở hữu.
 *
 * - Làm tròn xuống và kẹp vào [0, maxStacks]: save hỏng hay cộng nhầm không thể
 *   đẩy chỉ số vượt trần.
 * - Bỏ qua id không có trong pool thay vì ném lỗi: save từ pool cũ vẫn mở được run.
 * - Duyệt theo thứ tự `SKILLS`, không theo thứ tự Map, để kết quả tất định.
 */
export function resolveOwnedSkills(owned: ReadonlyMap<string, number>): OwnedSkillStacks[] {
  const result: OwnedSkillStacks[] = [];

  for (const def of SKILLS) {
    const stacks = clampStacks(owned.get(def.id) ?? 0, def.maxStacks);
    if (stacks > 0) result.push({ def, stacks });
  }

  return result;
}

/** Tổng điểm luck đang có (mỗi stack Luck = 0.01 điểm). Dùng cho `rollChoices`. */
export function luckPoints(owned: ReadonlyMap<string, number>): number {
  let total = 0;

  for (const skill of resolveOwnedSkills(owned)) {
    for (const tag of skill.def.tags) {
      if (tag.kind === 'luck-add') total += tag.amount * skill.stacks;
    }
  }

  return total;
}

function clampStacks(raw: number, maxStacks: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(Math.floor(raw), maxStacks);
}
