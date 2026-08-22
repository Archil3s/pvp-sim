# PvP Sim — Codex Instructions

## Goal
Build a browser-based OSRS-inspired PvP training simulator. It is a simulator only and must not connect to or automate the live OSRS client.

## Architecture rules
- The simulation engine is authoritative. React and Three.js only display and submit commands.
- Game logic runs on deterministic 600 ms ticks.
- Never put combat rules inside React components or Three.js objects.
- All player/AI actions must use the same command interface.
- Prefer data-driven weapon/item/prayer definitions over item-specific conditionals.
- Random combat outcomes must come from seeded RNG so scenarios can be replayed.
- True-tile coordinates are integer grid tiles. Rendering may interpolate visually between them.
- New mechanics should emit combat events that can later feed replays, debugging and AI training.
- Keep prototype values clearly identified until verified against OSRS mechanics.

## Current milestone
Prototype 0.2 includes movement, basic equipment switching, prayers, food, deterministic attacks, an attacking opponent and a combat event log.

## Next priorities
1. Split item/combat definitions out of GameEngine.ts into data modules.
2. Add projectile/impact timing instead of immediate ranged damage.
3. Add attack range and adjacency checks.
4. Add a proper replay frame/event recorder.
5. Add unit tests for tick timing and cooldowns.
6. Replace placeholder fighter geometry with legally usable original/open assets.

## Quality bar
- `npm run build` must pass before merging.
- Preserve deterministic outcomes for the same seed and command sequence.
- Do not silently guess OSRS mechanics. Mark uncertain values as placeholders and isolate them for later verification.
