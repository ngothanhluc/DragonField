// AUTO-GENERATED from game/config/tuning.json — do not edit. Run: bun run gen
//
// Số liệu balance đã validate từ `config/tuning.json`. Sửa JSON rồi chạy `bun run gen`;
// `bun run check:config` chặn file này lệch khỏi nguồn.

export const TUNING_DATA = {
  version: 1,
  combat: {
    fireRatePerSecond: 2,
    damage: 1,
    projectiles: 1,
    projectileSpeedTilesPerSecond: 12,
    moveSpeedTilesPerSecond: 4,
    playerMaxHearts: 6,
    invulnerabilityMs: 800,
    contactDamage: 1,
    targetingRangeTiles: 8,
    playerKnockbackDistanceTiles: 1.5,
    playerKnockbackDurationMs: 180,
    enemyKnockbackDistanceTiles: 0.35,
    enemyKnockbackDurationMs: 120,
    enemyHitstopMs: 70,
    enemyStaggerMs: 150,
  },
  enemies: {
    eliteHealthMultiplier: 2,
    eliteDamageMultiplier: 2,
    roomEdgeMarginTiles: 0.5,
    elite: {
      scale: 1.15,
      chaser: {
        pounceTelegraphMs: 300,
        pounceSpeedTilesPerSecond: 6,
        pounceDurationMs: 300,
        pounceCooldownMs: 900,
        pounceRangeTiles: 6,
      },
      caster: {
        volleyShots: 3,
        volleySpreadRadians: 0.22,
      },
      tank: {
        extraCharges: 1,
      },
    },
    roles: {
      chaser: {
        health: 6,
        speedTilesPerSecond: 3.2,
        attackCooldownMs: 0,
        telegraphMs: 0,
        preferredRangeMinTiles: 0.75,
        preferredRangeMaxTiles: 0.75,
        contactDamage: 1,
        chargeSpeedTilesPerSecond: 0,
        chargeDurationMs: 0,
        scale: 1,
      },
      caster: {
        health: 4,
        speedTilesPerSecond: 1.6,
        attackCooldownMs: 900,
        telegraphMs: 500,
        preferredRangeMinTiles: 4,
        preferredRangeMaxTiles: 6,
        contactDamage: 1,
        chargeSpeedTilesPerSecond: 0,
        chargeDurationMs: 0,
        scale: 1,
      },
      tank: {
        health: 10,
        speedTilesPerSecond: 1.2,
        attackCooldownMs: 900,
        telegraphMs: 700,
        preferredRangeMinTiles: 0,
        preferredRangeMaxTiles: 8,
        contactDamage: 2,
        chargeSpeedTilesPerSecond: 7,
        chargeDurationMs: 450,
        scale: 1.75,
      },
    },
  },
} as const;
