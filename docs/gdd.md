# GDD — Yokai Field (Index)

**Status:** M0–M21 implemented and shipped on `master`; M16–M21 landed between 2026-11-26 and 2026-11-28, with M21 proven end to end in a release build (see `docs/milestones/m16-m21.md`).

---

## 1. Pitch

Top-down 16px pixel-art bullet-hell roguelite on web-desktop. Basic firing is **100% continuous auto-fire** at the nearest enemy while moving — the skill is positioning, bullet dodging, **Dash (`Space`)**, and **Signature Active (`E` / Right-Click)**. Clear rooms, collect XP/Gold/Health pickups, level up for 1-of-3 skills (shared core + class-exclusive skills + Legendary Evolutions), defeat chapter bosses, and spend permanent gold in the interactive **Village Hub**.

4 chapters (**Grassland/Forest → River/Waterfall → Abandoned Village → Desert**), 4 playable classes (**Ninja, Archer, Mage, Cultivator**), 8 pooled chapter bosses, Ascension 1–5, and Endless loop.

---

## 2. Core loop

```text
Title ("Vào Làng" / "Tiếp tục" / "Cài đặt")
  → Playable Village Hub (walk with WASD)
      ├─ West: Enterable Shop Interior (talk to Shopkeeper → Meta Upgrades & Hero Unlocks)
      ├─ East: Dojo (switch character live + inspect Skill Codex)
      └─ North: Expedition Gate (choose Chapter 1–4 + Ascension)
            → RUN (8 rooms + 1 Boss; mid-chapter special room after room 4)
                ├─ Kill enemies → collect glowing XP / Gold / rare Health drops
                ├─ XP threshold → mid-combat Level-Up (1-of-3 + gold Reroll + radial safety wave)
                └─ Room clear → speed boost → single North Portal (VFX) → next room → Boss
            → Rich Results / Death screen (permadeath wipes runSave; keep gold)
            → Return to Village Hub
```

---

## 3. Document map

Detailed rules and tuning live in focused modules (one fact, one home):

| Module | Scope | Milestones | Status |
|---|---|---|---|
| [Baseline Systems (v1–M15)](gdd/v1-v15-baseline.md) | Combat model, enemies, bosses, meta, rooms, UI, save v5, M8–M15 architecture (`§3–§15`) | M0–M15 | `implemented` |
| [i18n (Vietnamese Default) & FX Fixes](gdd/m16-i18n-and-fx-fixes.md) | `core/i18n/` (`vi` default + `en` toggle), Vietnamese pixel font, `fx.explosion` 9×40×40 fix & FX slice audit | M16 | `designed` |
| [RPG HP Bar, Pickups & Single North Portal](gdd/m17-hp-pickups-portal.md) | `100 HP` base scale, top-left HP + XP HUD, small glowing XP/Gold + rare Health Potion, single North Portal + Portal VFX, room-clear speed boost | M17 | `designed` |
| [Bullet-Hell Difficulty, New Enemies & Visual Clarity](gdd/m18-difficulty-and-clarity.md) | Remove enemy hit knockback/stagger, speed/bullet/density escalation, `dasher` & `gunner` roles, move animals out of combat, softened weather & high-contrast outlines | M18 | `designed` |
| [Art Generation, Skill Pruning & Class-Exclusive Skills](gdd/m19-m20-class-skills-and-art.md) | `image-generator` asset batch (6 portraits, 20 skill icons, class FX), prune 27 → 21 core skills, 16 class-exclusive skills + 4 Class Evolutions, Skill Codex | M19–M20 | `designed` |
| [Interactive Village Hub & Enterable Shop](gdd/m21-village-hub.md) | Playable 36×24 village, wandering villagers & animals, enterable Shop interior + RPG dialog, Dojo character swap, North Gate & quick shortcuts | M21 | `implemented` |

Related project docs:
- Roadmap & acceptance: [docs/milestones.md](milestones.md) (detailed M16–M21: [docs/milestones/m16-m21.md](milestones/m16-m21.md))
- Architecture decisions: [docs/tech-decisions.md](tech-decisions.md) (`ADR-001` – `ADR-028`)
- Art pipeline & pack inventory: [docs/art/pack-inventory.md](art/pack-inventory.md), [docs/art/gemini-style.md](art/gemini-style.md)

---

## 4. Change log

- **2026-11-26 (grill session 2):** Split `docs/gdd.md` and `docs/milestones.md` into index + modular files; locked M16–M21 expansion (`ADR-024`–`ADR-028`).
- **2026-11-26 (grill session 1):** Shipped M11–M15 (`ADR-019`–`ADR-023`).
- **2026-11-18 – 2026-11-22:** Shipped M8–M10 (`ADR-014`–`ADR-018`).
- **2026-11-15 – 2026-11-18:** Shipped v1 M0–M7 (`ADR-001`–`ADR-013`).
