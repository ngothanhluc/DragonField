/** Số chapter của một run (GDD §1). */
export const CHAPTERS_PER_RUN = 3;
/** Số phòng thường mỗi chapter, trước phòng boss. */
export const NORMAL_ROOMS_PER_CHAPTER = 8;
/** Tổng số phòng mỗi chapter, tính cả boss. */
export const ROOMS_PER_CHAPTER = NORMAL_ROOMS_PER_CHAPTER + 1;

export type RunStatus = 'playing' | 'room-cleared' | 'won' | 'lost';

/**
 * Tiến trình một run: chapter nào, phòng nào, wave nào.
 *
 * Lớp này **không** biết một phòng có bao nhiêu wave (GDD §8: số wave là dữ
 * liệu của phòng, không phải của chapter) — caller truyền tổng số wave vào
 * `nextWave()`.
 *
 * Tổng số phòng của chapter là **dữ liệu** (`roomsInChapter`, lấy từ số file
 * `.tmx`), không phải hằng số: thêm `room-10.tmx` là run tự biết `10/10`. Hằng
 * `ROOMS_PER_CHAPTER` chỉ còn là mặc định khi caller không có dữ liệu (test,
 * simulation).
 *
 * Trạng thái chuyển theo đúng thứ tự: playing -> room-cleared -> playing (phòng kế)
 * hoặc -> won sau boss cuối. Mọi chuyển sai ném lỗi để bug lộ ra ngay ở test,
 * thay vì âm thầm đẩy run vào trạng thái không hợp lệ.
 */
export class RunState {
  private currentChapter: number;
  private currentRoom = 1;
  private currentWave = 1;
  private currentStatus: RunStatus = 'playing';
  private readonly roomsInChapter: number;

  constructor(chapter = 1, roomsInChapter: number = ROOMS_PER_CHAPTER) {
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS_PER_RUN) {
      throw new Error(
        `Chapter phải là số nguyên trong khoảng 1..${CHAPTERS_PER_RUN}, nhận ${chapter}`,
      );
    }
    if (!Number.isInteger(roomsInChapter) || roomsInChapter < 1) {
      throw new Error(
        `Số phòng của chapter phải là số nguyên >= 1, nhận ${roomsInChapter}`,
      );
    }
    this.currentChapter = chapter;
    this.roomsInChapter = roomsInChapter;
  }

  get chapter(): number {
    return this.currentChapter;
  }

  /** Phòng hiện tại, 1-based. Phòng `roomsTotal` là boss. */
  get room(): number {
    return this.currentRoom;
  }

  /** Tổng số phòng của chapter hiện tại — suy ra từ dữ liệu level, không hardcode. */
  get roomsTotal(): number {
    return this.roomsInChapter;
  }

  get isBossRoom(): boolean {
    return this.currentRoom === this.roomsInChapter;
  }

  get wave(): number {
    return this.currentWave;
  }

  get status(): RunStatus {
    return this.currentStatus;
  }

  /** Nhãn HUD, ví dụ "3/9". */
  get roomLabel(): string {
    return `${this.currentRoom}/${this.roomsInChapter}`;
  }

  /** Tỉ lệ phòng đã dọn trên toàn run, 0..1. */
  get progress(): number {
    const clearedInChapter = this.currentRoom - 1;
    const cleared =
      (this.currentChapter - 1) * this.roomsInChapter +
      clearedInChapter +
      (this.currentStatus === 'room-cleared' || this.currentStatus === 'won' ? 1 : 0);
    return Math.min(1, cleared / (CHAPTERS_PER_RUN * this.roomsInChapter));
  }

  /** Đánh dấu phòng sạch. Không tự sang phòng kế — caller chọn skill trước. */
  onRoomCleared(): void {
    if (this.currentStatus !== 'playing') {
      throw new Error(
        `Không thể dọn phòng khi run đang ở trạng thái '${this.currentStatus}' (phòng ${this.roomLabel})`,
      );
    }
    this.currentStatus = 'room-cleared';
  }

  /** Sang phòng kế; boss cuối chapter thì sang chapter mới; boss cuối run thì thắng. */
  advanceToNextRoom(): void {
    if (this.currentStatus !== 'room-cleared') {
      throw new Error(
        `Chỉ được sang phòng kế sau khi dọn phòng, trạng thái hiện tại là '${this.currentStatus}' (phòng ${this.roomLabel})`,
      );
    }

    if (this.isBossRoom) {
      if (this.currentChapter === CHAPTERS_PER_RUN) {
        this.currentStatus = 'won';
        return;
      }
      this.currentChapter += 1;
      this.currentRoom = 1;
    } else {
      this.currentRoom += 1;
    }

    this.currentWave = 1;
    this.currentStatus = 'playing';
  }

  /**
   * Sang wave kế trong cùng phòng.
   *
   * Tổng số wave là **dữ liệu của phòng** (GDD §8: object `spawn` có property `wave`
   * trong `assets/resources/data/levels/chapter-<n>/*.tmx`),
   * nên caller phải truyền vào — thường là `level.waves.length`. `RunState` chỉ
   * giữ wave hiện tại, không suy ra số wave từ chapter hay loại phòng; nhờ vậy
   * phòng 3 wave và phòng 1 wave dùng chung một state machine.
   */
  nextWave(wavesInRoom: number): void {
    if (!Number.isInteger(wavesInRoom) || wavesInRoom < 1) {
      throw new Error(`Số wave của phòng phải là số nguyên >= 1, nhận ${wavesInRoom}`);
    }
    if (this.currentStatus !== 'playing') {
      throw new Error(
        `Không thể sang wave khi run đang ở trạng thái '${this.currentStatus}' (phòng ${this.roomLabel})`,
      );
    }
    if (this.currentWave >= wavesInRoom) {
      throw new Error(
        `Phòng ${this.roomLabel} chỉ có ${wavesInRoom} wave, không thể sang wave ${this.currentWave + 1}`,
      );
    }
    this.currentWave += 1;
  }

  markLost(): void {
    if (this.currentStatus === 'won' || this.currentStatus === 'lost') {
      throw new Error(
        `Không thể đánh dấu thua khi run đang ở trạng thái '${this.currentStatus}' (phòng ${this.roomLabel})`,
      );
    }
    this.currentStatus = 'lost';
  }

  /**
   * Kết thúc run với thắng lợi.
   *
   * Dùng khi một chapter được chơi như **một run riêng** (chapter select của M2):
   * dọn boss là hết run, không tự nhảy sang chapter kế như `advanceToNextRoom`.
   */
  markWon(): void {
    if (this.currentStatus === 'won' || this.currentStatus === 'lost') {
      throw new Error(
        `Không thể đánh dấu thắng khi run đang ở trạng thái '${this.currentStatus}' (phòng ${this.roomLabel})`,
      );
    }
    this.currentStatus = 'won';
  }
}
