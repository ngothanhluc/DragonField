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

M0–M6 xong, M7 (ship) đang làm — xem `docs/milestones.md`. Game chạy ở **https://yokai.lukeinc.tech**
(Cloudflare Worker `yokai-field`, chỉ file tĩnh). Trang giới thiệu nằm ở portfolio:
https://lukeinc.tech/projects/dragon-field (repo riêng `luke-tech`).

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
/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator \
  --project game --build "platform=web-desktop;debug=false"
# exit code 36 = build thành công (quy ước của CLI Cocos), không phải lỗi
```

Deploy (thủ công từ máy, CI không build được Cocos):

```bash
cd game
bun run deploy:prepare   # build/web-desktop → deploy/ + sửa index.html, icon, OG, _headers; chặn nếu > 15 MB
bun run deploy           # check + deploy:prepare + wrangler deploy (cần `bunx wrangler login` một lần)
```

## Cấu trúc

```text
game/                  # project Cocos Creator — mọi thứ engine đọc nằm ở đây
├── assets/
│   ├── scripts/
│   │   ├── core/      # logic thuần TS — KHÔNG được import 'cc'
│   │   ├── game/      # component Cocos: adapter mỏng quanh core
│   │   ├── screens/   # màn M5 dựng bằng code (title/shop/pause/result/…)
│   │   └── ui/        # component UI
│   └── resources/
│       ├── data/      # animations manifest, level data
│       └── art/       # subset của pack, load theo path lúc runtime
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
2. **Không hardcode đường dẫn sprite.** Tham chiếu qua tên logic trong `assets/resources/data/animations.json` (`player.idle.down`). Pack thiếu thì khai báo `fallback`.
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
| Stub `cc` làm named import thành `any` **value**, không dùng được ở vị trí type | trong `assets/scripts/game/`, alias `type Node = InstanceType<typeof CocosNode>` (đã dùng ở 5 file); gom về một file khi có `cc.d.ts` thật từ editor |
| `resources.load` callback: `err` là `undefined` (không phải `null`) khi thành công | kiểm tra bằng truthiness (`if (err)`), đừng so `=== null` — sẽ đọc `.message` trên `undefined` |
| Build transpile kiểu loose: `[...set]` thành `[].concat(set)` → mảng chứa nguyên `Set` (vitest/tsc không bắt được) | Set/Map/iterator → mảng thì dùng `Array.from(x)`; chỉ spread array thật |
| Sprite/Label không nằm dưới Canvas thì **không được vẽ** | node gốc của world phải có `RenderRoot2D` (đã gắn trong `createWorldLayers`) |
| `.tmx` tham chiếu `.tsx` bằng tên file trần, cùng thư mục | importer lưu đúng chuỗi `source` làm key và engine tra `tsxContentMap[source]` **không fallback** (ảnh thì có fallback theo basename). Đặt `field.tsx` cạnh `room-*.tmx`, `source="field.tsx"`; ảnh trong `.tsx` cứ dùng đường dẫn tương đối |
| `TiledMap` vẽ tile bằng **pixel**, không phải unit | node map scale `1/16` (`ACTOR_SCALE`) và đặt ở tâm phòng `(16,9)`, anchor `(0.5,0.5)`; va chạm/vật cản lấy từ object layer (`.tmx` → `LevelData.obstacles`), **không** suy ra từ tile |
| Stub `cc` là `any` nên `this.foo()` trên class extends `Component` không bị tsc kiểm tra | method không tồn tại chỉ nổ lúc runtime — chạy build web thử sau khi sửa `game/` |
| Bộ gõ tiếng Việt (Telex/VNI) đang soạn chữ gửi `keydown` với `keyCode = 229`, `key = 'Process'`/`'ư'`/`'đ'`; `input` của Cocos chỉ chuyển `keyCode` → WASD kẹt. CDP/puppeteer không qua bộ gõ nên không tái hiện | Phím di chuyển đọc `event.code` (phím vật lý) trên `document` capture (`game/keyboard-move.ts` + `core/movement/move-keys.ts`), nhả hết phím khi `blur`. `?debug=1` có `__yokai.keyLog()` để xem event thật |
| `nine_path_panel*.png` (theme-wood) có sẵn một ô vuông lệch tâm bên trong → kéo 9-slice ra hai khung chồng lệch | panel/thẻ dùng `nine_path_panel_interior.png` (tâm đồng màu) |
| Camera world ở bội số nguyên (M7) có thể nhỏ hơn band UI `SHOW_ALL` → HUD dựng theo mép design sẽ trôi ra vùng bar | `WorldCamera.hudScale` (`worldToUiScale`) — node HUD nhân theo số này để bám mép phòng |
| Boss lớn hơn hitbox nhiều (Samurai 96 px); chừa tường theo hitbox thì charge sát tường bị camera cắt nửa người | `BOSSES[id].spriteExtentTiles` (đo từ PNG, `art-files.test` kiểm) → `bossRoomBounds` |
| Scale sprite | **1 texture px = 1/16 unit** (`ACTOR_SCALE` trong `level-view.ts`). Không chuẩn hoá theo bề rộng frame — làm vậy player 32 px sẽ nhỏ bằng nửa con quái 16 px |
| `Sprite.sizeMode = CUSTOM` lấy kích thước từ `UITransform.contentSize` (**mặc định 100×100**), không lấy từ frame | mọi sprite dựng bằng code phải gọi `transform.setContentSize(frame.width, frame.height)`; thiếu dòng đó thì hình to gấp ~3 lần dù rect/scale đúng (vòng telegraph M3 bị đúng lỗi này) |
| Build `web-desktop` ép `exactFitScreen = false` (plugin build ghi đè trong settings) → canvas đứng yên ở kích thước lúc build, `window.resize` **không** tự đổi canvas; chỉ `screen.windowSize` mới đổi được (chế độ SubFrame) | Từ M5 `game/viewport.ts` (`fillBrowserViewport`) gán `screen.windowSize` lúc boot + mỗi `window.resize`, nên canvas bám viewport và UI 16:9/16:10/4:3 không bị cắt. Test phải kiểm `canvas.getBoundingClientRect()` = `innerWidth×innerHeight`, không chỉ `page.setViewport` |
| Template build đặt canvas trong `#GameDiv` có **border 5px** + inline `1280×960`, kèm `h1.header`/`p.footer` | `fillBrowserViewport` phải set `#GameDiv` fixed `100vw/100vh`, border 0, ẩn header/footer; chỉ đổi `screen.windowSize` thì canvas lệch 5px và tràn viewport (đo được ở headless: `canvas.x = 5`) |
| `label.node.position` là toạ độ **local** trong button cha, không phải toạ độ canvas | debug `uiText()`/click-to-label phải dùng `node.worldPosition` (Canvas ở 0,0); dùng `.position` thì mọi nút báo cùng một rect và click "Play" rơi vào nút bên dưới |
| Texture UI import mặc định lọc **bilinear** → nút gỗ 16×8 phóng to và thẻ skill bị nhoè | UI frame/thẻ/chapter button load qua `loadPixelTexture` (`setFilters(NEAREST, NEAREST)`); HUD tim/thanh máu cũng dùng. World art vẫn đi `loadTexture` cho tới khi M6 quyết riêng |
| Kéo giãn frame nút 16×8 có góc trong suốt làm nền tối full-screen + nearest → 4 góc trong suốt phóng to thành lỗ, HUD/world lọt qua | nền phủ màn dùng `Graphics` (`createBackdropPanel`), không dùng sprite frame nút |
| Trình duyệt dùng Esc để thoát fullscreen và **không giao keydown** cho page | Màn Settings vẫn phải có nút Back chuột; nghe `fullscreenchange` để đồng bộ save/nhãn, đừng coi Esc là đường thoát duy nhất khi đang fullscreen |
| `Camera.clearFlags = SOLID_COLOR` chỉ xoá trong `rect` của camera; phần ngoài rect là backbuffer (đen, không đảm bảo màu) | Camera nền `visibility = 0`, `priority = -1`, `rect = (0,0,1,1)` để tô bar letterbox (`bootstrap.createBackdropCamera`) |
| Asset mới (`.tmx`/`.tsx`/folder) cần `.meta`; meta sai JSON thì asset-db báo `Read meta ... failed` và lần build đó có thể bỏ qua asset | `.tmx.meta`: `importer: "tiled-map"`, `files: [".json", ".tmx"]`; `.tsx.meta`: `importer: "text"`, `files: [".json"]`; folder: `importer: "directory"`. Sinh meta bằng script thì kiểm `python3 -c 'import json,glob;...'` trước khi build |
| Nhiều tileset trong một `.tmx`: `firstgid` phải bằng tổng `tilecount` của các tileset trước + 1 (`TilesetField` có 75 tile → tileset thứ hai `firstgid="76"`) | gid trong layer = `firstgid + row*columns + col`; sai firstgid thì tile hiện lệch cả bảng hoặc trong suốt |
| Key event "tổng hợp"/headless không tới `input` của Cocos hoặc bị canvas chặn bubble; UI modal nghe phím sẽ im lặng | UI cần phím (skill pick 1/2/3) nghe thêm `document.addEventListener('keydown', handler, true)` ở **capture phase**, và gỡ đúng handler khi destroy; đừng chỉ dựa vào `input.on(KEY_DOWN)` |
| `input.on` của Cocos gắn sau `await` (load texture) → người chơi bấm phím ngay frame mở modal bị mất | gắn listener phím **trước** mọi `await` trong hàm dựng modal; build phần hình sau |
| `TilesetWater` là autotile **kênh rưới** (nền xanh + bờ cam), không phải sông; stamp khối 4×3 ra hình ống/mosaic | `Backgrounds/Animated/Waterfall/*` và `Water Ripples/*` mới là sprite strip nước; đặt bằng `room-water.ts` + nền `Graphics` xanh, không đưa vào tile layer |
| Mỗi slot FX dùng một `SpriteAnimator` (component + promise load frame mỗi lần đổi frame) làm `stress()` tụt còn ~40 fps | pool FX tự slice frame lúc init + **một** clock chung (`fx/effect-pool.ts`); chỉ dùng `SpriteAnimator` cho actor |
| `Sprite.Type.SLICED` không có inset trên `SpriteFrame` thì vẫn kéo giãn cả 4 góc | set `insetLeft/Right/Top/Bottom` khi slice (xem `sliceSliced` trong `screens/menu.ts`) |
| Font pixel load async; label tạo trước khi font về giữ metrics font hệ thống và có thể cắt chữ | `applyPixelFont` đổi `useSystemFont=false` + `font` + `updateRenderData(true)` khi promise xong; mọi label UI đi qua `createLabel` |
| `NormalFont.ttf` của pack có space advance 227/2048 em (~0.11 em) → Cocos render "Clearthechapter", dấu cách gần như mất | patch `hmtx` glyph space lên 682/2048 em bằng `bun run fix:font` (`scripts/lib/font-spacing.ts`; `stage:art` tự gọi sau khi copy font) |
