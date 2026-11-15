/**
 * Điểm vào duy nhất của scene: gắn component này lên **một** node là game chạy.
 *
 * Dựng toàn bộ bằng code (không prefab, không sửa `.scene` — quy tắc 5 trong AGENTS.md):
 * camera → player → room → đạn → HUD → wave. Thứ tự load cố định:
 *
 * ```text
 * animations.json (validate) ─┐
 * chapter-1.json (validate)  ─┼─> preload sheet ─> room + player + HUD ─> wave 1
 * ```
 *
 * Lỗi ở bất kỳ bước nào cũng hiện **một** khối chữ trên màn hình kèm path resources
 * (`resources/data/animations`, `art/monsters/blue-bat/SpriteSheet/texture`…), vì lỗi
 * import art là lỗi hay gặp nhất khi mở project lần đầu.
 *
 * Vòng chạy nằm trong `update()` và gọi tuần tự player → enemy → đạn → va chạm, đúng thứ
 * tự `core/sim/run-simulation.ts`, để hành vi trong engine khớp với thứ đã được đo
 * balance ở sim.
 */
import {
  _decorator,
  Camera as CocosCamera,
  Canvas as CocosCanvas,
  Color as CocosColor,
  Component,
  JsonAsset as CocosJsonAsset,
  Label as CocosLabel,
  Layers,
  Node as CocosNode,
  Sprite as CocosSprite,
  UITransform as CocosUITransform,
  director,
  resources,
  view,
} from 'cc';
import { resolve, validateManifest } from '../core/art/manifest';
import type { AnimationManifest } from '../core/art/manifest';
import { firstHit, hitsCircle } from '../core/combat/bullets';
import type { Targetable } from '../core/combat/targeting';
import { DEFAULT_COMBAT } from '../core/config';
import type { EnemyState } from '../core/enemies/behaviours';
import { nextWaveIndex, spawnWave } from '../core/enemies/waves';
import { ROOM_COLS, ROOM_ROWS, parseChapterData } from '../core/level/level-data';
import type { ChapterData, EnemyRole, LevelData } from '../core/level/level-data';
import { distance } from '../core/math/vec2';
import type { Vec2 } from '../core/math/vec2';
import { RunState } from '../core/run/run-state';
import { SpriteAnimator } from './anim/sprite-animator';
import { preloadSheets } from './assets/texture-cache';
import { BulletView, ENEMY_BULLET_SHEET, PLAYER_BULLET_SHEET } from './bullet-view';
import { EnemyView } from './enemy-view';
import { Hud, HEART_SHEET, createLabel } from './hud';
import { ACTOR_SCALE, FLOOR_SHEET, OBSTACLE_SHEET, buildRoom } from './level-view';
import { PlayerController } from './player-controller';

const { ccclass } = _decorator;

/** `cc` là module any trong repo: type phải suy ra từ import value (xem `texture-cache.ts`). */
type Camera = InstanceType<typeof CocosCamera>;
type Canvas = InstanceType<typeof CocosCanvas>;
type JsonAsset = InstanceType<typeof CocosJsonAsset>;
type Node = InstanceType<typeof CocosNode>;
type Sprite = InstanceType<typeof CocosSprite>;
type UITransform = InstanceType<typeof CocosUITransform>;

/** Đường dẫn resources (không có `resources/`, không có `.json`). */
const MANIFEST_PATH = 'data/animations';
const CHAPTER_PATH = 'data/levels/chapter-1';

/** Bán kính va chạm enemy, tile — cùng quy ước với `run-simulation.ts`. */
const ENEMY_RADIUS_TILES = 0.4;

/**
 * Trần thời gian một frame. Tab bị ẩn vài giây rồi quay lại sẽ có `dt` rất lớn; kẹp lại
 * để enemy không nhảy xuyên phòng và i-frame không bị "ăn" hết trong một frame.
 */
const MAX_STEP_MS = 50;

/** Camera world: `orthoHeight = 9` và đứng ở tâm phòng (16, 9). */
const CAMERA_ORTHO_HEIGHT = ROOM_ROWS / 2;
const ROOM_CENTER: Vec2 = { x: ROOM_COLS / 2, y: ROOM_ROWS / 2 };

