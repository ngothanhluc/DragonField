/**
 * Display text for skills and Legendary Evolutions on the 1-of-3 pick screen and the HUD.
 *
 * Content derives from the pool's `tags`, not hand-written per skill: adding a skill or Evolution
 * = adding tags, and the description follows automatically.
 */
import { getLocale, t, type Locale } from '../i18n';
import type { SkillDef, SkillTag } from './pool';

/** Twin Shot spread angle, degrees — matches `shot-effects.ts`. */
export const TWIN_SPREAD_DEGREES = 12;

/**
 * One description line for **each stack** of a skill or Evolution. Multiple tags join with " · ".
 * Does not include the current stack count — the UI appends "×N" or stack lines separately.
 */
export function describeSkill(def: SkillDef, locale: Locale = getLocale()): string {
  return def.tags.map((tag) => describeTag(tag, locale)).join(' · ');
}

/**
 * Short HUD text (2 characters). Comes from `SkillDef.short`, hand-written so every
 * skill and Evolution has a unique 2-character code.
 */
export function skillAbbreviation(def: SkillDef): string {
  return def.short;
}

/** Description text for one tag, computed for one stack. */
export function describeTag(tag: SkillTag, locale: Locale = getLocale()): string {
  switch (tag.kind) {
    case 'damage-add':
      return t('tag.damageAdd', { amount: formatNumber(tag.amount) }, locale);
    case 'fire-rate-mult':
      return t('tag.fireRateMult', { pct: formatPercent(tag.amount) }, locale);
    case 'projectile-add':
      return t(
        tag.amount === 1 ? 'tag.projectileAddOne' : 'tag.projectileAddMany',
        { amount: formatNumber(tag.amount), spread: TWIN_SPREAD_DEGREES },
        locale,
      );
    case 'pierce-add': {
      const amount = tag.amount ?? 1;
      return t(
        amount === 1 ? 'tag.pierceAddOne' : 'tag.pierceAddMany',
        { amount: formatNumber(amount) },
        locale,
      );
    }
    case 'crit-chance':
      return t(
        'tag.critChance',
        { pct: formatPercent(tag.chance), mult: formatNumber(tag.multiplier) },
        locale,
      );
    case 'max-hearts':
      return t('tag.maxHearts', { amount: formatNumber(tag.amount) }, locale);
    case 'heal-per-room':
      return t('tag.healPerRoom', { amount: formatNumber(tag.amount) }, locale);
    case 'shield':
      return t('tag.shield', { sec: formatSeconds(tag.cooldownMs) }, locale);
    case 'thorns':
      return t('tag.thorns', { damage: formatNumber(tag.damage) }, locale);
    case 'move-speed-mult':
      return t('tag.moveSpeedMult', { pct: formatPercent(tag.amount) }, locale);
    case 'iframe-mult':
      return t('tag.iframeMult', { pct: formatPercent(tag.amount - 1) }, locale);
    case 'slow-on-hit':
      return t(
        'tag.slowOnHit',
        { pct: formatPercent(1 - tag.factor), sec: formatSeconds(tag.durationMs) },
        locale,
      );
    case 'poison':
      return t(
        'tag.poison',
        { dps: formatNumber(tag.dps), sec: formatSeconds(tag.durationMs) },
        locale,
      );
    case 'burn':
      return t(
        'tag.burn',
        { dps: formatNumber(tag.dps), sec: formatSeconds(tag.durationMs) },
        locale,
      );
    case 'shock-arc':
      return t(
        'tag.shockArc',
        { arcs: formatNumber(tag.arcs), pct: formatPercent(tag.damageRatio) },
        locale,
      );
    case 'status-amp':
      return t('tag.statusAmp', { pct: formatPercent(tag.bonusRatio) }, locale);
    case 'lifesteal':
      return t('tag.lifesteal', { pct: formatPercent(tag.percent) }, locale);
    case 'execute':
      return t(
        'tag.execute',
        { pct: formatPercent(tag.bonus), threshold: formatPercent(tag.threshold) },
        locale,
      );
    case 'ricochet-add':
      return t(
        tag.bounces === 1 ? 'tag.ricochetOne' : 'tag.ricochetMany',
        { bounces: formatNumber(tag.bounces) },
        locale,
      );
    case 'homing-add':
      return t('tag.homing', undefined, locale);
    case 'explosive':
      return t(
        'tag.explosive',
        { radius: formatNumber(tag.radiusTiles), pct: formatPercent(tag.damageRatio) },
        locale,
      );
    case 'damage-reduction':
      return t('tag.damageReduction', { pct: formatPercent(tag.chance) }, locale);
    case 'shield-recharge-mult':
      return t('tag.shieldRechargeMult', { pct: formatPercent(1 - tag.factor) }, locale);
    case 'dash-cooldown-mult':
      return t('tag.dashCooldownMult', { pct: formatPercent(1 - tag.factor) }, locale);
    case 'dash-speed-mult':
      return t('tag.dashSpeedMult', { pct: formatPercent(tag.amount) }, locale);
    case 'dash-nova':
      return t(
        'tag.dashNova',
        { damage: formatNumber(tag.damage), radius: formatNumber(tag.radiusTiles) },
        locale,
      );
    case 'post-dash-fire-rate':
      return t(
        'tag.postDashFireRate',
        { pct: formatPercent(tag.bonus), sec: formatSeconds(tag.durationMs) },
        locale,
      );
    case 'active-cooldown-mult':
      return t('tag.activeCooldownMult', { pct: formatPercent(1 - tag.factor) }, locale);
    case 'active-power-mult':
      return t('tag.activePowerMult', { pct: formatPercent(tag.amount) }, locale);
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 20 000 ms → "20s"; 500 → "0.5s". */
function formatSeconds(value: number): string {
  const seconds = value / 1000;
  return `${Number.isInteger(seconds) ? seconds : Math.round(seconds * 10) / 10}s`;
}
