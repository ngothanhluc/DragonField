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
 * Trạng thái chuyển theo đúng thứ tự: playing -> room-cleared -> playing (phòng kế)
 * hoặc -> won sau boss cuối. Mọi chuyển sai ném lỗi để bug lộ ra ngay ở test,
 * thay vì âm thầm đẩy run vào trạng thái không hợp lệ.
 */
export class RunState {
  private currentChapter: number;
  private currentRoom = 1;
  private currentWave = 1;
  private currentStatus: RunStatus = 'playing';

  constructor(chapter = 1) {
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS_PER_RUN) {
      throw new Error(
        `Chapter phải là số nguyên trong khoảng 1..${CHAPTERS_PER_RUN}, nhận ${chapter}`,
      );
    }
    this.currentChapter = chapter;
  }

  get chapter(): number {
    return this.currentChapter;
  }

  /** Phòng hiện tại, 1-based. Phòng ROOMS_PER_CHAPTER là boss. */
  get room(): number {
    return this.currentRoom;
  }

  get isBossRoom(): boolean {
    return this.currentRoom === ROOMS_PER_CHAPTER;
  }

  get wave(): number {
    return this.currentWave;
  }

  get status(): RunStatus {
    return this.currentStatus;
  }

  /** Chapter 1 có 1 wave/phòng; chapter sau có 2. Boss là 1 wave. */
  get wavesInRoom(): number {
    if (this.isBossRoom) return 1;
    return this.currentChapter === 1 ? 1 : 2;
  }

  /** Nhãn HUD, ví dụ "3/9". */
  get roomLabel(): string {
    return `${this.currentRoom}/${ROOMS_PER_CHAPTER}`;
  }

  /** Tỉ lệ phòng đã dọn trên toàn run, 0..1. */
  get progress(): number {
    const clearedInChapter = this.currentRoom - 1;
    const cleared =
      (this.currentChapter - 1) * ROOMS_PER_CHAPTER +
      clearedInChapter +
      (this.currentStatus === 'room-cleared' || this.currentStatus === 'won' ? 1 : 0);
    return Math.min(1, cleared / (CHAPTERS_PER_RUN * ROOMS_PER_CHAPTER));
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

  /** Sang wave kế trong cùng phòng. */
  nextWave(): void {
    if (this.currentStatus !== 'playing') {
      throw new Error(
        `Không thể sang wave khi run đang ở trạng thái '${this.currentStatus}' (phòng ${this.roomLabel})`,
      );
    }
    if (this.currentWave >= this.wavesInRoom) {
      throw new Error(
        `Phòng ${this.roomLabel} chỉ có ${this.wavesInRoom} wave, không thể sang wave ${this.currentWave + 1}`,
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
}