/**
 * Monster theo vai trò của từng chapter (GDD §4). Key phải khớp manifest — không có
 * gạch nối (`bluebat`, không phải `blue-bat`).
 */
const MONSTERS_BY_CHAPTER: Readonly<Record<number, Readonly<Record<EnemyRole, string>>>> = {
  1: { chaser: 'bluebat', caster: 'eye', tank: 'bear' },
  2: { chaser: 'spiderred', caster: 'greenoctopus', tank: 'trex' },
  3: { chaser: 'snake3', caster: 'lanternred', tank: 'cyclope' },
};

/** Animation player cần có sheet sẵn trước frame đầu (`roll` chưa dùng ở M1). */
const PLAYER_KEYS = [
  'player.idle.down',
  'player.walk.down',
  'player.attack.down',
  'player.hit.down',
  'player.dead',
] as const;

/** Trạng thái của bootstrap — không phải trạng thái của `RunState`. */
type BootstrapStatus = 'loading' | 'playing' | 'lost' | 'won' | 'boss-pending' | 'error';

@ccclass('Bootstrap')
export class Bootstrap extends Component {
  private manifest: AnimationManifest | null = null;
  private chapter: ChapterData | null = null;
  private run: RunState | null = null;

  /**
   * Ba lớp con của node `world`, tạo đúng một lần theo thứ tự vẽ: sàn → actor → đạn.
   * Tách lớp thay vì nhét tất cả vào `worldRoot` để đổi phòng (huỷ + dựng lại room) không
   * làm sàn mới bị vẽ đè lên player/enemy.
   */
  private roomLayer: Node | null = null;
  private actorLayer: Node | null = null;
  private bulletLayer: Node | null = null;
  private roomRoot: Node | null = null;
  private uiRoot: Node | null = null;

  private player: PlayerController | null = null;
  private bulletView: BulletView | null = null;
  private hud: Hud | null = null;

  private enemies: EnemyView[] = [];
  private currentLevel: LevelData | null = null;
  private waveIndex = 0;
  private nowMs = 0;
  private status: BootstrapStatus = 'loading';

  start(): void {
    void this.boot().catch((error: unknown) => {
      this.fail(error);
    });
  }

  update(deltaTime: number): void {
    if (this.status !== 'playing') return;

    const player = this.player;
    const level = this.currentLevel;
    if (player === null || level === null) return;

    const deltaMs = Math.min(Math.max(deltaTime, 0) * 1000, MAX_STEP_MS);
    this.nowMs += deltaMs;

    const targets: Targetable[] = this.enemies
      .filter((enemy) => !enemy.isDead)
      .map((enemy) => ({
        id: enemy.id,
        position: enemy.position,
        alive: true,
      }));

    player.step(this.nowMs, deltaMs, targets);
    for (const enemy of this.enemies) {
      if (enemy.isDead) continue;
      enemy.step(this.nowMs, deltaMs, player.position);
    }

    this.stepBullets(deltaMs, level);
    this.applyContactDamage();

    this.bulletView?.sync();
    this.hud?.setHearts(player.hearts);

    if (player.isDead) {
      this.finishLoss();
      return;
    }
    if (this.enemies.every((enemy) => enemy.isDead)) {
      this.onWaveCleared();
    }
  }

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  private async boot(): Promise<void> {
    const manifest = await this.loadManifest();
    const chapter = await this.loadChapter();

    this.manifest = manifest;
    this.chapter = chapter;
    this.run = new RunState(chapter.chapter);

    this.prepareCamera();

    this.createWorldLayers();

    // Preload **trước** khi dựng gì: mọi lỗi art/JSON nổi ở một chỗ, với path đầy đủ.
    await preloadSheets(this.collectSheets(manifest, chapter));

    const firstRoom = this.levelFor(1);
    if (firstRoom === null) {
      throw new Error(`"resources/${CHAPTER_PATH}.json" không có phòng 1`);
    }

    const player = this.createPlayer(firstRoom.playerStart);
    this.createRoom(firstRoom);

    await this.createBullets(player);
    await this.createHud();

    this.status = 'playing';
    this.startWave(0);
    console.log(
      `[YokaiField] Chapter ${chapter.chapter}: ${chapter.rooms.length} phòng. ` +
        `Bắt đầu phòng ${this.run?.roomLabel ?? '?'} (${firstRoom.waves.length} wave).`,
    );
  }

