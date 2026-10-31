# Lotus — Spatial Memory Pins & Study Focus Zone

lotus is a WebXR and interactive 3D spatial environment that lets you anchor persistent memory pins onto furniture and room surfaces—revealing note headers automatically as you walk within 2 meters and expanding into full notes when selected—paired with a drag-to-define 3D Study Focus Zone and timer that masks peripheral distractions while keeping your study area crystal clear.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product and UX decisions incorporate your confirmed preferences from our planning session:

- **Proximity-Reactive Memory Pins**: Saved spatial pins remain compact at a distance, automatically pop up their floating header badge when you move within **2 meters**, and expand to display the full note details and location metadata when clicked or pinched.
- **Manual Note Input via Voice & Virtual XR Keyboard**: Notes are 100% manual without AI auto-generation. You can dictate notes hands-free using Web Speech API voice recognition or type/edit directly using both an in-scene spatial XR virtual keyboard and standard desktop/mobile keyboard inputs.
- **Welcome & Configuration Tab for Focus Timer & Peripheral Shield**: A dedicated **Welcome & Setup Tab** lets you choose across all timer modes (**Preset Durations** like 15/25/45m, **Custom Countdown** minute/second controls, or **Stopwatch Count-Up**) and switch between all three peripheral distraction shields (**Frosted Peripheral Dim Shield**, **Opaque Dark Surround Mask**, or **Soft Ambient Tint**) that activate automatically when the timer starts and clear completely when the timer stops.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. **Spatial Memory Pins**: Point and click/pinch on any furniture item, desk, shelf, or room coordinate to drop a 3D spatial pin. Attach a title, detailed note (via voice dictation or XR/desktop keyboard), and location label. All pins persist automatically across sessions. As you walk or navigate through the space, pins within 2 meters smoothly elevate their floating header card so you remember key tasks at a glance; selecting a pin opens the complete note card.
  2. **Drag-to-Focus Study Zone & Timer**: Switch to Focus Zone mode and drag across your desk or study surface to define a 3D bounding focus volume. When you start the timer, a spatial aperture shield blurs or masks everything outside your dragged focus zone so your eyes stay locked on your study area. Stopping or resetting the timer immediately restores full visibility across the entire room.
- **Target Audience / Persona**: Students, researchers, and spatial computing users who want to organize physical study spaces with location-anchored reminders and eliminate peripheral visual clutter during deep-focus sessions.
- **Key Value**: Bridges spatial memory (locating notes where they matter physically) with visual attention management (isolating a physical or virtual workspace during timed study blocks).

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Welcome & Mode Selection Flow**:
   - On launch, a clean Welcome & Configuration surface greets the user with quick-start presets for **Memory Pin Mode** and **Focus Study Mode**, alongside preferences for timer behavior (Preset Countdown, Custom Countdown, or Stopwatch) and peripheral mask style (Frosted Blur Shield, Opaque Dark Mask, or Soft Warm Amber Tint).
   - Users can enter full WebXR AR passthrough on supported headsets/devices or explore an interactive 3D furnished study room (complete with desk, bookshelf, lamp, lounge chair, and study props) right in the browser using mouse/touch and WASD/arrow navigation.
2. **Adding & Inspecting Spatial Memory Pins**:
   - **Placement**: Hovering the reticle over any surface previews a grounded placement ring with real-time coordinates. Clicking/pinching drops a multi-part 3D beacon pin and opens the Note Composer.
   - **Voice & XR Keyboard Entry**: Users tap the microphone button to dictate the header and full note via live speech-to-text, or tap keys on the spatial XR virtual keyboard (or physical keyboard) to type. Clicking **Save Pin** persists the pin's 3D world coordinates, surface label, header, and full body text.
   - **Proximity & Inspection**: Walking within **2.0 meters** of any saved pin smoothly scales up its floating header label (`Auto-pop header`). Clicking or pinching the pin opens the full note inspection card with options to edit, relocate, or delete.
3. **Dragging a Focus Area & Running the Study Timer**:
   - **Drag to Select Focus Volume**: In Focus Zone mode, pressing and dragging across a desk or room area draws an interactive 3D focus frame with corner resize handles and a live dimensions readout.
   - **Timer Activation & Peripheral Blur**: Pressing **Start Timer** activates the selected countdown or stopwatch and smoothly transitions the surrounding space outside the dragged focus zone into the chosen distraction shield (Frosted Peripheral Dim, Opaque Dark Surround, or Soft Ambient Tint) while keeping the dragged study zone 100% sharp and unobstructed.
   - **Stopping / Completing Timer**: Pressing **Pause / Stop Timer** (or when the countdown finishes) immediately lifts the peripheral blur/mask so the entire room is clear again.

