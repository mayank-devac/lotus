import {vec3} from '../storage';
import {
  LotusSettings,
  LotusTask,
  PinScreenProjection,
  SpatialPin,
  Vector3Data,
} from '../types';
import {escapeHtml, hexToRgbTuple} from './dom';

/** What one frame of marker updates needs to know besides the projections. */
export interface MarkerFrame {
  settings: LotusSettings;
  tasks: LotusTask[];
  timerRunning: boolean;
  timerUsesArea: boolean;
  /** Viewport size, CSS pixels. */
  vw: number;
  vh: number;
  /** Centre and half-size of the focus window: pins blur with distance from it. */
  focusCenterX: number;
  focusCenterY: number;
  halfW: number;
  halfH: number;
  /** 0–1, see `getShieldStrength`. */
  shieldStrength: number;
}

export interface PinMarkerHandlers {
  onHover(pinId: string | null): void;
  /** A marker was clicked (the event is already stopped). */
  onClick(pinId: string): void;
}

/**
 * The 2D screen's pin markers: a clickable header card and hit target per
 * pin, positioned each frame from the 3D projection, plus the coloured
 * edge-of-screen glow ("ambient light") for pins nearby but out of view.
 * Also remembers each pin's last distance for the pin directory.
 */
export class PinMarkers {
  private markerEls = new Map<string, HTMLElement>();
  private pulseEls = new Map<string, HTMLElement>();
  /** When each pin's ambient light came on, for its on → flicker → off cycle. */
  private ambientStartedAt = new Map<string, number>();
  private distances = new Map<string, number>();
  private userPosition: Vector3Data = vec3(0, 1.45, -0.25);

  constructor(
    private readonly markerLayer: HTMLElement,
    private readonly pulseLayer: HTMLElement,
    private readonly handlers: PinMarkerHandlers,
  ) {}

  public setUserPosition(position: Vector3Data) {
    this.userPosition = position;
  }