  private loadManifest(): Promise<AnimationManifest> {
    return this.loadJson(MANIFEST_PATH).then((json) => {
      try {
        return validateManifest(json);
      } catch (error: unknown) {
        throw new Error(`"resources/${MANIFEST_PATH}.json" không hợp lệ: ${errorMessage(error)}`);
      }
    });
  }

  private loadChapter(): Promise<ChapterData> {
    return this.loadJson(CHAPTER_PATH).then((json) => {
      try {
        return parseChapterData(json);
      } catch (error: unknown) {
        throw new Error(`"resources/${CHAPTER_PATH}.json" không hợp lệ: ${errorMessage(error)}`);
      }
    });
  }

  /**
   * `resources.load` với type tường minh, gói thành Promise và **nêu path** trong lỗi —
   * path là thứ duy nhất giúp phân biệt "quên import" với "sai schema".
   */
  private loadJson(path: string): Promise<unknown> {
    return new Promise<unknown>((onLoad, onFail) => {
      resources.load(path, CocosJsonAsset, (error: Error | null, asset: JsonAsset | null) => {
        if (error !== null || asset === null) {
          const cause = error === null ? 'asset trả về rỗng' : error.message;
          onFail(new Error(`Không load được "resources/${path}.json". Nguyên nhân: ${cause}`));
          return;
        }
        onLoad(asset.json);
      });
    });
  }

  /**
   * Gom sheet cần preload: animation player, walk của mọi monster chapter này dùng, cộng
   * sheet sàn/vật cản/đạn/tim. Preload một lần để frame đầu không có sprite trắng.
   */
  private collectSheets(manifest: AnimationManifest, chapter: ChapterData): string[] {
    const sheets = new Set<string>();

    for (const key of PLAYER_KEYS) {
      sheets.add(resolve(manifest, key).sheet);
    }

    for (const room of chapter.rooms) {
      for (const wave of room.waves) {
        for (const spawn of wave.enemies) {
          const monster = this.monsterFor(room.chapter, spawn.role);
          sheets.add(resolve(manifest, `${monster}.walk.down`).sheet);
        }
      }
    }

    sheets.add(FLOOR_SHEET);
    sheets.add(OBSTACLE_SHEET);
    sheets.add(PLAYER_BULLET_SHEET);
    sheets.add(ENEMY_BULLET_SHEET);
    sheets.add(HEART_SHEET);

    return [...sheets];
  }

  /**
   * Camera world: ép đúng world convention (ortho, `orthoHeight = 9`, đứng ở tâm phòng).
   * Làm trong code để scene dựng tay sai thông số vẫn chạy đúng; scene không có camera thì
   * báo lỗi rõ ràng thay vì màn hình đen.
   */
  private prepareCamera(): void {
    const scene = director.getScene();
    const camera: Camera | null = scene === null ? null : scene.getComponentInChildren(CocosCamera);
    if (camera === null) {
      throw new Error(
        'Scene không có Camera. Tạo scene 2D có Main Camera rồi gắn Bootstrap (xem docs/editor-setup.md).',
      );
    }

    camera.projection = CocosCamera.ProjectionType.ORTHO;
    camera.orthoHeight = CAMERA_ORTHO_HEIGHT;
    const node = camera.node;
    node.setPosition(ROOM_CENTER.x, ROOM_CENTER.y, node.position.z);
  }

  /** world → room/actor/bullet, thứ tự này là thứ tự vẽ của Cocos 2D. */
  private createWorldLayers(): void {
    const worldRoot = new CocosNode('world');
    worldRoot.parent = this.node;

    this.roomLayer = this.addLayer('room-layer', worldRoot);
    this.actorLayer = this.addLayer('actor-layer', worldRoot);
    this.bulletLayer = this.addLayer('bullet-layer', worldRoot);
  }

  private addLayer(name: string, parent: Node): Node {
    const node = new CocosNode(name);
    node.parent = parent;
    return node;
  }

