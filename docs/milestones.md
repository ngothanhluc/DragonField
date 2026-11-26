# Milestones — Yokai Field (Index)

Every milestone must be **playable or testable**. No milestone counts as done just because "the code is written".
There are no deadlines, but each milestone is a mandatory stopping point to re-evaluate scope.

Design source: [docs/gdd.md](gdd.md) · Technical decisions: [docs/tech-decisions.md](tech-decisions.md).

---

## Status overview

| Milestone | Scope | Status | Details |
|---|---|---|---|
| **M0 – M7** | Tooling, core loop, art taste test, rooms, combat depth, skills/bosses, meta/UI, art integration, web ship | ✅ Done | [m0-m10.md](milestones/m0-m10.md) |
| **M8 – M10** | Visuals & juice, big rooms + 4 chapters + 8 bosses, playable character rig framework | ✅ Done | [m0-m10.md](milestones/m0-m10.md) |
| **M11 – M15** | Map/weather/UI overhaul, XP & level-up, Dash/Active + pure-combat skills/Evolutions, 4 classes, Save/Resume + Ascension + Endless | ✅ Done | [m11-m15.md](milestones/m11-m15.md) |
| **M16** | Tiếng Việt mặc định, Font Pixel VI & Sửa lỗi nổ vuông (`fx.explosion`) | 📋 Planned | [m16-m21.md](milestones/m16-m21.md#m16--tiếng-việt-mặc-định-font-pixel-vi--sửa-lỗi-nổ-vuông) |
| **M17** | Hệ HP RPG (`100 HP`), HUD mới (HP+XP trên-trái), Pickup phát sáng + Bình Máu, 1 Cổng Bắc VFX mới & Tăng tốc khi dọn phòng | 📋 Planned | [m16-m21.md](milestones/m16-m21.md#m17--hệ-hp-rpg-hud-mới-vật-phẩm-phát-sáng--1-cổng-bắc-vfx-mới) |
| **M18** | Độ khó Bullet-Hell, Bỏ knockback/stagger, 2 quái mới (`dasher`, `gunner`) & Chống lẫn môi trường | 📋 Planned | [m16-m21.md](milestones/m16-m21.md#m18--độ-khó-bullet-hell-bỏ-knockback-2-quái-mới--chống-lẫn-môi-trường) |
| **M19** | Generate bộ Art mới (6 Avatar, 20 Icon skill, Sprite FX) & Lọc bỏ 6 skill nền nhàm chán | 📋 Planned | [m16-m21.md](milestones/m16-m21.md#m19--generate-bộ-art-mới--tinh-gọn-kho-skill-nền) |
| **M20** | 16 Skill độc quyền + 4 Class Evolution cho 4 nhân vật & Skill Codex | 📋 Planned | [m16-m21.md](milestones/m16-m21.md#m20--bộ-skill-độc-quyền-theo-nhân-vật--codex-chi-tiết-skill) |
| **M21** | Sảnh Ngôi Làng 2D tương tác, Cửa Hàng đi vào được trò chuyện, Võ Đường & Cổng Xuất Chinh | 📋 Planned | [m16-m21.md](milestones/m16-m21.md#m21--sảnh-ngôi-làng-tương-tác-cửa-hàng-đi-vào-được--võ-đường) |

---

## Skills Matrix (M16 – M21)

| Milestone | Skills used (`.claude/skills/` + subagents) |
|---|---|
| **M16** | `tdd`, `game-ui-ux`, `game-feel`, `save-systems`, `game-docs` |
| **M17** | `tdd`, `game-ui-ux`, `game-feel`, `roguelike`, `save-systems`, `audio-design`, `performance-optimization`, `image-generator` |
| **M18** | `tdd`, `game-ai`, `physics-tuning`, `game-feel`, `roguelike`, `performance-optimization` |
| **M19** | `create-game-assets`, `image-generator`, `tdd`, `roguelike`, `game-ui-ux`, `save-systems` |
| **M20** | `tdd`, `roguelike`, `game-feel`, `audio-design`, `game-ui-ux`, `performance-optimization` |
| **M21** | `level-design`, `camera-systems`, `input-systems`, `game-ai`, `game-ui-ux`, `audio-design`, `save-systems`, `tdd`, `game-docs` |

---

## Dependencies

```text
M0 → M1 → M1.5 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10 → M11 → M12 → M13 → M14 → M15
  → M16 → M17 → M18 → M19 → M20 → M21
```

No milestone starts before the previous one meets acceptance. Exception: downloading the Update #8 pack and building the dungeon tile set can run in parallel with M0–M1.