### Visual Identity & Theme

- **Aesthetic Direction**: Tactile Spatial Utility — crisp architectural glass surfaces, high-contrast studio typography, and physically grounded 3D markers that remain effortless to read against both real-world AR passthrough and 3D room geometry.
- **Color Palette & Mood**:
  - `--background`: Deep Obsidian Slate (`#0B0F17`) for 2D/spatial HUD backing (`rgba(11, 15, 23, 0.86)`) with subtle hairline borders (`rgba(255, 255, 255, 0.12)`).
  - `--primary`: Electric Cyan (`#06B6D4`) for active memory pin beacons, reticle placement rings, and proximity highlights.
  - `--accent`: Warm Study Amber (`#F59E0B`) for focus zone boundaries, active timer progress, and primary call-to-action controls.
  - `--text`: Crisp Alabaster (`#F8FAFC`) for primary headings and tabular timer numerals; Muted Slate (`#94A3B8`) for coordinates and distance readouts.
- **Typography & Hierarchy**:
  - *Display & Headings*: `Plus Jakarta Sans` (SemiBold 600) for spatial card titles and mode headers.
  - *Body Prose*: `DM Sans` (Regular 400 / Medium 500) for full note contents and setup instructions.
  - *Timer, Distance & Coordinates*: `JetBrains Mono` with `tabular-nums` for zero-jitter countdown clocks, stopwatch ticks, and meter distance readouts (`1.42 m`).
- **Component Styling & Layout**:
  - **Collapsible Bottom Control Dock**: All primary mode switches, timer controls, and quick pin list navigation sit in a sleek, collapsible bottom-center dock so the central 3D/AR viewport stays 100% unobstructed.
  - **Spatial 3D Cards & XR Keyboard**: Floating 3D note headers and an interactive spatial keyboard panel face the user smoothly using damped billboarding.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dual-Layer Focus Zone Aperture (3D Spatial Stencil/Volume + Screen-Space Projected Aperture)**
  - *Chosen Approach*: Combine a 3D bounding focus volume (rendered around the dragged study area with corner handles and a 3D surrounding dim/tint/frosted curtain) with a synchronized real-time projected viewport aperture mask that applies true optical blur, opaque dark masking, or warm ambient tinting to everything outside the 3D focus box's projected bounds.
  - *Why*: WebXR passthrough feeds cannot be blurred by standard WebGL post-processing shaders alone, whereas pure 2D screen rectangles do not stay anchored in 3D space when you turn your head. Projecting the 3D dragged bounding box into a dynamic spatial-plus-viewport aperture guarantees that looking or moving around keeps the exact 3D desk area clear and everything else blurred/masked in both 3D and AR.
- **Decision 3: Voice Dictation + In-Scene XR Keyboard for Manual Note Entry**
  - *Chosen Approach*: Integrate native Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) with live transcript feedback alongside an interactive on-screen and 3D XR virtual keyboard.
  - *Why*: Directly fulfills your requirement for manual note creation via voice or XR keyboard without any unwanted AI text rewriting.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   LocusAR Spatial Runtime (XR Blocks + Three.js)            │
