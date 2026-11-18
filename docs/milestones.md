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

**Việc.** 20 skill theo GDD §6, rarity weight, stack, màn hình chọn 1/3. Boss thật của GDD §5 — **TenguBlue / SquidGreen / GiantBlueSamurai**, 60/80/100 máu, 3 phase, pattern đọc được — không còn boss rồng/placeholder hình khối. Chapter 2, 3 với scaling.

**Nghiệm thu.**
- Test: rarity roll có seed cố định; stack cộng dồn đúng; skill ảnh hưởng DPS đúng công thức.
- Chơi trọn 1 run 9 phòng + boss ở cả 3 chapter.
- 3 phase boss khác nhau rõ (tint + màu vòng telegraph + banner riêng), và mỗi phase có ít nhất 1 pattern buộc phải di chuyển (test: player đứng yên tại `playerStart` vẫn trúng đòn ở cả 9 phase).

**Trạng thái: ✅ Xong (2026-11-17).** 538 test xanh (39 file; mới `skills-loadout`, `combat-effects`, `boss-phases`, `chapter-scaling`, `chapter-assets`, `save-unlock`, `integer-damage`). 20 skill sống trong game qua `DerivedStats` + `core/combat/*` (crit, pierce, ricochet, homing, nổ AoE có flash, freeze/poison có tint + DoT, lifesteal, execute, shield 20 s có tint, thorns, Second Wind, Vitality…); sim dùng đúng các helper đó. Màn chọn 1/3 dựng bằng code (`skill-pick.ts`): 3 thẻ có tên/rarity màu/hiệu ứng/stack, chọn bằng chuột **và** phím 1/2/3 (phải nghe `document` capture — xem bẫy AGENTS.md), roll bằng RNG seed của run, tôn trọng max stack. HUD có hàng chữ tắt 2 ký tự + stack (20 mã không trùng) và thanh máu boss. Boss dùng `core/boss/patterns.ts`: Tengu 60 / Squid 80 / Samurai 100 máu, phase 66%/33%, Summon 2 caster của Squid chạy, Samurai line-up theo hàng player trước khi charge ngang (nếu không, player đứng hàng khác không bao giờ bị đe doạ); mỗi phase có tint + màu vòng telegraph + banner `PHASE 2` / `ENRAGE` riêng. Chapter 2–3 author đủ 9 phòng mỗi chapter (5–6 enemy/phòng, brute từ phòng 3; 7–8 enemy + elite), mỗi phòng chia 2–3 wave; scale máu theo `config/tuning.json` (`chapters.enemyHealthMultipliers` 1/1.05/1.05, damage giữ 1/1/1 — độ khó chính đến từ số lượng/elite, đúng tinh thần GDD §4). Thắng chapter ghi `chaptersUnlocked` vào save; chapter select hiện đúng 1 → 2 → 3. Headless Chrome (1280×960): ch1 → ch2 → ch3, mỗi chapter qua 9 phòng + 3 phase boss + unlock, **không lỗi console**; `stress()` giữ 8 enemy + 44 đạn; đo riêng 12 mẫu **60.0 fps** (16.67 ms/frame); run full-flow 3 chapter + 3 boss đo **58.1 fps** trung bình. Sim balance (3 seed, policy né): đứng yên chết phòng 1 sau 8.2–11.2 s; né không skill sống 9.9–121.2 s; né + loadout tiêu biểu **thắng cả 3 chapter** (trung bình 85 / 93 / 135 s). Round 2 thêm test riêng cho chapter 2–3 với run 0 skill: đứng yên thua phòng 1 (14.3 / 13.4 s), né không skill sống **254–256 s** (ch2, dọn 6 phòng) và **187–205 s** (ch3, dọn 3–4 phòng). Ảnh: `/tmp/yokai-m4/shots/`. Còn thiếu: Greed chưa có vàng trong run (M5), Freeze không làm chậm boss (chỉ enemy thường), crit/lifesteal dùng RNG chung với boss pattern, HUD skill dùng chữ tắt vì pack không có icon skill 16×16 phù hợp.

