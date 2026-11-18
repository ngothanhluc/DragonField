/**
 * Điều hướng màn hình M5: title, chapter select, shop, settings, credits,
 * pause, result. Tách khỏi `bootstrap.ts` để run-flow không phình theo UI.
 *
 * File này không sở hữu run/combat. Nó nhận một `ScreenFlowHost` hẹp:
 * UI canvas, save/repository, trạng thái run (`status`, snapshot) và các hành
 * động run (start/launch/teardown). Nhờ vậy mọi màn vẫn dựng bằng code trong
 * `screens/`, còn bootstrap chỉ còn boot + vòng chạy + render.
 *
 * Mọi chữ hiển thị trong game là tiếng Anh (console log có thể giữ tiếng Việt).
 */
import type { Node as CocosNode } from 'cc';
import { chapterGate } from '../core/save/chapter-gate';
import { applyGold, MAX_GOLD, summariseRun } from '../core/run/rewards';
import { applySettings, toPlainSettings } from '../core/save/settings';
import type { Settings } from '../core/save/settings';
import type { SaveData } from '../core/save/save-data';
import type { SaveRepository } from '../core/save/storage';
import { buy, canBuy, UPGRADE_TRACKS } from '../core/meta/upgrades';
import type { UpgradeTrack } from '../core/meta/upgrades';
import type { DebugScreenId, DebugStatus } from './debug-api';
import type { MusicId } from './audio/audio-manager';
import { commitRunEnd } from './run-end';
import { buildChapterSelect, type ChapterButton } from './chapter-select';
import { buildCreditsScreen } from './screens/credits-screen';
import { buildPauseScreen } from './screens/pause-screen';
import { buildResultScreen, type RunResultData } from './screens/result-screen';
import { buildSettingsScreen } from './screens/settings-screen';
import { buildShopScreen } from './screens/shop-screen';
import { buildTitleScreen } from './screens/title-screen';

type Node = InstanceType<typeof CocosNode>;

/** Một lần chụp run trước khi teardown; đủ để dựng result và cộng vàng. */
export interface RunSnapshot {
  readonly chapter: number;
  readonly room: number;
  readonly roomsTotal: number;
  readonly durationMs: number;
  readonly goldEarned: number;
  readonly kills: number;
}