├──────────────────────────────────────┬──────────────────────────────────────┤
│        3D Spatial Scene Layer        │       Interactive HUD & XR UI        │
│                                      │                                      │
│  ┌────────────────────────────────┐  │  ┌────────────────────────────────┐  │
│  │   Procedural Furnished Room    │  │  │     Welcome & Setup Modal      │  │
│  │  (Desk, Shelf, Lamp, Sofa,     │  │  │  • Timer Mode Selector         │  │
│  │   Raycasting Surface Colliders)│  │  │  • Peripheral Shield Selector  │  │
│  └───────────────┬────────────────┘  │  └───────────────┬────────────────┘  │
│                  │                   │                  │                   │
│  ┌───────────────▼────────────────┐  │  ┌───────────────▼────────────────┐  │
│  │   Spatial Memory Pin Manager   │◄─┼─►│  Note Composer & XR Keyboard   │  │
│  │  • Multi-part 3D Beacon Group  │  │  │  • Web Speech Voice Dictation  │  │
│  │  • < 2.0m Proximity Detector   │  │  │  • Virtual QWERTY Key Grid     │  │
│  │  • Floating 3D Header & Card   │  │  │  • Full Note Inspector Modal   │  │
│  └───────────────┬────────────────┘  │  └───────────────┬────────────────┘  │
│                  │                   │                  │                   │
│  ┌───────────────▼────────────────┐  │  ┌───────────────▼────────────────┐  │
│  │  3D Focus Volume & Drag Gizmo  │◄─┼─►│  Collapsible Bottom Dock &     │  │
│  │  • Raycasted Drag-to-Box       │  │  │  Focus Aperture Shield Engine  │  │
│  │  • 3D Surround Dim/Frost Mesh  │  │  │  • Countdown / Stopwatch Clock │  │
│  │  • World-to-Viewport Projection│  │  │  • Frosted / Dark / Amber Mask │  │
│  └────────────────────────────────┘  │  └────────────────────────────────┘  │
└──────────────────────────────────────┴──────────────────┬───────────────────┘
                                                          │
                                       ┌──────────────────▼───────────────────┐
                                       │     Local Persistence Store          │
                                       │  • Saved Pins (Pos, Header, Note)    │
                                       │  • Saved Focus Zone Bounds & Prefs   │
                                       └──────────────────────────────────────┘
```

### Data Model & State

- **`SpatialPin`**:
  - `id`: Unique string identifier
  - `title`: Short header text (displayed automatically when user is within 2.0 meters)
  - `body`: Full detailed note content (revealed when pin is clicked/selected)
  - `surfaceLabel`: Name of the anchored object/location (e.g., `"Study Desk"`, `"Bookshelf"`, `"Custom Point"`)
  - `position`: `{ x: number, y: number, z: number }` in meters (world coordinates)
  - `normal`: `{ x: number, y: number, z: number }` surface orientation vector
  - `createdAt`: Timestamp
- **`FocusZoneState`**:
  - `defined`: Boolean indicating whether a 3D focus region has been dragged
  - `min` & `max`: 3D bounding coordinates (`Vector3`) of the dragged focus box
  - `center` & `size`: Computed 3D center and dimensions in meters
  - `shieldStyle`: `'frosted' | 'dark' | 'ambient'`
  - `timerMode`: `'preset' | 'custom' | 'stopwatch'`
  - `durationSeconds`: Target duration for countdown modes
  - `remainingSeconds` / `elapsedSeconds`: Active clock state
  - `isRunning`: Boolean controlling whether the timer is active and the peripheral blur/mask is engaged

### Interactive Component & State Mapping

- **Proximity Engine (Per-Frame Distance Check)**:
  - Each frame, computes the Euclidean distance $d = \|\mathbf{p}_{\text{camera}} - \mathbf{p}_{\text{pin}}\|$ between the user's head/camera position and every saved `SpatialPin`.
  - When $d \le 2.0\text{ m}$, smoothly damps the pin's floating header visibility and scale to `1.0` so the reminder pops up naturally as you walk by.
  - Clicking/pinching any pin triggers `selectPin(pin.id)`, opening the full note card with voice/keyboard editing and a "Walk To / Focus Pin" camera glide option.
- **Drag-to-Select 3D Focus Area**:
  - In `Focus Drag` mode, `pointerdown` / XR controller select-start records the 3D surface raycast hit point $\mathbf{p}_1$.
  - Dragging (`pointermove` / controller ray move) updates the opposite corner $\mathbf{p}_2$ in real time, constructing a 3D translucent focus volume over the desk or furniture area with a minimum height envelope so objects on the desk are enclosed.
- **Timer & Peripheral Blur Synchronization**:
  - Starting the timer sets `isRunning = true`, immediately engaging both the 3D surrounding shroud outside the focus box and the dynamic projected aperture mask (applying `backdrop-filter: blur(16px)` for Frosted mode, `rgba(5, 7, 12, 0.92)` for Opaque Dark mode, or `rgba(45, 28, 8, 0.72)` with soft blur for Ambient Tint mode) everywhere outside the projected 3D focus zone polygon.
  - Stopping, pausing, or resetting the timer sets `isRunning = false`, smoothly animating the peripheral blur/mask opacity to `0` so the entire scene is clear with zero blur anywhere.
