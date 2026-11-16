import { describe, expect, it } from 'vitest';
import {
  CHAPTERS_PER_RUN,
  NORMAL_ROOMS_PER_CHAPTER,
  ROOMS_PER_CHAPTER,
  RunState,
} from '../../assets/scripts/core/run/run-state';
import { loadChapterOne } from '../helpers/tmx-levels';

/** Dọn phòng hiện tại rồi sang phòng kế. */
function clearAndAdvance(run: RunState): void {
  run.onRoomCleared();
  run.advanceToNextRoom();
}

describe('RunState — hằng số', () => {
  it('khớp GDD: 3 chapter, mỗi chapter 8 phòng thường + 1 boss', () => {
    expect(CHAPTERS_PER_RUN).toBe(3);
    expect(NORMAL_ROOMS_PER_CHAPTER).toBe(8);
    expect(ROOMS_PER_CHAPTER).toBe(9);
  });
});

describe('RunState — trạng thái ban đầu', () => {
  it('bắt đầu ở chapter được chọn, phòng 1, wave 1', () => {
    const run = new RunState();

    expect(run.chapter).toBe(1);
    expect(run.room).toBe(1);
    expect(run.wave).toBe(1);
    expect(run.isBossRoom).toBe(false);
    expect(run.status).toBe('playing');
  });

  it('nhận chapter bắt đầu hợp lệ', () => {
    expect(new RunState(2).chapter).toBe(2);
    expect(new RunState(3).chapter).toBe(3);
  });

  it('từ chối chapter ngoài 1..3', () => {
    expect(() => new RunState(0)).toThrow(/1\.\.3/);
    expect(() => new RunState(4)).toThrow(/1\.\.3/);
    expect(() => new RunState(1.5)).toThrow(/1\.\.3/);
  });
});

describe('RunState — đi hết run', () => {
  it('đi từ chapter 1 phòng 1 qua boss tới chapter 2', () => {
    const run = new RunState();

    for (let room = 1; room <= NORMAL_ROOMS_PER_CHAPTER; room += 1) {
      expect(run.room).toBe(room);
      expect(run.isBossRoom).toBe(false);

      clearAndAdvance(run);

      expect(run.status).toBe('playing');
      expect(run.room).toBe(room + 1);
    }

    // Phòng 9 là boss.
    expect(run.isBossRoom).toBe(true);
    expect(run.roomLabel).toBe('9/9');

    clearAndAdvance(run);

    expect(run.chapter).toBe(2);
    expect(run.room).toBe(1);
    expect(run.isBossRoom).toBe(false);
    expect(run.status).toBe('playing');
  });

  it('thắng sau khi dọn boss chapter cuối', () => {
    const run = new RunState();

    while (run.status === 'playing' || run.status === 'room-cleared') {
      if (run.status === 'playing') {
        run.onRoomCleared();
      } else {
        run.advanceToNextRoom();
      }
    }

    expect(run.status).toBe('won');
    expect(run.chapter).toBe(CHAPTERS_PER_RUN);
    expect(run.room).toBe(ROOMS_PER_CHAPTER);
    expect(run.progress).toBe(1);
  });

  it('boss chapter 2 sang chapter 3 chứ không kết thúc run', () => {
    const run = new RunState(2);

    for (let room = 1; room <= ROOMS_PER_CHAPTER; room += 1) {
      clearAndAdvance(run);
    }

    expect(run.status).toBe('playing');
    expect(run.chapter).toBe(3);
    expect(run.room).toBe(1);
  });
});

describe('RunState — phòng sạch và wave', () => {
  it('onRoomCleared chỉ đổi trạng thái, không tự sang phòng kế', () => {
    const run = new RunState();

    run.onRoomCleared();

    expect(run.status).toBe('room-cleared');
    expect(run.room).toBe(1);
  });

  it('sang phòng mới thì wave về 1', () => {
    const run = new RunState(2);

    run.nextWave(2);
    expect(run.wave).toBe(2);

    clearAndAdvance(run);

    expect(run.room).toBe(2);
    expect(run.wave).toBe(1);
  });
});