export interface ScreenFlowHost {
  /** UI canvas (tạo lazily bởi bootstrap). */
  uiRoot(): Node;
  save(): SaveData | null;
  repository(): SaveRepository | null;
  setSave(save: SaveData): void;
  status(): DebugStatus;
  setStatus(status: DebugStatus): void;
  /** Chapter có dữ liệu level trong build này. */
  chapterAvailable(chapter: number): boolean;
  /** Bắt đầu run từ chapter select (có gate/status guard ở bootstrap). */
  startChapter(chapter: number): void;
  /** Chụp run hiện tại; `null` khi không ở trong run. */
  runSnapshot(): RunSnapshot | null;
  launchChapter(chapter: number): Promise<void>;
  teardownRun(): void;
  /** Nhạc nền theo màn; `null` = dừng (result/pause không đổi). */
  setMusic(id: MusicId | null): void;
  /** Master volume áp ngay sau khi save settings đổi. */
  setVolume(volume: number): void;
  /** Cờ accessibility (rung, số damage) áp ngay lên run đang chơi. */
  applyFeelSettings(settings: Settings): void;
  fail(error: unknown): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ScreenFlow {
  private menu: { readonly node: Node; destroy(): void } | null = null;
  private token = 0;
  private currentScreen: DebugScreenId = 'title';
  private settingsBack: (() => void) | null = null;
  private shopBack: (() => void) | null = null;

  constructor(private readonly host: ScreenFlowHost) {
    document.addEventListener('keydown', this.onKey, true);
  }

  /** Esc/P trong run mở pause. Capture phase để không lệ thuộc focus canvas. */
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.repeat || this.host.status() !== 'playing') return;
    const key = event.key;
    const pause =
      key === 'Escape' || key === 'p' || key === 'P' || event.keyCode === 27 || event.keyCode === 80;
    if (!pause) return;
    event.preventDefault();
    void this.showPause().catch((error: unknown) => this.host.fail(error));
  };

  /** Gỡ listener + màn hiện tại khi Bootstrap bị destroy. */
  destroy(): void {
    document.removeEventListener('keydown', this.onKey, true);
    this.clearMenu();
  }

  get screenId(): DebugScreenId {
    return this.currentScreen;
  }

  /** bootstrap báo màn đang chạy (playing/skill-pick) — không đổi status. */
  setScreen(id: DebugScreenId): void {
    this.currentScreen = id;
  }

  /** Huỷ màn đang mở (dùng trước khi vào run hoặc khi destroy component). */
  clearMenu(): void {
    this.menu?.destroy();
    this.menu = null;
  }

  private nextMenuToken(): number {
    this.token += 1;
    this.clearMenu();
    return this.token;
  }

  async showTitle(): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: chưa load save');

    const token = this.nextMenuToken();
    const built = await buildTitleScreen({
      parent: this.host.uiRoot(),
      gold: save.gold,
      best: save.best,
      onPlay: () => {
        void this.showChapterSelect().catch((error: unknown) => this.host.fail(error));
      },
      onShop: () => {
        void this.showShop(() => {
          void this.showTitle().catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onSettings: () => {
        void this.showSettings(() => {
          void this.showTitle().catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onCredits: () => {
        void this.showCredits(() => {
          void this.showTitle().catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'title';
    this.host.setStatus('menu');
    this.host.setMusic('title');
    console.log(`[YokaiField] Title: gold ${save.gold}, unlocked ${save.chaptersUnlocked}/3.`);
  }

  async showChapterSelect(): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: chưa load save');

    const token = this.nextMenuToken();
    const chapters: ChapterButton[] = [];
    for (let chapter = 1; chapter <= 3; chapter += 1) {
      const hasData = this.host.chapterAvailable(chapter);
      chapters.push({
        chapter,
        hasData,
        playable: chapterGate(save, chapter, hasData).allowed,
      });
    }

    const built = await buildChapterSelect(this.host.uiRoot(), {
      chapters,
      best: save.best,
      onSelect: (chapter) => this.host.startChapter(chapter),
      onBack: () => {
        void this.showTitle().catch((error: unknown) => this.host.fail(error));
      },
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'chapter-select';
    this.host.setStatus('menu');
    this.host.setMusic('title');
    console.log(
      `[YokaiField] Chapter select: best chapter ${save.best.chapter} · room ${save.best.room}, ` +
        `unlocked ${save.chaptersUnlocked}/3.`,
    );
  }

  /** Kết thúc run: cộng vàng/unlock một lần, dọn run, mở result. */
  finishRun(won: boolean): void {
    const run = this.host.runSnapshot();
    if (run === null) return;

    const roomsCleared = won ? run.roomsTotal : Math.max(0, run.room - 1);
    const summary = summariseRun({
      roomsCleared,
      kills: run.kills,
      goldEarned: run.goldEarned,
      durationMs: run.durationMs,
      status: won ? 'won' : 'lost',
    });

    const save = this.host.save();
    const repo = this.host.repository();
    let goldTotal = save?.gold ?? 0;
    let unlockedChapter: number | undefined;

    if (save !== null && repo !== null) {
      try {
        const commit = commitRunEnd(save, repo, {
          chapter: run.chapter,
          goldEarned: run.goldEarned,
          won,
        });
        this.host.setSave(commit.save);
        goldTotal = commit.gold;
        if (commit.unlocked) {
          unlockedChapter = run.chapter + 1;
          console.log(
            `[YokaiField] Chapter ${run.chapter} clear → mở chapter ${commit.chaptersUnlocked}.`,
          );
        }
      } catch (error: unknown) {
        console.warn(`[YokaiField] Không ghi được kết quả run: ${errorMessage(error)}`);
      }
    }

    const data: RunResultData = {
      chapter: run.chapter,
      roomReached: run.room,
      roomsTotal: run.roomsTotal,
      goldEarned: run.goldEarned,
      goldTotal,
      durationMs: summary.durationMs,
      kills: run.kills,
      won,
      ...(unlockedChapter !== undefined ? { unlockedChapter } : {}),
    };

    console.log(
      `[YokaiField] ${won ? 'RUN WON' : 'RUN LOST'}: chapter ${data.chapter} · ` +
        `phòng ${data.roomReached}/${data.roomsTotal} · +${data.goldEarned} vàng ` +
        `(tổng ${data.goldTotal}) · ${summary.durationSeconds}s · ${data.kills} kill.`,
    );

    this.currentScreen = 'result';
    this.host.setStatus(won ? 'won' : 'lost');
    this.host.teardownRun();
    void this.showResult(data).catch((error: unknown) => this.host.fail(error));
  }

  private async showResult(data: RunResultData): Promise<void> {
    const token = this.nextMenuToken();
    const current: RunResultData = {
      ...data,
      goldTotal: this.host.save()?.gold ?? data.goldTotal,
    };

    const built = await buildResultScreen({
      parent: this.host.uiRoot(),
      result: current,
      onShop: () => {
        void this.showShop(() => {
          void this.showResult(current).catch((error: unknown) => this.host.fail(error));
        }).catch((error: unknown) => this.host.fail(error));
      },
      onChapterSelect: () => {
        void this.returnToChapterSelect().catch((error: unknown) => this.host.fail(error));
      },
      onTitle: () => {
        void this.showTitle().catch((error: unknown) => this.host.fail(error));
      },
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'result';
    this.host.setStatus(data.won ? 'won' : 'lost');
    this.host.setMusic(null);
  }

  private async showShop(backTo: () => void, initialFocus = 0): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: chưa load save');

    this.shopBack = backTo;
    const token = this.nextMenuToken();
    const built = await buildShopScreen({
      parent: this.host.uiRoot(),
      save,
      initialFocus,
      onBack: backTo,
      onBuy: (track) => {
        if (this.tryBuy(track) === null) return;
        // Dựng lại để giá/level/vàng đúng; giữ focus ở đúng track vừa mua.
        void this.showShop(backTo, UPGRADE_TRACKS.indexOf(track)).catch((error: unknown) =>
          this.host.fail(error),
        );
      },
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'shop';
    this.host.setStatus('menu');
    this.host.setMusic('title');
  }

  /** Mua một cấp; `null` khi thiếu vàng/track max/save lỗi. Luật nằm ở core. */
  private tryBuy(track: UpgradeTrack): SaveData | null {
    const save = this.host.save();
    const repo = this.host.repository();
    if (save === null || repo === null) return null;

    if (!canBuy(save, track, save.gold)) {
      console.warn(`[YokaiField] Không mua được '${track}': thiếu vàng hoặc đã max.`);
      return null;
    }

    try {
      const result = buy({ upgrades: save.upgrades }, track, save.gold);
      const next: SaveData = { ...save, gold: result.gold, upgrades: result.state.upgrades };
      repo.save(next);
      this.host.setSave(next);
      console.log(`[YokaiField] Mua '${track}' lên cấp ${next.upgrades[track]}, còn ${next.gold} vàng.`);
      return next;
    } catch (error: unknown) {
      console.warn(`[YokaiField] Mua upgrade thất bại: ${errorMessage(error)}`);
      return null;
    }
  }

  private async showSettings(backTo: () => void): Promise<void> {
    const save = this.host.save();
    if (save === null) throw new Error('ScreenFlow: chưa load save');

    this.settingsBack = backTo;
    const token = this.nextMenuToken();
    const built = await buildSettingsScreen({
      parent: this.host.uiRoot(),
      settings: save.settings,
      onVolume: (volume) => this.persistSettings({ ...this.currentSettings(save.settings), volume }),
      onToggleFullscreen: () => {
        void this.toggleFullscreen().catch((error: unknown) => this.host.fail(error));
      },
      onToggleScreenShake: () => {
        const current = this.currentSettings(save.settings);
        this.persistSettings({ ...current, screenShake: !current.screenShake });
      },
      onToggleDamageNumbers: () => {
        const current = this.currentSettings(save.settings);
        this.persistSettings({ ...current, damageNumbers: !current.damageNumbers });
      },
      onBack: backTo,
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'settings';
    this.host.setStatus('menu');
    this.host.setMusic('title');
  }

  private async showCredits(backTo: () => void): Promise<void> {
    const token = this.nextMenuToken();
    const built = await buildCreditsScreen({ parent: this.host.uiRoot(), onBack: backTo });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'credits';
    this.host.setStatus('menu');
    this.host.setMusic('title');
  }

  async showPause(): Promise<void> {
    if (this.host.status() !== 'playing') return;

    // Đặt status trước khi dựng: update() dừng ngay, nên sim clock/enemy/đạn/
    // telegraph/shield/i-frame đều đứng yên trong lúc màn pause load texture.
    this.host.setStatus('paused');
    this.currentScreen = 'paused';

    const save = this.host.save();
    const token = this.nextMenuToken();
    const built = await buildPauseScreen({
      parent: this.host.uiRoot(),
      volume: save?.settings.volume ?? 0.8,
      onResume: () => this.resumeRun(),
      onRestart: () => {
        void this.restartRun().catch((error: unknown) => this.host.fail(error));
      },
      onQuit: () => {
        void this.quitToTitle().catch((error: unknown) => this.host.fail(error));
      },
      onVolume: (volume) => this.persistVolume(volume),
    });

    if (token !== this.token) {
      built.destroy();
      return;
    }
    this.menu = built;
    this.currentScreen = 'paused';
  }

  private resumeRun(): void {
    if (this.host.status() !== 'paused') return;
    this.clearMenu();
    this.host.setStatus('playing');
    this.currentScreen = 'playing';
    console.log('[YokaiField] Resume.');
  }

  /** Restart: giữ vàng đã kiếm, bắt đầu run mới cùng chapter. */
  private async restartRun(): Promise<void> {
    const chapter = this.host.runSnapshot()?.chapter ?? 1;
    this.bankRunGold();
    this.clearMenu();
    this.host.teardownRun();
    this.host.setStatus('loading');
    await this.host.launchChapter(chapter);
    console.log(`[YokaiField] Restart chapter ${chapter}.`);
  }

  private async quitToTitle(): Promise<void> {
    this.bankRunGold();
    this.clearMenu();
    this.host.teardownRun();
    this.host.setStatus('loading');
    await this.showTitle();
    console.log('[YokaiField] Quit to title.');
  }

  private async returnToChapterSelect(): Promise<void> {
    this.clearMenu();
    this.host.teardownRun();
    this.host.setStatus('loading');
    await this.showChapterSelect();
  }

  /** Thoát/restart giữa run vẫn giữ vàng (GDD §7: vàng nhặt được là của người chơi). */
  private bankRunGold(): void {
    const save = this.host.save();
    const repo = this.host.repository();
    const goldEarned = this.host.runSnapshot()?.goldEarned ?? 0;
    if (save === null || repo === null || goldEarned <= 0) return;

    try {
      const next = applyGold(save, goldEarned).save;
      repo.save(next);
      this.host.setSave(next);
      console.log(`[YokaiField] Giữ ${goldEarned} vàng khi rời run (tổng ${next.gold}).`);
    } catch (error: unknown) {
      console.warn(`[YokaiField] Không ghi được vàng khi rời run: ${errorMessage(error)}`);
    }
  }

  private persistVolume(volume: number): void {
    const save = this.host.save();
    if (save === null) return;
    this.persistSettings({ ...save.settings, volume });
  }

  /**
   * Settings mới nhất từ save sống, không phải bản chụp lúc mở màn — bấm hai
   * công tắc liên tiếp không được ghi đè lẫn nhau.
   */
  private currentSettings(fallback: Settings): Settings {
    return this.host.save()?.settings ?? fallback;
  }

  private persistSettings(settings: Settings): void {
    const save = this.host.save();
    const repo = this.host.repository();
    if (save === null || repo === null) return;

    const normalized = toPlainSettings(applySettings(settings));
    if (
      normalized.volume === save.settings.volume &&
      normalized.fullscreen === save.settings.fullscreen &&
      normalized.screenShake === save.settings.screenShake &&
      normalized.damageNumbers === save.settings.damageNumbers
    ) {
      return;
    }

    try {
      const next: SaveData = { ...save, settings: normalized };
      repo.save(next);
      this.host.setSave(next);
      if (normalized.volume !== save.settings.volume) this.host.setVolume(normalized.volume);
      this.host.applyFeelSettings(normalized);
    } catch (error: unknown) {
      console.warn(`[YokaiField] Không ghi được settings: ${errorMessage(error)}`);
    }
  }

  /** Fullscreen thật qua DOM; headless/không hỗ trợ thì giữ nguyên + cảnh báo. */
  private async toggleFullscreen(): Promise<void> {
    const save = this.host.save();
    if (save === null) return;
    const wanted = !save.settings.fullscreen;

    try {
      if (wanted) {
        await document.documentElement.requestFullscreen?.();
      } else if (document.fullscreenElement !== null) {
        await document.exitFullscreen?.();
      }
    } catch (error: unknown) {
      console.warn(`[YokaiField] Fullscreen không đổi được: ${errorMessage(error)}`);
    }

    this.syncFullscreen();
  }

  /** Lưu trạng thái fullscreen thật và vẽ lại nhãn nếu đang ở màn Settings. */
  syncFullscreen(): void {
    const save = this.host.save();
    if (save === null) return;

    const actual = document.fullscreenElement !== null;
    if (save.settings.fullscreen !== actual) {
      this.persistSettings({ ...save.settings, fullscreen: actual });
    }

    if (this.currentScreen === 'settings') {
      const back = this.settingsBack ?? (() => {
        void this.showTitle().catch((error: unknown) => this.host.fail(error));
      });
      void this.showSettings(back).catch((error: unknown) => this.host.fail(error));
    }
  }

  /** Debug-only: đặt vàng (test shop). */
  setGold(gold: number): boolean {
    if (!Number.isInteger(gold) || gold < 0) {
      console.warn(`[YokaiField] debug setGold bỏ qua: cần số nguyên >= 0, nhận ${gold}`);
      return false;
    }
    const save = this.host.save();
    const repo = this.host.repository();
    if (save === null || repo === null) return false;

    try {
      const next: SaveData = { ...save, gold: Math.min(gold, MAX_GOLD) };
      repo.save(next);
      this.host.setSave(next);
      console.log(`[YokaiField] debug setGold → ${next.gold}.`);
      // Shop đang mở thì vẽ lại để giá/nút disabled khớp vàng mới.
      if (this.currentScreen === 'shop') {
        const back = this.shopBack ?? (() => {
          void this.showTitle().catch((error: unknown) => this.host.fail(error));
        });
        void this.showShop(back).catch((error: unknown) => this.host.fail(error));
      }
      return true;
    } catch (error: unknown) {
      console.warn(`[YokaiField] debug setGold không ghi được save: ${errorMessage(error)}`);
      return false;
    }
  }
}
