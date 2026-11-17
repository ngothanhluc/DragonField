/**
 * Vòng chiến đấu của một phòng: enemy + đạn + va chạm + hitstop.
 *
 * Tách khỏi `bootstrap.ts` khi M3 thêm đạn caster, cú lao của brute, stagger và
 * hitstop: bootstrap lo run flow (chapter → phòng → wave → clear/loss), còn file
 * này lo **một frame chiến đấu**. Thứ tự frame giữ đúng như trước và như
 * `core/sim/run-simulation.ts`: player → enemy → đạn → va chạm → sạm thương chạm.
 *
 * Ba thứ thuộc về core, file này chỉ áp:
 *
 * - **Thời gian**: `HitstopClock` ăn thời gian thật và trả thời gian mô phỏng;
 *   `nowMs` chỉ tăng theo phần mô phỏng, nên telegraph/i-frame/cooldown/TTL đạn
 *   cùng đứng yên trong 70 ms hitstop (không desync).
 * - **Quyết định của enemy**: `EnemyView.step` gọi `decideAction`; ở đây chỉ đọc
 *   kết quả (`released`, `chargeSweep`).
 * - **Hình học**: `segmentHitsCircle` cho cú lao, `hitsCircle` cho đạn, `firstHit`
 *   cho vật cản.
 *
 * Debug (`?debug=1`) dùng các method `spawnDebug` / `startStress` / `godMode`;
 * bình thường không code nào gọi chúng.
 */
import { Color as CocosColor, Node as CocosNodeValue, Sprite as CocosSprite } from 'cc';
import type { AnimationManifest } from '../core/art/manifest';
import type { BossDef, BossPhase } from '../core/boss/boss-defs';
import { summonedEnemies } from '../core/boss/summon';
import { firstHit, hitsCircle } from '../core/combat/bullets';
import { fireEnemyVolley } from '../core/combat/enemy-fire';
import { segmentHitsCircle } from '../core/combat/hitbox';
import { HitstopClock } from '../core/combat/hitstop';
import {
  HOMING_TURN_RATE_RADIANS_PER_SECOND,
  damageAfterExecute,
  lifestealHeal,
  ricochetTarget,
  steerVelocity,
} from '../core/combat/shot-effects';
import { StatusEffects } from '../core/combat/status-effects';
import type { Targetable } from '../core/combat/targeting';
import { DEFAULT_COMBAT } from '../core/config';
import type { EnemyState } from '../core/enemies/behaviours';
import { maxHealthFor } from '../core/enemies/behaviours';
import { eliteVolleyAngles } from '../core/enemies/elite';
import { spawnWave } from '../core/enemies/waves';
import type { EnemyRole, LevelData } from '../core/level/level-data';
import { distance, type Vec2 } from '../core/math/vec2';
import type { SeededRng } from '../core/rng';
import { SpriteAnimator } from './anim/sprite-animator';
import { BossView } from './boss-view';
import type { BulletView } from './bullet-view';
import { EnemyView } from './enemy-view';
import type { FxPool } from './fx/effect-pool';
import { ACTOR_SCALE } from './level-view';
import type { PlayerController } from './player-controller';
import { playSfx } from './audio/sfx';

/** `cc` là module any: tên import chỉ dùng được ở vị trí value. */
type Node = InstanceType<typeof CocosNodeValue>;

/** Bán kính player khi xét đạn enemy / cú lao, tile — cùng quy ước sim. */
export const PLAYER_RADIUS_TILES = 0.25;

/** Số enemy và số đạn enemy mà `stress()` duy trì. */
export const STRESS_ENEMY_COUNT = 8;
/** Id của boss trong collision/auto-aim — trùng `boss-run.ts` để debug đọc được. */
export const BOSS_TARGET_ID = 'boss';
/**
 * Mốc của milestone là "8 enemy + 40 đạn". Giữ 44 để sau khi vài viên trúng
 * player/bị vật cản ăn trong frame, con số đo được vẫn **>= 40**.
 */
