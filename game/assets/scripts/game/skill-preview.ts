/**
 * Debug overlay that previews skill cards **without granting** a skill (M5 round 3).
 *
 * Uses the real `buildSkillPick`, so text/layout are checked on the exact component that runs
 * in game. It never touches the run's loadout/RNG.
 */
import type { Node as CocosNode } from 'cc';
import { findSkillOrEvolution } from '../core/skills/evolutions';
import type { SkillDef } from '../core/skills/pool';
import { buildSkillPick } from './skill-pick';
import type { SkillPickScreen } from './skill-pick';

type Node = InstanceType<typeof CocosNode>;

export class SkillPreview {
  private screen: SkillPickScreen | null = null;

  constructor(private readonly parent: () => Node) {}

  /** Returns `false` for an unknown id or when the screen cannot be built. */
  async show(ids: readonly string[]): Promise<boolean> {
    this.close();

    const choices: SkillDef[] = [];
    for (const id of ids) {
      const def = findSkillOrEvolution(id);
      if (def === undefined) {
        console.warn(`[YokaiField] debug skillPreview: unknown id "${id}"`);
        return false;
      }
      choices.push(def);
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
      console.warn(`[YokaiField] debug skillPreview failed: ${message}`);
      return false;
    }
  }

  close(): boolean {
    this.screen?.destroy();
    this.screen = null;
    return true;
  }
}
