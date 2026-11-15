# GDD — DragonField v2 (roguelite)

Trạng thái: bản nháp 1, chốt các quyết định từ phiên thiết kế 2026-11-15. Chưa có phần nào được implement.

---

## 1. Pitch

Roguelite né đạn một màn hình, top-down 16px. Người chơi **luôn tự động bắn** vào kẻ địch gần nhất, nên kỹ năng duy nhất là **di chuyển**. Mỗi phòng dọn sạch → chọn 1 trong 3 kỹ năng ngẫu nhiên. Chết là hết run, giữ vàng để mua upgrade vĩnh viễn. Rồng là boss cuối của mỗi chapter.

Tham chiếu: Archero (loop), nhưng **bắn liên tục kể cả khi đang chạy** — khác Archero ở chỗ không có "đứng lại mới bắn".

---

## 2. Core loop

```text
Title → chọn chapter → RUN
  phòng 1 → dọn sạch → chọn 1/3 skill
  phòng 2 → ...
  ... 8 phòng
  phòng 9 = BOSS (rồng)
→ màn hình kết quả (số phòng, vàng, thời gian)
→ meta shop (mua upgrade vĩnh viễn)
→ Title
```

- 1 run = 8 phòng thường + 1 boss.
- 1 run dài 8–12 phút.
- 3 chapter; chapter sau mở khi thắng chapter trước.

---

## 3. Combat model

| Tham số | Giá trị |
|---|---|
| Di chuyển | WASD, 8 hướng, không dash |
| Bắn | **tự động, liên tục, kể cả khi đang chạy** |
| Aim | tự nhắm enemy gần nhất trong tầm |
| Nhịp bắn cơ bản | 2 phát/giây |
| Đạn cơ bản | 1 viên, damage 1, tốc độ 12 tile/s |
| Máu người chơi | 6 tim |
| Nhận damage | 1, i-frame **0.8 s**, knockback 3 px |
| Chết | hết run ngay, không hồi sinh trong run |

Không có nút đánh, không có nút bắn. Input duy nhất: **WASD + Esc (pause)**.

---

## 4. Kẻ địch

Chọn theo **vai trò**, không theo tên sinh vật (sinh vật cụ thể lấy từ pack, đổi được mà không sửa logic).

| Vai trò | Máu | Hành vi | Đòn |
|---|---|---|---|
| **Grunt** | 3 | lao thẳng vào player, tốc độ cao | chạm người gây 1 |
| **Caster** | 2 | giữ khoảng cách 4–6 tile, né ra xa khi bị áp sát | bắn đạn chậm, telegraph 500 ms |
| **Brute** | 8 | chậm, đi thẳng | charge theo đường thẳng, telegraph 700 ms |

Độ khó tăng theo chapter:

| Chapter | Số enemy/phòng | Thành phần |
|---|---|---|
| 1 | 3–4 | grunt, 1 caster từ phòng 4 |
| 2 | 5–6 | grunt + caster + 1 brute từ phòng 3 |
| 3 | 7–8 | cả 3 loại + elite (enemy thường ×1.5 máu, ×1.5 damage) |

Elite = cùng sprite, tint màu + scale 1.15, thêm 1 đòn.

---

## 5. Boss: rồng

Máu 60. 3 phase, mỗi phase đổi pattern. Arena là 1 phòng 32×18 tile có 4 cột đá phá được.

| Phase | Máu còn | Pattern |
|---|---|---|
| 1 | 100–66% | breath hình nón 5 viên (telegraph 800 ms) + tail sweep cận chiến |
| 2 | 66–33% | bay lên, dive vào vị trí player (dấu chân trên đất 900 ms), gọi 2 grunt |
| 3 | 33–0% | breath quét 180° (12 viên), dive nhanh hơn, phá 2 cột đá |

Animation rồng: xem ADR-007 — dùng sprite tĩnh + chuyển động bộ phận, không có frame sheet.

---

## 6. Kỹ năng (pool 20, đóng băng ở v1)

Sau mỗi phòng (trừ phòng boss): chọn **1 trong 3** thẻ. Cùng kỹ năng lấy lại thì **cộng dồn** (tối đa 5 stack). Rarity ảnh hưởng trọng số xuất hiện.

