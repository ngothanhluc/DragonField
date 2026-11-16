/**
 * Định nghĩa 3 boss chapter (GDD §5): TenguBlue → SquidGreen → GiantBlueSamurai.
 *
 * File này chỉ có **dữ liệu thuần**: không thời gian, không RNG, không `cc`.
 * Pattern chi tiết nằm ở `patterns.ts`, sinh quái ở `summon.ts`.
 *
 * Boss lấy frame từ `Actor/Boss` của pack; mỗi sheet là **một hàng ngang**
 * (`layout: "strip"` trong `assets/resources/data/animations.json`), nên core chỉ *gọi
 * tên* animation, adapter lo cắt frame và lật sprite.
 */
export const BOSS_IDS = ['tengu', 'squid', 'samurai'] as const;
export type BossId = (typeof BOSS_IDS)[number];

export type BossPhase = 1 | 2 | 3;

/** Hướng boss quay. Với Samurai đây cũng là **dấu hiệu đọc đòn** (GDD §5). */
export type Facing = 'left' | 'right';

/**
 * Animation boss đặt tên **theo ý đồ**, không theo tên file. Adapter tra
 * `animationFor()` để ra key manifest thật. Nhờ vậy Samurai đổi
 * `attack` → `samurai.attack.left|right` mà pattern không cần biết.
 */
export type BossAnimKind = 'idle' | 'walk' | 'attack' | 'charge' | 'loop' | 'shoot' | 'teleport' | 'hit';

/** Một key animation trong manifest, kèm cờ "có hướng" (Samurai L/R). */
interface AnimationEntry {
  /** Key gốc; nếu `perFacing` thì hậu tố `.left` / `.right` được ghép vào. */
  readonly base: string;
  /** Samurai tách sheet trái/phải; hai boss kia chỉ một sheet. */
  readonly perFacing?: boolean;
}

/**
 * Bảng tra animation của từng boss, chỉ gồm những gì pack **thật sự có**
 * (`docs/art/pack-inventory.md` §3). Thiếu kind nào thì `animationFor` lùi về
 * `attack` rồi `idle` — pattern không bao giờ hỏi kind mà boss không có.
 */
const ANIMATION_TABLE: Readonly<
  Record<BossId, Readonly<Partial<Record<BossAnimKind, AnimationEntry>>>>
> = {
  tengu: {
    idle: { base: 'tengu.idle' },
    walk: { base: 'tengu.walk' },
    attack: { base: 'tengu.attack' },
    teleport: { base: 'tengu.trans' },
    hit: { base: 'tengu.hit' },
  },
  squid: {
    idle: { base: 'squid.idle' },
    walk: { base: 'squid.walk' },
    attack: { base: 'squid.attack' },
    loop: { base: 'squid.attack-loop' },
    shoot: { base: 'squid.shoot' },
    hit: { base: 'squid.hit' },
  },
  samurai: {
    idle: { base: 'samurai.idle' },
    walk: { base: 'samurai.walk' },
    attack: { base: 'samurai.attack', perFacing: true },
    charge: { base: 'samurai.charge', perFacing: true },
    hit: { base: 'samurai.hit' },
  },
};

/**
 * Ngưỡng chuyển phase, tính theo **tỉ lệ máu còn lại**.
 *
 * Biên tính về phase sau: máu đúng bằng ngưỡng đã là phase mới. Nhờ vậy
 * `phaseFor` chỉ cần hai phép so sánh và không có vùng "lửng" nào.
 */
export interface PhaseThresholds {
  /** Máu <= tỉ lệ này thì vào phase 2. */
  readonly phase2: number;
  /** Máu <= tỉ lệ này thì vào phase 3. */
  readonly phase3: number;
}

/** 2/3 và 1/3 — dùng chung cho cả ba boss, GDD không nói khác nhau. */
export const PHASE_THRESHOLDS: PhaseThresholds = {
  phase2: 2 / 3,
  phase3: 1 / 3,
};