  /** Dựng room mới và thay room cũ (node cũ `destroy()` là engine dọn hết con). */
  private createRoom(level: LevelData): void {
    const manifest = this.manifest;
    const roomLayer = this.roomLayer;
    if (manifest === null || roomLayer === null) return;

    this.roomRoot?.destroy();
    this.roomRoot = buildRoom(roomLayer, level, manifest, FLOOR_SHEET, OBSTACLE_SHEET);
    this.currentLevel = level;
    this.waveIndex = 0;
  }

  private createPlayer(startAt: Vec2): PlayerController {
    const manifest = this.manifest;
    const actorLayer = this.actorLayer;
    if (manifest === null || actorLayer === null) {
      throw new Error('Bootstrap: chưa có manifest/actor-layer — không dựng được player');
    }

    const node = new CocosNode('player');
    node.parent = actorLayer;

    const sprite: Sprite = node.addComponent(CocosSprite);
    // TRIMMED: node size = đúng frame, nên đổi sheet (Dead.png cao 64 px) không bị kéo giãn.
    sprite.sizeMode = CocosSprite.SizeMode.TRIMMED;
    sprite.trim = false;

    // 1 texture px = 1/16 unit. Player frame 32 px → 2 unit, art thật ~1 tile.
    const scale = ACTOR_SCALE;
    node.setScale(scale, scale, 1);

    node.addComponent(SpriteAnimator);
    const player: PlayerController = node.addComponent(PlayerController);
    player.init({ manifest, startAt });

    this.player = player;
    return player;
  }

  private async createBullets(player: PlayerController): Promise<void> {
    const node = new CocosNode('bullets');
    node.parent = this.bulletLayer ?? this.node;

    const bulletView: BulletView = node.addComponent(BulletView);
    await bulletView.init(player.bullets);
    this.bulletView = bulletView;
  }

  private async createHud(): Promise<void> {
    const run = this.run;
    if (run === null) return;

    const canvas = this.ensureUiRoot();
    const node = new CocosNode('hud');
    node.layer = Layers.Enum.UI_2D;
    node.parent = canvas;

    const hud: Hud = node.addComponent(Hud);
    await hud.init(this.player?.maxHearts ?? DEFAULT_COMBAT.playerMaxHearts, run.roomLabel);
    this.hud = hud;
  }

  /**
   * Canvas + camera UI riêng, tạo bằng code.
   *
   * Camera world mặc định **không thấy layer `UI_2D`** (`CAMERA_DEFAULT_MASK` loại nó ra),
   * nên HUD cần camera riêng với `visibility = UI_2D`. Canvas neo camera đó vào tâm màn
   * hình và tự set `orthoHeight` theo design resolution.
   */
  private ensureUiRoot(): Node {
    const existing = this.uiRoot;
    if (existing !== null && existing.isValid) return existing;

    const canvasNode = new CocosNode('ui-canvas');
    canvasNode.layer = Layers.Enum.UI_2D;
    canvasNode.parent = this.node;

    const canvas: Canvas = canvasNode.addComponent(CocosCanvas);

    const cameraNode = new CocosNode('ui-camera');
    cameraNode.layer = Layers.Enum.UI_2D;
    cameraNode.parent = canvasNode;
    cameraNode.setPosition(0, 0, 1000);

    const camera: Camera = cameraNode.addComponent(CocosCamera);
    camera.projection = CocosCamera.ProjectionType.ORTHO;
    // World camera đã vẽ nền; UI camera chỉ vẽ chồng lên, không xoá màu.
    camera.clearFlags = CocosCamera.ClearFlag.DEPTH_ONLY;
    camera.visibility = Layers.Enum.UI_2D;
    camera.priority = 1;
    camera.near = 1;
    // Canvas đặt camera ở z = 1000 nên `far` phải > 1000 mới không cắt mất HUD.
    camera.far = 2000;

    canvas.cameraComponent = camera;

    this.uiRoot = canvasNode;
    return canvasNode;
  }

  // -------------------------------------------------------------------------
  // Vòng chạy
  // -------------------------------------------------------------------------