export const STRESS_ENEMY_BULLETS = 44;
/** Máu giả của enemy stress để chúng không chết trong lúc đo fps. */
const STRESS_ENEMY_HEALTH = 999_999;
const STRESS_BULLET_SPEED = 3;
const STRESS_BULLET_TTL_MS = 6000;
/** Bán kính vòng spawn của stress (quanh tâm phòng), tile. */
const STRESS_RING_RADIUS = 7;

export interface CombatLoopOptions {
  readonly player: PlayerController;
  readonly bulletView: BulletView | null;
  readonly manifest: AnimationManifest;
  readonly actorLayer: Node;
  readonly level: LevelData;
  /** Tên actor trong manifest theo vai trò của chapter hiện tại. */
  readonly monsterFor: (role: EnemyRole) => string;
  /** RNG của run: boss pattern + summon + trí crit đạn đã nằm ở PlayerController. */
  readonly rng: SeededRng;
  /** Callback khi boss đổi phase (bootstrap hiện banner). */
  readonly onBossPhase?: (phase: BossPhase) => void;
  /**
   * Một enemy vừa chết — bootstrap cộng vàng (M5). Gọi đúng **một lần** cho
   * mỗi enemy, kể cả khi `killAll()`/debug giết hàng loạt.
   */
  readonly onKill?: (role: EnemyRole, elite: boolean) => void;
  /** Boss vừa chết (thưởng phòng boss do bootstrap quyết ở `awardRoomClear`). */
  readonly onBossKilled?: () => void;
  /** Pool flash vụ nổ; vắng mặt thì vẫn chạy, chỉ không có hình. */
  readonly fx?: FxPool;
}

export interface CombatUpdateResult {
  /** Frame bị hitstop ăn hết — mô phỏng không chạy frame này. */
  readonly frozen: boolean;
  readonly playerDied: boolean;
  /** Mọi enemy của phòng đã chết (bootstrap quyết sang wave/phòng kế). */
  readonly cleared: boolean;
}

export interface EnemySnapshot {
  readonly id: string;
  readonly role: EnemyRole | null;
  readonly elite: boolean;
  readonly health: number;
  readonly maxHealth: number;
  readonly action: string;
  readonly x: number;
  readonly y: number;
}

export class CombatLoop {
  private readonly player: PlayerController;
  private readonly bulletView: BulletView | null;
  private readonly manifest: AnimationManifest;
  private readonly actorLayer: Node;
  private readonly monsterFor: (role: EnemyRole) => string;
  private readonly rng: SeededRng;
  private readonly onBossPhase: (phase: BossPhase) => void;
  private readonly onKill: (role: EnemyRole, elite: boolean) => void;
  private readonly onBossKilled: () => void;
  private readonly fx: FxPool | null;
  private readonly hitstop = new HitstopClock(DEFAULT_COMBAT.enemyHitstopMs);
  private readonly enemies: EnemyView[] = [];
  private boss: BossView | null = null;
  /** Enemy/boss đã trả thưởng — chặn cộng vàng hai lần khi update quét lại. */
  private readonly rewarded = new Set<string>();
  private bossRewarded = false;
  private readonly bossStatus = new StatusEffects();
  private level: LevelData;
  private waveIndex = 0;
  private nowMs = 0;
  private playerDied = false;
  private awaitingAdvance = false;
  private god = false;

  /** Debug stress: giữ 8 enemy + 44 đạn enemy trên màn để đo fps. */
  private stress = false;
  private stressIndex = 0;
  private debugSeq = 0;

  constructor(options: CombatLoopOptions) {
    this.player = options.player;
    this.bulletView = options.bulletView;
    this.manifest = options.manifest;
    this.actorLayer = options.actorLayer;
    this.level = options.level;
    this.monsterFor = options.monsterFor;
    this.rng = options.rng;
    this.onBossPhase = options.onBossPhase ?? (() => undefined);
    this.onKill = options.onKill ?? (() => undefined);
    this.onBossKilled = options.onBossKilled ?? (() => undefined);
    this.fx = options.fx ?? null;
  }

  get currentLevel(): LevelData {
    return this.level;
  }

  get clockMs(): number {
    return this.nowMs;
  }

  get currentWaveIndex(): number {
    return this.waveIndex;
  }

