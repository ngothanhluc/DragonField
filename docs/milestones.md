# Milestones — Yokai Field v2 (roguelite)

Mỗi mốc phải **chơi được hoặc test được**. Không mốc nào tính là xong chỉ vì "đã viết code".
Không đặt deadline, nhưng mỗi mốc là một điểm dừng bắt buộc để đánh giá lại scope.

Nguồn thiết kế: `docs/gdd.md`. Quyết định kỹ thuật: `docs/tech-decisions.md`.

---

## M0 — Tooling

**Việc.** Project Cocos Creator 3.8.8 (Empty 2D) tại root. `assets/scripts/{core,game,ui}`, `assets/resources/data/`. `AGENTS.md`. `tsc --noEmit`, vitest, eslint, prettier. GitHub Actions chạy `bun run check`. Script sinh placeholder sprite. Xoá Unity + tag `unity-final` (theo ADR-003, ADR-011).

**Nghiệm thu.** `bun run check` xanh; boot scene rỗng không lỗi console; `docs/` đủ 5 file; repo sạch, không còn `Assets/`.

---

## M1 — Core loop bằng hình chữ nhật

**Việc.** WASD 8 hướng. Auto-fire 2 phát/giây vào enemy gần nhất. Đạn là hình tròn 2×2 px. 1 enemy grunt lao vào, chạm gây 1 damage, player i-frame 0.8 s. Máu 6 tim. Dọn sạch phòng → hiện text "room clear". Chết → restart.

**Nghiệm thu.**
- Test (core, không import `cc`): chọn mục tiêu gần nhất; nhịp bắn; damage + i-frame; knockback; trạng thái room clear.
- Chơi được 1 phòng trong editor, chết và restart được.
- Không có `cc` import trong `src/core/`.

**Trạng thái: ✅ Xong (2026-11-16).** 361 test xanh (có `knockback.test.ts`); chơi trên build web: knockback 1.5 tile, "ROOM CLEAR" ~1 s rồi sang 2/9, GAME OVER + R chơi lại. Còn treo: bộ gõ tiếng Việt (Telex) làm kẹt phím WASD — xem `AGENTS.md`; caster chưa bắn đạn (thuộc M3).

---

## M1.5 — Taste test art (bắt buộc)

**Việc.** Cài pack **Ninja Adventure Update #8** (có `Actor/CharacterAnimated`). Phòng dùng tileset có sẵn của pack (không tự vẽ tile, không làm dungeon — ADR-007). Gắn player + 1 enemy + 1 phòng vào M1.

**Nghiệm thu.**
- Ảnh chụp màn hình 512×288 trông như game, không phải prototype.
- Quyết định: giữ hướng art này / đổi. **Đổi ngay tại đây**, không đổi sau M3.

**Trạng thái: ✅ Xong (2026-11-16).** Giữ tileset của pack, không làm dungeon. Ảnh nghiệm thu: `docs/art/m1.5-taste-test.png` (512×288, build release). Phòng 32×18 letterbox vừa khít mọi tỉ lệ canvas (`core/view/letterbox.ts`), HUD dán đúng mép phòng.

---

## M2 — Phòng và run flow

**Việc.** Phòng 32×18 tile, 1 màn hình, không camera follow. Tiled → `.tmx` → `TiledMap` + parse object layer → `LevelData` (collision, spawn, wave). Chuyển phòng, đếm `3/9`, chapter select stub. Không có scroll, không có confiner.

**Nghiệm thu.**
- Schema `LevelData` có test validate.
- Thêm 1 phòng mới chỉ bằng sửa `.tmx`, không sửa code.
- Đi hết 9 phòng của chapter 1 (boss là placeholder) không lỗi.