  /** Positions every projected pin's marker and edge glow for this frame. */
  public update(
    pins: SpatialPin[],
    pinProjections: PinScreenProjection[],
    frame: MarkerFrame,
  ) {
    const {vw, vh, focusCenterX, focusCenterY, halfW, halfH, shieldStrength} = frame;
    for (const proj of pinProjections) {
      this.distances.set(proj.id, proj.distanceMeters);
      const pin = pins.find((p) => p.id === proj.id);
      if (!pin) continue;

      let markerEl = this.markerEls.get(pin.id);
      if (!markerEl) {
        markerEl = this.createMarker(pin);
        this.markerLayer.appendChild(markerEl);
        this.markerEls.set(pin.id, markerEl);
      }

      const maxProximityDist = Math.max(
        0.5,
        frame.settings.proximityDistanceMeters || 0.5,
      );
      const isWithinRadius =
        proj.isWithinRadius ?? proj.distanceMeters <= maxProximityDist;

      // Update directional corner/side screen pulse when user moves within proximity distance of this pin
      let pulseEl = this.pulseEls.get(pin.id);
      if (!pulseEl) {
        pulseEl = this.createPulse(pin);
        this.pulseLayer.appendChild(pulseEl);
        this.pulseEls.set(pin.id, pulseEl);
      }

      const pinHex = pin.color || '#E84D2B';
      pulseEl.style.setProperty('--pin-pulse-color', pinHex);
      pulseEl.style.setProperty(
        '--pin-pulse-rgb',
        hexToRgbTuple(pinHex),
      );

      // Determine side (left/right) and corner (top/bottom) from pin's camera-local or screen direction
      const isLeftSide =
        proj.camLocalX !== undefined
          ? proj.camLocalX < 0
          : proj.screenX < vw * 0.5;
      const isTopSide =
        proj.camLocalY !== undefined
          ? proj.camLocalY >= 0
          : proj.screenY < vh * 0.5;

      pulseEl.classList.toggle('is-side-left', isLeftSide);
      pulseEl.classList.toggle('is-side-right', !isLeftSide);
      pulseEl.classList.toggle('is-corner-top', isTopSide);
      pulseEl.classList.toggle('is-corner-bottom', !isTopSide);

      // Bias the side glow vertically toward the pin's screen projection along that side
      const normY = proj.visible
        ? Math.max(8, Math.min(92, (proj.screenY / Math.max(1, vh)) * 100))
        : isTopSide
          ? 20
          : 80;
      pulseEl.style.setProperty('--pin-side-y', `${normY.toFixed(1)}%`);

      // Check if the pin is currently inside the user's direct viewpoint
      const viewMargin = 20;
      const isInViewpoint =
        proj.visible &&
        proj.screenX >= viewMargin &&
        proj.screenX <= vw - viewMargin &&
        proj.screenY >= viewMargin &&
        proj.screenY <= vh - viewMargin;

      const ambientMode = frame.settings.ambientLightMode ?? 'timer';
      const ambientAllowed =
        ambientMode === 'all' ||
        (ambientMode === 'timer' &&
          (frame.timerRunning ||
            frame.tasks.some((t) => !t.completed && t.timerRunning)));
      const nowMs = performance.now();
      let ambientPhase: 'off' | 'on' | 'flicker' = 'off';
      if (ambientAllowed && isWithinRadius && !isInViewpoint) {
        let startedAt = this.ambientStartedAt.get(pin.id);
        if (startedAt === undefined) {
          startedAt = nowMs;
          this.ambientStartedAt.set(pin.id, startedAt);
        }
        const durMs =
          Math.max(1, frame.settings.ambientLightDurationSec ?? 6) * 1000;
        const elapsed = nowMs - startedAt;
        ambientPhase =
          elapsed < durMs ? 'on' : elapsed < durMs + 1300 ? 'flicker' : 'off';
      } else {
        this.ambientStartedAt.delete(pin.id);
      }
      pulseEl.classList.toggle('is-flickering', ambientPhase === 'flicker');

      if (ambientPhase !== 'off') {
        const closeness = Math.max(
          0.28,
          Math.min(
            1,
            1 - (proj.distanceMeters / (maxProximityDist * 1.18)) * 0.72,
          ),
        );
        pulseEl.style.setProperty(
          '--pulse-closeness',
          closeness.toFixed(3),
        );
        const wasPulsing = pulseEl.classList.contains('is-proximity-pulsing');
        pulseEl.classList.add('is-proximity-pulsing');

        if (proj.justEnteredProximity || !wasPulsing) {
          pulseEl.classList.remove('is-entry-burst');
          void pulseEl.offsetWidth;
          pulseEl.classList.add('is-entry-burst');
        }
      } else {
        pulseEl.classList.remove('is-proximity-pulsing', 'is-entry-burst');
        pulseEl.style.setProperty('--pulse-closeness', '0');
      }

      if (!proj.visible) {
        markerEl.style.display = 'none';
        continue;
      }

      markerEl.style.display = 'block';
      markerEl.style.transform = `translate3d(${proj.screenX.toFixed(1)}px, ${proj.screenY.toFixed(1)}px, 0)`;
      markerEl.style.setProperty('--pin-accent', pin.color || '#E84D2B');

      // Depth-of-Field effect on objects/pins: dynamically increase blurriness the further from focus center
      if (frame.timerRunning && frame.timerUsesArea) {
        const dx = (proj.screenX - focusCenterX) / halfW;
        const dy = (proj.screenY - focusCenterY) / halfH;
        const normDist = Math.hypot(dx, dy);
        const dofBlurPx =
          normDist <= 0.55
            ? 0
            : Math.min(14, (normDist - 0.55) * 6.5) * shieldStrength;
        markerEl.style.filter =
          dofBlurPx > 0.2 ? `blur(${dofBlurPx.toFixed(1)}px)` : 'none';
      } else {
        markerEl.style.filter = 'none';
      }

      const distEl = markerEl.querySelector('.lotus-pin-dist') as HTMLElement;
      if (distEl) {
        distEl.textContent = `${proj.distanceMeters.toFixed(1)}m`;
      }

      if (proj.isReticleHovered) {
        markerEl.classList.add('is-hovered');
      } else {
        markerEl.classList.remove('is-hovered');
      }

      if (proj.isWithinProximity && frame.settings.headerPopEnabled) {
        markerEl.classList.add('is-proximity-active');
        markerEl.classList.remove('is-compact-far');
      } else {
        markerEl.classList.remove('is-proximity-active');
        markerEl.classList.add('is-compact-far');
      }
    }
  }

  /** Drops the markers of pins that no longer exist. */
  public prune(validIds: Set<string>) {
    for (const [id, el] of this.markerEls.entries()) {
      if (!validIds.has(id)) {
        el.remove();
        this.markerEls.delete(id);
      }
    }
    for (const [id, pulseEl] of this.pulseEls.entries()) {
      if (!validIds.has(id)) {
        pulseEl.remove();
        this.pulseEls.delete(id);
      }
    }
  }