  get frozenMs(): number {
    return this.hitstop.remaining;
  }

  get isGodMode(): boolean {
    return this.god;
  }

  /** Số enemy còn sống — bootstrap dùng cho debug. */
  get aliveCount(): number {
    return this.enemies.filter((enemy) => !enemy.isDead).length;
  }

  get hasBoss(): boolean {
    return this.boss !== null && !this.boss.isDefeated;
  }

  /** Snapshot boss cho debug `boss()`; `null` khi phòng thường. */
  bossSnapshot(): {
    readonly id: string;
    readonly name: string;
    readonly health: number;
    readonly maxHealth: number;
    readonly phase: BossPhase;
  } | null {
    const boss = this.boss;
    if (boss === null) return null;
    return {
      id: boss.id,
      name: boss.displayName,
      health: boss.health,
      maxHealth: boss.maxHealth,
      phase: boss.phase,
    };
  }

  /** Debug `setBossHp`: trừ máu qua đúng đường `takeDamage` để phase đổi tự nhiên. */
  setBossHealthFraction(fraction: number): boolean {
    const boss = this.boss;
    if (boss === null || boss.isDefeated) return false;
    const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
    const target = Math.round(boss.maxHealth * clamped);
    const damage = boss.health - target;
    if (damage > 0) boss.takeDamage(damage, this.nowMs);
    this.reportDeaths();
    return true;
  }

  setGodMode(on: boolean): void {
    this.god = on;
  }

  /** Đổi phòng: dọn enemy/đạn, nhận level mới. Đồng hồ mô phỏng chạy tiếp (i-frame xuyên phòng). */
  enterRoom(level: LevelData): void {
    this.clear();
    this.level = level;
    this.waveIndex = 0;
    this.playerDied = false;
    this.awaitingAdvance = false;
    this.hitstop.reset();
    this.rewarded.clear();
    this.bossRewarded = false;
  }

  /**
   * Sinh boss thật của phòng. Gọi trước `startWave` để telegraph/đạn boss có
   * ngay trong frame đầu phòng (bootstrap gọi khi `enterRoom`).
   */
  spawnBoss(def: BossDef, start: Vec2): BossView {
    this.boss?.destroy();
    this.bossStatus.clear();
    this.bossRewarded = false;
    const boss = new BossView({
      def,
      start,
      actorLayer: this.actorLayer,
      bullets: this.player.bullets,
      rng: this.rng,
      onPhase: this.onBossPhase,
      onSummon: (role, count) => this.summon(role, count),
      ...(this.fx !== null ? { fx: this.fx } : {}),
    });
    this.boss = boss;
    return boss;
  }

  /** Gọi quái theo vòng quanh boss; vị trí do core/summon quyết (tất định). */
  private summon(role: EnemyRole, count: number): void {
    const boss = this.boss;
    if (boss === null) return;

    for (const enemy of summonedEnemies(boss.bossState, role, count, this.rng)) {
      const maxHealth = maxHealthFor(role, false, undefined, this.level.chapter);
      const state: EnemyState = {
        id: enemy.id,
        role: enemy.role,
        elite: false,
        position: { x: enemy.position.x, y: enemy.position.y },
        health: maxHealth,
        maxHealth,
        action: { kind: 'idle' },
        actionStartedMs: this.nowMs,
      };
      this.addEnemy(state);
    }
  }

  /** Sinh wave `index` của phòng hiện tại. Gọi sau `enterRoom` (và sau khi đã spawn boss). */
  startWave(index: number): void {
    this.waveIndex = index;
    this.awaitingAdvance = false;
    for (const state of spawnWave(this.level, index)) {
      this.addEnemy(state);
    }
  }

