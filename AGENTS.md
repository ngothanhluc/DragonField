# AGENTS.md — Yokai Field

Hướng dẫn cho agent (và cho người) làm việc trong repo này. Đọc file này trước khi sửa code.

## Dự án là gì

Roguelite né đạn top-down, pixel 16px, chạy trên web. Người chơi **tự động bắn**, kỹ năng nằm ở di chuyển. Dọn phòng → chọn 1 trong 3 skill → boss cuối chapter. Chết là hết run, giữ vàng mua upgrade vĩnh viễn.

- Thiết kế: `docs/gdd.md`
- Quyết định kỹ thuật: `docs/tech-decisions.md`
- Mốc và nghiệm thu: `docs/milestones.md`
- Kiểm kê art: `docs/art/pack-inventory.md`
- Số liệu bản Unity cũ (đã xoá, tag `unity-final`): `docs/research/2026-11-unity-content-audit.md`

## Stack

- **Cocos Creator 3.8.8** (LTS). Không dùng 4.0 — mới chỉ là beta.
- **Bun** là package manager duy nhất (`bun install`, `bun run …`). Không dùng npm/yarn/pnpm: repo chỉ có `bun.lock`, không có `package-lock.json`.
- TypeScript. Không C#, không GDScript.
- Target duy nhất: **web-desktop**. Không mobile, không native, không mini-game.
- Nguồn art duy nhất: **Ninja Adventure Update #8** (CC0). Không thêm pack ngoài.
- Tên game: **Yokai Field**. Tên folder repo vẫn là `DragonField` (đổi tên folder sẽ phá đường dẫn tuyệt đối trong các session đang mở).

## Trạng thái hiện tại

Project Cocos **đã được tạo** tại `game/` (Cocos Creator 3.8.8, template Empty 2D, `package.json name: ninja-adventure`).
`game/assets/` hiện còn rỗng — scaffold M0 chưa làm.

Mọi lệnh và đường dẫn dưới đây tính từ repo root, trừ khi ghi rõ.

## Lệnh

```bash
cd game
bun run check      # bắt buộc trước khi báo "xong": check:config + tsc + vitest + eslint
bun run gen        # sinh lại tuning.generated.ts từ config/tuning.json
bun run check:config  # chỉ kiểm tra generated code có lệch JSON không
bun run test       # vitest
bun run typecheck  # tsc --noEmit
bun run lint       # eslint
```

Build web (cần editor đã cài, không chạy trong CI):

```bash
/Applications/CocosCreator/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project game --build "platform=web-desktop;debug=false"
```

## Cấu trúc

```text
game/                  # project Cocos Creator — mọi thứ engine đọc nằm ở đây
├── assets/
│   ├── scripts/
│   │   ├── core/      # logic thuần TS — KHÔNG được import 'cc'
│   │   ├── game/      # component Cocos: adapter mỏng quanh core
│   │   └── ui/        # component UI
│   ├── data/          # animations manifest, level data
│   └── art/           # subset của pack, chỉ file game dùng
├── config/
│   └── tuning.json    # số liệu tune (nguồn duy nhất) → bun run gen
├── settings/          # editor sinh
├── library/ temp/     # cache, gitignored
└── package.json
docs/                  # thiết kế + quyết định + kiểm kê
art-source/            # pack đầy đủ, KHÔNG commit (gitignored)
```

## Quy tắc bắt buộc

1. **`src/core/` không import `cc`.** Mọi thứ trong core phải test được bằng vitest, không cần engine. Ranh giới này được enforce bằng eslint `no-restricted-imports`.
2. **Không hardcode đường dẫn sprite.** Tham chiếu qua tên logic trong `assets/data/animations.json` (`player.idle.down`). Pack thiếu thì khai báo `fallback`.
3. **Số liệu tune nằm trong `game/config/tuning.json`** (ngoài asset DB), không nằm trong code. Sửa số → `bun run gen` → `bun run check`. `bun run check` chạy `check:config` trước, nên generated code lệch JSON là fail ngay.
4. **Luôn chạy `bun run check`.** Cocos **bỏ qua TypeScript type error** khi compile (docs xác nhận) — không có gate này thì lỗi kiểu chỉ nổ lúc runtime.
5. **Không tự sửa `.scene`/`.prefab` bằng tay** khi có thể mở editor; file đó là JSON do editor sinh, sửa tay dễ hỏng tham chiếu UUID.
6. **Không thêm asset pack ngoài.** Nếu thiếu sprite, chọn asset khác trong pack hoặc dùng primitive/particle.
7. **Test đi kèm logic.** Thay đổi trong `core/` phải có test tương ứng; test là thứ duy nhất chứng minh combat/skill/save đúng.

## Quy ước

- File/thư mục: `kebab-case`. Class/type: `PascalCase`. Biến/hàm: `camelCase`.
- Mỗi hệ thống một thư mục trong `core/`: `combat/`, `skills/`, `run/`, `meta/`, `save/`, `level/`.
- Không dùng `any` trừ khi bất khả kháng, và phải có comment lý do.
- Commit message: `type(scope): mô tả` — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.

## Bẫy đã biết của Cocos

| Bẫy | Cách tránh |
|---|---|
| Compile bỏ qua type error | `bun run check` |
| Không có authoring headless | scene dựng bằng editor hoặc bằng code; level là data |
| Không có TileMap native, chỉ TiledMap (TMX) | map vẽ bằng Tiled |
| Không có Cinemachine | không cần — phòng chỉ 1 màn hình, camera tĩnh |
| `tsconfig.json` không được đọc lúc compile | dùng để IDE check + `tsc --noEmit` trong CI |
| `resources.load` cần hậu tố `/spriteFrame` | dùng manifest, không load path thủ công |
