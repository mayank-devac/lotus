import {ShieldStyle} from '../types';

/** The overlay's fixed elements; each view renders into one of them. */
export interface LayoutRefs {
  dragBoxOverlay: HTMLElement;
  pinPlacementReticle: HTMLElement;
  proximityPulseLayer: HTMLElement;
  pinLayer: HTMLElement;
  topBar: HTMLElement;
  focusCornerBar: HTMLElement;
  modeToast: HTMLElement;
  modalLayer: HTMLElement;
  bottomDock: HTMLElement;
}

/**
 * Builds the overlay's skeleton inside `container` (`#lotus-ui-root`). The
 * focus shield's elements are picked up by `FocusShield`.
 */
export function buildLayout(container: HTMLElement, shieldStyle: ShieldStyle): LayoutRefs {
  container.innerHTML = `
    <!-- Single Continuous Surround Shield (Engaged when Timer is ON or previewing Focus Area — zero quadrant seams) -->
    <div id="lotus-aperture-root" class="lotus-aperture-root shield-${shieldStyle}" style="display: none;">
      <div id="lotus-surround-shield" class="lotus-surround-shield"></div>

      <div id="lotus-focus-window-frame" class="lotus-focus-window-frame">
        <div id="lotus-focus-window-badge" class="lotus-focus-window-badge">
          <span id="lotus-focus-window-label">FOCUS AREA</span>
        </div>
      </div>
    </div>

    <!-- 2D Drag Selection Feedback Rectangle -->
    <div id="lotus-drag-box-overlay" class="lotus-drag-box-overlay" style="display: none;"></div>

    <!-- Live Surroundings Pin Placement Reticle (Shown in pin-add mode before Save UI opens) -->
    <div id="lotus-pin-placement-reticle" class="lotus-pin-placement-reticle" style="display: none;">
      <div class="lotus-reticle-ring">
        <div class="lotus-reticle-dot"></div>
      </div>
      <div class="lotus-reticle-caption">TAP HERE TO PLACE PIN</div>
    </div>

    <!-- Subtle Directional Corner/Side Proximity Pulse Layer (Colored by Pin Color) -->
    <div id="lotus-proximity-pulse-layer" class="lotus-proximity-pulse-layer" aria-hidden="true"></div>

    <!-- 3D Projected Spatial Pin Hit Targets & Optional Proximity Headers -->
    <div id="lotus-pin-layer" class="lotus-pin-layer"></div>

    <!-- Transparent Top Bar -->
    <header id="lotus-top-bar" class="lotus-top-bar"></header>

    <!-- Focus Mode Top-Right Corner Controls: Task Button + Stop Focus Button -->
    <div id="lotus-focus-corner-bar" class="lotus-focus-corner-bar" style="display: none;"></div>

    <!-- Minimal Mode Instruction Pill -->
    <div id="lotus-mode-toast" class="lotus-mode-banner"></div>

    <!-- Modals Layer -->
    <div id="lotus-modal-layer" class="lotus-modal-layer"></div>

    <!-- Minimal Bottom Dock -->
    <aside id="lotus-bottom-dock" class="lotus-bottom-dock"></aside>
  `;
  const el = (selector: string) => container.querySelector<HTMLElement>(selector)!;
  return {
    dragBoxOverlay: el('#lotus-drag-box-overlay'),
    pinPlacementReticle: el('#lotus-pin-placement-reticle'),
    proximityPulseLayer: el('#lotus-proximity-pulse-layer'),
    pinLayer: el('#lotus-pin-layer'),
    topBar: el('#lotus-top-bar'),
    focusCornerBar: el('#lotus-focus-corner-bar'),
    modeToast: el('#lotus-mode-toast'),
    modalLayer: el('#lotus-modal-layer'),
    bottomDock: el('#lotus-bottom-dock'),
  };
}