  /** Một frame chiến đấu. `realDeltaMs` đã được bootstrap kẹp trần. */
  update(realDeltaMs: number): CombatUpdateResult {
    const player = this.player;
    const level = this.level;

    if (this.awaitingAdvance || player.isDead) {
      return { frozen: false, playerDied: player.isDead, cleared: this.awaitingAdvance };
    }

    if (this.stress) this.topUpStress();

    const deltaMs = this.hitstop.step(realDeltaMs);
    if (deltaMs <= 0) {
      return { frozen: true, playerDied: false, cleared: false };
    }
    this.nowMs += deltaMs;

    const targets: Targetable[] = this.enemies
      .filter((enemy) => !enemy.isDead)
      .map((enemy) => ({ id: enemy.id, position: enemy.position, alive: true }));
    const boss = this.boss;
    if (boss !== null && !boss.isDefeated) {
      targets.push({ id: BOSS_TARGET_ID, position: boss.position, alive: true });
    }

    player.step(this.nowMs, deltaMs, targets, level);
    this.stepBoss(deltaMs, player.position);
    this.stepEnemies(deltaMs);
    this.stepBullets(deltaMs, level);
    this.applyContactDamage();
    this.fx?.update(deltaMs);
    this.reportDeaths();

    this.bulletView?.sync();
    if (this.stress) this.topUpStress();

    if (player.isDead) this.playerDied = true;

    const cleared =
      this.enemies.every((enemy) => enemy.isDead) &&
      (this.boss === null || this.boss.isDefeated);
    if (cleared) this.awaitingAdvance = true;

    return { frozen: false, playerDied: this.playerDied, cleared };
  }

  /** Đi một frame pattern boss + poison DoT (Freeze không áp lên boss — xem report M4). */
  private stepBoss(deltaMs: number, playerPosition: Vec2): void {
    const boss = this.boss;
    if (boss === null || boss.isDefeated) return;

    boss.step(this.nowMs, deltaMs, playerPosition);
    const poison = this.bossStatus.poisonDamage(this.nowMs, deltaMs);
    if (poison > 0) boss.takeDamage(poison, this.nowMs);

    // Thân boss lúc lao cũng gây sát thương — nếu không, Samurai charge xuyên
    // qua người chơi mà không có gì xảy ra. i-frame chặn trúng nhiều frame.
    if (
      boss.isCharging &&
      distance(boss.position, playerPosition) <= boss.hitboxRadiusTiles + PLAYER_RADIUS_TILES
    ) {
      const heartsBefore = this.player.hearts;
      this.damagePlayer(DEFAULT_COMBAT.contactDamage, boss.position);
      const thorns = this.player.derivedStats.thorns;
      if (thorns !== undefined && this.player.hearts < heartsBefore) {
        boss.takeDamage(thorns.damage, this.nowMs);
      }
    }
  }

