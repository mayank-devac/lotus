# AGENTS.md

## What this repo is

- LOTUS: single-page WebXR AR app — spatial memory pins anchored in the real room plus a study focus zone with peripheral blur timer. Browser-only; no backend, no native code.
- `README.md` is **empty** — trust code and `index.html` meta tags, not the README.
- Product spec and confirmed UX decisions (pin behavior, timer modes, "no AI auto-generation" constraint): `.plan/artifacts/implementation_plan.md`. Read it before product-level changes.

## Commands (bun, not npm)

- Package manager is **bun** — only `bun.lock` is committed, no `package-lock.json`. Use `bun install`, `bun run <script>`.
- `bun run dev` — Vite dev server on `0.0.0.0:3000` (host bind is intentional for LAN device testing).
- `bun run lint` — the ONLY quality gate, and despite the name it is `tsc --noEmit` (typecheck). There is no ESLint and no test suite; the GitHub Pages deploy workflow runs this typecheck before building. Run it after every change.
- `bun run build` → `dist/`; `bun run preview` serves the build.
- No env vars or API keys anywhere (nothing reads `process.env`/`import.meta.env`). `vite.config.ts` only sets a relative `base` (GitHub Pages sub-path) and dedupes `three`.

## Architecture / wiring

- Entry: `index.html` → `src/index.ts`. On `DOMContentLoaded` it builds `xb.Options()` (title, depth enabled, reticles disabled; no `enableCamera()` — LOTUS opens the webcam itself), then `xb.add(new LotusSpatialApp())` + `xb.init(options)`. There is no router; one screen.
- xrblocks lifecycle: feature modules extend `xb.Script`, override `init()`/`dispose()`, and attach roots via `this.add(...)` (see `LotusSpatialApp` in `src/index.ts`). Camera access goes through `xb.core?.camera`.
- **AR passthrough is NOT the WebXR camera API**: `src/CameraPassthrough.ts` gets a `getUserMedia` stream and renders a `<video>` element behind a transparent three.js canvas. Rear camera (`facingMode: 'environment'` ideal) with fallback to any webcam (desktop).
- `src/CameraGate.ts` is the onboarding card and the ONLY way into XR: xrblocks' own Enter XR button is hidden by CSS (`#XRButtonWrapper`) and the gate forwards taps to it. The gate is hidden/re-shown, never destroyed, and leaves an "Enter XR" chip when dismissed on immersive-ar devices. During a session the webcam stream is stopped (`bindXRSessionEvents` in `src/index.ts`).
- Persistence is 100% `localStorage` (`src/storage.ts`: pins, tasks, focus zone, settings). Data shapes live in `src/types.ts` and must stay JSON-serializable. Changing a schema requires a migration in `storage.ts` loaders, not just type edits.
- UI (`src/LotusUI.ts`) is a DOM overlay using d3, not lit or @pmndrs/uikit. Voice dictation uses the Web Speech API directly and degrades gracefully when unsupported.
- **The DOM UI is invisible inside an immersive session on a headset.** `src/XRInterface.ts` is the in-headset UI (canvas-textured control panel, pin card, pin labels, aiming rays); `index.ts` ray-tests it itself from the controller/hand pose in `onSelectStart`/`onSelecting`/`onSelectEnd`, which are XR-only. Any feature the user needs in the headset must be reachable from there, not only from `LotusUI`.
- Pins and the focus zone are stored in "room space": they hang under `worldRoot` in `index.ts`, which `src/RoomAnchor.ts` moves each frame from one persistent WebXR anchor. Convert ray hits with `worldRoot.worldToLocal` before storing (`raycastSpatialPoint` already does) and use world positions for distances.
- The focus shield in a headset is the dim shell in `src/FocusVolume3D.ts` (passthrough cannot be blurred in WebXR); the CSS `backdrop-filter` shield is 2D-only.
- Sound is a zero-dependency WebAudio synth (`src/sound.ts`); all playback wrapped in try/catch for autoplay policy.

## Gotchas

- Camera (`getUserMedia`) and WebXR require a **secure context**: opening the dev server over plain `http://<lan-ip>:3000` on a phone/headset blocks the camera (localhost is fine in desktop browsers). Real-device AR testing needs HTTPS (tunnel) or localhost.
- Must handle both input families: DOM mouse/touch **and** WebXR controller/hand pinch (`index.ts` has parallel drag/pinch state per family, e.g. `pinDragFromDOM` vs `xrDragPinId`). Changes to interaction code need both paths, or the app breaks on headset.
- `metadata.json` declares `requestFramePermissions` (camera, microphone) for the xrblocks app builder — update it if requested permissions change.
