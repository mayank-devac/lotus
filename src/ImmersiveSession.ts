import * as THREE from 'three';
import * as xb from 'xrblocks';

import {FocusVolume3D} from './FocusVolume3D';
import {LotusUI, PIN_COLOR_OPTIONS} from './LotusUI';
import {PinManager3D} from './PinManager3D';
import {RoomAnchor} from './RoomAnchor';
import {
  XRCardAction,
  XRDrawerAction,
  XRDrawerData,
  XRHudAction,
  XRInterface,
  XRLabelMode,
  XRPanelHit,
  XRPointerRay,
} from './XRInterface';
import {lotusSound} from './sound';
import {dictateOnce} from './speech';
import {getShieldStrength} from './storage';
import {
  AppMode,
  LotusSettings,
  LotusTask,
  PinScreenProjection,
  SpatialHit,
  SpatialPin,
  Vector3Data,
} from './types';
import {
  XRTextInputMethod,
  editWithSystemKeyboard,
  pickTextInputMethod,
} from './xrTextInput';

type TextField = 'title' | 'body';

/** What the immersive session needs from the app that owns the data. */
export interface ImmersiveHost {
  readonly pinManager: PinManager3D;
  readonly focusVolume: FocusVolume3D;
  /** Group holding everything stored in room space; moved by the room anchor. */
  readonly worldRoot: THREE.Object3D;
  readonly ui: Pick<
    LotusUI,
    | 'getIsTimerRunning'
    | 'startFocusTimer'
    | 'stopFocusTimer'
    | 'getTimerClockText'
    | 'getSettings'
    | 'applySettings'
  >;
  getMode(): AppMode;
  setMode(mode: AppMode): void;
  getPins(): SpatialPin[];
  /** Replaces the pin list everywhere (storage, 3D pins, DOM UI). */
  commitPins(pins: SpatialPin[]): void;
  getTasks(): LotusTask[];
  /** Replaces the task list everywhere (storage, DOM UI). */
  commitTasks(tasks: LotusTask[]): void;
  /** Creates and commits a pin at a ray hit. */
  createPinAt(hit: SpatialHit): SpatialPin;
  /** Casts `raycaster` into the room; a miss lands `fallbackDistance` along the ray. */
  raycastSpatialPoint(
    raycaster: THREE.Raycaster,
    fallbackDistance?: number,
  ): SpatialHit;
  /** True while the focus zone is still the made-up default. */
  focusZoneNeedsDefining(): boolean;
  /** Live update while the focus zone is dragged out. */
  dragFocusZone(start: Vector3Data, end: Vector3Data): void;
  /** Persists the focus zone once a drag finishes. */
  commitFocusZone(): void;
}

/** The one pinch gesture in progress, if any. */
type XRGesture =
  | {kind: 'idle'}
  | {
      kind: 'pin';
      controller: xb.Controller;
      pinId: string;
      startOrigin: THREE.Vector3;
      startDir: THREE.Vector3;
      /** Distance the pin was grabbed from; it is carried there off surfaces. */
      grabDistance: number;
      /** False while the press may still be a tap that opens the pin. */
      moved: boolean;
    }
  | {
      kind: 'focus';
      controller: xb.Controller;
      start: Vector3Data;
      dragged: boolean;
    };

/** What a controller ray points at, nearest first. */
type XRTarget =
  | {kind: 'panel'; hit: XRPanelHit}
  | {kind: 'pin'; pinId: string; distance: number}
  | {kind: 'space'; hit: SpatialHit};

const IDLE: XRGesture = {kind: 'idle'};
/** A press becomes a drag once the ray travels this far or turns ~3°. */
const DRAG_START_METERS = 0.025;
const DRAG_START_RADIANS = 0.052;
/**
 * Hover survives this long after the ray leaves a pin. Hand rays on Quest are
 * computed from the head and shoulder, so head motion swings them; a short
 * grace stops that from flickering the hover title.
 */
const HOVER_GRACE_MS = 160;
/** Palm normal's upward component above which a pinch counts as "palm up". */
const PALM_UP_THRESHOLD = 0.75;
/** xr-standard gamepad index of the B / Y face button on Touch controllers. */
const MENU_BUTTON_INDEX = 5;
/** Frame rate requested when the headset offers it (Quest Browser starts at 72). */
const PREFERRED_FRAME_RATE = 90;