  private stepBullets(deltaMs: number, level: LevelData): void {
    const player = this.player;
    if (player === null) return;

    const bullets = player.bullets;
    bullets.update(deltaMs);
    bullets.consumeWhere((bullet) => !isInsideRoom(level, bullet.position));

    const spent = new Set<number>();
    const seconds = deltaMs / 1000;

    for (const bullet of bullets.active()) {
      if (bullet.owner !== 'player') continue;

      // Vật cản chặn đạn (GDD §8: dùng để né đạn) — quét theo đường đi để viên nhanh
      // không xuyên qua cột 1 tile.
      const from = {
        x: bullet.position.x - bullet.velocity.x * seconds,
        y: bullet.position.y - bullet.velocity.y * seconds,
      };
      if (firstHit({ from, to: bullet.position }, level) !== null) {
        spent.add(bullet.id);
        continue;
      }

      const area = {
        position: bullet.position,
        radiusTiles: bullet.radiusTiles,
      };
      const victim = this.enemies.find(
        (enemy) =>
          !enemy.isDead &&
          hitsCircle(area, {
            position: enemy.position,
            radiusTiles: ENEMY_RADIUS_TILES,
          }),
      );
      if (victim === undefined) continue;

      spent.add(bullet.id);
      victim.takeDamage(bullet.damage);
    }

    if (spent.size > 0) {
      bullets.consumeWhere((bullet) => spent.has(bullet.id));
    }
  }

  /**
   * Sát thương khi chạm: chaser/tank đứng trong tầm chạm là gây damage; i-frame của
   * `HealthState` lo phần "không mất 2 tim trong 0.8 s".
   *
   * TODO(enemy-bullets): caster hiện chỉ telegraph rồi thôi, chưa bắn. Khi nối thì sinh
   * đạn `owner: 'enemy'` vào cùng pool rồi xử lý va chạm với player ở đây — xem
   * `core/sim/run-simulation.ts` (`spawnEnemyShot`).
   */
  private applyContactDamage(): void {
    const player = this.player;
    if (player === null) return;

    for (const enemy of this.enemies) {
      if (enemy.isDead || !enemy.melee) continue;
      if (distance(enemy.position, player.position) > enemy.contactRangeTiles) continue;
      player.applyDamage(this.nowMs, enemy.contactDamage);
    }
  }

  private onWaveCleared(): void {
    const run = this.run;
    const level = this.currentLevel;
    if (run === null || level === null) return;

    const nextWave = nextWaveIndex(this.waveIndex, level);
    if (nextWave !== null) {
      run.nextWave(level.waves.length);
      this.startWave(nextWave);
      return;
    }

    run.onRoomCleared();
    console.log(`[YokaiField] Phòng ${level.room} sạch.`);
    run.advanceToNextRoom();
    this.enterRoom(run.room);
  }

  private enterRoom(roomNumber: number): void {
    const run = this.run;
    if (run === null) return;

    const level = this.levelFor(roomNumber);
    if (level === null) {
      this.finishWin();
      return;
    }

    this.clearEnemies();
    this.player?.bullets.clear();

    this.createRoom(level);
    this.player?.teleport(level.playerStart);
    this.hud?.setRoomLabel(run.roomLabel);

    if (level.isBossRoom) {
      this.reachBossRoom(level);
      return;
    }

    this.startWave(0);
    console.log(`[YokaiField] Vào phòng ${run.roomLabel} (${level.waves.length} wave).`);
  }

  /**
   * Phòng boss: dựng arena nhưng **không** chạy boss. Đây là chỗ duy nhất phải thay khi
   * làm milestone boss.
   *
   * TODO(boss): `core/sim/boss-run.ts` là bản mẫu đầy đủ của cách lái boss — mỗi frame gọi
   * `stepBoss({ state, nowMs, deltaMs, player, rng })`, đọc `events` để sinh đạn (`shoot`),
   * gọi quái (`summon`), đổi animation (`play-animation`), rồi áp `state` trả về. Arena đã
   * sẵn (`level.isBossRoom`, 4 cột), chỉ thiếu một `BossView` làm đúng các bước đó.
   */
  private reachBossRoom(level: LevelData): void {
    this.status = 'boss-pending';
    const bossName = level.boss?.name ?? 'chưa khai báo';
    // "Kết quả" của run tính tới đây: đã dọn 8 phòng, còn bao nhiêu tim, mất bao lâu.
    // Màn kết quả thật (vàng, thời gian, nút về meta shop — GDD §9) chưa làm.
    const hearts = this.player?.hearts ?? 0;
    const seconds = (this.nowMs / 1000).toFixed(1);
    console.log(
      `[YokaiField] Tới phòng boss ${level.room} (${bossName}) sau ${seconds}s, còn ${hearts} tim. ` +
        'Boss chưa nối — dừng run ở đây.',
    );
    console.log(
      '[YokaiField] TODO(boss): nối core/sim/boss-run.ts (stepBoss + events) để chạy pattern GDD §5.',
    );
  }

