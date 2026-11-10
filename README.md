<p align="center">
  <img src="assets/logo.svg" alt="LOTUS logo" width="96" height="96" />
</p>

<h1 align="center">LOTUS — Spatial Memory Pins &amp; Study Focus Zone</h1>

<p align="center">
  A single-page <strong>WebXR AR</strong> app that anchors persistent memory pins in your real room,
  pairs them with tasks, and hides everything outside a drag-defined study focus zone
  while a timer runs. Browser-only — no backend, no accounts, no native code.
</p>



## What is LOTUS?

LOTUS turns a physical study space into a spatial workspace. Two core ideas:

1. **Spatial memory pins** — Point at a desk, shelf, or any surface in the room and drop a 3D pin anchored to that exact spot. Attach a title, a full note (typed or dictated), and a surface label. Pins persist across sessions. As you physically move within ~2 meters of a pin, its floating header card pops up so the reminder finds *you*.
2. **Study Focus Zone + timer** — Drag across your desk to define a 3D focus volume. When the timer starts, everything outside that box is masked by a peripheral shield (frosted blur, opaque dark, or warm ambient tint) while the focus area stays perfectly sharp. Stop the timer and the whole room is visible again.

It runs as a fully immersive WebXR session on supported headsets (AR passthrough), or as an interactive 3D study room in any desktop/mobile browser with mouse, touch, and WASD navigation.

## Features

### 📍 Spatial Pins
- Click/pinch on any surface to drop a 3D beacon pin with placement ring preview and live coordinates.
- Proximity-reactive headers: pins stay compact at a distance and auto-pop their floating header badge within a configurable radius (default 2 m).
- Select a pin to open the full note inspector — edit, relocate, resize, or delete.
- Per-pin color and shape style (`revolving` or `dot`), and a pins directory list sorted by proximity or date.
- Mark pins completed/ongoing like tasks.

### ⏱ Timer
- Three timer modes: **preset countdowns** (e.g. 15/25/45 min), **custom countdown** (minute/second controls), and **stopwatch count-up**.
- Pause / stop / reset; the peripheral shield engages the moment the timer starts and clears instantly when it stops.
- Tabular-numeral clock display (zero-jitter countdown numerals).

