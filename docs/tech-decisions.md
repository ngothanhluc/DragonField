# Tech decisions — DragonField v2

Bản ghi quyết định kỹ thuật. Mỗi mục là một ADR ngắn: quyết định, lý do, hệ quả.
Ngày chốt: 2026-11-15. Trạng thái: đã chốt, chỉ mở lại khi có bằng chứng mới.

---

## ADR-001 — Engine: Cocos Creator 3.8.8, chỉ web-desktop

**Quyết định.** Dùng Cocos Creator **3.8.8** (LTS, phát hành 2025-12-16). Không dùng 4.0 (mới nhất chỉ là `4.0.0-beta.2`, 2026-11-13; trang download chính thức chỉ có 3.8.x). Target duy nhất: **web-desktop**.

**Lý do.** 3.8 là bản stable duy nhất; web là nền tảng mạnh nhất của Cocos; bỏ mobile/mini-game để không phải xử lý touch + layout mobile từ đầu.

**Hệ quả.** Không có native build. Input = chuột + bàn phím. Save = `localStorage`. Resolution phải theo pixel-perfect scaling.

---

## ADR-002 — Rewrite từ đầu, không port parity

**Quyết định.** Không port 1:1 codebase Unity. Thể loại mới: **roguelite né đạn một màn hình** (tham chiếu Archero). Người chơi tự động bắn, kỹ năng nằm ở di chuyển; dọn phòng → chọn 1/3 skill; chết là hết run, giữ vàng mua upgrade vĩnh viễn. 3 chapter × (8 phòng + boss rồng). Bỏ hub, NPC, dialog, inventory. Chi tiết ở `docs/gdd.md`.

**Lý do.** Audit cho thấy nội dung cũ rất mỏng (Level1 = 14 quái rải rác, damage hardcode = 1, không có state machine). Không có baseline nào đáng giữ, nên đổi thể loại không mất gì thêm.

**Hệ quả.** Single-screen room ⇒ **không cần camera follow, không cần map lớn**. Hệ thống mới phải xây: skill pool, rarity, meta progression, save meta. Hệ thống bị bỏ: dialog, inventory, shop trong màn, hub. Các con số kỹ thuật (16px, cadence animation, audio) vẫn giữ trong `docs/research/2026-11-unity-content-audit.md`.

---

## ADR-003 — Repo: Cocos ở root, xoá Unity, giữ tag

**Quyết định.** Tag `unity-final` trên commit cuối của bản Unity, sau đó force-push repo sạch chỉ còn project Cocos ở root. Bỏ Plastic SCM, chỉ dùng git.

**Lý do.** Repo gọn cho agent; tag đủ để quay lại mà không cần branch/backup riêng. Plastic không cần thiết khi chỉ có một người và agent làm việc qua git.

**Hệ quả.** Không còn `.plastic/`, `ignore.conf`, `Assets/`, `Packages/`, `ProjectSettings/`. Không xoá cho tới khi 3 tài liệu trong `docs/` tồn tại (xem ADR-011).

---

## ADR-004 — Kiến trúc: core TS thuần + adapter Cocos

**Quyết định.** Toàn bộ logic (stats, combat math, inventory, save, level data) nằm trong `assets/scripts/core/` và **không được import `cc`**. Component `cc` trong `assets/scripts/game/` chỉ là adapter mỏng: đọc input, gọi core, gán sprite/transform. UI ở `assets/scripts/ui/`.

**Lý do.** Docs Cocos xác nhận compiler **bỏ qua TypeScript type error** và `tsconfig.json` không được đọc lúc compile. Đồng thời CLI không có authoring headless. Nếu logic nằm trong component thì không test được và agent không có phản hồi nào ngoài việc mở editor.

**Hệ quả.** Bắt buộc có `tsc --noEmit` + vitest. Ranh giới `core` không import `cc` phải được enforce (eslint rule `no-restricted-imports`).

---

## ADR-005 — Pipeline level: TiledMap render + LevelData thuần TS

**Quyết định.** Map vẽ bằng **Tiled** (`.tmx`). Cocos `TiledMap` component render. Object layer (spawn, door, collision, trigger) được parse thành `LevelData` (TS thuần), có JSON schema và test.

**Lý do.** Cocos không có TileMap native, chỉ TiledMap/TMX; không có đường import tilemap từ Unity. Tách LevelData giữ được khả năng test headless mà vẫn dùng component chính thức.

**Hệ quả.** Phải cài Tiled. TMX không được chứa logic; mọi logic nằm ở LevelData. Không có Circle/Edge collider như Unity — collision là box/polygon hoặc tile-based.

---

## ADR-006 — Hợp đồng art: manifest tên logic

**Quyết định.** Code không tham chiếu tên file sprite. Mọi animation truy cập qua tên logic trong `assets/data/animations.json` (`player.idle.down`, `enemy.grunt.attack`), kèm `fallback` khi pack thiếu.

**Lý do.** Cho phép build M1→M5 bằng placeholder và swap art ở M6 mà không sửa logic.

**Hệ quả.** Manifest phải được validate bằng test (mọi key được code dùng đều tồn tại hoặc có fallback).

---

## ADR-007 — Đặc tả art

