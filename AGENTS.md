# AGENTS.md — DragonField

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
- TypeScript. Không C#, không GDScript.
- Target duy nhất: **web-desktop**. Không mobile, không native, không mini-game.
- Nguồn art duy nhất: **Ninja Adventure Update #8** (CC0). Không thêm pack ngoài.

## Trạng thái hiện tại

Repo **chưa có project Cocos**. Project phải được tạo bằng Cocos Dashboard (GUI) tại root repo, chọn template **Empty (2D)**.
Sau khi tạo xong, các lệnh dưới đây mới tồn tại.

## Lệnh

```bash
npm run check      # bắt buộc trước khi báo "xong": tsc --noEmit + vitest + eslint
npm run test       # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

Build web (cần editor đã cài, không chạy trong CI):

```bash
/Applications/CocosCreator/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project . --build "platform=web-desktop;debug=false"
```

## Cấu trúc

```text
assets/
├── scripts/
│   ├── core/    # logic thuần TS — KHÔNG được import 'cc'
│   ├── game/    # component Cocos: adapter mỏng quanh core
│   └── ui/      # component UI
├── data/        # JSON: config, animations manifest, level data
└── art/         # subset của pack, chỉ file game dùng
docs/            # thiết kế + quyết định + kiểm kê
art-source/      # pack đầy đủ, KHÔNG commit (gitignored)
```

## Quy tắc bắt buộc

1. **`src/core/` không import `cc`.** Mọi thứ trong core phải test được bằng vitest, không cần engine. Ranh giới này được enforce bằng eslint `no-restricted-imports`.
2. **Không hardcode đường dẫn sprite.** Tham chiếu qua tên logic trong `assets/data/animations.json` (`player.idle.down`). Pack thiếu thì khai báo `fallback`.
3. **Số liệu tune nằm trong `assets/data/config.json`**, không nằm trong code. Đổi balance = sửa JSON.
4. **Luôn chạy `npm run check`.** Cocos **bỏ qua TypeScript type error** khi compile (docs xác nhận) — không có gate này thì lỗi kiểu chỉ nổ lúc runtime.
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
| Compile bỏ qua type error | `npm run check` |
| Không có authoring headless | scene dựng bằng editor hoặc bằng code; level là data |
| Không có TileMap native, chỉ TiledMap (TMX) | map vẽ bằng Tiled |
| Không có Cinemachine | không cần — phòng chỉ 1 màn hình, camera tĩnh |
| `tsconfig.json` không được đọc lúc compile | dùng để IDE check + `tsc --noEmit` trong CI |
| `resources.load` cần hậu tố `/spriteFrame` | dùng manifest, không load path thủ công |
