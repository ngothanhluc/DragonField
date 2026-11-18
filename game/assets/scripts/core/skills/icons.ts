/**
 * Skill → pack icon mapping (#5).
 *
 * The mapping is **data** (docs/art/import-checklist.md §5.2): these are the pack's closest
 * matching `Ui/Skill Icon/Spell` icons, not custom art. To change one, swap the file name here
 * and stage the PNG; the skill ids stay the same.
 *
 * Pure module: no `cc`, no file system — the UI adapters (`loadSkillIcon`) turn these sheet
 * paths into `SpriteFrame`s.
 */

import type { SkillDef } from './pool';

/** Skill id → icon file name in `resources/art/ui/skill-icons/` (no extension, no `Disabled` suffix). */
export const SKILL_ICONS: Readonly<Record<string, string>> = {
  sharpen: 'AttackUpgrade',
  'rapid-fire': 'Fireball',
  'twin-shot': 'Permutation',
  piercing: 'RockSpike',
  ricochet: 'BookThunder',
  homing: 'Vision',
  explosive: 'Explosion',
  'crit-eye': 'Counter',
  vitality: 'Heal',
  'second-wind': 'BookPlant',
  shield: 'DefenseUpgrade',
  thorns: 'BookDarkness',
  swift: 'BookWind',
  'long-iframe': 'Mist',
  freeze: 'BookIce',
  poison: 'BookDeath',
  lifesteal: 'MagicWeapon',
  greed: 'Alchemy',
  luck: 'LuckUpgrade',
  executioner: 'Death',
};

const ICON_DIR = 'resources/art/ui/skill-icons';

/** Resources sheet path of a skill's icon; `disabled` picks the `<Name>Disabled.png` variant. Throws on unknown ids. */
export function skillIconSheet(id: string, options: { readonly disabled?: boolean } = {}): string {
  const icon = SKILL_ICONS[id];
  if (icon === undefined) {
    throw new Error(`No skill icon mapped for skill id: "${id}"`);
  }
  const suffix = options.disabled === true ? 'Disabled' : '';
  return `${ICON_DIR}/${icon}${suffix}.png`;
}

/** Icon for a 1-of-3 pick card: the Disabled variant once `stacks >= def.maxStacks`. */
export function skillCardIconSheet(def: SkillDef, stacks: number): string {
  return skillIconSheet(def.id, { disabled: stacks >= def.maxStacks });
}