### 🎯 Focus Zone
- Drag-to-define 3D bounding focus volume with corner resize handles, live dimensions readout, and a text label.
- Three peripheral shield styles: **Frosted Dim**, **Opaque Dark Surround**, and **Soft Ambient Tint**.
- Dual-layer aperture: a 3D surround mesh plus a screen-space projected mask, so the shield stays anchored to the physical area even as you turn your head (critical for AR passthrough, which can't be blurred by regular post-processing).
- Adjustable focus-area visibility and saved zone bounds.

### ✅ Tasks
- Standalone task & reminder list alongside pinned notes — todos with due labels, and reminders with their own per-task countdown timers that tick in the live clock readout.
- Filter tabs: **All / Ongoing / Completed / Insights**.
- Insights view with KPI cards (7-day completions, completions/day, completion rate, peak day) and a D3 bar chart of completed tasks over the last 7 days.

### Also included
- **Manual note input only** (no AI auto-generation): Web Speech API voice dictation with live transcript, plus an in-scene spatial XR virtual keyboard, plus ordinary desktop/mobile keyboard input.
- **Welcome & setup panel** for timer mode, shield style, proximity radius, pin defaults, virtual-room toggle, and sound.
- Procedurally furnished 3D study room (desk, bookshelf, lamp, chair) as a fallback environment when not in AR.
- Rear-camera `getUserMedia` passthrough behind the 3D canvas on AR devices, with webcam fallback.
- Zero-dependency WebAudio sound synth for feedback cues (wrapped for autoplay policy).
- **100% `localStorage` persistence** — pins, tasks, focus zone bounds, and settings never leave your device.

## The logo

The lotus mark above is the app favicon, extracted from `index.html` into [`assets/logo.svg`](assets/logo.svg).

---

# Developer Guide

## Prerequisites

- **[Bun](https://bun.sh)** ≥ 1.x (package manager; only `bun.lock` is committed — do not use npm)
- A modern browser. For the full WebXR AR passthrough experience: a WebXR-capable headset browser (e.g. Meta Quest Browser). Desktop browsers get the 3D room mode with webcam fallback.

## Run it locally

```bash
bun install        # install dependencies
bun run dev        # start Vite dev server on http://localhost:3000 (bound to 0.0.0.0 for LAN testing)
```

Then open the printed URL. Desktop browsers open the interactive 3D room; clicking **Enter XR** (or similar) on a headset starts the AR session.

### Other scripts

```bash
bun run lint       # typecheck (tsc --noEmit) — the only quality gate; run after every change
bun run build      # production build → dist/
bun run preview    # serve the production build locally
bun run clean      # remove dist/
```

## Testing on a physical device

- WebXR and `getUserMedia` (camera) require a **secure context**. `http://localhost:3000` qualifies, but opening `http://<lan-ip>:3000` from a phone or headset does **not** — the camera will be blocked.
- To test AR on a device, either use an HTTPS tunnel to your dev server (e.g. `ngrok`, `cloudflared`), or `bun run build` + `bun run preview` behind TLS.
- The dev server binds `0.0.0.0:3000` intentionally so LAN devices can reach it (over HTTPS).

## Project structure

```
index.html               entry HTML; app favicon (logo source), fonts, meta
metadata.json            xrblocks app-builder manifest (requests camera + microphone)
assets/
  icon.svg               LOTUS brand icon (inlined into the UI via `?raw` import; fill=currentColor)
  logo.svg               logo shown in this README (white background)
src/
  vite-env.d.ts          vite/client types (`?raw` SVG imports)
  index.ts               bootstrap: builds xb.Options() and mounts LotusSpatialApp;
                         drag/pinch interaction state for BOTH input families
                         (DOM mouse/touch AND XR controller/hand pinch)
  LotusUI.ts             all DOM overlay UI (d3-based): welcome panel, note composer,
                         XR keyboard, pin inspector, pin directory, tasks + insights
  PinManager3D.ts        3D beacon pins, proximity detector, floating headers
  FocusVolume3D.ts       drag-to-define focus volume, shield meshes, aperture projection
  CameraPassthrough.ts   getUserMedia video feed behind the transparent canvas
  StudyRoomBuilder.ts    procedural furnished study room + surface colliders
  sound.ts               zero-dependency WebAudio synth
  storage.ts             localStorage persistence + seed/demo data + migrations
  types.ts               data shapes (all JSON-serializable)
  index.css              theme + layout (obsidian slate / cyan / amber palette)
```

## Tech stack

- **[xrblocks](https://www.npmjs.com/package/xrblocks)** — WebXR app framework / lifecycle (`xb.Script` feature modules with `init()`/`dispose()`, `xb.core.camera`)
- **three.js** — 3D scene, geometry, raycasting, billboarding
- **lit** — dependency of xrblocks (XR button / simulator UI statically import it; required for `vite build` even though LOTUS never imports it directly)
- **d3** — DOM overlay rendering, task insights charts
- **Vite** — dev server and builds (no `vite.config.ts`; defaults only)
- **Web Speech API, getUserMedia, WebAudio, localStorage** — platform APIs, degrade gracefully when unsupported

## Notes & constraints

- There is **no backend, no env vars, no API keys**. Nothing reads `process.env` / `import.meta.env`.
- `package.json` is deliberately minimal: `d3`, `lit`, `three`, `xrblocks`. `lit` is required by xrblocks (dropping it breaks `vite build`), and `@pmndrs/uikit` auto-installs as xrblocks' required peer. Other xrblocks peers (`openai`, `@google/genai`, `@mediapipe/*`, spark, three-mesh-bvh, three-pathfinding) are optional peers never bundled in — LOTUS has no AI/vision SDK code. Don't re-add them unless actually using an xrblocks feature that needs one.
- Number of scripts beyond the `package.json` ones: none. There is **no test suite and no CI**; `bun run lint` (typecheck) is the sole gate.
- Product spec and confirmed UX decisions live in `.plan/artifacts/implementation_plan.md` — read it before product-level changes.
- If you change requested device permissions, update `metadata.json` (`requestFramePermissions`) accordingly.
- Every interaction code change must handle **both input families**: DOM mouse/touch and XR controller/hand pinch, or the app breaks on headset.

## Contributing workflow

1. `bun install`
2. Make your change.
3. `bun run lint` — must pass with no type errors.
4. Manually test both desktop (mouse/touch) and, if your change touches interaction or camera, a WebXR device over HTTPS if possible.