export interface BossDef {
  readonly id: BossId;
  /** Tên hiển thị trên HUD (GDD §5). */
  readonly displayName: string;
  /** Tên folder art thật, khớp `LevelData.boss.name`. */
  readonly spriteName: string;
  readonly chapter: BossPhase;
  /** Máu tối đa: 60 / 80 / 100 (GDD §5). */
  readonly maxHealth: number;
  /**
   * Bán kính **hitbox**, tile — proxy va chạm, không phải kích thước sprite.
   *
   * Sprite boss trong pack (xem `docs/art/pack-inventory.md` §3) là 82×82 px
   * (Tengu lúc walk/attack), 76×79 px (Squid) và 96×96 px (Samurai lúc
   * attack/charge). Ở 16 px/tile tức 4.75–6 tile, nhưng frame có viền trong suốt
   * và thân chỉ chiếm ~70–85% bề rộng. Lấy **nửa bề rộng thân**, làm tròn 1/4
   * tile:
   *
   * | boss    | frame | thân ≈ | bán kính |
   * |---------|-------|--------|----------|
   * | tengu   | 82 px | 70 %   | 1.75     |
   * | squid   | 76 px | 85 %   | 2        |
   * | samurai | 96 px | 75 %   | 2.25     |
   *
   * Hitbox nhỏ hơn sprite nên player không bị "trúng không khí".
   */
  readonly hitboxRadiusTiles: number;
  readonly phaseThresholds: PhaseThresholds;
  /** Mọi key animation boss này có trong manifest. Adapter preload theo danh sách này. */
  readonly animations: readonly string[];
}

function animationsOf(id: BossId): readonly string[] {
  const table = ANIMATION_TABLE[id];
  const keys = new Set<string>();
  for (const entry of Object.values(table)) {
    if (entry === undefined) continue;
    if (entry.perFacing === true) {
      keys.add(`${entry.base}.left`);
      keys.add(`${entry.base}.right`);
    } else {
      keys.add(entry.base);
    }
  }
  return Array.from(keys);
}

export const BOSSES: Readonly<Record<BossId, BossDef>> = {
  tengu: {
    id: 'tengu',
    displayName: 'Tengu',
    spriteName: 'TenguBlue',
    chapter: 1,
    maxHealth: 60,
    hitboxRadiusTiles: 1.75,
    phaseThresholds: PHASE_THRESHOLDS,
    animations: animationsOf('tengu'),
  },
  squid: {
    id: 'squid',
    displayName: 'Squid',
    spriteName: 'SquidGreen',
    chapter: 2,
    maxHealth: 80,
    hitboxRadiusTiles: 2,
    phaseThresholds: PHASE_THRESHOLDS,
    animations: animationsOf('squid'),
  },
  samurai: {
    id: 'samurai',
    displayName: 'Samurai',
    spriteName: 'GiantBlueSamurai',
    chapter: 3,
    maxHealth: 100,
    hitboxRadiusTiles: 2.25,
    phaseThresholds: PHASE_THRESHOLDS,
    animations: animationsOf('samurai'),
  },
};

/**
 * Phase theo máu còn lại. `healthFraction` phải hữu hạn; 1 = đầy máu.
 *
 * Biên: `1 → 1`, `0.66 → 2`, `0.33 → 3`, `0 → 3` (với ngưỡng 2/3 và 1/3).
 */
export function phaseFor(bossId: BossId, healthFraction: number): BossPhase {
  if (!Number.isFinite(healthFraction)) {
    throw new Error(`phaseFor cần healthFraction hữu hạn, nhận ${healthFraction}`);
  }

  const thresholds = BOSSES[bossId].phaseThresholds;
  if (healthFraction <= thresholds.phase3) return 3;
  if (healthFraction <= thresholds.phase2) return 2;
  return 1;
}

/** Tỉ lệ máu còn lại, kẹp trong [0, 1] để overheal không đẩy ra ngoài ngưỡng. */
export function healthFraction(bossId: BossId, health: number): number {
  if (!Number.isFinite(health)) {
    throw new Error(`healthFraction cần health hữu hạn, nhận ${health}`);
  }
  const ratio = health / BOSSES[bossId].maxHealth;
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}

/**
 * Key animation manifest cho một ý đồ của boss. `facing` chỉ dùng khi boss có
 * sheet tách hướng (Samurai); hai boss kia bỏ qua tham số này.
 */
export function animationFor(bossId: BossId, kind: BossAnimKind, facing: Facing): string {
  const table = ANIMATION_TABLE[bossId];
  const entry = table[kind] ?? table.attack ?? table.idle;
  if (entry === undefined) {
    throw new Error(`Boss ${bossId} không có animation nào để lùi về`);
  }
  return entry.perFacing === true ? `${entry.base}.${facing}` : entry.base;
}

/** Hướng đối diện — Samurai đổi hướng charge thứ hai (GDD §5). */
export function oppositeFacing(facing: Facing): Facing {
  return facing === 'left' ? 'right' : 'left';
}