**Trạng thái: ✅ Xong (2026-11-16).** 427 test xanh (mới: `xml`, `tmx`, `chapter-discovery`, `withBest`, `run-state` data-driven + `markWon`). 9 phòng `chapter-1/room-<n>.tmx` + `field.tsx`; `TiledMap` vẽ tile, object layer parse bằng **một** parser (`core/level/tmx.ts`, không `cc`) thành `LevelData`. Chapter select dựng bằng code (ch1 mở, 2–3 khoá, hiện best từ `localStorage`) → 9 phòng → boss placeholder Tengu 60 HP → CHAPTER CLEAR → về chapter select. Đã thử thả `room-10.tmx`: HUD và flow thành `x/10` không sửa code (file thử đã xoá). Headless Chrome đi trọn `1/9 → 9/9`, không lỗi console. Chưa có: 3 phase/đạn boss (M4), skill pick (M3), font pixel.

---

## M3 — Độ sâu combat

**Việc.** 3 vai trò enemy (grunt/caster/brute) + bullet của caster + charge của brute + telegraph. Elite variant (tint + scale + 1 đòn). Hitstop 70 ms, knockback, stagger. Object pool cho đạn (không `new` mỗi phát).

**Nghiệm thu.**
- Test: telegraph timing, charge hitbox, i-frame khi trúng đạn, pool không rò rỉ sau 1000 phát.
- 3 enemy phân biệt được khi nhìn 2 giây: khác silhouette, khác cách tấn công, khác cách né.
- 60 fps với 8 enemy + 40 viên đạn trên màn.

**Trạng thái: ✅ Xong (2026-11-16).** 469 test xanh (31 file; mới `hitstop`, `charge-hitbox`, `enemy-fire`, `elite-attacks`, `bullet-pool`, thêm rule boss trong `chapter-discovery`). Vai trò: chaser (dơi xanh, chạm người), caster (octopus xanh lá — đổi từ Eye để không trùng silhouette/màu dơi — đạn chậm owner `enemy` tint cam, dùng chung `BulletPool`), brute/tank (gấu, silhouette ×1.75 qua `enemies.roles.tank.scale`, telegraph 700 ms rồi lao 7 tile/s); telegraph = vòng `fx/telegraph-ring` **màu theo vai trò** (vàng/cyan/cam) + pulse + tint. Elite = tint + scale 1.15 + 1 đòn thêm: chaser elite lao ngắn (300 ms telegraph, 6 tile/s × 300 ms), caster elite bắn loạt 3 viên toả quạt (±0.22 rad), tank elite lao **2 lần** (cú sau chốt hướng mới). Hitstop 70 ms khi đạn player trúng enemy = đóng băng **thời gian mô phỏng** (`HitstopClock`), nên telegraph/i-frame/cooldown/TTL cùng đứng yên — có test; stagger 150 ms là action riêng, không reset cooldown (nếu reset, enemy bị auto-fire 2 phát/s sẽ không bao giờ ra đòn — bug bắt được ở smoke test). Đạn: pool 256 slot + 64 node view dựng sẵn, không `new` mỗi phát. `chapterFromLevels` từ chối boss không phải phòng cuối / >1 boss room (có test). Debug `?debug=1`: `spawn(role, elite, at)`, `stress()`, `fps()`, `godMode(on)` (+ `enemies()`, `bulletCount()`), đã dùng cho acceptance. Headless Chrome (ANGLE Metal, viewport 1280×960): `stress()` giữ **8 enemy + 40–41 đạn**, `fps()` 12 mẫu liên tiếp **~60.0 fps / 16.67 ms** (baseline phòng thường 60); vòng 9 phòng M2 chạy lại `1/9 → 9/9` → CHAPTER CLEAR → về chapter select, **không lỗi console**. Ảnh: `/tmp/yokai-m3/shots/`. Còn thiếu (không thuộc M3): FX chết/impact và palette remap của elite (tint nhân màu hiện tại, gấp ở M6), boss 3 phase (M4), sim headless chưa mô phỏng hitstop/stagger/đòn thêm của elite (chỉ game adapter có).

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