  private startWave(index: number): void {
    const level = this.currentLevel;
    if (level === null) return;

    this.waveIndex = index;
    for (const state of spawnWave(level, index)) {
      this.addEnemy(level, state);
    }
  }

  private addEnemy(level: LevelData, state: EnemyState): void {
    const manifest = this.manifest;
    const actorLayer = this.actorLayer;
    if (manifest === null || actorLayer === null) return;

    const monster = this.monsterFor(level.chapter, state.role);

    const node = new CocosNode(`${monster}-${state.id}`);
    node.parent = actorLayer;

    const sprite: Sprite = node.addComponent(CocosSprite);
    sprite.sizeMode = CocosSprite.SizeMode.TRIMMED;
    sprite.trim = false;

    const scale = ACTOR_SCALE;
    node.setScale(scale, scale, 1);

    node.addComponent(SpriteAnimator);
    const enemyView: EnemyView = node.addComponent(EnemyView);
    enemyView.init({ state, monster, level, baseScale: scale });

    this.enemies.push(enemyView);
  }

  private clearEnemies(): void {
    for (const enemy of this.enemies) {
      if (enemy.node.isValid) enemy.node.destroy();
    }
    this.enemies = [];
  }

  private finishLoss(): void {
    const run = this.run;
    if (run === null) return;

    this.status = 'lost';
    run.markLost();
    console.log(
      `[YokaiField] Thua ở phòng ${run.roomLabel} (0 tim). Run kết thúc — màn kết quả chưa nối.`,
    );
  }

  private finishWin(): void {
    this.status = 'won';
    console.log('[YokaiField] Hết phòng của chapter — thắng chapter (màn kết quả chưa làm).');
  }

  // -------------------------------------------------------------------------
  // Lỗi
  // -------------------------------------------------------------------------

  /** Hiện lỗi lên màn hình **và** console, sau đó dừng vòng chạy. */
  private fail(error: unknown): void {
    this.status = 'error';
    const message = errorMessage(error);
    console.error(`[YokaiField] Bootstrap thất bại: ${message}`);

    try {
      const canvas = this.ensureUiRoot();
      const label = createLabel(canvas, 'load-error', `LOAD FAILED\n${message}`);
      label.fontSize = 13;
      label.lineHeight = 17;
      label.color = new CocosColor(255, 96, 96, 255);
      label.enableWrapText = true;
      // RESIZE_HEIGHT + bề rộng cố định = xuống dòng theo màn hình thay vì tràn ra ngoài.
      label.overflow = CocosLabel.Overflow.RESIZE_HEIGHT;

      const transform: UITransform | null = label.node.getComponent(CocosUITransform);
      if (transform !== null) {
        transform.setContentSize(view.getVisibleSize().width - 16, 80);
      }
      label.node.setPosition(0, 0, 0);
    } catch (nested: unknown) {
      console.error(`[YokaiField] Không dựng được màn hình lỗi: ${errorMessage(nested)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Truy vấn dữ liệu
  // -------------------------------------------------------------------------

  private levelFor(roomNumber: number): LevelData | null {
    const chapter = this.chapter;
    if (chapter === null) return null;

    for (const room of chapter.rooms) {
      if (room.room === roomNumber) return room;
    }
    return null;
  }

  private monsterFor(chapter: number, role: EnemyRole): string {
    const byRole = MONSTERS_BY_CHAPTER[chapter];
    const monster = byRole?.[role];
    if (monster === undefined) {
      throw new Error(
        `Chapter ${chapter} chưa map monster cho role "${role}" (xem MONSTERS_BY_CHAPTER)`,
      );
    }
    return monster;
  }
}

function isInsideRoom(level: LevelData, point: Vec2): boolean {
  return point.x >= 0 && point.x <= level.size.cols && point.y >= 0 && point.y <= level.size.rows;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
