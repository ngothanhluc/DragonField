/**
 * Số liệu tune balance đã validate, dùng trong game.
 *
 * Nguồn duy nhất là `game/config/tuning.json` — **ngoài `assets/`**, nên Cocos
 * không coi nó là asset và không đụng vào lúc bundle script. Từ JSON đó,
 * `scripts/gen-tuning.ts` sinh ra `tuning.generated.ts` (một module TS thường),
 * và file này chỉ import module đó:
 *
 * ```text
 * config/tuning.json  --bun run gen-->  core/enemies/tuning.generated.ts
 *                                              |
 *                                              v
 *                                        core/enemies/tuning.ts
 * ```
 *
 * Vì sao không import JSON trực tiếp: mọi thứ dưới `assets/` là nội dung của
 * asset DB, và ta không kiểm chứng được bằng CLI rằng import JSON có sống sót
 * qua bước bundle script của editor hay không. Module TS thì chắc chắn sống.
 *
 * AGENTS rule 3 — "số liệu tune nằm ngoài code, không hardcode". Đổi balance =
 * sửa `config/tuning.json` rồi chạy `bun run gen`; `bun run check:config` chặn
 * file generated lệch khỏi JSON.
 *
 * `parseTuning()` vẫn chạy ở đây như lớp phòng thủ: generated hỏng thì ném lỗi
 * ngay lúc load, thay vì lặng lẽ `undefined` → `NaN` → enemy 0 máu. Luật validate
 * nằm ở `tuning-schema.ts`, dùng chung với script generate.
 *
 * Không import `cc`, không đọc file, không dùng thời gian — `core/` thuần.
 * Test muốn thử một bộ số khác thì gọi `parseTuning(structuredClone(…))` với
 * bản copy, không sửa object đã export.
 */
import { TUNING_DATA } from './tuning.generated';
import {
  parseTuning,
  type CombatTuning,
  type EnemiesTuning,
  type FeelTuning,
  type TuningConfig,
} from './tuning-schema';

export * from './tuning-schema';

/**
 * Object thô sinh từ `config/tuning.json`, giữ lại để test đối chiếu
 * "số trong code = số trong JSON".
 */
export const TUNING_SOURCE: unknown = TUNING_DATA;

/** Toàn bộ số tune đã validate. */
export const TUNING: TuningConfig = parseTuning(TUNING_SOURCE);

/** Số liệu combat của player — `config.ts` suy ra `DEFAULT_COMBAT` từ đây. */
export const COMBAT_TUNING: CombatTuning = TUNING.combat;

/** Số liệu enemy — `behaviours.ts`, `waves.ts` và sim đọc từ đây. */
export const ENEMY_TUNING: EnemiesTuning = TUNING.enemies;

/** Hệ số scale theo chapter — `behaviours.ts` đọc khi tính máu/sát thương. */
export const CHAPTER_TUNING = TUNING.chapters;

/** Số liệu juice (ticket #2) — adapter `game/` đọc, `core/feel/` chỉ nhận số qua tham số. */
export const FEEL_TUNING: FeelTuning = TUNING.feel;