**Quyết định.** **Chỉ dùng Ninja Adventure Update #8** (pixel-boy & AAA, CC0), không pack ngoài, **không vẽ thêm asset nào**. Nguồn: `art-source/ninja-adventure/` (110 MB: 1915 PNG, 188 audio, 23 tileset, 66 monster, 20 folder boss, 361 file UI, 62 skill icon). Tile 16×16, top-down 3/4, 4 hướng.

Những gì pack **không có** thì **cắt khỏi thiết kế**, không tự làm:
- **Không có tileset dungeon/crypt** → 3 chapter là đồng cỏ/rừng, sông/thác, làng hoang.
- **Rồng không có animation** (modular parts, 0 frame) → bỏ rồng. Boss dùng Tengu / Squid / Samurai.
- **Chỉ 1 nhân vật có bộ 4 hướng đầy đủ** (`CharacterAnimated/NinjaGreen`) → player là nhân vật đó, không có skin animated.
- **Không monster nào có attack/hurt/death** → telegraph, trúng đòn, chết đều là FX + palette remap.
- **Không có art thanh máu boss / khung thẻ skill** → ghép từ nine-path `Theme Wood`.

Chi tiết + bảng coverage: `docs/art/pack-inventory.md`.

**Lý do.** Survey cho thấy không tồn tại rồng animated top-down 16px nào trên thị trường, và pack này đã có sẵn bề rộng kẻ địch (66 monster + 10 boss) — đúng thứ roguelite cần hơn là một con boss đẹp. Tự vẽ dungeon tiles + rồng là 2 task author lớn nhất, và cả hai đều không cần thiết cho loop.

**Hệ quả.** Zero rủi ro license, zero công author art. Đổi lại: theme bị giới hạn trong 3 bối cảnh có sẵn, và biểu đạt của enemy phụ thuộc hoàn toàn vào FX.

---

## ADR-008 — Số liệu combat

**Quyết định.**
- Di chuyển WASD 8 hướng, **không dash**, không nút đánh/bắn.
- **Auto-fire 2 phát/giây, bắn cả khi đang chạy**, tự nhắm enemy gần nhất trong tầm.
- Đạn: 1 viên, damage 1, tốc độ 12 tile/s.
- Player 6 tim; nhận 1 damage; **i-frame 0.8 s**; knockback 3 px.
- Enemy: hitstop 70 ms khi trúng, stagger 150 ms; telegraph 500 ms (caster) / 700 ms (brute).
- Boss rồng 60 máu, 3 phase (100–66 / 66–33 / 33–0%).

Bảng đầy đủ: `docs/gdd.md` §3–§5. Toàn bộ số nằm trong `src/core/config`, có test.

**Lý do.** "Cảm giác tốt hơn" chỉ kiểm chứng được khi có số; và với roguelite, các số này là đầu vào của balance skill nên phải tách khỏi logic.

**Hệ quả.** Luật "đứng lại mới bắn" của Archero bị bỏ ⇒ độ khó phải đến từ mật độ đạn và số quái. Nếu playtest thấy nhạt, thêm lại như một skill chứ không đổi luật gốc.

---

## ADR-009 — Code-first, art sau, có taste test

**Quyết định.** Build bằng placeholder (hình chữ nhật màu + animation giả) từ M1. Gắn tileset + player sprite thật ở **M1.5** để duyệt hướng art. Swap toàn bộ ở M6.

**Lý do.** Art phụ thuộc license và sự tồn tại của pack — không thể là điều kiện chặn code. Nhưng để art tới M6 sẽ mất động lực, nên cần một mốc nhìn thấy được sớm.

**Hệ quả.** M1.5 là mốc bắt buộc, không phải tuỳ chọn.

---

## ADR-010 — Gate và CI

**Quyết định.** `tsc --noEmit`, `vitest`, `eslint` + `prettier` chạy trên mỗi push qua GitHub Actions. **Không** build web trong CI (build cần editor GUI).

**Lý do.** Cocos bỏ qua type error; không có gate thì lỗi kiểu chỉ nổ lúc runtime. Build web trong CI cần cài editor vào runner — quá nặng, để sau M7.

**Hệ quả.** `npm run check` là lệnh duy nhất agent cần chạy trước khi báo xong việc.

---

## ADR-011 — Điều kiện được xoá Unity

**Quyết định.** Chỉ xoá `Assets/`, `Packages/`, `ProjectSettings/`, `.plastic/` sau khi các file sau tồn tại và đã commit:
1. `docs/research/2026-11-unity-content-audit.md` ✅
2. `docs/gdd.md`
3. `docs/tech-decisions.md` (file này)
4. `docs/milestones.md`
5. `docs/art/asset-pack-shortlist.md`

**Lý do.** Tránh mất dữ liệu không thể phục hồi khi chưa có gì thay thế.

**Hệ quả.** Tag `unity-final` phải được tạo **trước** khi xoá.

---

## ADR-012 — Save: chỉ meta, không lưu run

**Quyết định.** `localStorage`, 1 slot, schema versioned: `gold`, `upgrades{hp,damage,firerate}`, `chaptersUnlocked`, `best{chapter,room}`, `settings{volume,fullscreen}`. **Không** lưu run đang chơi.

**Lý do.** Chủ dự án chọn không resume run: chết/tắt tab là mất run. Schema nhỏ nên không cần migration phức tạp; vẫn giữ `version` để có chỗ sửa sau.

**Hệ quả.** Không cần serialize state giữa các phòng. Toàn bộ "run state" sống trong RAM và bị xoá khi reload.
