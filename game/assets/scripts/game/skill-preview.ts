/**
 * Debug overlay xem trước card skill mà **không grant** skill (M5 round 3).
 *
 * Dùng đúng `buildSkillPick` như màn chọn thật, nên text/layout được kiểm trên
 * chính component sẽ chạy trong game. Không đụng loadout/RNG của run.
 */
import type { Node as CocosNode } from 'cc';
import { getSkill } from '../core/skills/pool';
import type { SkillDef } from '../core/skills/pool';
import { buildSkillPick } from './skill-pick';
import type { SkillPickScreen } from './skill-pick';

type Node = InstanceType<typeof CocosNode>;

export class SkillPreview {
  private screen: SkillPickScreen | null = null;

  constructor(private readonly parent: () => Node) {}

  /** Trả `false` khi id lạ hoặc không dựng được. */
  async show(ids: readonly string[]): Promise<boolean> {
    this.close();

    const choices: SkillDef[] = [];
    for (const id of ids) {
      try {
        choices.push(getSkill(id));
      } catch {
        console.warn(`[YokaiField] debug skillPreview: id lạ "${id}"`);
        return false;
      }
    }

    try {
      this.screen = await buildSkillPick(this.parent(), {
        choices,
        owned: new Map<string, number>(),
        onPick: () => undefined,
      });
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[YokaiField] debug skillPreview thất bại: ${message}`);
      return false;
    }
  }

  close(): boolean {
    this.screen?.destroy();
    this.screen = null;
    return true;
  }
}