const FOCUS_MINUTES_STEP = 5;
const FOCUS_MINUTES_MIN = 5;
const FOCUS_MINUTES_MAX = 120;
/** "Focus dim" steps, in percent of the room hidden. */
const DIM_STEPS = [30, 50, 75, 90];
const LABEL_MODES: XRLabelMode[] = ['hover', 'nearby', 'always'];

const _rayQuat = new THREE.Quaternion();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _pinPos = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _palmQuat = new THREE.Quaternion();
const _palmNormal = new THREE.Vector3();

function labelModeOf(s: Readonly<LotusSettings>): XRLabelMode {
  if (!s.headerPopEnabled) return 'hover';
  return s.proximityMode === 'always' ? 'always' : 'nearby';
}

function labelModePatch(mode: XRLabelMode): Partial<LotusSettings> {
  switch (mode) {
    case 'hover':
      return {headerPopEnabled: false};
    case 'nearby':
      return {headerPopEnabled: true, proximityMode: 'proximity-2m'};
    case 'always':
      return {headerPopEnabled: true, proximityMode: 'always'};
  }
}

/**
 * Everything LOTUS does inside an immersive session (headset): the room
 * anchor, the in-headset interface, and controller / hand pinch gestures.
 * The DOM overlay is not visible there, so this is the whole user interface.
 */
export class ImmersiveSession {
  private readonly ui = new XRInterface();
  private readonly roomAnchor = new RoomAnchor();
  private readonly raycaster = new THREE.Raycaster();
  private xrSession: XRSession | null = null;
  private active = false;
  private gesture: XRGesture = IDLE;
  /** Hands only report a pose once they have pinched; remember them. */
  private seenControllers = new Set<xb.Controller>();
  private startTimerAfterZone = false;
  private rays: XRPointerRay[] = [];
  private textInput: XRTextInputMethod = 'none';
  /** Stops the keyboard edit or dictation in progress, if any. */
  private stopTextEntry: (() => void) | null = null;
  /**
   * A "Type …" button was pressed. The keyboard opens on the browser's own
   * `select` event (pinch release): xrblocks reports pinches from its frame
   * loop, outside the user gesture `focus()` needs to raise the keyboard.
   */
  private pendingKeyboard: {pinId: string; field: TextField} | null = null;
  private readonly onNativeSelect = () => this.openPendingKeyboard();

  /** Debounced pin hover (see HOVER_GRACE_MS). */
  private hoveredPinId: string | null = null;
  private hoverLostAt = 0;
  /** Timer state last frame, to hide / show the panel when focus starts / ends. */
  private timerWasRunning = false;
  /** Hands whose palm faced up last frame (summons the control panel). */
  private palmUp = new Set<XRHandedness>();
  /** Menu button state last frame, per controller, for edge detection. */
  private menuButtonDown = new Set<XRHandedness>();

  constructor(private readonly host: ImmersiveHost) {}