---

## M5 — Meta và UI

**Việc.** Vàng, meta shop 3 track, save `localStorage` (schema ở GDD §10), title, chapter select, pause, kết quả run, settings, credits. Toàn bộ bằng chuột + phím.

**Nghiệm thu.**
- Test: save/load round-trip, giá upgrade, chặn mua khi thiếu vàng, chặn chapter chưa mở.
- Mọi màn hình vào/ra được, không ngõ cụt.
- Không có text bị cắt ở 16:9, 16:10, 4:3.

**Trạng thái: ✅ Xong (2026-11-17).** 562 test xanh (43 file; mới `run-stats`, `run-rewards`, `chapter-gate`, `settings`; `save.test` đã có round-trip/giá/chặn mua/migrate key cũ `hp`/`firerate`). Vàng: kill trả `goldForKill` (elite ×3) qua `RunRewards`, Greed nhân rồi **làm tròn** (tank 3 × 1.5 = 5), dọn phòng +5 / boss +50, HUD hiện sống; chỉ ghi vào save một lần ở cuối run (`game/run-end.ts`: chết/thắng, restart/thoát giữa run cũng giữ vàng). Meta: `core/meta/run-stats.ts` áp cấp đã mua vào baseline trước skill (tim +1/cấp, damage +5%/cấp, nhịp +3%/cấp); đã kiểm trong browser: mua damage 1 + hearts 1 → run mới có `damage 1.05`, `maxHearts 7` và đầy 7 tim. Màn: title / chapter select (+Back, keyboard focus) / pause (Resume, Restart, Quit, volume; **sim clock đứng yên** — enemy không nhích 0.000 tile sau 1.5 s) / result (chết + thắng; rooms, vàng, thời gian, kills, Shop/Chapter select/Title) / shop 3 track (level, giá, vàng, lý do disabled) / settings (volume 10% bước, fullscreen thật, keybind read-only) / credits (Pixel-boy & AAA, CC0) / skill-pick (thêm ←/→ + Enter, vẫn 1/2/3). Mọi màn dùng `game/screens/menu.ts`: click chuột thật, hover/focus, ↑/↓/←/→, Enter/Space, Esc; focus có viền vàng. Locked chapter bị chặn ở **core** (`chapterGate`, test) chứ không chỉ nút disabled — click Chapter 2 ở browser không vào run. Save schema giữ `version: 1`, key `hearts/damage/fireRate` (GDD §10 đã sửa theo code; migrate đọc tên nháp cũ); `localStorage` hỏng → save mặc định, không crash (test + browser). Debug `?debug=1`: thêm `screen()`, `save()`, `setGold(n)`, `uiText()` (rect label trong canvas + `insideCanvas`), giữ nguyên hook cũ. Canvas: `applyCanvasSize` gán `screen.windowSize` lúc boot + resize, bỏ border/header/footer của template → canvas đúng `innerWidth×innerHeight`; world vẫn letterbox 16:9. Headless Chrome đi đủ flow (title → chapter → run → pause/resume/restart/quit; chết → result → shop → mua → back; thắng chapter 1 → mở chapter 2 → chơi chapter 2; credits/settings; 54 lượt audit UI ở 6 viewport 1280×720, 1920×1080, 1280×800, 1440×900, 1024×768, 1280×960, **0 label bị cắt**, 0 lỗi console). `stress()` 8 enemy + 44 đạn: **58.5–60.1 fps** (mẫu 120 frame; 1280×720/960/1024×768/1920×1080). Ảnh: `/tmp/yokai-m5/shots/` (mỗi màn ở 16:9 và 4:3, cộng result-win/stress). Còn thiếu: volume chỉ lưu, chưa có audio (M6); font hệ thống thay vì `NormalFont.ttf` của pack (M6); Esc trong fullscreen bị trình duyệt dùng để thoát fullscreen nên phải bấm lần nữa hoặc dùng nút Back; không rebind phím (đúng v1).

