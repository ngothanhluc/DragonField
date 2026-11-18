/**
 * Skill → pack icon mapping (#5). STUB written with the red acceptance test: the executor fills it in.
 */
import type { SkillDef } from './pool';

/** Skill id → icon file name in `resources/art/ui/skill-icons/` (no extension, no `Disabled` suffix). */
export const SKILL_ICONS: Readonly<Record<string, string>> = {};

/** Resources sheet path of a skill's icon; `disabled` picks the `<Name>Disabled.png` variant. Throws on unknown ids. */
export function skillIconSheet(id: string, options: { readonly disabled?: boolean } = {}): string {
  void id;
  void options;
  return '';
}

/** Icon for a 1-of-3 pick card: the Disabled variant once `stacks >= def.maxStacks`. */
export function skillCardIconSheet(def: SkillDef, stacks: number): string {
  void def;
  void stacks;
  return '';
}