  /**
   * Bắn đạn enemy khi enemy vừa thả đòn. Caster elite bắn loạt 3 viên toả quạt
   * (`eliteVolleyAngles`); caster thường một viên đi thẳng.
   */
  private stepEnemies(deltaMs: number): void {
    const player = this.player;

    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;

      const step = enemy.step(this.nowMs, deltaMs, player.position);

      if (step.released === 'shot') {
        const role = enemy.role;
        if (role !== null) {
          fireEnemyVolley({
            pool: player.bullets,
            from: enemy.position,
            to: player.position,
            damage: enemy.contactDamage,
            angles: eliteVolleyAngles(role, enemy.isElite),
          });
        }
      }

      // Cú lao trúng player: quét cả đoạn đường, mỗi cú chỉ trừ máu một lần.
      const sweep = step.chargeSweep;
      if (
        sweep !== null &&
        !enemy.chargeHitApplied &&
        segmentHitsCircle(sweep.from, sweep.to, player.position, PLAYER_RADIUS_TILES, enemy.radiusTiles)
      ) {
        enemy.markChargeHit();
        this.damagePlayer(enemy.contactDamage, sweep.to);
      }
    }
  }

  /**
   * Đạn bay + va chạm. Đạn enemy trừ máu player (i-frame của `HealthState` chặn
   * hai viên trong 0.8 s); đạn player áp toàn bộ skill (crit/execute/pierce/
   * ricochet/homing/nổ/freeze/poison/lifesteal) và **xin hitstop** khi trúng.
   */
  private stepBullets(deltaMs: number, level: LevelData): void {
    const player = this.player;
    const stats = player.derivedStats;
    const pool = player.bullets;

    // Homing xoay trước khi bay, dùng vị trí đầu frame.
    for (const bullet of pool.active()) {
      if (!bullet.homing || bullet.owner !== 'player') continue;
      const aim = this.nearestTarget(bullet.position);
      if (aim === null) continue;
      const turn = (HOMING_TURN_RATE_RADIANS_PER_SECOND * deltaMs) / 1000;
      const next = steerVelocity(bullet.velocity, bullet.position, aim, turn);
      bullet.velocity.x = next.x;
      bullet.velocity.y = next.y;
    }

    pool.update(deltaMs);
    pool.consumeWhere((bullet) => !isInsideRoom(level, bullet.position));

    const seconds = deltaMs / 1000;
    const spent = new Set<number>();

    for (const bullet of pool.active()) {
      // Vật cản chặn đạn — quét theo đường đi để viên nhanh không xuyên cột 1 tile.
      const from = {
        x: bullet.position.x - bullet.velocity.x * seconds,
        y: bullet.position.y - bullet.velocity.y * seconds,
      };
      if (firstHit({ from, to: bullet.position }, level) !== null) {
        spent.add(bullet.id);
        continue;
      }

      const area = { position: bullet.position, radiusTiles: bullet.radiusTiles };

      if (bullet.owner === 'enemy') {
        if (!hitsCircle(area, { position: player.position, radiusTiles: PLAYER_RADIUS_TILES })) {
          continue;
        }
        spent.add(bullet.id);
        this.damagePlayer(bullet.damage, bullet.position);
        continue;
      }

      let consumed = false;

      // Boss trước (mục tiêu chính của phòng boss), rồi mới tới quái.
      const boss = this.boss;
      if (
        boss !== null &&
        !boss.isDefeated &&
        !bullet.hitIds.includes(BOSS_TARGET_ID) &&
        hitsCircle(area, { position: boss.position, radiusTiles: boss.hitboxRadiusTiles })
      ) {
        const damage = damageAfterExecute(
          stats,
          bullet.damage,
          boss.health / boss.maxHealth,
        );
        boss.takeDamage(damage, this.nowMs);
        this.bossStatus.apply(stats, this.nowMs);
        this.fx?.spawn('fx.impact', bullet.position, {
          tint: new CocosColor(255, 236, 190, 255),
          drawUnits: 1.4,
        });
        playSfx('enemy-hit');
        player.heal(lifestealHeal(stats, damage));
        bullet.hitIds.push(BOSS_TARGET_ID);
        this.explode(bullet, boss.position, null);
        this.hitstop.request();
        consumed = this.resolveBullet(bullet);
        if (consumed) {
          spent.add(bullet.id);
          continue;
        }
      }

      for (const victim of this.enemies) {
        if (victim.isDead || bullet.hitIds.includes(victim.id)) continue;
        if (!hitsCircle(area, { position: victim.position, radiusTiles: victim.radiusTiles })) {
          continue;
        }

        const damage = damageAfterExecute(stats, bullet.damage, victim.health / victim.maxHealth);
        victim.takeDamage(damage, bullet.position, this.nowMs);
        victim.applyStatus(stats, this.nowMs);
        this.fx?.spawn('fx.impact', victim.position, {
          tint: new CocosColor(255, 236, 190, 255),
          drawUnits: 1.4,
        });
        playSfx('enemy-hit');
        player.heal(lifestealHeal(stats, damage));
        bullet.hitIds.push(victim.id);
        this.explode(bullet, victim.position, victim);
        this.hitstop.request();
        consumed = this.resolveBullet(bullet);
        if (consumed) break;
      }

      if (consumed) spent.add(bullet.id);
    }

    if (spent.size > 0) {
      pool.consumeWhere((bullet) => spent.has(bullet.id));
    }
  }

  /** Nổ AoE quanh điểm trúng: damage phụ lên mọi mục tiêu khác trong bán kính. */
  private explode(
    bullet: { readonly explosiveRadiusTiles: number; readonly explosiveDamage: number; readonly hitIds: readonly string[] },
    center: Vec2,
    direct: EnemyView | null,
  ): void {
    if (bullet.explosiveRadiusTiles <= 0 || bullet.explosiveDamage <= 0) return;

    for (const enemy of this.enemies) {
      if (enemy.isDead || enemy === direct || bullet.hitIds.includes(enemy.id)) continue;
      if (distance(center, enemy.position) > bullet.explosiveRadiusTiles) continue;
      enemy.takeDamage(bullet.explosiveDamage, center, this.nowMs);
    }

    const boss = this.boss;
    if (
      boss !== null &&
      !boss.isDefeated &&
      !bullet.hitIds.includes(BOSS_TARGET_ID) &&
      distance(center, boss.position) <= bullet.explosiveRadiusTiles
    ) {
      boss.takeDamage(bullet.explosiveDamage, this.nowMs);
    }

    this.fx?.spawn('fx.explosion', center, {
      drawUnits: Math.max(1.2, bullet.explosiveRadiusTiles * 2),
      lifetimeMs: 820,
    });
    playSfx('explosion');
  }

  /**
   * Sau một lần trúng: Piercing giữ đạn, Ricochet đổi hướng, còn lại thu hồi.
   * Trả `true` khi viên đạn phải bị bỏ.
   */
  private resolveBullet(bullet: {
    pierceRemaining: number;
    ricochetRemaining: number;
    velocity: { x: number; y: number };
    position: Vec2;
    hitIds: string[];
  }): boolean {
    if (bullet.pierceRemaining > 0) {
      bullet.pierceRemaining -= 1;
      return false;
    }

    if (bullet.ricochetRemaining > 0) {
      const candidates: Array<{ id: string; position: Vec2 }> = this.enemies
        .filter((enemy) => !enemy.isDead)
        .map((enemy) => ({ id: enemy.id, position: enemy.position }));
      const boss = this.boss;
      if (boss !== null && !boss.isDefeated) {
        candidates.push({ id: BOSS_TARGET_ID, position: boss.position });
      }

      const next = ricochetTarget(bullet.position, candidates, bullet.hitIds);
      if (next !== null) {
        bullet.ricochetRemaining -= 1;
        const speed = Math.hypot(bullet.velocity.x, bullet.velocity.y);
        const dx = next.position.x - bullet.position.x;
        const dy = next.position.y - bullet.position.y;
        const length = Math.hypot(dx, dy) || 1;
        bullet.velocity.x = (dx / length) * speed;
        bullet.velocity.y = (dy / length) * speed;
        return false;
      }
    }

    return true;
  }

  /** Mục tiêu gần nhất cho Homing: boss hoặc enemy còn sống. */
  private nearestTarget(from: Vec2): Vec2 | null {
    let best: Vec2 | null = null;
    let bestGap = Number.POSITIVE_INFINITY;

    const boss = this.boss;
    if (boss !== null && !boss.isDefeated) {
      best = boss.position;
      bestGap = distance(from, boss.position);
    }
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      const gap = distance(from, enemy.position);
      if (gap < bestGap) {
        best = enemy.position;
        bestGap = gap;
      }
    }
    return best;
  }

  /** Sát thương khi chạm của chaser/tank (i-frame lo phần "không mất 2 tim liên tiếp"). */
  private applyContactDamage(): void {
    const player = this.player;
    const thorns = player.derivedStats.thorns;

    for (const enemy of this.enemies) {
      if (enemy.isDead || !enemy.melee) continue;
      if (distance(enemy.position, player.position) > enemy.contactRangeTiles) continue;

      const heartsBefore = player.hearts;
      this.damagePlayer(enemy.contactDamage, enemy.position);
      // Thorns chỉ nổ khi đòn **thật sự** vào tim, không phải khi khiên chặn/i-frame.
      if (thorns !== undefined && player.hearts < heartsBefore) {
        enemy.takeDamage(thorns.damage, player.position, this.nowMs);
      }
    }
  }

  /** Trả `true` khi tim thật sự giảm (để Thorns không kích hoạt lúc khiên/i-frame). */
  private damagePlayer(amount: number, source: Vec2 | null): boolean {
    if (this.god) return false;
    const before = this.player.hearts;
    this.player.applyDamage(this.nowMs, amount, source);
    return this.player.hearts < before;
  }

  /** Sinh một enemy và gắn node. Boss/debug dùng chung đường này. */
  addEnemy(
    state: EnemyState,
    options: {
      readonly monster?: string;
      readonly radiusTiles?: number;
      readonly contactRangeTiles?: number;
      readonly roleScale?: number;
    } = {},
  ): EnemyView | null {
    const monster = options.monster ?? this.monsterFor(state.role);

    const node = new CocosNodeValue(`${monster}-${state.id}`);
    node.parent = this.actorLayer;

    const sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.TRIMMED;
    sprite.trim = false;

    // 1 texture px = 1/16 unit (xem `ACTOR_SCALE` trong level-view).
    const scale = ACTOR_SCALE;
    node.setScale(scale, scale, 1);

    node.addComponent(SpriteAnimator);
    const enemyView = node.addComponent(EnemyView) as EnemyView;
    enemyView.init({
      state,
      monster,
      level: this.level,
      baseScale: scale,
      radiusTiles: options.radiusTiles,
      contactRangeTiles: options.contactRangeTiles,
      roleScale: options.roleScale,
      ...(this.fx !== null ? { fx: this.fx } : {}),
    });

    this.enemies.push(enemyView);
    return enemyView;
  }

  /** Giết mọi enemy còn sống qua đường damage chuẩn (wave/room clear chạy như chơi thật). */
  killAll(): number {
    let killed = 0;
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      enemy.takeDamage(enemy.health, null, this.nowMs);
      killed += 1;
    }
    const boss = this.boss;
    if (boss !== null && !boss.isDefeated) {
      boss.takeDamage(boss.health, this.nowMs);
      killed += 1;
    }
    // Debug giết hàng loạt vẫn phải trả vàng đúng như chơi thật (M5).
    this.reportDeaths();
    return killed;
  }

  /**
   * Báo chết đúng một lần cho mỗi enemy/boss. Gọi sau mọi đường damage (update,
   * `killAll`, `setBossHealthFraction`) để bootstrap cộng vàng ngay frame đó.
   */
  private reportDeaths(): void {
    for (const enemy of this.enemies) {
      if (!enemy.isDead || this.rewarded.has(enemy.id)) continue;
      this.rewarded.add(enemy.id);
      const role = enemy.role;
      if (role !== null) this.onKill(role, enemy.isElite);
      // Gold sparkle tại chỗ chết (không có đồ nhặt riêng trong run).
      this.fx?.spawn('fx.impact', enemy.position, {
        tint: new CocosColor(255, 214, 90, 255),
        drawUnits: 0.9,
        lifetimeMs: 320,
      });
      playSfx('gold');
    }

    const boss = this.boss;
    if (boss !== null && boss.isDefeated && !this.bossRewarded) {
      this.bossRewarded = true;
      this.onBossKilled();
    }
  }

  /** Debug: spawn một enemy ở vị trí chỉ định (mặc định quanh tâm phòng). */
  spawnDebug(role: EnemyRole, elite: boolean, at?: Vec2): string {
    const maxHealth = maxHealthFor(role, elite, undefined, this.level.chapter);
    const position = at ?? this.defaultSpawnPoint(role);
    const state: EnemyState = {
      id: `debug-${this.debugSeq + 1}`,
      role,
      elite,
      position: { x: position.x, y: position.y },
      health: maxHealth,
      maxHealth,
      action: { kind: 'idle' },
      actionStartedMs: 0,
    };
    this.debugSeq += 1;
    this.addEnemy(state);
    return state.id;
  }

  /**
   * Debug: 8 enemy máu vô hạn + giữ >= 40 đạn enemy trên màn. Player vẫn bị coi
   * là trúng đạn nhưng `godMode` chặn sát thương, để đo fps trong điều kiện xấu nhất.
   */
  startStress(): void {
    this.stress = true;
    this.god = true;
    this.topUpStress();
  }

  stopStress(): void {
    this.stress = false;
  }

  /** Snapshot enemy cho debug hook (không expose object nội bộ). */
  snapshotEnemies(): EnemySnapshot[] {
    return this.enemies.map((enemy) => ({
      id: enemy.id,
      role: enemy.role,
      elite: enemy.isElite,
      health: enemy.health,
      maxHealth: enemy.maxHealth,
      action: enemy.actionKind,
      x: enemy.position.x,
      y: enemy.position.y,
    }));
  }

  /** Số đạn enemy đang sống — debug/acceptance dùng để kiểm "stress giữ 40 viên". */
  enemyBulletCount(): number {
    return this.player.bullets.active().filter((bullet) => bullet.owner === 'enemy').length;
  }

  /** Dọn toàn bộ enemy khỏi scene + xoá đạn. */
  clear(): void {
    for (const enemy of this.enemies) {
      if (enemy.node.isValid) enemy.node.destroy();
    }
    this.enemies.length = 0;
    this.boss?.destroy();
    this.boss = null;
    this.bossStatus.clear();
    this.rewarded.clear();
    this.bossRewarded = false;
    this.player.bullets.clear();
  }

  /** Dọn node + trạng thái; gọi khi rời run. */
  destroy(): void {
    this.clear();
    this.fx?.destroy();
    this.stress = false;
    this.awaitingAdvance = false;
    this.nowMs = 0;
  }

  private topUpStress(): void {
    const player = this.player;

    // Đủ 8 enemy, mỗi con máu vô hạn để không chết vì auto-fire trong lúc đo.
    // Gọi cả đầu và cuối frame: enemy của wave chết giữa frame thì slot được lấp
    // ngay, nên số đo giữa hai frame luôn là 8.
    let alive = this.aliveCount;
    while (alive < STRESS_ENEMY_COUNT) {
      const role = STRESS_ROLES[this.stressIndex % STRESS_ROLES.length] ?? 'chaser';
      this.stressIndex += 1;
      const angle = (this.stressIndex / STRESS_ENEMY_COUNT) * Math.PI * 2;
      const state: EnemyState = {
        id: `stress-${this.debugSeq}`,
        role,
        elite: this.stressIndex % 4 === 0,
        position: {
          x: clamp(player.position.x + Math.cos(angle) * STRESS_RING_RADIUS, 1, this.level.size.cols - 1),
          y: clamp(player.position.y + Math.sin(angle) * STRESS_RING_RADIUS, 1, this.level.size.rows - 1),
        },
        health: STRESS_ENEMY_HEALTH,
        maxHealth: STRESS_ENEMY_HEALTH,
        action: { kind: 'idle' },
        actionStartedMs: 0,
      };
      this.debugSeq += 1;
      this.addEnemy(state);
      alive += 1;
    }

    // Giữ >= 40 đạn enemy: bắn từ vòng ngoài vào player, TTL dài để màn luôn đầy.
    const pool = player.bullets;
    let live = this.enemyBulletCount();
    const angleStep = (Math.PI * 2) / STRESS_ENEMY_BULLETS;
    while (live < STRESS_ENEMY_BULLETS) {
      const angle = this.stressIndex * angleStep;
      this.stressIndex += 1;
      const from = {
        x: player.position.x + Math.cos(angle) * 9,
        y: player.position.y + Math.sin(angle) * 6,
      };
      const dx = player.position.x - from.x;
      const dy = player.position.y - from.y;
      const length = Math.hypot(dx, dy) || 1;
      pool.spawn({
        position: from,
        velocity: {
          x: (dx / length) * STRESS_BULLET_SPEED,
          y: (dy / length) * STRESS_BULLET_SPEED,
        },
        radiusTiles: 0.15,
        damage: 1,
        owner: 'enemy',
        ttlMs: STRESS_BULLET_TTL_MS,
      });
      live += 1;
    }
  }

  private defaultSpawnPoint(role: EnemyRole): Vec2 {
    const offset = role === 'tank' ? 5 : 4;
    return {
      x: clamp(this.player.position.x + offset, 1, this.level.size.cols - 1),
      y: clamp(this.player.position.y - offset, 1, this.level.size.rows - 1),
    };
  }
}

const STRESS_ROLES: readonly EnemyRole[] = ['chaser', 'caster', 'tank'];

function isInsideRoom(level: LevelData, point: Vec2): boolean {
  return point.x >= 0 && point.x <= level.size.cols && point.y >= 0 && point.y <= level.size.rows;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