---

## M6 — Tích hợp art

**Việc.** Trang trí đủ 27 phòng bằng tileset **có thật trong pack** theo bảng GDD §8 — ch1 Nature/Relief/Element/Field, ch2 Water + thác/nước + bờ Nature, ch3 VillageAbandoned/House/Towers/Hole, arena boss + 4 cột đá. Trang trí không được mâu thuẫn va chạm: thứ trông đặc phải là obstacle trong object layer, sàn trông đi được thì vẫn đi được. Animation thật qua `animations.json` cho player (NinjaGreen: idle/walk scale theo vận tốc, hurt, death), 3 vai trò enemy + elite (idle/walk; hurt = flash/tint, death = FX — GDD §12.3), và 3 boss TenguBlue/SquidGreen/GiantBlueSamurai (attack/Trans/AttackLoop/Shoot/charge/hit gắn với pattern event). Pivot theo chân, không giật khi đổi anim khác kích thước. Bullet/VFX/impact từ `FX/` của pack (shuriken, energy ball, spark, explosion, smoke, shield, freeze/poison, gold sparkle), tất cả pool sẵn. Audio: nhạc title/chapter/boss + SFX hành động, master volume theo save, mở khoá autoplay ở input đầu. Font pixel của pack cho mọi label. UI dùng nine-slice thật. Credits trong game + `README.md`. **Không** có rồng, **không** có dungeon (ADR-007).

**Nghiệm thu.**
- Không còn placeholder nào hiển thị.
- Mọi key trong manifest có sprite thật hoặc fallback.
- 4 animation bắt buộc cho mỗi actor; không có frame nào lệch pivot.
- Credit trong game + `README`.

**Trạng thái: ✅ Xong (2026-11-17).** 576 test xanh (45 file; mới `art-files` 9 test + `water-layout` 5 test). **Manifest**: 119 key; `art-files.test` đọc PNG thật bằng decoder nội bộ (`scripts/lib/png.ts`), kiểm file tồn tại, grid chia hết sheet, và `footPx` = đáy pixel đặc của sheet (test pivot); thêm idle cho 9 monster + 8 key FX. `SpriteEntry` có `anchor`/`footPx`; `SpriteAnimator` đặt anchor theo chân, `contentSize` theo frame, walk scale theo vận tốc (GDD §12.2). **Phòng**: `scripts/dress-rooms.ts` phủ decor layer cho 27 `.tmx` (ch1 Nature cỏ/hoa/sỏi + hedge/barrel hàng 0; ch2 cỏ + `water-layout.json`; ch3 Desert props + mái nhà/hàng rào Village hàng 0/17 + Houses/Towers/Hole trong boss arena). Nước ch2 là sprite strip `Backgrounds/Animated` (ripple + thác 3 phần) vẽ bởi `room-water.ts` trên nền `Graphics` xanh — `TilesetWater` là autotile kênh, stamp khối ra hình ống nên không dùng làm sông. Không thêm obstacle mới: props đặc chỉ nằm ở hàng/cột 0/31 bị clamp 1 tile, nên collision/balance giữ nguyên (`run-simulation` vẫn xanh). **Actor**: enemy idle/walk, hurt tint/flash, death = smoke+impact; boss dùng attack/Trans/AttackLoop/Shoot/charge/hit theo event và về idle khi clip xong; player death FX 1.4 s rồi result. **FX**: pool 32 slot tự slice frame từ manifest + một clock chung (bản đầu dùng `SpriteAnimator`/slot làm stress tụt 40 fps); impact/explosion/smoke/shield/ice/poison/gold sparkle; đạn shuriken 15 frame + energy ball 4 frame. **Audio**: 5 track (title/ch1/ch2/ch3/boss) + 15 SFX mp3 (2.2 MB), autoplay unlock ở input đầu, volume save áp live; debug `audio()` thấy track + SFX. **UI**: `NormalFont.ttf` cho mọi label, nine-slice panel/nút/thẻ skill (có inset), credits cập nhật + `README.md`. Build `du -sh` **7.9 MB**. Headless 1280×720 và 1024×768: mọi màn (title/chapter/shop/settings/credits/skill-pick/pause/result) `uiText` clipped=0 overflow=0; ch1→ch3 đủ 9 phòng + 3 phase mỗi boss; `placeholders()` rỗng ở mọi màn; `stress()` 59.5–60.1 fps với 8 enemy + 44 đạn + FX; 0 lỗi console. Ảnh: `/tmp/yokai-m6/shots/`. Hạn chế trung thực: ch3 nội ô khá trống (VillageAbandoned toàn mảnh autotile có góc trong suốt, đặt lẻ thành “giấy rách”); `TilesetElement` không có cột đá nên boss arena dùng boulder Nature; nước/sông đi qua được (sông nông); boss Samurai có thể chạm mép arena và bị cắt một phần sprite; monster vẫn không có frame attack/hurt/death (FX + tint theo GDD §12.3).