/**
 * Số wave là dữ liệu của phòng (GDD §8), nên test lấy phòng 1 của chapter 1
 * thật (3 wave) thay vì khẳng định "chapter 1 có 1 wave" như trước.
 */
describe('RunState — wave theo dữ liệu level', () => {
  const [roomOne] = loadChapterOne().rooms;

  if (roomOne === undefined) throw new Error('chapter 1 (.tmx) thiếu phòng 1');

  it('phòng 1 có 3 wave trong level data', () => {
    expect(roomOne.waves.length).toBe(3);
  });

  it('phòng 3 wave đi hết state machine: 1 → 2 → 3, không sớm hơn không muộn hơn', () => {
    const run = new RunState();
    const totalWaves = roomOne.waves.length;

    expect(run.wave).toBe(1);

    run.nextWave(totalWaves);
    expect(run.wave).toBe(2);

    run.nextWave(totalWaves);
    expect(run.wave).toBe(3);

    // Hết wave cuối: không được sang wave 4.
    expect(() => run.nextWave(totalWaves)).toThrow(/3 wave/);
    expect(run.wave).toBe(3);

    // Dọn phòng sau wave cuối rồi sang phòng kế: wave reset về 1.
    run.onRoomCleared();
    run.advanceToNextRoom();
    expect(run.room).toBe(2);
    expect(run.wave).toBe(1);
  });

  it('cùng state machine chạy được phòng 1 wave (boss) và phòng 2 wave', () => {
    for (const totalWaves of [1, 2, 5]) {
      const run = new RunState();
      for (let wave = 1; wave < totalWaves; wave += 1) run.nextWave(totalWaves);
      expect(run.wave).toBe(totalWaves);
      expect(() => run.nextWave(totalWaves)).toThrow();
    }
  });
});

describe('RunState — nhãn và tiến trình', () => {
  it('roomLabel có dạng "phòng/tổng"', () => {
    const run = new RunState();

    expect(run.roomLabel).toBe('1/9');

    run.onRoomCleared();
    run.advanceToNextRoom();
    run.onRoomCleared();
    run.advanceToNextRoom();

    expect(run.roomLabel).toBe('3/9');
  });

  it('progress tăng theo phòng đã dọn', () => {
    const run = new RunState();

    expect(run.progress).toBe(0);

    run.onRoomCleared();
    expect(run.progress).toBeCloseTo(1 / 27, 10);

    run.advanceToNextRoom();
    expect(run.progress).toBeCloseTo(1 / 27, 10);

    run.onRoomCleared();
    expect(run.progress).toBeCloseTo(2 / 27, 10);
  });

  it('run thua giữ nguyên tiến trình đã đạt', () => {
    const run = new RunState();
    clearAndAdvance(run);
    clearAndAdvance(run);

    run.markLost();

    expect(run.status).toBe('lost');
    expect(run.progress).toBeCloseTo(2 / 27, 10);
  });
});

describe('RunState — tổng phòng lấy từ dữ liệu', () => {
  it('nhận tổng phòng khác 9 (thêm room-10.tmx là x/10)', () => {
    const run = new RunState(1, 10);

    expect(run.roomsTotal).toBe(10);
    expect(run.roomLabel).toBe('1/10');

    for (let room = 1; room <= 10; room += 1) {
      expect(run.room).toBe(room);
      expect(run.isBossRoom).toBe(room === 10);
      if (room < 10) clearAndAdvance(run);
    }

    expect(run.roomLabel).toBe('10/10');
  });

  it('progress dùng tổng phòng của chapter', () => {
    const run = new RunState(1, 10);

    run.onRoomCleared();

    expect(run.progress).toBeCloseTo(1 / (CHAPTERS_PER_RUN * 10), 10);
  });

  it('từ chối tổng phòng không hợp lệ', () => {
    expect(() => new RunState(1, 0)).toThrow(/số nguyên >= 1/);
    expect(() => new RunState(1, 2.5)).toThrow(/số nguyên >= 1/);
    expect(() => new RunState(1, Number.NaN)).toThrow(/số nguyên >= 1/);
  });
});

