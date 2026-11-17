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
import { Node as CocosNodeValue, Sprite as CocosSprite } from 'cc';
import type { AnimationManifest } from '../core/art/manifest';
import { firstHit, hitsCircle } from '../core/combat/bullets';
import { fireEnemyVolley } from '../core/combat/enemy-fire';
import { segmentHitsCircle } from '../core/combat/hitbox';
import { HitstopClock } from '../core/combat/hitstop';
import type { Targetable } from '../core/combat/targeting';
import { DEFAULT_COMBAT } from '../core/config';
import type { EnemyState } from '../core/enemies/behaviours';
import { maxHealthFor } from '../core/enemies/behaviours';
import { eliteVolleyAngles } from '../core/enemies/elite';
import { spawnWave } from '../core/enemies/waves';
import type { EnemyRole, LevelData } from '../core/level/level-data';
import { distance, type Vec2 } from '../core/math/vec2';
import { SpriteAnimator } from './anim/sprite-animator';
import type { BulletView } from './bullet-view';
import { EnemyView } from './enemy-view';
import { ACTOR_SCALE } from './level-view';
import type { PlayerController } from './player-controller';

/** `cc` là module any: tên import chỉ dùng được ở vị trí value. */
type Node = InstanceType<typeof CocosNodeValue>;

/** Bán kính player khi xét đạn enemy / cú lao, tile — cùng quy ước sim. */
export const PLAYER_RADIUS_TILES = 0.25;

/** Số enemy và số đạn enemy mà `stress()` duy trì. */
export const STRESS_ENEMY_COUNT = 8;
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
  private readonly hitstop = new HitstopClock(DEFAULT_COMBAT.enemyHitstopMs);
  private readonly enemies: EnemyView[] = [];
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

    player.step(this.nowMs, deltaMs, targets, level);
    this.stepEnemies(deltaMs);
    this.stepBullets(deltaMs, level);
    this.applyContactDamage();

    this.bulletView?.sync();
    if (this.stress) this.topUpStress();

    if (player.isDead) this.playerDied = true;

    const cleared = this.enemies.every((enemy) => enemy.isDead);
    if (cleared) this.awaitingAdvance = true;

    return { frozen: false, playerDied: this.playerDied, cleared };
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
   * hai viên trong 0.8 s); đạn player trừ máu enemy và **xin hitstop**
   * (`enemyHitstopMs`) — hitstop chỉ xảy ra khi đòn của người chơi trúng.
   */
  private stepBullets(deltaMs: number, level: LevelData): void {
    const player = this.player;
    const pool = player.bullets;
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

      const victim = this.enemies.find(
        (enemy) =>
          !enemy.isDead &&
          hitsCircle(area, { position: enemy.position, radiusTiles: enemy.radiusTiles }),
      );
      if (victim === undefined) continue;

      spent.add(bullet.id);
      victim.takeDamage(bullet.damage, bullet.position, this.nowMs);
      this.hitstop.request();
    }

    if (spent.size > 0) {
      pool.consumeWhere((bullet) => spent.has(bullet.id));
    }
  }

  /** Sát thương khi chạm của chaser/tank (i-frame lo phần "không mất 2 tim liên tiếp"). */
  private applyContactDamage(): void {
    const player = this.player;

    for (const enemy of this.enemies) {
      if (enemy.isDead || !enemy.melee) continue;
      if (distance(enemy.position, player.position) > enemy.contactRangeTiles) continue;
      this.damagePlayer(enemy.contactDamage, enemy.position);
    }
  }

  private damagePlayer(amount: number, source: Vec2 | null): void {
    if (this.god) return;
    this.player.applyDamage(this.nowMs, amount, source);
  }

  /** Sinh một enemy và gắn node. Boss/debug dùng chung đường này. */
  addEnemy(
    state: EnemyState,
    options: {
      readonly monster?: string;
      readonly walkKey?: string;
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
      walkKey: options.walkKey,
      radiusTiles: options.radiusTiles,
      contactRangeTiles: options.contactRangeTiles,
      roleScale: options.roleScale,
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
    return killed;
  }

  /** Debug: spawn một enemy ở vị trí chỉ định (mặc định quanh tâm phòng). */
  spawnDebug(role: EnemyRole, elite: boolean, at?: Vec2): string {
    const maxHealth = maxHealthFor(role, elite);
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
    this.player.bullets.clear();
  }

  /** Dọn node + trạng thái; gọi khi rời run. */
  destroy(): void {
    this.clear();
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