---

## M7 — Ship

**Việc.** Build web, host **Cloudflare** (Worker chỉ file tĩnh `yokai-field`, custom domain `yokai.lukeinc.tech`; bỏ itch.io và GitHub Pages), pixel-perfect integer scaling (512×288 × 2/3/4), kiểm performance, trang giới thiệu = trang dự án trên portfolio `lukeinc.tech/projects/dragon-field` (kể bản Unity 2023 → bản này). Sửa trước khi ship: Samurai bị cắt sprite ở mép arena, WASD kẹt khi bật bộ gõ tiếng Việt.

**Nghiệm thu.**
- Link mở được trên Chrome/Safari/Firefox.
- 60 fps ở 1920×1080 trên laptop tầm trung.
- Build < 15 MB (audio stream riêng nếu cần).
- Không lỗi console ở lần chơi đầu.

**Trạng thái: ✅ Xong (2026-11-18).** 598 test xanh (mới: `move-keys`, `deploy-html`, bound boss trong `boss.test`, extent sprite trong `art-files`, `pixelPerfectRect`/`worldToUiScale` trong `letterbox`). World vẽ ở bội số nguyên (1920×1080 → 1536×864 ×3, lề pixel nguyên), HUD thu theo `hudScale` để bám mép phòng, menu vẫn `SHOW_ALL`. Boss đứng trong `bossRoomBounds` theo extent sprite đo từ PNG — Samurai charge sát tường không còn bị cắt (đã xem ở 1920×1080). WASD đọc `event.code` trên `document` — event giả lập `key: 'đ'`, `keyCode: 229` vẫn đi đúng; **chờ thử bằng Telex thật** (`?debug=1` → `__yokai.keyLog()`). Panel/thẻ skill đổi sang `nine_path_panel_interior` (hết khung chồng lệch từ M6). `bun run deploy:prepare`: 431 file, 6.66 MB, file lớn nhất 2.42 MB. Local 1920×1080: `stress()` 8 enemy + 44 đạn **60.0 fps** (6 mẫu × 120 frame). **Deploy thật ✅** (Cloudflare Workers Builds, `yokai.lukeinc.tech` trả 200). **Chrome trên domain ✅ (2026-11-18)**: `?debug=1`, viewport 1920×876, canvas khớp đúng `innerWidth×innerHeight`, title → ch1, `stress()` 8 enemy + 44 đạn **60.0 fps** (4 mẫu × 120 frame), `placeholders()` rỗng, 0 error console (warning duy nhất do gọi `stress()` khi phòng còn đang load). Chủ dự án quyết định **bỏ qua** kiểm Safari/Firefox và thử Telex thật (2026-11-18) — nghiệm thu “Chrome/Safari/Firefox” chỉ xác nhận trên Chrome; fix WASD theo `event.code` giữ nguyên nhưng chưa thử bằng bộ gõ thật.