| # | Tên | Rarity | Hiệu ứng | Stack |
|---|---|---|---|---|
| 1 | Sharpen | common | +1 damage | 5 |
| 2 | Rapid Fire | common | +25% nhịp bắn | 5 |
| 3 | Twin Shot | rare | +1 viên đạn (bắn chéo ±12°) | 3 |
| 4 | Piercing | rare | đạn xuyên 1 enemy | 3 |
| 5 | Ricochet | epic | đạn nảy sang enemy khác 1 lần | 2 |
| 6 | Homing | epic | đạn tự bám mục tiêu | 1 |
| 7 | Explosive | rare | đạn nổ AoE 1.5 tile, 50% damage | 3 |
| 8 | Crit Eye | rare | 15% chí mạng ×2 | 3 |
| 9 | Vitality | common | +1 tim tối đa (hồi 1 tim ngay) | 5 |
| 10 | Second Wind | epic | hồi 2 tim mỗi khi dọn phòng | 2 |
| 11 | Shield | rare | chặn 1 đòn, hồi sau 20 s | 3 |
| 12 | Thorns | rare | chạm vào enemy gây 2 damage cho nó | 3 |
| 13 | Swift | common | +10% tốc chạy | 5 |
| 14 | Long i-frame | rare | i-frame 0.8 → 1.1 s | 2 |
| 15 | Freeze | rare | trúng địch làm chậm 40% trong 1 s | 2 |
| 16 | Poison | rare | 1 damage/giây trong 3 s | 2 |
| 17 | Lifesteal | epic | 5% damage hồi máu (làm tròn xuống) | 2 |
| 18 | Greed | common | +25% vàng nhặt | 4 |
| 19 | Luck | rare | +1% trọng số rarity cao | 3 |
| 20 | Executioner | epic | +50% damage lên enemy dưới 30% máu | 2 |

---

## 7. Meta progression

Vàng nhặt trong run được giữ sau khi chết. 3 track vĩnh viễn, mỗi track 10 cấp, giá tăng dần:

| Track | Mỗi cấp | Giá cấp 1 → 10 |
|---|---|---|
| Máu | +1 tim | 50 → 500 (tăng ~×1.3) |
| Damage | +5% | 40 → 400 |
| Nhịp bắn | +3% | 40 → 400 |

Không có equipment, không có nhân vật thứ hai, không unlock skill.

---

## 8. Phòng và level design

- **Mỗi phòng = đúng 1 màn hình.** Base resolution **512×288 px = 32×18 tile 16px**. Không scroll, **không cần camera follow**.
- Phòng sinh quái theo **wave** (1 wave/phòng ở chapter 1, 2 wave từ chapter 2).
- Vật cản: cột, hố, tường thấp — dùng để né đạn, không chặn tầm bắn hoàn toàn.
- 3 chapter × 9 phòng = 27 phòng, thiết kế tay trong Tiled, thứ tự cố định (không random layout) — random nằm ở skill, không ở map.

---

## 9. UI

| Màn hình | Nội dung |
|---|---|
| Title | Play, Settings, Credits |
| Chapter select | 3 nút, khoá/mở, hiện best |
| HUD | tim, vàng, icon skill (tối đa 8), số phòng `3/9` |
| Skill pick | 3 thẻ, hover hiện mô tả, click chọn |
| Pause | Resume, Restart run, Quit to title, volume |
| Kết quả | phòng đạt, vàng nhặt, thời gian, nút về meta shop |
| Meta shop | 3 track + giá, hiện vàng hiện có |
| Settings | volume, fullscreen, hiện keybind (không rebind ở v1) |
| Credits | tác giả pack (không bắt buộc với CC0, nhưng nên) |

Điều khiển: **chuột + bàn phím**. Không gamepad, không touch.

---

## 10. Save

`localStorage`, 1 slot:

```json
{
  "version": 1,
  "gold": 0,
  "upgrades": { "hp": 0, "damage": 0, "firerate": 0 },
  "chaptersUnlocked": 1,
  "best": { "chapter": 0, "room": 0 },
  "settings": { "volume": 0.8, "fullscreen": false }
}
```

**Không** lưu run đang chơi (user chọn: mất run khi tắt tab).

---

## 11. Ngoài scope v1

Inventory, equipment, NPC, dialog, hub, shop trong màn, nhiều nhân vật, gamepad, mobile, localization, leaderboard, daily run, dash.

---

## 12. Rủi ro đã biết

1. **Bắn liên tục** làm mất tension "đứng lại mới bắn" của Archero → độ khó phải đến từ mật độ đạn; nếu playtest thấy nhạt, thêm lại luật đứng-ý-định như một skill.
2. **Rồng không có frame animation** → phải làm chuyển động bộ phận; nếu trông tệ, cắt xuống boss "rồng bóng" (silhouette + particle) thay vì cố animate.
3. **20 skill × 3 chapter** là khối balance lớn; giữ pool đóng băng, chỉ tune số.
4. Pack hiện trong repo **chưa phải Update #8** (thiếu `Actor/CharacterAnimated`) → phải tải lại trước M1.5.
