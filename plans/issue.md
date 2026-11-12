I audited the focus feature, the headset session code and XR compatibility, and wrote three handoff plans in [plans/](plans/). No source code was changed, as the `/improve` skill requires. Nothing was tested on a headset or emulator; every finding comes from reading the code and the xrblocks 0.24 source.

`bun run lint` passes at `c64340b`. While I was reading, uncommitted edits appeared in [src/ImmersiveSession.ts](src/ImmersiveSession.ts) and [src/XRInterface.ts](src/XRInterface.ts) (the chip now reopens the panel in place). They are not mine, and plan 002's drift check will flag the `ImmersiveSession.ts` one.

## Findings

| # | Finding | Category | Impact | Effort | Confidence | Evidence |
|---|---------|----------|--------|--------|------------|----------|
| 1 | The focus dim leaves a clear window directly opposite the focus area. The shader searches the whole line through the eye, including the part behind it. | Bug | Turning around mid-session shows a bright hole in the dim | S | High | [FocusVolume3D.ts:58-81](src/FocusVolume3D.ts#L58-L81) |
| 2 | A focus area dragged on the 2D screen is treated as a real room area in the headset. The check compares the zone's label text to the default label. | Bug | "Focus area" start skips the "mark your desk" step and dims around a box metres away | M | High | [storage.ts:93](src/storage.ts#L93), [index.ts:618](src/index.ts#L618) |
| 3 | Task timers subtract one second per interval tick, so they run slow when the browser throttles. The focus timer already uses the wall clock. | Bug | A 25-minute task timer takes longer than 25 minutes, mostly in XR and background tabs | S | High | [LotusUI.ts:206-243](src/LotusUI.ts#L206-L243) |
| 4 | Stop is really pause, and nothing resets the focus clock. The default stopwatch keeps adding to the last session. | UX | No way to start a fresh session in the headset short of cycling the timer mode | S | High | [LotusUI.ts:1013-1057](src/LotusUI.ts#L1013-L1057) |
| 5 | Any failed anchor restore deletes the stored room anchor and re-anchors at the current origin, with no message. | Reliability | Pins and the focus area silently move | M | Medium (needs a Quest check of when restore rejects) | [RoomAnchor.ts:39-45](src/RoomAnchor.ts#L39-L45) |
| 6 | The focus area is an axis-aligned box in room space, and the room axes come from where the first session faced. | XR UX | A desk at an angle gets a box that does not match the dragged rectangle | L (schema change) | High | [FocusVolume3D.ts:120-145](src/FocusVolume3D.ts#L120-L145) |
| 7 | Desk versus wall is decided by ray pitch; the surface normal from the depth hit is discarded. | XR UX | A desk aimed at from a shallow angle becomes a wall area | M | Medium | [ImmersiveSession.ts:1000](src/ImmersiveSession.ts#L1000), [index.ts:541](src/index.ts#L541) |
| 8 | The dim vanishes when the head is inside the focus box, which is easy with a desk zone that rises 0.72 m. | XR UX | Leaning in clears the whole room | S | Medium | [FocusVolume3D.ts:83-99](src/FocusVolume3D.ts#L83-L99) |
| 9 | The dim sphere is drawn at full cost when its strength is zero. | Perf | A wasted full-screen blended pass on both eyes | S | High | [FocusVolume3D.ts:304](src/FocusVolume3D.ts#L304) |
| 10 | The drawer rebuilds its data and a JSON key every frame while open. | Perf | Garbage-collection hitches at 90 Hz | S | Medium | [ImmersiveSession.ts:517](src/ImmersiveSession.ts#L517), [XRInterface.ts:700-733](src/XRInterface.ts#L700-L733) |
| 11 | Every save swallows storage errors. | Reliability | A full or blocked `localStorage` loses data silently | S | High | [storage.ts:234-240](src/storage.ts#L234-L240) |
| 12 | "Exit XR" acts on one press while deletes need two. | XR UX | An accidental pinch ends the session | S | High | [XRInterface.ts:635](src/XRInterface.ts#L635) |

## Code quality verdict: not approved as structured

- **File size:** three files are past 1,000 lines: [LotusUI.ts](src/LotusUI.ts) (3,779), [ImmersiveSession.ts](src/ImmersiveSession.ts) (1,617) and [XRInterface.ts](src/XRInterface.ts) (1,584).
- **Timer in the wrong layer:** the focus timer, the live task list and settings live inside the DOM class, and the headset reaches them through it ([ImmersiveSession.ts:58-66](src/ImmersiveSession.ts#L58-L66)). A `FocusTimer` module owned by `index.ts`, which both interfaces subscribe to, would delete the pass-through getters and the per-frame polling in `syncHudWithTimer`.
- **Focus zone model:** one record stands for three things (placeholder, 2D rectangle, room box), told apart by a label string and a nullable field. Plan 002 fixes the worst of it with an explicit `source` field.
- **Focus setup state:** four loose fields (`zoneBeforeEdit`, `zoneDrawn`, `startTimerAfterZone`, `askingStart`) should be one state union.
- **Focus visuals:** `FocusVolume3D` has four overlapping setters that each re-apply geometry; they should be one `setState`.
- **Drawer actions:** `runDrawerAction` splits a typed action on `:` and passes a plain `string` on, so unhandled actions are silently ignored ([ImmersiveSession.ts:1068-1201](src/ImmersiveSession.ts#L1068-L1201)).

## Plans written

I wrote plans for the top three by leverage that have a clean, verifiable fix:

1. [001-dim-shader-forward-ray.md](plans/001-dim-shader-forward-ray.md) covers findings 1 and 9.
2. [002-focus-zone-source.md](plans/002-focus-zone-source.md) covers finding 2, with a storage migration.
3. [003-task-timers-wall-clock.md](plans/003-task-timers-wall-clock.md) covers finding 3.

They are independent, but 001 and 002 both edit `FocusVolume3D.ts`, so run them one after the other. The index, the unplanned findings and the rejected ones are in [plans/README.md](plans/README.md).

Two things I checked and rejected: depth-mesh ray casts per frame are cheap (xrblocks uses a grid walk), and a pinch stuck after a hand disappears is unlikely (xrblocks sends a final `selectend`).

## Decisions for you

- **Timer reset (finding 4):** should Play on the stopwatch start from zero each time, or should the panel get a reset button? I'd start from zero on each new session, since the headset panel has no room for another button.
- **More plans:** I can write plans for the `FocusTimer` extraction, the anchor-restore check or the rotated focus area if you want them; say which.