---

## M8 — Hình ảnh và juice

Chốt qua buổi grill 2026-11-18 (xem GDD §13, ADR-014…017). **Không đổi số balance**: hitbox, damage, AI, spawn giữ nguyên; `run-simulation` phải xanh không cần retune. Nhánh `m8-visuals`, merge `master` (= deploy) khi đạt nghiệm thu. Skill dùng: `game-feel`, `game-ui-ux`, `level-design`, `performance-optimization` (engine-neutral — tự map sang Cocos).

**Việc (theo thứ tự).**
1. **Juice.** Rung màn khi trúng đòn / boss slam, biên độ là bội số nguyên texel (giữ integer scaling M7); squash/stretch player (đổi hướng, trúng đòn) và enemy (trúng đạn); muzzle flash; coin bay về HUD khi nhặt vàng; số damage bằng font pixel. Settings: **Screen shake** bật/tắt (mặc định bật), **Damage numbers** bật/tắt (mặc định tắt).
2. **VFX vũ khí.**
   - Sprite đạn player theo nguyên tố mạnh nhất (ưu tiên): Explosive → BigEnergyBall tint cam, Freeze → IceSpike, Poison → PlantSpike, Homing → ShurikenMagic, Piercing → Kunai, mặc định Shuriken. Sharpen ≥ 3 → bản Big (BigShuriken/BigKunai).
   - Vệt bay 2–3 ghost (pool riêng), màu theo nguyên tố: lửa cam, băng cyan, độc xanh lá, homing tím, crit vàng. Tụt fps → 1 ghost.
   - Impact riêng: crit (Spark lớn + flash trắng + hitstop dài hơn), freeze (`Elemental/Ice`), poison (`Elemental/Plant` + bong bóng), explosive (Explosion + SmokeCircular + shake), pierce (`Attack/Cut` nhỏ), ricochet (Spark ở điểm bật + tia nối mục tiêu mới), execute (`Slash/Arc` + flash đỏ), lifesteal (hạt đỏ bay về player).
   - Player phát `Attack` 4 hướng khi **đứng yên** và bắn; đang chạy giữ walk + muzzle flash.
   - `Magic/Boost` khi nhận skill; `Magic/Aura` dưới chân khi ≥ 8 stack hoặc có skill Epic+, màu theo nguyên tố mạnh nhất.
   - **Ngôn ngữ hình dạng:** đạn player nhọn (shuriken/kunai/spike), đạn địch tròn + viền tối, theo chapter: ch1 EnergyBall, ch2 bong bóng nước, ch3 CanonBall/Rock, ch4 Fireball (ADR-016).
   - Settings **Effects: Full / Reduced** — Reduced tắt trail, aura, particle phụ; giữ impact và telegraph.
3. **Elite palette remap.** Script lúc build sinh PNG biến thể elite, remap theo index `Palette.png` (53 màu) — thay tint nhân màu từ M3 (ADR-015).
4. **Icon skill.** 20 skill → icon 24×24 trong `Ui/Skill Icon` (+ bản Disabled) cho HUD, thẻ chọn skill, shop giữa run, icon cửa. Ánh xạ là data, có test không trùng.
5. **Không khí theo chapter** bằng sprite + `Graphics` (không shader custom — ADR-017): ch1 Raylight + lá bay, ch2 Fog + gợn nước, ch3 tro + vignette, ch4 hơi nóng/cát. **Decor sống** không collider, không che đạn/telegraph: thú `Animal/`, cờ/cây/hoa animated.
6. **Dress lại ch3** (hết “giấy rách”) và boss arena.
7. **Menu sống.** Title + chapter select vẽ phòng thật của chapter, NinjaGreen idle, thú, lớp không khí.
8. **Âm thanh nhỏ.** Biến thể SFX (không lặp một file) + jingle room clear / nhận skill.