  /** Removes every marker; they are rebuilt with fresh content next frame. */
  public clear() {
    this.markerLayer.innerHTML = '';
    this.markerEls.clear();
    this.pulseLayer.innerHTML = '';
    this.pulseEls.clear();
  }

  public setDragging(pinId: string | null) {
    for (const [id, markerEl] of this.markerEls.entries()) {
      markerEl.classList.toggle('is-dragging', id === pinId);
    }
  }

  /** Plays the click wave on a pin's marker. */
  public ripple(pinId: string) {
    const markerEl = this.markerEls.get(pinId);
    if (!markerEl) return;
    markerEl.classList.remove('is-click-pulsing');
    void markerEl.offsetWidth;
    markerEl.classList.add('is-click-pulsing');
    window.setTimeout(() => {
      markerEl.classList.remove('is-click-pulsing');
    }, 450);
  }

  /** Restarts every ambient light's cycle (after its setting changed). */
  public resetAmbientLights() {
    this.ambientStartedAt.clear();
  }

  /** Last projected distance to a pin, or the straight-line distance from the user. */
  public distanceMeters(pin: SpatialPin): number {
    const cached = this.distances.get(pin.id);
    if (cached !== undefined && Number.isFinite(cached)) {
      return cached;
    }
    return Math.hypot(
      pin.position.x - this.userPosition.x,
      pin.position.y - this.userPosition.y,
      pin.position.z - this.userPosition.z,
    );
  }

  /**
   * Creates the DOM anchor for a spatial pin at (screenX, screenY).
   */
  private createMarker(pin: SpatialPin): HTMLElement {
    const el = document.createElement('div');
    el.className = 'lotus-pin-marker is-proximity-active';
    el.dataset.pinId = pin.id;
    el.style.setProperty('--pin-accent', pin.color || '#E84D2B');

    el.innerHTML = `
      <button type="button" class="lotus-pin-header-card" data-pin-id="${pin.id}" aria-label="Open or drag note: ${escapeHtml(pin.title)}">
        <div class="lotus-pin-meta-row">
          <span class="lotus-pin-surface">${escapeHtml(pin.surfaceLabel)}</span>
          <span aria-hidden="true">·</span>
          <span class="lotus-pin-dist">1.2m</span>
        </div>
        <div class="lotus-pin-title">${escapeHtml(pin.title)}</div>
        <div class="lotus-pin-cta-hint">CLICK FOR NOTE · PINCH/DRAG TO MOVE</div>
      </button>
      <button
        type="button"
        class="lotus-pin-hit-target"
        data-pin-id="${pin.id}"
        aria-label="Inspect or drag spatial point: ${escapeHtml(pin.title)}"
        title="${escapeHtml(pin.title)} — Click to open note, or pinch/drag to move"
      >
        <span class="lotus-pin-hover-ring"></span>
        <span class="lotus-pin-click-wave"></span>
      </button>
    `;

    const onEnter = () => {
      el.classList.add('is-hovered');
      this.handlers.onHover(pin.id);
    };
    const onLeave = () => {
      el.classList.remove('is-hovered');
      this.handlers.onHover(null);
    };
    const onClick = (e: Event) => {
      e.stopPropagation();
      this.handlers.onClick(pin.id);
    };

    const headerBtn = el.querySelector('.lotus-pin-header-card')!;
    const hitTargetBtn = el.querySelector('.lotus-pin-hit-target')!;

    headerBtn.addEventListener('pointerenter', onEnter);
    headerBtn.addEventListener('pointerleave', onLeave);
    headerBtn.addEventListener('click', onClick);

    hitTargetBtn.addEventListener('pointerenter', onEnter);
    hitTargetBtn.addEventListener('pointerleave', onLeave);
    hitTargetBtn.addEventListener('click', onClick);

    return el;
  }

  private createPulse(pin: SpatialPin): HTMLElement {
    const el = document.createElement('div');
    el.className = 'lotus-pin-corner-pulse';
    el.dataset.pinId = pin.id;
    const pinHex = pin.color || '#E84D2B';
    el.style.setProperty('--pin-pulse-color', pinHex);
    el.style.setProperty('--pin-pulse-rgb', hexToRgbTuple(pinHex));
    el.innerHTML = `
      <span class="lotus-corner-pulse-glow"></span>
      <span class="lotus-side-pulse-glow"></span>
      <span class="lotus-corner-pulse-rim"></span>
    `;
    return el;
  }
}
