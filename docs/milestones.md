# Milestones — Yokai Field v2 (roguelite)

Mỗi mốc phải **chơi được hoặc test được**. Không mốc nào tính là xong chỉ vì "đã viết code".
Không đặt deadline, nhưng mỗi mốc là một điểm dừng bắt buộc để đánh giá lại scope.

Nguồn thiết kế: `docs/gdd.md`. Quyết định kỹ thuật: `docs/tech-decisions.md`.

---

## M0 — Tooling

**Việc.** Project Cocos Creator 3.8.8 (Empty 2D) tại root. `assets/scripts/{core,game,ui}`, `assets/data/`. `AGENTS.md`. `tsc --noEmit`, vitest, eslint, prettier. GitHub Actions chạy `bun run check`. Script sinh placeholder sprite. Xoá Unity + tag `unity-final` (theo ADR-003, ADR-011).

**Nghiệm thu.** `bun run check` xanh; boot scene rỗng không lỗi console; `docs/` đủ 5 file; repo sạch, không còn `Assets/`.

---

## M1 — Core loop bằng hình chữ nhật

**Việc.** WASD 8 hướng. Auto-fire 2 phát/giây vào enemy gần nhất. Đạn là hình tròn 2×2 px. 1 enemy grunt lao vào, chạm gây 1 damage, player i-frame 0.8 s. Máu 6 tim. Dọn sạch phòng → hiện text "room clear". Chết → restart.

**Nghiệm thu.**
- Test (core, không import `cc`): chọn mục tiêu gần nhất; nhịp bắn; damage + i-frame; knockback; trạng thái room clear.
- Chơi được 1 phòng trong editor, chết và restart được.
- Không có `cc` import trong `src/core/`.

---

## M1.5 — Taste test art (bắt buộc)

**Việc.** Cài pack **Update #8** (có `Actor/CharacterAnimated`). Tự vẽ bộ tile dungeon tối thiểu: sàn, tường (autotile 16 biến thể góc/cạnh), cửa. Palette lấy mẫu từ pack. Gắn player + 1 enemy + 1 phòng vào M1.

**Nghiệm thu.**
- Ảnh chụp màn hình 512×288 trông như game, không phải prototype.
- Tile tự vẽ đứng cạnh sprite pack mà không lệch palette/outline.
- Quyết định: giữ hướng art này / đổi. **Đổi ngay tại đây**, không đổi sau M3.

---

## M2 — Phòng và run flow

**Việc.** Phòng 32×18 tile, 1 màn hình, không camera follow. Tiled → `.tmx` → `TiledMap` + parse object layer → `LevelData` (collision, spawn, wave). Chuyển phòng, đếm `3/9`, chapter select stub. Không có scroll, không có confiner.

**Nghiệm thu.**
- Schema `LevelData` có test validate.
- Thêm 1 phòng mới chỉ bằng sửa `.tmx`, không sửa code.
- Đi hết 9 phòng của chapter 1 (boss là placeholder) không lỗi.

---

## M3 — Độ sâu combat

**Việc.** 3 vai trò enemy (grunt/caster/brute) + bullet của caster + charge của brute + telegraph. Elite variant (tint + scale + 1 đòn). Hitstop 70 ms, knockback, stagger. Object pool cho đạn (không `new` mỗi phát).

**Nghiệm thu.**
- Test: telegraph timing, charge hitbox, i-frame khi trúng đạn, pool không rò rỉ sau 1000 phát.
- 3 enemy phân biệt được khi nhìn 2 giây: khác silhouette, khác cách tấn công, khác cách né.
- 60 fps với 8 enemy + 40 viên đạn trên màn.

---

## M4 — Skill và boss

**Việc.** 20 skill theo GDD §6, rarity weight, stack, màn hình chọn 1/3. Boss rồng placeholder (hình khối) với 3 phase và pattern ở GDD §5. Chapter 2, 3 với scaling.

**Nghiệm thu.**
- Test: rarity roll có seed cố định; stack cộng dồn đúng; skill ảnh hưởng DPS đúng công thức.
- Chơi trọn 1 run 9 phòng + boss bằng placeholder.
- 3 phase boss khác nhau rõ, và mỗi phase có ít nhất 1 pattern buộc phải di chuyển.

---

## M5 — Meta và UI

**Việc.** Vàng, meta shop 3 track, save `localStorage` (schema ở GDD §10), title, chapter select, pause, kết quả run, settings, credits. Toàn bộ bằng chuột + phím.

**Nghiệm thu.**
- Test: save/load round-trip, giá upgrade, chặn mua khi thiếu vàng, chặn chapter chưa mở.
- Mọi màn hình vào/ra được, không ngõ cụt.
- Không có text bị cắt ở 16:9, 16:10, 4:3.

---

## M6 — Tích hợp art

**Việc.** Bộ tile dungeon hoàn chỉnh (sàn/tường/props/trang trí). Animation thật qua `animations.json` (idle/run/hurt/death cho player + 3 enemy). Rồng: sprite tĩnh + chuyển động bộ phận (cánh/hàm/đuôi) + death. Bullet/VFX/impact. Audio hookup.

**Nghiệm thu.**
- Không còn placeholder nào hiển thị.
- Mọi key trong manifest có sprite thật hoặc fallback.
- 4 animation bắt buộc cho mỗi actor; không có frame nào lệch pivot.
- Credit trong game + `README`.

---

## M7 — Ship

**Việc.** Build web, host itch.io (chính) + GitHub Pages (test), pixel-perfect integer scaling (512×288 × 2/3/4), kiểm performance, trang giới thiệu.

**Nghiệm thu.**
- Link mở được trên Chrome/Safari/Firefox.
- 60 fps ở 1920×1080 trên laptop tầm trung.
- Build < 15 MB (audio stream riêng nếu cần).
- Không lỗi console ở lần chơi đầu.

---

## Phụ thuộc

```text
M0 → M1 → M1.5 → M2 → M3 → M4 → M5 → M6 → M7
```

Không mốc nào bắt đầu khi mốc trước chưa đạt nghiệm thu. Ngoại lệ: tải pack Update #8 và dựng bộ tile dungeon có thể chạy song song M0–M1.