**Nghiệm thu.**
- `bun run check` xanh; test mới cho: chọn sprite đạn theo loadout, shake bội số texel, ánh xạ icon, palette remap (màu output ⊂ palette), settings mới round-trip save.
- `run-simulation` xanh **không đổi `tuning.json`**.
- `stress()` **60 fps ở 1920×1080** với Effects Full, loadout có trail + aura; không file deploy > 25 MiB (bỏ trần 15 MB của M7).
- Đọc được: ảnh chụp màn hình đầy đạn — đạn địch phân biệt được với đạn player ở mọi loadout; telegraph không bị decor/FX che.
- 0 lỗi console ở luồng title → ch1 → boss → result.

**Trạng thái: ⏳ Chưa bắt đầu.**

---

## M9 — Nội dung

Nhánh `m9-content`. Skill dùng: thêm `game-ai`, `roguelike`, `game-docs`. Số liệu mới đặt trong `tuning.json` và chỉnh bằng sim (ADR-013); người duyệt bảng sim, không duyệt từng số.

**Việc.**
1. **Pool phòng.** Mỗi chapter 15–18 phòng, mỗi run bốc 9 theo seed run. Phòng sinh bằng script `.tmx` từ template gọn + script dress (mở rộng `scripts/dress-rooms.ts`); người duyệt qua ảnh chụp.
2. **Chọn cửa.** Sau mỗi phòng thường: 2 cửa, mỗi cửa có icon phần thưởng (skill / vàng / hồi máu / shop / rương). Phòng boss luôn cuối (ADR-014).
3. **Phòng đặc biệt.** Hồi máu (NPC), shop giữa run (NPC, **chung vàng meta** — tiêu trong run thì về ít hơn), rương (`Items/Treasure`). NPC lấy từ `Actor/Character/`, chỉ làm NPC, không làm skin player.
4. **Vai trò enemy mới**, có ở cả ch1–4, sprite theo chapter từ monster chưa dùng: **Sniper** (đứng xa, telegraph đường thẳng ~800 ms, 1 viên nhanh), **Splitter** (chết tách 2–3 con nhỏ hơn, tint).
5. **Boss pool** (random 1/2 theo seed), nhạc riêng mỗi boss: ch1 Tengu / GiantFrog · ch2 Squid / GiantSlime · ch3 Samurai / GiantBamboo · ch4 GiantRacoon / Tengu biến thể màu (pattern mạnh hơn). Boss mới theo chuẩn M4: 3 phase, tint + màu telegraph + banner, mỗi phase ≥ 1 pattern buộc di chuyển.
6. **Chapter 4 — sa mạc** (`TilesetDesert` + `tileset_camp`), mở sau ch3. Save bump `version` + migrate.

**Nghiệm thu.**
- Test: bốc phòng theo seed tất định và không trùng trong run; mọi phòng sinh ra đi được từ spawn tới cửa, prop đặc là obstacle, spawn không đè obstacle; phần thưởng cửa theo seed; shop trừ vàng đúng + chặn khi thiếu; splitter tách đúng số con; sniper telegraph trước khi bắn; boss mới đứng yên tại `playerStart` vẫn trúng đòn ở mọi phase; save v1 → v2 migrate.
- Sim (nhiều seed, cả 2 boss mỗi chapter): đứng yên thua phòng 1; né + loadout tiêu biểu thắng cả 4 chapter.
- Chơi trọn ch1 → ch4 trong browser, 0 lỗi console; 60 fps `stress()` 1920×1080.

**Trạng thái: ⏳ Chưa bắt đầu** (chờ M8).

---

## Phụ thuộc

```text
M0 → M1 → M1.5 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9
```

Không mốc nào bắt đầu khi mốc trước chưa đạt nghiệm thu. Ngoại lệ: tải pack Update #8 và dựng bộ tile dungeon có thể chạy song song M0–M1.
