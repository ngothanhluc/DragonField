import { describe, expect, it } from 'vitest';
import {
  CHAPTERS_PER_RUN,
  NORMAL_ROOMS_PER_CHAPTER,
  ROOMS_PER_CHAPTER,
  RunState,
} from '../../assets/scripts/core/run/run-state';

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

    run.nextWave();
    expect(run.wave).toBe(2);

    clearAndAdvance(run);

    expect(run.room).toBe(2);
    expect(run.wave).toBe(1);
  });

  it('chapter 1 có 1 wave, chapter sau có 2, boss có 1', () => {
    expect(new RunState(1).wavesInRoom).toBe(1);
    expect(new RunState(2).wavesInRoom).toBe(2);
    expect(new RunState(3).wavesInRoom).toBe(2);

    const boss = new RunState(2);
    for (let room = 1; room < ROOMS_PER_CHAPTER; room += 1) {
      clearAndAdvance(boss);
    }
    expect(boss.isBossRoom).toBe(true);
    expect(boss.wavesInRoom).toBe(1);
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

    expect(() => run.nextWave()).toThrow(/room-cleared/);
  });

  it('không sang wave vượt số wave của phòng', () => {
    const run = new RunState(1);

    expect(() => run.nextWave()).toThrow(/1 wave/);

    const run2 = new RunState(2);
    run2.nextWave();
    expect(() => run2.nextWave()).toThrow(/2 wave/);
  });
});
