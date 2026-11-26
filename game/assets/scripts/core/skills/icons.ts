/**
 * Skill & Legendary Evolution → pack icon mapping (M13, ADR-022).
 *
 * Every base skill (27) and every Legendary Evolution (7) maps to a strictly unique
 * 24×24 icon in `resources/art/ui/skill-icons/` (plus its `<Name>Disabled.png` variant).
 *
 * Pure module: no `cc`, no file system — the UI adapters (`loadSkillIcon`) turn these sheet
 * paths into `SpriteFrame`s.
 */

import type { SkillDef } from './pool';

/** Skill or Evolution id → icon file name in `resources/art/ui/skill-icons/` (no extension, no `Disabled` suffix). */
export const SKILL_ICONS: Readonly<Record<string, string>> = {
  // Weapon / Offense (9)
  sharpen: 'AttackUpgrade',
  'rapid-fire': 'Fireball',
  'twin-shot': 'Permutation',
  piercing: 'RockSpike',
  ricochet: 'Hook',
  homing: 'Vision',
  explosive: 'Explosion',
  'crit-eye': 'Counter',
  executioner: 'Death',

  // Elemental / Status (6)
  freeze: 'BookIce',
  poison: 'BookDeath',
  ignite: 'BookFire',
  'chain-lightning': 'BookThunder',
  lifesteal: 'MagicWeapon',
  corrosive: 'Downgrade',

  // Defense / Survival (6)
  vitality: 'Heal',
  'second-wind': 'BookPlant',
  shield: 'DefenseUpgrade',
  thorns: 'BookDarkness',
  'long-iframe': 'Mist',
  'iron-skin': 'Armor',

  // Mobility / Dash & Active (6)
  swift: 'BookWind',
  'phantom-dash': 'Camouflage',
  'dash-nova': 'Cut',
  'shadow-conduit': 'Amulet',
  'arcane-surge': 'BookLight',
  afterimage: 'Boot',

  // Legendary Evolutions (7)
  'phantom-volley': 'Arrow',
  cataclysm: 'Sun',
  blightfrost: 'Snow',
  'starfall-kunai': 'Kunai',
  'aegis-retribution': 'Guard',
  shadowstep: 'Moon',
  'tempest-barrage': 'Shuriken',
};

const ICON_DIR = 'resources/art/ui/skill-icons';

/** Resources sheet path of a skill/Evolution icon; `disabled` picks the `<Name>Disabled.png` variant. */
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
