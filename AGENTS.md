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
- Alter (BSD 2-Clause) is an approved behavioural/architectural reference. Preserve attribution in `THIRD_PARTY_NOTICES.md` when adapting its implementation details.

## Current milestone
Prototype 0.3 includes:
- queued one-tile movement steps,
- data-driven weapon attack speed/range,
- persistent attack intent with movement into weapon range,
- delayed ranged/magic impacts,
- projectile state exposed by the simulation,
- deterministic attacks and opponent attacks,
- equipment switching, prayers, food and combat event logging.

## Known simplifications
- Route building is straight-line and has no collision map yet.
- Running/two-step movement is not implemented yet.
- Accuracy/max-hit values are still placeholders.
- Projectile line-of-sight is not implemented yet.
- Prayer timing/damage snapshot semantics must be verified against current OSRS PvP behaviour.
- The opponent AI is a deterministic test opponent, not a model of real PK behaviour.

## Next priorities
1. Add unit tests for 3-tick/5-tick attack cadence, attack range and delayed impacts.
2. Add collision flags and line-of-sight validation.
3. Add walk/run movement semantics and routefinding.
4. Port and verify ranged accuracy/max-hit formulas and equipment bonuses.
5. Add a proper replay frame/event recorder.
6. Add projectile rendering based only on `WorldState.projectiles`.
7. Replace placeholder fighter geometry with legally usable original/open assets.

## Quality bar
- `npm run build` must pass before merging.
- Preserve deterministic outcomes for the same seed and command sequence.
- Do not silently guess OSRS mechanics. Mark uncertain values as placeholders and isolate them for later verification.
