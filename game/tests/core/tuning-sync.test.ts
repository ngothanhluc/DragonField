import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TUNING_DATA } from '../../assets/scripts/core/enemies/tuning.generated';

/**
 * Cổng chống stale: `tuning.generated.ts` phải là bản in trung thực của
 * `config/tuning.json`.
 *
 * `bun run check:config` đã so byte-by-byte trước khi tsc chạy, nhưng test này
 * khoá thêm ở mức **ngữ nghĩa**: ai đó sửa tay file generated (hoặc JSON) mà
 * quên chạy `bun run gen` thì đỏ ngay, kèm thông điệp chỉ đúng file nguồn.
 */
const CONFIG_PATH = new URL('../../config/tuning.json', import.meta.url);
const GENERATED_PATH = new URL(
  '../../assets/scripts/core/enemies/tuning.generated.ts',
  import.meta.url,
);

const config: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const generatedSource = readFileSync(GENERATED_PATH, 'utf8');

describe('tuning sync — generated code khớp config/tuning.json', () => {
  it('object export của module generated deep-equal JSON nguồn', () => {
    expect(TUNING_DATA).toEqual(config);
  });

  it('version của JSON có mặt trong module generated', () => {
    const version = (config as { version?: unknown }).version;
    expect(typeof version).toBe('number');
    expect(TUNING_DATA.version).toBe(version);
  });

  it('file generated mang header AUTO-GENERATED và nhắc chạy bun run gen', () => {
    expect(generatedSource).toContain(
      '// AUTO-GENERATED from game/config/tuning.json — do not edit. Run: bun run gen',
    );
  });
});