describe('RunState — markWon (chapter chơi như một run riêng)', () => {
  it('dọn boss rồi markWon → won, giữ nguyên phòng', () => {
    const run = new RunState(1);
    for (let room = 1; room <= ROOMS_PER_CHAPTER; room += 1) {
      if (room < ROOMS_PER_CHAPTER) {
        clearAndAdvance(run);
      } else {
        run.onRoomCleared();
      }
    }

    expect(run.isBossRoom).toBe(true);
    run.markWon();

    expect(run.status).toBe('won');
    expect(run.chapter).toBe(1);
    expect(run.room).toBe(ROOMS_PER_CHAPTER);
    // progress tính trên cả 3 chapter của run (GDD §1), nên xong chapter 1 = 1/3.
    expect(run.progress).toBeCloseTo(1 / 3, 10);
  });

  it('markWon từ trạng thái playing cũng hợp lệ', () => {
    const run = new RunState(1);

    run.markWon();

    expect(run.status).toBe('won');
  });

  it('không markWon hai lần, không markLost sau markWon', () => {
    const run = new RunState(1);
    run.markWon();

    expect(() => run.markWon()).toThrow(/won/);
    expect(() => run.markLost()).toThrow(/won/);
    expect(() => run.advanceToNextRoom()).toThrow(/won/);
  });
});

describe('RunState — chuyển trạng thái sai đều ném lỗi', () => {
  it('không sang phòng kế khi phòng chưa dọn', () => {
    const run = new RunState();

    expect(() => run.advanceToNextRoom()).toThrow(/dọn phòng/);
    expect(run.room).toBe(1);
  });

  it('không dọn phòng hai lần', () => {
    const run = new RunState();
    run.onRoomCleared();

    expect(() => run.onRoomCleared()).toThrow(/room-cleared/);
  });

  it('không sang phòng kế sau khi đã thắng', () => {
    const run = new RunState(3);
    for (let room = 1; room <= ROOMS_PER_CHAPTER; room += 1) {
      clearAndAdvance(run);
    }
    expect(run.status).toBe('won');

    expect(() => run.advanceToNextRoom()).toThrow(/won/);
  });

  it('không sang phòng kế sau khi đã thua', () => {
    const run = new RunState();
    run.markLost();

    expect(() => run.advanceToNextRoom()).toThrow(/lost/);
  });

  it('không dọn phòng sau khi đã thua', () => {
    const run = new RunState();
    run.markLost();

    expect(() => run.onRoomCleared()).toThrow(/lost/);
  });

  it('không đánh dấu thua hai lần', () => {
    const run = new RunState();
    run.markLost();

    expect(() => run.markLost()).toThrow(/lost/);
  });

  it('không đánh dấu thua sau khi đã thắng', () => {
    const run = new RunState(3);
    for (let room = 1; room <= ROOMS_PER_CHAPTER; room += 1) {
      clearAndAdvance(run);
    }

    expect(() => run.markLost()).toThrow(/won/);
  });

  it('không sang wave khi phòng đã dọn', () => {
    const run = new RunState(2);
    run.onRoomCleared();

    expect(() => run.nextWave(1)).toThrow(/room-cleared/);
  });

  it('không sang wave vượt số wave của phòng', () => {
    const run = new RunState(1);

    expect(() => run.nextWave(1)).toThrow(/1 wave/);

    const run3 = new RunState(2);
    run3.nextWave(2);
    expect(() => run3.nextWave(2)).toThrow(/2 wave/);
  });

  it('từ chối tổng số wave không hợp lệ thay vì đoán', () => {
    const run = new RunState();

    expect(() => run.nextWave(0)).toThrow(/số nguyên >= 1/);
    expect(() => run.nextWave(1.5)).toThrow(/số nguyên >= 1/);
    expect(() => run.nextWave(Number.NaN)).toThrow(/số nguyên >= 1/);
    expect(run.wave).toBe(1);
  });
});