  public get root(): THREE.Object3D {
    return this.ui.root;
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  public begin(session: XRSession | null) {
    this.active = true;
    this.xrSession = session;
    this.reset();
    this.textInput = pickTextInputMethod(session);
    this.ui.setTextInputMethod(this.textInput);
    this.ui.setActive(true);
    this.host.focusVolume.setXRPresentation(true);
    this.timerWasRunning = this.host.ui.getIsTimerRunning();
    if (this.timerWasRunning) this.ui.setHudHidden(true);
    if (session) {
      this.roomAnchor.begin(session);
      session.addEventListener('select', this.onNativeSelect);
      void this.requestFrameRate(session);
    }
    this.host.setMode('explore');
  }

  public end() {
    this.active = false;
    this.xrSession?.removeEventListener('select', this.onNativeSelect);
    this.xrSession = null;
    this.roomAnchor.end();
    // Back on a 2D screen the room space is the scene space again.
    const root = this.host.worldRoot;
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    this.reset();
    this.seenControllers.clear();
    this.ui.setActive(false);
    this.host.focusVolume.setXRPresentation(false);
    this.host.setMode('explore');
  }

  public dispose() {
    this.xrSession?.removeEventListener('select', this.onNativeSelect);
    this.cancelTextEntry();
    this.roomAnchor.end();
    this.ui.dispose();
  }

  private reset() {
    this.cancelTextEntry();
    this.gesture = IDLE;
    this.startTimerAfterZone = false;
    this.hoveredPinId = null;
    this.hoverLostAt = 0;
    this.palmUp.clear();
    this.menuButtonDown.clear();
    const {pinManager} = this.host;
    pinManager.setDraggingPin(null);
    pinManager.setHoveredPin(null);
    pinManager.updatePreview(false);
  }

  /**
   * Quest Browser runs WebXR at 72 Hz unless asked otherwise. LOTUS draws
   * little, so ask for 90 Hz where offered: smoother rays and panels.
   * https://developers.meta.com/horizon/documentation/web/webxr-frames
   */
  private async requestFrameRate(session: XRSession) {
    const s = session as XRSession & {
      supportedFrameRates?: Float32Array;
      updateTargetFrameRate?: (rate: number) => Promise<void>;
    };
    if (!s.supportedFrameRates || !s.updateTargetFrameRate) return;
    const rates = Array.from(s.supportedFrameRates);
    if (!rates.includes(PREFERRED_FRAME_RATE)) return;
    try {
      await s.updateTargetFrameRate(PREFERRED_FRAME_RATE);
    } catch {
      // Refused (battery saver, thermal limits): keep the default rate.
    }
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  /**
   * Runs first each XR frame, while `frame` is valid: puts room content back
   * on the real room and reads hand / button state for the panel shortcuts.
   */
  public updateFrame(frame: XRFrame, referenceSpace: XRReferenceSpace) {
    if (!this.active) return;
    this.roomAnchor.update(frame, referenceSpace, this.host.worldRoot);
    this.readInputShortcuts(frame, referenceSpace);
  }

  /**
   * Two ways to summon (or put away) the control panel from anywhere, so a
   * hidden panel is never lost: the B / Y button on a controller, or a pinch
   * with the palm facing up (Meta's recommended options gesture for hands).
   * Palm state is sampled here because joint poses need a live XRFrame; the
   * pinch itself arrives later through `selectStart`.
   */
  private readInputShortcuts(frame: XRFrame, referenceSpace: XRReferenceSpace) {
    const session = this.xrSession;
    if (!session) return;
    for (const source of session.inputSources) {
      const hand = source.handedness;
      if (source.hand) {
        const wrist = source.hand.get('wrist');
        let up = false;
        try {
          const pose = wrist && frame.getJointPose?.(wrist, referenceSpace);
          if (pose) {
            const o = pose.transform.orientation;
            _palmQuat.set(o.x, o.y, o.z, o.w);
            // WebXR hand joints: -Y points out of the palm.
            _palmNormal.set(0, -1, 0).applyQuaternion(_palmQuat);
            up = _palmNormal.y > PALM_UP_THRESHOLD;
          }
        } catch {
          // Joint poses unavailable this frame.
        }
        if (up) this.palmUp.add(hand);
        else this.palmUp.delete(hand);
        continue;
      }
      const pressed = Boolean(source.gamepad?.buttons[MENU_BUTTON_INDEX]?.pressed);
      const wasPressed = this.menuButtonDown.has(hand);
      if (pressed && !wasPressed) this.toggleHud();
      if (pressed) this.menuButtonDown.add(hand);
      else this.menuButtonDown.delete(hand);
    }
  }

  /** Aiming rays, hover, panels and labels. */
  public update(
    camera: THREE.Camera,
    delta: number,
    elapsed: number,
    pinProjections: PinScreenProjection[],
  ) {
    if (!this.active) return;
    const {pinManager, focusVolume} = this.host;
    const mode = this.host.getMode();
    camera.getWorldPosition(_camPos);
    focusVolume.updateDim(_camPos);
    this.syncHudWithTimer();

    let panelHover: XRPanelHit | null = null;
    let rayPinId: string | null = null;
    let previewPoint: Vector3Data | null = null;
    const controllers = this.getActiveControllers();

    for (const [i, controller] of controllers.entries()) {
      this.aim(controller);
      const ray = (this.rays[i] ??= {
        origin: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        distance: 1,
        showDot: false,
      });
      ray.origin.copy(this.raycaster.ray.origin);
      ray.quaternion.copy(_rayQuat);
      ray.showDot = true;

      // While this hand carries a pin, the ray simply ends at the pin.
      const g = this.gesture;
      if (g.kind === 'pin' && g.controller === controller) {
        ray.distance = pinManager.getPinWorldPosition(g.pinId, _pinPos)
          ? ray.origin.distanceTo(_pinPos)
          : g.grabDistance;
        continue;
      }

      const target = this.pick();
      switch (target.kind) {
        case 'panel':
          ray.distance = target.hit.distance;
          panelHover ??= target.hit;
          break;
        case 'pin':
          ray.distance = target.distance;
          rayPinId ??= target.pinId;
          break;
        case 'space':
          ray.distance = target.hit.distance;
          // In explore mode a cursor floating in mid-air is noise; show it only
          // on real surfaces, or whenever the pinch will place something.
          ray.showDot = target.hit.isSurface || mode !== 'explore';
          if (mode === 'pin-add') previewPoint ??= target.hit.point;
          break;
      }
    }

    this.ui.setPanelHover(panelHover);
    const hovered = this.updatePinHover(
      this.gesture.kind === 'pin' ? this.gesture.pinId : rayPinId,
      mode,
    );
    pinManager.setHoveredPin(hovered);
    if (previewPoint) {
      pinManager.updatePreview(true, previewPoint, elapsed);
    } else {
      pinManager.updatePreview(false);
    }
    this.ui.updatePointers(this.rays.slice(0, controllers.length));

    this.ui.updateHud(
      {
        clock: this.host.ui.getTimerClockText(),
        timerRunning: this.host.ui.getIsTimerRunning(),
        mode,
      },
      camera,
      delta,
    );
    if (this.ui.getDrawerTab()) this.ui.updateDrawer(this.drawerData());

    const cardPinId = this.ui.getCardPinId();
    if (cardPinId) {
      if (pinManager.getPinWorldPosition(cardPinId, _pinPos)) {
        this.ui.updateCard(camera, _pinPos, delta);
      } else {
        this.closeCard();
      }
    }
    this.ui.updateLabels(
      this.host.getPins(),
      pinProjections,
      (pinId, out) => pinManager.getPinWorldPosition(pinId, out),
      hovered,
      delta,
    );
  }

  /**
   * Hover with a short grace period: the pin under a ray right now wins at
   * once; a pin the ray just slipped off stays hovered for HOVER_GRACE_MS.
   */
  private updatePinHover(rayPinId: string | null, mode: AppMode): string | null {
    if (mode !== 'explore') {
      this.hoveredPinId = null;
      return null;
    }
    const now = performance.now();
    if (rayPinId) {
      this.hoveredPinId = rayPinId;
      this.hoverLostAt = 0;
    } else if (this.hoveredPinId) {
      if (!this.hoverLostAt) this.hoverLostAt = now;
      if (now - this.hoverLostAt > HOVER_GRACE_MS) this.hoveredPinId = null;
    }
    return this.hoveredPinId;
  }

  /** Focus starting puts the panel away; focus ending brings it back. */
  private syncHudWithTimer() {
    const running = this.host.ui.getIsTimerRunning();
    if (running === this.timerWasRunning) return;
    this.timerWasRunning = running;
    if (running) {
      this.ui.setDrawerTab(null);
      this.ui.setHudHidden(true);
    } else {
      this.ui.setHudHidden(false);
      this.ui.flashStatus('Focus session ended');
    }
  }

  private toggleHud() {
    this.ui.setHudHidden(!this.ui.isHudHidden());
    lotusSound.playHoverTick();
  }

  // ---------------------------------------------------------------------------
  // Pinch gestures (controller trigger or hand pinch)
  // ---------------------------------------------------------------------------

  public selectStart(controller: xb.Controller) {
    if (!this.active) return;
    this.seenControllers.add(controller);
    // One gesture at a time: ignore the other hand while one is running.
    if (this.gesture.kind !== 'idle') return;

    const source = controller.inputSource;
    const handedness = source?.handedness;
    if (source?.hand && handedness && this.palmUp.has(handedness)) {
      this.toggleHud();
      return;
    }
    this.aim(controller);

    const target = this.pick();
    switch (target.kind) {
      case 'panel':
        if (target.hit.action) this.pulse(controller, 0.35, 25);
        this.runPanelAction(target.hit);
        return;
      case 'pin': {
        // A press that becomes a drag if the ray moves, or opens the pin's
        // card if it does not.
        const {origin, direction} = this.raycaster.ray;
        const {pinManager} = this.host;
        this.gesture = {
          kind: 'pin',
          controller,
          pinId: target.pinId,
          startOrigin: origin.clone(),
          startDir: direction.clone(),
          grabDistance: pinManager.getPinWorldPosition(target.pinId, _pinPos)
            ? origin.distanceTo(_pinPos)
            : target.distance,
          moved: false,
        };
        pinManager.setDraggingPin(target.pinId);
        this.pulse(controller, 0.3, 20);
        return;
      }
      case 'space':
        this.pressEmptySpace(controller, target.hit);
        return;
    }
  }

  public selecting(controller: xb.Controller) {
    const g = this.gesture;
    if (!this.active || g.kind === 'idle' || g.controller !== controller) {
      return;
    }
    this.aim(controller);

    if (g.kind === 'focus') {
      g.dragged = true;
      this.host.dragFocusZone(
        g.start,
        this.host.raycastSpatialPoint(this.raycaster).point,
      );
      return;
    }

    // A drag starts when the ray itself moves: either the hand travels or the
    // wrist turns. Position alone missed aiming from across the room.
    const {origin, direction} = this.raycaster.ray;
    if (
      !g.moved &&
      (origin.distanceTo(g.startOrigin) > DRAG_START_METERS ||
        direction.angleTo(g.startDir) > DRAG_START_RADIANS)
    ) {
      g.moved = true;
      lotusSound.playHoverTick();
      this.pulse(controller, 0.2, 15);
    }
    if (!g.moved) return;

    // Snap to a real surface when the ray finds one, otherwise carry the pin
    // at the distance it was grabbed from.
    const hit = this.host.raycastSpatialPoint(this.raycaster, g.grabDistance);
    this.host.pinManager.updatePinPositionLive(
      g.pinId,
      hit.point,
      hit.isSurface ? hit.surfaceLabel : undefined,
    );
  }

  public selectEnd(controller: xb.Controller) {
    // Normally the native `select` already opened it; a pinch shorter than a
    // frame can release before the press was seen, so try once more here.
    if (this.pendingKeyboard) this.openPendingKeyboard();
    const g = this.gesture;
    if (!this.active || g.kind === 'idle' || g.controller !== controller) {
      return;
    }
    this.gesture = IDLE;

    if (g.kind === 'pin') {
      const {pinManager} = this.host;
      pinManager.setDraggingPin(null);
      if (!g.moved) {
        this.openCard(g.pinId);
        return;
      }
      // The drag moved the pin object in place; persist the list as it is.
      this.host.commitPins(this.host.getPins());
      pinManager.triggerClickEffect(g.pinId);
      lotusSound.playPinCreated();
      this.pulse(controller, 0.4, 30);
      return;
    }

    if (!g.dragged) return; // A tap without a drag: stay in focus-area mode.
    this.host.commitFocusZone();
    lotusSound.playPinCreated();
    this.pulse(controller, 0.4, 30);
    const startTimer = this.startTimerAfterZone;
    this.startTimerAfterZone = false;
    this.host.setMode('explore');
    if (startTimer && !this.host.ui.getIsTimerRunning()) {
      this.host.ui.startFocusTimer();
      this.ui.flashStatus('Focus area set. Timer started');
    } else {
      this.ui.flashStatus('Focus area set');
    }
  }

  /** Empty space: only an explicit mode places anything, so a stray pinch never litters the room. */
  private pressEmptySpace(controller: xb.Controller, hit: SpatialHit) {
    switch (this.host.getMode()) {
      case 'pin-add': {
        const pin = this.host.createPinAt(hit);
        this.host.setMode('explore');
        this.openCard(pin.id);
        this.pulse(controller, 0.4, 30);
        this.ui.flashStatus(
          this.textInput === 'none'
            ? 'Pin placed'
            : `Pin placed. Use "${this.textInput === 'keyboard' ? 'Type' : 'Say'} title" to name it`,
        );
        return;
      }
      case 'focus-drag':
        this.gesture = {kind: 'focus', controller, start: hit.point, dragged: false};
        return;
      case 'explore':
        if (this.ui.getCardPinId()) this.closeCard();
        return;
    }
  }

  /** A short haptic tick on the controller, where it has a motor. */
  private pulse(controller: xb.Controller, intensity: number, ms: number) {
    const actuator = controller.inputSource?.gamepad?.hapticActuators?.[0] as
      | {pulse?: (value: number, duration: number) => Promise<boolean>}
      | undefined;
    try {
      void actuator?.pulse?.(intensity, ms)?.catch?.(() => undefined);
    } catch {
      // No haptics on this input (hands, some browsers).
    }
  }

  // ---------------------------------------------------------------------------
  // Targeting
  // ---------------------------------------------------------------------------

  private aim(controller: xb.Controller) {
    controller.getWorldPosition(_rayOrigin);
    controller.getWorldQuaternion(_rayQuat);
    _rayDir.set(0, 0, -1).applyQuaternion(_rayQuat).normalize();
    this.raycaster.set(_rayOrigin, _rayDir);
  }

  /** The nearest thing under the current ray: a panel, a pin, or the room. */
  private pick(): XRTarget {
    const panel = this.ui.hitTest(this.raycaster);
    // Pins are only grabbable in explore mode; otherwise the room is the target.
    const pin =
      this.host.getMode() === 'explore'
        ? this.host.pinManager.pickPin(this.raycaster.ray, this.hoveredPinId)
        : null;
    if (panel && (!pin || panel.distance <= pin.distance)) {
      return {kind: 'panel', hit: panel};
    }
    if (pin) return {kind: 'pin', pinId: pin.pinId, distance: pin.distance};
    return {kind: 'space', hit: this.host.raycastSpatialPoint(this.raycaster)};
  }

  /** Tracked controllers / hands that currently have a pose. */
  private getActiveControllers(): xb.Controller[] {
    return (xb.core?.input?.controllers ?? []).filter(
      (c) =>
        c.visible &&
        (c.inputSource?.targetRayMode === 'tracked-pointer' ||
          this.seenControllers.has(c)),
    );
  }

  // ---------------------------------------------------------------------------
  // Panel actions
  // ---------------------------------------------------------------------------

  private runPanelAction(hit: XRPanelHit) {
    if (!hit.action) return; // Pressed the panel body: swallow the pinch.
    lotusSound.playHoverTick();
    switch (hit.panel) {
      case 'hud':
        this.runHudAction(hit.action);
        return;
      case 'chip':
        this.ui.setHudHidden(false);
        return;
      case 'drawer':
        this.runDrawerAction(hit.action);
        return;
      case 'card':
        this.runCardAction(hit.action);
        return;
    }
  }

  private runHudAction(action: XRHudAction) {
    const mode = this.host.getMode();
    const timer = this.host.ui;
    switch (action) {
      case 'toggle-timer':
        if (timer.getIsTimerRunning()) {
          timer.stopFocusTimer();
        } else if (this.host.focusZoneNeedsDefining()) {
          this.startTimerAfterZone = true;
          this.host.setMode('focus-drag');
          this.ui.flashStatus('First pinch and drag across your focus area', 8);
        } else {
          timer.startFocusTimer();
        }
        return;
      case 'place-pin':
        this.startTimerAfterZone = false;
        this.host.setMode(mode === 'pin-add' ? 'explore' : 'pin-add');
        return;
      case 'focus-zone':
        this.startTimerAfterZone = false;
        this.host.setMode(mode === 'focus-drag' ? 'explore' : 'focus-drag');
        return;
      case 'tab-tasks':
      case 'tab-pins':
      case 'tab-settings': {
        const tab =
          action === 'tab-tasks' ? 'tasks' : action === 'tab-pins' ? 'pins' : 'settings';
        this.ui.setDrawerTab(this.ui.getDrawerTab() === tab ? null : tab);
        return;
      }
      case 'hide-hud':
        this.ui.setHudHidden(true);
        this.ui.flashStatus('Panel hidden');
        return;
      case 'exit-xr':
        void this.xrSession?.end();
        return;
    }
  }

  private runDrawerAction(action: XRDrawerAction) {
    if (action.startsWith('task:')) {
      this.toggleTask(action.slice('task:'.length));
      return;
    }
    if (action.startsWith('pin:')) {
      this.openCard(action.slice('pin:'.length));
      return;
    }
    const ui = this.host.ui;
    const s = ui.getSettings();
    switch (action) {
      case 'page-prev':
        this.ui.turnDrawerPage(-1);
        return;
      case 'page-next':
        this.ui.turnDrawerPage(1);
        return;
      case 'minutes-down':
      case 'minutes-up': {
        const current = this.focusMinutes(s) ?? s.presetMinutes;
        const step = action === 'minutes-up' ? FOCUS_MINUTES_STEP : -FOCUS_MINUTES_STEP;
        // Snap to the step grid, then move one step.
        const snapped = Math.round(current / FOCUS_MINUTES_STEP) * FOCUS_MINUTES_STEP;
        const next = THREE.MathUtils.clamp(
          snapped === current ? current + step : snapped,
          FOCUS_MINUTES_MIN,
          FOCUS_MINUTES_MAX,
        );
        ui.applySettings({timerMode: 'preset', presetMinutes: next});
        if (ui.getIsTimerRunning()) {
          this.ui.flashStatus(`Next focus: ${next} min`);
        }
        return;
      }
      case 'sound':
        ui.applySettings({soundEnabled: !s.soundEnabled});
        return;
      case 'labels': {
        const i = LABEL_MODES.indexOf(labelModeOf(s));
        ui.applySettings(labelModePatch(LABEL_MODES[(i + 1) % LABEL_MODES.length]));
        return;
      }
      case 'dim': {
        const current = Math.round(getShieldStrength(s) * 100);
        const next = DIM_STEPS.find((v) => v > current) ?? DIM_STEPS[0];
        ui.applySettings({focusAreaVisibility: 100 - next});
        return;
      }
    }
  }

  private focusMinutes(s: Readonly<LotusSettings>): number | null {
    switch (s.timerMode) {
      case 'preset':
        return s.presetMinutes;
      case 'custom':
        return Math.max(1, Math.round(s.customMinutes + s.customSeconds / 60));
      case 'stopwatch':
        return null;
    }
  }

  private drawerData(): XRDrawerData {
    const {pinManager} = this.host;
    const s = this.host.ui.getSettings();
    const pins: XRDrawerData['pins'] = [];
    if (this.ui.getDrawerTab() === 'pins') {
      for (const pin of this.host.getPins()) {
        const distance = pinManager.getPinWorldPosition(pin.id, _pinPos)
          ? _pinPos.distanceTo(_camPos)
          : Infinity;
        pins.push({pin, distance});
      }
      pins.sort((a, b) => a.distance - b.distance);
    }
    return {
      tasks: this.host.getTasks(),
      pins,
      settings: {
        focusMinutes: this.focusMinutes(s),
        sound: s.soundEnabled,
        labels: labelModeOf(s),
        dimPercent: Math.round(getShieldStrength(s) * 100),
      },
    };
  }

  private toggleTask(taskId: string) {
    const now = Date.now();
    this.host.commitTasks(
      this.host.getTasks().map((t) =>
        t.id === taskId
          ? {
              ...t,
              completed: !t.completed,
              completedAt: t.completed ? undefined : now,
              timerRunning: t.completed ? t.timerRunning : false,
            }
          : t,
      ),
    );
  }

  private runCardAction(action: XRCardAction) {
    const pinId = this.ui.getCardPinId();
    switch (action) {
      case 'close':
        this.closeCard();
        return;
      case 'delete': {
        if (!pinId || !this.ui.confirmDelete()) return;
        this.closeCard();
        this.host.commitPins(this.host.getPins().filter((p) => p.id !== pinId));
        this.ui.flashStatus('Pin deleted');
        return;
      }
      case 'edit-title':
        this.editText('title');
        return;
      case 'edit-note':
        this.editText('body');
        return;
      case 'color':
        this.updatePin(pinId, (pin) => {
          const colors = PIN_COLOR_OPTIONS.map((c) => c.value.toLowerCase());
          const i = colors.indexOf((pin.color || '').toLowerCase());
          return {...pin, color: PIN_COLOR_OPTIONS[(i + 1) % colors.length].value};
        });
        return;
      case 'shape':
        this.updatePin(pinId, (pin) => ({
          ...pin,
          shapeStyle: (pin.shapeStyle ?? this.host.ui.getSettings().defaultPinStyle) === 'dot'
            ? 'revolving'
            : 'dot',
        }));
        return;
    }
  }

  /** Applies `change` to one pin, commits, and redraws its card. */
  private updatePin(pinId: string | null, change: (pin: SpatialPin) => SpatialPin) {
    if (!pinId) return;
    const pins = this.host.getPins();
    const pin = pins.find((p) => p.id === pinId);
    if (!pin) return;
    const updated = change(pin);
    this.host.commitPins(pins.map((p) => (p === pin ? updated : p)));
    this.host.pinManager.triggerClickEffect(pinId);
    this.ui.refreshCard(updated);
  }

  // ---------------------------------------------------------------------------
  // Pin card and text entry
  // ---------------------------------------------------------------------------

  private openCard(pinId: string) {
    const pin = this.findPin(pinId);
    if (!pin) return;
    this.cancelTextEntry();
    this.ui.openCard(pin);
    this.host.pinManager.triggerClickEffect(pinId);
    lotusSound.playPinOpen();
  }

  private closeCard() {
    this.cancelTextEntry();
    this.ui.closeCard();
  }

  private cancelTextEntry() {
    this.pendingKeyboard = null;
    this.stopTextEntry?.();
    this.stopTextEntry = null;
  }

  private openPendingKeyboard() {
    const pending = this.pendingKeyboard;
    this.pendingKeyboard = null;
    if (pending && this.ui.getCardPinId() === pending.pinId) {
      this.typeText(pending.pinId, pending.field);
    }
  }

  /** DOM inputs are invisible in a headset, so text comes from the keyboard or voice. */
  private editText(field: TextField) {
    const pinId = this.ui.getCardPinId();
    if (!pinId) return;
    this.cancelTextEntry();
    switch (this.textInput) {
      case 'keyboard':
        // Opens on release; see `pendingKeyboard`.
        this.pendingKeyboard = {pinId, field};
        return;
      case 'voice':
        this.dictateText(pinId, field);
        return;
      case 'none':
        this.ui.setCardStatus('Edit the text on the 2D screen after exiting XR.');
        return;
    }
  }

  private typeText(pinId: string, field: TextField) {
    const pin = this.findPin(pinId);
    if (!pin) return;
    const stop = editWithSystemKeyboard(
      pin[field],
      // Live preview on the card; nothing is saved until the keyboard closes.
      (text) => this.ui.refreshCard({...pin, [field]: text}),
      (text) => {
        if (this.stopTextEntry === stop) this.stopTextEntry = null;
        if (this.ui.getCardPinId() !== pinId) return;
        this.ui.setCardStatus('');
        this.savePinText(pinId, field, text);
      },
    );
    if (!stop) {
      this.ui.setCardStatus('The keyboard did not open. Try again.');
      return;
    }
    this.stopTextEntry = stop;
    this.ui.setCardStatus(
      field === 'title'
        ? 'Type the title, then press Done'
        : 'Type the note, then press Done',
    );
  }

  private dictateText(pinId: string, field: TextField) {
    const stop = dictateOnce(
      (text) => this.savePinText(pinId, field, text),
      (failed) => {
        if (this.stopTextEntry === stop) this.stopTextEntry = null;
        if (this.ui.getCardPinId() !== pinId) return;
        this.ui.setCardStatus(
          failed ? 'Could not hear that. Check mic access and try again.' : '',
        );
      },
    );
    if (!stop) {
      this.ui.setCardStatus('Voice input is not available in this browser.');
      return;
    }
    this.stopTextEntry = stop;
    this.ui.setCardStatus(
      field === 'title' ? 'Listening for the title…' : 'Listening for the note…',
    );
  }

  /** Saves edited text and redraws the card from the saved pin. */
  private savePinText(pinId: string, field: TextField, text: string) {
    const pins = this.host.getPins();
    const pin = pins.find((p) => p.id === pinId);
    if (!pin) return;
    const value = text.trim();
    // A pin always keeps a title; an emptied title reverts to the old one.
    if (value !== pin[field] && (value || field === 'body')) {
      const updated = {...pin, [field]: value};
      this.host.commitPins(pins.map((p) => (p === pin ? updated : p)));
      this.ui.refreshCard(updated);
      return;
    }
    this.ui.refreshCard(pin);
  }

  private findPin(pinId: string): SpatialPin | undefined {
    return this.host.getPins().find((p) => p.id === pinId);
  }
}
