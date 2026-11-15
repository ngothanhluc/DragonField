/**
 * Sinh `assets/scripts/core/enemies/tuning.generated.ts` từ `config/tuning.json`.
 *
 * Chạy bằng bun:
 *
 * ```bash
 * bun run gen           # sinh lại file generated
 * bun run check:config  # chỉ kiểm tra, exit 1 nếu file lệch hoặc thiếu
 * ```
 *
 * Vì sao có script này: `config/tuning.json` nằm **ngoài `assets/`** để Cocos
 * không coi số liệu tune là asset — import JSON từ trong `assets/` có thể không
 * sống sót qua bước bundle script của editor, và ta không có cách kiểm chứng
 * bằng CLI. Thay vào đó, JSON được biên dịch sẵn thành một module TS thường
 * (`tuning.generated.ts`), thứ chắc chắn được bundle như mọi script khác.
 *
 * Script chỉ đọc/ghi file và gọi `parseTuning()` — **không** giữ bản sao luật
 * validate, để JSON hợp lệ lúc generate là JSON hợp lệ lúc runtime.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTuning,
  type TuningConfig,
} from '../assets/scripts/core/enemies/tuning-schema';

/** Repo path của nguồn và đích, dùng cho thông báo lỗi dễ đọc. */
const CONFIG_RELATIVE_PATH = 'config/tuning.json';
const OUTPUT_RELATIVE_PATH = 'assets/scripts/core/enemies/tuning.generated.ts';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG_PATH = join(PROJECT_ROOT, CONFIG_RELATIVE_PATH);
const OUTPUT_PATH = join(PROJECT_ROOT, OUTPUT_RELATIVE_PATH);

const HEADER =
  '// AUTO-GENERATED from game/config/tuning.json — do not edit. Run: bun run gen';
const NOTE = [
  '//',
  '// Số liệu balance đã validate từ `config/tuning.json`. Sửa JSON rồi chạy `bun run gen`;',
  '// `bun run check:config` chặn file này lệch khỏi nguồn.',
].join('\n');

/** Đọc + validate JSON nguồn. Ném lỗi đã đủ ngữ cảnh từ `parseTuning`. */
function readTuning(): TuningConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    throw new Error(
      `không đọc được ${CONFIG_RELATIVE_PATH}: ${(error as Error).message}`,
    );
  }
  return parseTuning(raw);
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * In một object thành literal TS, giữ đúng thứ tự key của `parseTuning`.
 *
 * Định dạng cố ý khớp Prettier mặc định (2 space, key không quote khi là
 * identifier, dấu phẩy cuối) để `bun run format` không làm file "lệch" giả.
 */
function renderObject(source: Record<string, unknown>, indent: string): string {
  const lines: string[] = ['{'];
  for (const [key, value] of Object.entries(source)) {
    const printedKey = IDENTIFIER.test(key) ? key : JSON.stringify(key);
    lines.push(
      `${indent}  ${printedKey}: ${renderValue(value, `${indent}  `)},`,
    );
  }
  lines.push(`${indent}}`);
  return lines.join('\n');
}

function renderValue(value: unknown, indent: string): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(
      (item) => `${indent}  ${renderValue(item, `${indent}  `)},`,
    );
    return `[\n${items.join('\n')}\n${indent}]`;
  }
  if (typeof value === 'object')
    return renderObject(value as Record<string, unknown>, indent);

  throw new Error(`không in được giá trị kiểu ${typeof value} ra module TS`);
}

/** Nội dung file generated. Tất định: cùng JSON → cùng byte. */
function renderModule(tuning: TuningConfig): string {
  return `${HEADER}\n${NOTE}\n\nexport const TUNING_DATA = ${renderObject(
    tuning as unknown as Record<string, unknown>,
    '',
  )} as const;\n`;
}

/** Dòng lệch đầu tiên + số dòng lệch, đủ để thấy phải chạy `bun run gen`. */
function describeDrift(expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const length = Math.max(expectedLines.length, actualLines.length);
  const mismatches: number[] = [];

  for (let index = 0; index < length; index += 1) {
    if (expectedLines[index] !== actualLines[index]) mismatches.push(index);
  }

  if (mismatches.length === 0) return '';

  const first = mismatches[0] ?? 0;
  const lineNumber = first + 1;
  const expectedLine = expectedLines[first] ?? '<hết file>';
  const actualLine = actualLines[first] ?? '<hết file>';

  return [
    `${OUTPUT_RELATIVE_PATH} lệch khỏi ${CONFIG_RELATIVE_PATH} (${mismatches.length} dòng khác).`,
    `  dòng ${lineNumber} mong đợi: ${expectedLine}`,
    `  dòng ${lineNumber} hiện có: ${actualLine}`,
    `  Chạy \`bun run gen\` để sinh lại.`,
  ].join('\n');
}

function check(expected: string): boolean {
  let actual: string;
  try {
    actual = readFileSync(OUTPUT_PATH, 'utf8');
  } catch {
    console.error(
      `${OUTPUT_RELATIVE_PATH} chưa được sinh từ ${CONFIG_RELATIVE_PATH}.\n  Chạy \`bun run gen\` để tạo.`,
    );
    return false;
  }

  if (actual === expected) return true;

  console.error(describeDrift(expected, actual));
  return false;
}

function main(args: readonly string[]): number {
  const unknownFlags = args.filter((arg) => arg !== '--check');
  if (unknownFlags.length > 0) {
    console.error(
      `tham số không hỗ trợ: ${unknownFlags.join(' ')}\nDùng: bun run scripts/gen-tuning.ts [--check]`,
    );
    return 1;
  }

  let tuning: TuningConfig;
  try {
    tuning = readTuning();
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }

  const expected = renderModule(tuning);

  if (args.includes('--check')) {
    if (check(expected)) {
      console.log(`${OUTPUT_RELATIVE_PATH} khớp ${CONFIG_RELATIVE_PATH}.`);
      return 0;
    }
    return 1;
  }

  writeFileSync(OUTPUT_PATH, expected, 'utf8');
  console.log(`Đã sinh ${OUTPUT_RELATIVE_PATH} từ ${CONFIG_RELATIVE_PATH}.`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
