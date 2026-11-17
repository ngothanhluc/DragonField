/**
 * Skill của một run: loadout + RNG roll + màn chọn 1/3.
 *
 * Tách khỏi `bootstrap.ts` để run flow không phải giữ 4 field rời (loadout,
 * rng, screen, choices) và để luật "roll bằng seed của run, tôn trọng max stack"
 * nằm một chỗ. File này không quyết định chuyển phòng — bootstrap vẫn làm việc
 * đó sau khi `choose()` trả về.
 */
import { SkillLoadout, type AcquireResult } from '../core/skills/loadout';
import type { DerivedStats } from '../core/skills/derived-stats';
import type { OwnedSkillStacks, SkillDef } from '../core/skills/pool';
import { rollChoices } from '../core/skills/roll';
import { SeededRng } from '../core/rng';
import { buildSkillPick, type SkillPickScreen } from './skill-pick';

type PickParent = Parameters<typeof buildSkillPick>[0];

export interface SkillPickResult {
  readonly def: SkillDef;
  readonly result: AcquireResult;
}

export interface SkillGrant {
  readonly acquired: boolean;
  readonly healNow: number;
  readonly stacks: number;
}

export class SkillRun {
  private loadout = new SkillLoadout();
  private rng = SeededRng.fromSeed(1);
  private screen: SkillPickScreen | null = null;
  private offered: readonly SkillDef[] | null = null;
  /** Tăng mỗi lần mở/đóng để bỏ kết quả build screen cũ (đổi phòng nhanh). */
  private token = 0;

  /** Bắt đầu run mới: loadout rỗng, RNG lấy từ seed của run. */
  reset(seed: number): void {
    this.destroy();
    this.loadout = new SkillLoadout();
    this.rng = SeededRng.fromSeed(seed);
  }

  get entries(): OwnedSkillStacks[] {
    return this.loadout.entries;
  }

  get size(): number {
    return this.loadout.size;
  }

  stats(): DerivedStats {
    return this.loadout.stats();
  }

  snapshot(): ReadonlyMap<string, number> {
    return this.loadout.snapshot();
  }

  stacks(id: string): number {
    return this.loadout.stacks(id);
  }

  /** 3 skill được offer hiện tại (id), `null` khi không ở màn chọn. */
  get choices(): string[] | null {
    return this.offered === null ? null : this.offered.map((skill) => skill.id);
  }

  /** Quay thẻ bằng RNG của run; pool cạn thì trả ít hơn 3 (kể cả rỗng). */
  roll(): SkillDef[] {
    return rollChoices({ rng: this.rng, owned: this.loadout.snapshot() });
  }

  /**
   * Dựng màn chọn. Nghe phím được gắn ngay trong `buildSkillPick` trước await,
   * nên bấm 1/2/3 ngay frame mở vẫn ăn.
   */
  async open(parent: PickParent, choices: readonly SkillDef[], onPick: (index: number) => void): Promise<void> {
    this.offered = choices;
    const token = ++this.token;
    const screen = await buildSkillPick(parent, {
      choices,
      owned: this.loadout.snapshot(),
      onPick,
    });

    if (token !== this.token || this.offered === null) {
      screen.destroy();
      return;
    }
    this.screen = screen;
  }

  /**
   * Chọn thẻ theo index hoặc id. Trả `null` khi không có màn chọn / thẻ sai /
   * đã đạt max stack. Không tự chuyển phòng.
   */
  choose(indexOrId: number | string): SkillPickResult | null {
    const choices = this.offered;
    if (choices === null) return null;

    const index =
      typeof indexOrId === 'number'
        ? indexOrId
        : choices.findIndex((skill) => skill.id === indexOrId);
    const def = choices[index];
    if (def === undefined) return null;

    const result = this.loadout.acquire(def.id);
    if (!result.acquired) return null;

    this.offered = null;
    this.token += 1;
    this.screen?.destroy();
    this.screen = null;
    return { def, result };
  }

  /** Debug: nhặt ngoài màn chọn; trả stack sau khi nhặt. */
  grant(id: string, stacks = 1): SkillGrant {
    const result = this.loadout.acquire(id, stacks);
    return { acquired: result.acquired, healNow: result.healNow, stacks: this.loadout.stacks(id) };
  }

  /** Đóng màn chọn (nếu có) và huỷ offer hiện tại. */
  destroy(): void {
    this.token += 1;
    this.offered = null;
    this.screen?.destroy();
    this.screen = null;
  }
}
