import * as THREE from 'three';
import * as xb from 'xrblocks';

import {FocusVolume3D, focusZoneFromDrag} from './FocusVolume3D';
import {LotusUI, PIN_COLOR_OPTIONS} from './LotusUI';
import {PinManager3D} from './PinManager3D';
import {RoomAnchor} from './RoomAnchor';
import {
  XRCardAction,
  XRDrawerAction,
  XRDrawerData,
  XRHudAction,
  XRInterface,
  XRMovablePanel,
  XRPanelHit,
  XRPointerRay,
  XRTaskFilter,
  XRZoneAction,
} from './XRInterface';
import {XRKeyAction, XRTextRequest} from './XRTextEditor';
import {lotusSound} from './sound';
import {dictateOnce, isSpeechSupported} from './speech';
import {
  TASK_TIMER_PRESETS_MIN,
  TaskDraft,
  createTask,
  pinContentFromTask,
  taskClockText,
  toggleTaskDone,
  toggleTaskTimer,
} from './tasks';
import {
  AppMode,
  FocusZoneBounds,
  LotusTask,
  PinScreenProjection,
  PinSortBy,
  SpatialHit,
  SpatialPin,
} from './types';
import {XR_SETTINGS, findXRSetting} from './xrSettings';
import {editWithSystemKeyboard, isSystemKeyboardSupported} from './xrTextInput';

type PinContent = Pick<SpatialPin, 'title' | 'body' | 'surfaceLabel'>;
type PinTextField = keyof PinContent;
type TaskTextField = 'title' | 'dueLabel' | 'note';

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
  /** The live task list, including timers that are counting down. */
  getTasks(): LotusTask[];
  /** Replaces the task list everywhere (storage, DOM UI). */
  commitTasks(tasks: LotusTask[]): void;
  /** Creates and commits a pin at a ray hit; `content` replaces the default text. */
  createPinAt(hit: SpatialHit, content?: PinContent): SpatialPin;
  /** Casts `raycaster` into the room; a miss lands `fallbackDistance` along the ray. */
  raycastSpatialPoint(
    raycaster: THREE.Raycaster,
    fallbackDistance?: number,
  ): SpatialHit;
  getFocusZone(): FocusZoneBounds;
  /** True while the focus zone is still the made-up default. */
  focusZoneNeedsDefining(): boolean;
  /** Shows `zone` as the focus zone without saving it. */
  previewFocusZone(zone: FocusZoneBounds): void;
  /** Saves the focus zone that is currently shown. */
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
      startOrigin: THREE.Vector3;
      startDir: THREE.Vector3;
      /** First corner of the area, in room space. */
      start: THREE.Vector3;
      /** The flat plane (room space) the second corner is dragged across. */
      plane: THREE.Plane;
      /** True for an area on a desk or floor, false for one on a wall. */
      onSurface: boolean;
      moved: boolean;
    }
  | {
      /** A panel carried by its grip. */
      kind: 'move';
      panel: XRMovablePanel;
      controller: xb.Controller;
      /** How far along the ray the panel was grabbed. */
      distance: number;
      /** From the grabbed point to the panel's centre, at grab time. */
      offset: THREE.Vector3;
      startDir: THREE.Vector3;
    };

/** What a controller ray points at, nearest first. */
type XRTarget =
  | {kind: 'panel'; hit: XRPanelHit}
  | {kind: 'pin'; pinId: string; distance: number}
  | {kind: 'space'; hit: SpatialHit}
  /** The keyboard is open and the ray is not on a panel: pins and the room ignore it. */
  | {kind: 'blocked'};

/** The task being created (taskId null) or edited in the drawer. */
interface TaskFormState extends TaskDraft {
  taskId: string | null;
}

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
/** A destructive button must be pressed again within this long to act. */
const CONFIRM_WINDOW_MS = 4000;
/**
 * A focus-area drag that starts with the ray pointing down by more than ~20°
 * marks out a surface (desk, floor); a flatter ray marks out a wall area.
 */
const FOCUS_SURFACE_PITCH = -0.34;
/** A corner further than this (m) from the first one is a stray ray, not a drag. */
const FOCUS_MAX_SPAN = 15;
/** Length of a ray that points at nothing. */
const IDLE_RAY_LENGTH = 1.2;

const TASK_FILTERS: XRTaskFilter[] = ['all', 'ongoing', 'completed'];
const PIN_TEXT_FIELDS: Record<PinTextField, Omit<XRTextRequest, 'initial'>> = {
  title: {label: 'Pin title', maxLength: 80},
  body: {label: 'Pin note', maxLength: 400},
  surfaceLabel: {label: 'Where is this pin?', maxLength: 40},
};
const TASK_TEXT_FIELDS: Record<TaskTextField, Omit<XRTextRequest, 'initial'>> = {
  title: {label: 'Task title', maxLength: 120},
  dueLabel: {label: 'Due (optional), e.g. Today 5 PM', maxLength: 40},
  note: {label: 'Task note (optional)', maxLength: 200},
};

const _rayQuat = new THREE.Quaternion();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _pinPos = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _palmQuat = new THREE.Quaternion();
const _palmNormal = new THREE.Vector3();
const _roomRay = new THREE.Ray();
const _roomFromWorld = new THREE.Matrix4();
const _zonePoint = new THREE.Vector3();
const _hudPos = new THREE.Vector3();
const _turn = new THREE.Quaternion();

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
  private rays: XRPointerRay[] = [];
  private panelHits: XRPanelHit[] = [];

  /** Debounced pin hover (see HOVER_GRACE_MS). */
  private hoveredPinId: string | null = null;
  private hoverLostAt = 0;
  /** Timer state last frame, to hide / show the panel when focus starts / ends. */
  private timerWasRunning = false;
  /** Hands whose palm faced up last frame (summons the control panel). */
  private palmUp = new Set<XRHandedness>();
  /** Menu button state last frame, per controller, for edge detection. */
  private menuButtonDown = new Set<XRHandedness>();
  /** The destructive button waiting for its confirming second press. */
  private armed: {key: string; until: number} | null = null;

  // Focus area being set: nothing is saved until the user confirms.
  private zoneBeforeEdit: FocusZoneBounds | null = null;
  private zoneDrawn = false;
  private startTimerAfterZone = false;
  /** Play was pressed with "Start focus: Ask each time": the panel shows the choice. */
  private askingStart = false;

  // Tasks and pins drawer.
  private taskFilter: XRTaskFilter = 'all';
  private openTaskId: string | null = null;
  private taskForm: TaskFormState | null = null;
  private pinSort: PinSortBy = 'proximity';
  /** Text for the next placed pin, when it is being placed for a task. */
  private pendingPinContent: PinContent | null = null;

  // Text entry. `textEdit` is the edit the keyboard is open for: `apply`
  // saves the typed text, `alive` is false once what it edits has gone (card
  // closed, task form cancelled), which closes the keyboard.
  private textEdit: {apply: (text: string) => void; alive: () => boolean} | null = null;
  private systemKeyboard = false;
  private stopDictation: (() => void) | null = null;
  private stopSystemKeyboard: (() => void) | null = null;
  /**
   * The headset-keyboard key was pressed. That keyboard opens on the
   * browser's own `select` event (pinch release): xrblocks reports pinches
   * from its frame loop, outside the user gesture `focus()` needs.
   */
  private pendingSystemKeyboard = false;
  private readonly onNativeSelect = () => this.openSystemKeyboard();

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
    this.systemKeyboard = isSystemKeyboardSupported(session);
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
    // Leaves focus-area mode properly: an unconfirmed area is not kept.
    this.setMode('explore');
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
  }

  public dispose() {
    this.xrSession?.removeEventListener('select', this.onNativeSelect);
    this.closeEditor();
    this.roomAnchor.end();
    this.ui.dispose();
  }

  private reset() {
    this.closeEditor();
    this.gesture = IDLE;
    this.armed = null;
    this.zoneBeforeEdit = null;
    this.zoneDrawn = false;
    this.startTimerAfterZone = false;
    this.askingStart = false;
    this.openTaskId = null;
    this.taskForm = null;
    this.pendingPinContent = null;
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

  /**
   * Every mode change goes through here, so leaving a mode always cleans up
   * after it: an unconfirmed focus area is put back, and text waiting for a
   * task's pin is dropped.
   */
  private setMode(mode: AppMode) {
    const from = this.host.getMode();
    if (from === mode) return;
    if (from === 'focus-drag') this.discardZoneEdit();
    if (from === 'pin-add') this.pendingPinContent = null;
    if (mode === 'focus-drag') {
      this.zoneBeforeEdit = this.host.getFocusZone();
      this.zoneDrawn = false;
    }
    this.host.setMode(mode);
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
    if (this.armed && performance.now() >= this.armed.until) this.armed = null;

    this.panelHits.length = 0;
    let rayPinId: string | null = null;
    let previewPoint: SpatialHit['point'] | null = null;
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

      // While this hand carries something, its ray simply ends on it.
      const g = this.gesture;
      if (g.kind === 'pin' && g.controller === controller) {
        ray.distance = pinManager.getPinWorldPosition(g.pinId, _pinPos)
          ? ray.origin.distanceTo(_pinPos)
          : g.grabDistance;
        continue;
      }
      if (g.kind === 'move' && g.controller === controller) {
        ray.distance = g.distance;
        continue;
      }

      const target = this.pick();
      switch (target.kind) {
        case 'panel':
          ray.distance = target.hit.distance;
          this.panelHits.push(target.hit);
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
        case 'blocked':
          ray.distance = IDLE_RAY_LENGTH;
          ray.showDot = false;
          break;
      }
    }

    this.ui.setPanelHover(this.panelHits);
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

    if (this.textEdit && !this.textEdit.alive()) this.closeEditor();
    const typing = this.ui.editor.isOpen();
    if (this.askingStart && (this.ui.isHudHidden() || this.host.ui.getIsTimerRunning())) {
      this.askingStart = false;
    }
    this.ui.updateHud(
      {
        clock: this.host.ui.getTimerClockText(),
        timerRunning: this.host.ui.getIsTimerRunning(),
        mode,
        hint: this.hint(mode),
        askingStart: this.askingStart,
      },
      camera,
    );
    if (this.ui.getDrawerTab()) this.ui.updateDrawer(this.drawerData());
    this.ui.updateZoneBar(camera, this.zoneBarAnchor(mode));
    this.ui.editor.update(camera);

    const cardPinId = this.ui.getCardPinId();
    if (cardPinId) {
      if (pinManager.getPinWorldPosition(cardPinId, _pinPos)) {
        this.ui.setCardDeleteArmed(this.armed?.key === `pin:${cardPinId}`);
        this.ui.updateCard(camera, _pinPos, delta, typing);
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

  /** What the control panel says when nothing more specific is showing. */
  private hint(mode: AppMode): string {
    if (this.askingStart) return 'Start how? Timer only, or dim around a focus area';
    if (this.ui.editor.isOpen()) return 'Type on the keyboard, then press Done';
    switch (mode) {
      case 'explore':
        return 'Pinch a pin to open it, drag to move it';
      case 'pin-add':
        return this.pendingPinContent
          ? "Pinch where the task's pin should go"
          : 'Pinch where the pin should go';
      case 'focus-drag':
        if (this.zoneDrawn) return 'Drag again to redo, or press "Use this area"';
        if (this.canConfirmZone()) return 'Pinch and drag to mark a new focus area';
        return this.startTimerAfterZone
          ? 'First pinch and drag across your desk'
          : 'Pinch and drag across your desk';
    }
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
        const grip = gripOf(target.hit);
        if (grip) {
          this.grabPanel(grip, controller, target.hit.distance);
        } else {
          this.runPanelAction(target.hit);
        }
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
      case 'blocked':
        return;
    }
  }

  public selecting(controller: xb.Controller) {
    const g = this.gesture;
    if (!this.active || g.kind === 'idle' || g.controller !== controller) {
      return;
    }
    this.aim(controller);
    const {origin, direction} = this.raycaster.ray;

    if (g.kind === 'move') {
      // The panel rides the ray at the distance it was grabbed from.
      _turn.setFromUnitVectors(g.startDir, direction);
      _hudPos
        .copy(g.offset)
        .applyQuaternion(_turn)
        .add(origin)
        .addScaledVector(direction, g.distance);
      this.ui.setPanelPosition(g.panel, _hudPos);
      return;
    }

    // A drag starts when the ray itself moves: either the hand travels or the
    // wrist turns. Position alone missed aiming from across the room.
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

    if (g.kind === 'focus') {
      // The second corner slides across one flat plane through the first, so
      // the area follows the hand steadily instead of jumping between
      // whatever surfaces the ray happens to cross.
      const corner = this.roomRay().intersectPlane(g.plane, _zonePoint);
      if (!corner) return;
      // Past the largest allowed span, slide along the limit instead of
      // freezing, so the area keeps following the hand.
      const span = corner.distanceTo(g.start);
      if (span > FOCUS_MAX_SPAN) {
        corner.sub(g.start).multiplyScalar(FOCUS_MAX_SPAN / span).add(g.start);
      }
      this.host.previewFocusZone(focusZoneFromDrag(g.start, corner, g.onSurface));
      this.zoneDrawn = true;
      return;
    }

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
    this.openSystemKeyboard();
    const g = this.gesture;
    if (!this.active || g.kind === 'idle' || g.controller !== controller) {
      return;
    }
    this.gesture = IDLE;

    switch (g.kind) {
      case 'move':
        lotusSound.playHoverTick();
        return;
      case 'pin': {
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
      case 'focus':
        // The area stays in preview until the user confirms it on the bar.
        if (!g.moved) return;
        lotusSound.playPinCreated();
        this.pulse(controller, 0.4, 30);
        return;
    }
  }

  /** Empty space: only an explicit mode places anything, so a stray pinch never litters the room. */
  private pressEmptySpace(controller: xb.Controller, hit: SpatialHit) {
    switch (this.host.getMode()) {
      case 'pin-add': {
        const content = this.pendingPinContent;
        const pin = this.host.createPinAt(hit, content ?? undefined);
        this.setMode('explore');
        this.openCard(pin.id);
        this.pulse(controller, 0.4, 30);
        if (content) {
          this.ui.flashStatus('Pin placed for the task');
        } else {
          // Like the 2D composer: a new pin asks for its name straight away.
          this.editPinText(pin.id, 'title', {
            label: 'Name this pin',
            initial: '',
            placeholder: pin.title,
          });
        }
        return;
      }
      case 'focus-drag':
        this.startFocusDrag(controller, hit);
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

  private grabPanel(panel: XRMovablePanel, controller: xb.Controller, distance: number) {
    const {origin, direction} = this.raycaster.ray;
    this.gesture = {
      kind: 'move',
      panel,
      controller,
      distance,
      offset: this.ui
        .getPanelPosition(panel, new THREE.Vector3())
        .sub(origin)
        .addScaledVector(direction, -distance),
      startDir: direction.clone(),
    };
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
    // While typing every panel still works, but a stray pinch must not grab a
    // pin or place anything in the room.
    if (this.ui.editor.isOpen()) {
      return panel ? {kind: 'panel', hit: panel} : {kind: 'blocked'};
    }
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

  /** The current aiming ray in room space (the space pins and the zone are stored in). */
  private roomRay(): THREE.Ray {
    const root = this.host.worldRoot;
    root.updateWorldMatrix(true, false);
    _roomFromWorld.copy(root.matrixWorld).invert();
    return _roomRay.copy(this.raycaster.ray).applyMatrix4(_roomFromWorld);
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
    if (hit.panel === 'editor') {
      lotusSound.playKeyTap();
      this.runEditorAction(hit.action);
      return;
    }
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
      case 'zone':
        this.runZoneAction(hit.action);
        return;
    }
  }

  /**
   * Destructive buttons need two presses. The first arms the button for a few
   * seconds and returns false; the second, while armed, returns true.
   */
  private confirmTwice(key: string): boolean {
    const now = performance.now();
    if (this.armed?.key === key && now < this.armed.until) {
      this.armed = null;
      return true;
    }
    this.armed = {key, until: now + CONFIRM_WINDOW_MS};
    return false;
  }

  private runHudAction(action: XRHudAction) {
    const mode = this.host.getMode();
    const timer = this.host.ui;
    // Any other button answers the "Start how?" question with "not now".
    if (action !== 'start-timer-only' && action !== 'start-with-area') {
      this.askingStart = false;
    }
    switch (action) {
      case 'toggle-timer':
        if (timer.getIsTimerRunning()) {
          timer.stopFocusTimer();
          return;
        }
        switch (timer.getSettings().focusStart) {
          case 'ask':
            this.askingStart = true;
            return;
          case 'timer':
            this.startTimerOnly();
            return;
          case 'area':
            this.startFocusWithArea();
            return;
        }
        return;
      case 'start-timer-only':
        this.askingStart = false;
        this.startTimerOnly();
        return;
      case 'start-with-area':
        this.askingStart = false;
        this.startFocusWithArea();
        return;
      case 'start-cancel':
        return;
      case 'place-pin':
        this.setMode(mode === 'pin-add' ? 'explore' : 'pin-add');
        return;
      case 'focus-zone':
        this.setMode(mode === 'focus-drag' ? 'explore' : 'focus-drag');
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
        return;
      case 'move-hud':
        return; // A drag, handled in selectStart.
      case 'exit-xr':
        void this.xrSession?.end();
        return;
    }
  }

  /** Runs just the clock: nothing in the room is dimmed. */
  private startTimerOnly() {
    if (this.host.getMode() === 'focus-drag') this.setMode('explore');
    this.host.ui.startFocusTimer(false);
  }

  /** Starts focus with the room dimmed outside the focus area, setting the area first if needed. */
  private startFocusWithArea() {
    if (this.host.getMode() === 'focus-drag' && this.canConfirmZone()) {
      // Starting focus while an area is on show uses that area.
      this.startTimerAfterZone = true;
      this.confirmZone();
    } else if (this.host.focusZoneNeedsDefining()) {
      // The timer starts once the area is confirmed; the hint says what to do.
      this.setMode('focus-drag');
      this.startTimerAfterZone = true;
    } else {
      this.host.ui.startFocusTimer(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Focus area
  // ---------------------------------------------------------------------------

  private startFocusDrag(controller: xb.Controller, hit: SpatialHit) {
    const {origin, direction} = this.raycaster.ray;
    const ray = this.roomRay();
    const start = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
    const onSurface = ray.direction.y < FOCUS_SURFACE_PITCH;
    const normal = new THREE.Vector3(0, 1, 0);
    if (!onSurface) {
      // An upright plane facing the user, through the first corner.
      normal.set(-ray.direction.x, 0, -ray.direction.z);
      if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
      normal.normalize();
    }
    this.gesture = {
      kind: 'focus',
      controller,
      startOrigin: origin.clone(),
      startDir: direction.clone(),
      start,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start),
      onSurface,
      moved: false,
    };
  }

  /** There is an area to confirm: one just drawn, or the one saved earlier. */
  private canConfirmZone(): boolean {
    return this.zoneDrawn || !this.host.focusZoneNeedsDefining();
  }

  /** Top centre of the area being set, in world space; null when there is none to confirm. */
  private zoneBarAnchor(mode: AppMode): THREE.Vector3 | null {
    if (mode !== 'focus-drag' || !this.canConfirmZone()) return null;
    const {min, max} = this.host.getFocusZone();
    _zonePoint.set((min.x + max.x) / 2, max.y, (min.z + max.z) / 2);
    return this.host.worldRoot.localToWorld(_zonePoint);
  }

  private runZoneAction(action: XRZoneAction) {
    if (action === 'zone-confirm') this.confirmZone();
    else this.setMode('explore');
  }

  private confirmZone() {
    if (!this.canConfirmZone()) return;
    if (this.zoneDrawn) this.host.commitFocusZone();
    const startTimer = this.startTimerAfterZone;
    // Nothing left to put back when the mode is left below.
    this.zoneDrawn = false;
    this.zoneBeforeEdit = null;
    this.setMode('explore');
    lotusSound.playPinCreated();
    if (startTimer && !this.host.ui.getIsTimerRunning()) {
      this.host.ui.startFocusTimer(true);
    } else {
      this.ui.flashStatus('Focus area saved');
    }
  }

  /** Leaving focus-area mode without confirming: show the saved area again. */
  private discardZoneEdit() {
    if (this.zoneDrawn && this.zoneBeforeEdit) {
      this.host.previewFocusZone(this.zoneBeforeEdit);
    }
    this.zoneDrawn = false;
    this.zoneBeforeEdit = null;
    this.startTimerAfterZone = false;
  }

  // ---------------------------------------------------------------------------
  // Drawer: tasks, pins, settings
  // ---------------------------------------------------------------------------

  private runDrawerAction(action: XRDrawerAction) {
    if (action !== 'task-delete') this.armed = null;
    const [name, id, direction] = action.split(':');
    switch (name) {
      case 'move-drawer':
        return; // A drag, handled in selectStart.
      case 'page-prev':
        this.ui.turnDrawerPage(-1);
        return;
      case 'page-next':
        this.ui.turnDrawerPage(1);
        return;
      case 'pin':
        this.openCard(id);
        return;
      case 'pin-sort':
        this.pinSort = this.pinSort === 'proximity' ? 'date' : 'proximity';
        return;
      case 'setting':
        this.changeSetting(id, direction === 'prev' ? -1 : 1);
        return;
      default:
        this.runTaskAction(name, id);
    }
  }

  private runTaskAction(name: string, taskId: string | undefined) {
    const tasks = this.host.getTasks();
    const openTask = tasks.find((t) => t.id === this.openTaskId);
    switch (name) {
      // Task list
      case 'task-toggle':
        if (taskId) this.toggleTaskDone(taskId);
        return;
      case 'task-open':
        this.openTaskId = taskId ?? null;
        return;
      case 'task-new':
        this.taskForm = {
          taskId: null,
          title: '',
          note: '',
          dueLabel: '',
          type: 'task',
          timerMinutes: 25,
        };
        this.editTaskText('title');
        return;
      case 'task-filter':
        this.taskFilter =
          TASK_FILTERS[(TASK_FILTERS.indexOf(this.taskFilter) + 1) % TASK_FILTERS.length];
        return;
      case 'task-clear-done': {
        const kept = tasks.filter((t) => !t.completed);
        if (kept.length === tasks.length) {
          this.ui.flashStatus('No done tasks to clear');
          return;
        }
        this.host.commitTasks(kept);
        this.ui.flashStatus('Done tasks cleared');
        return;
      }

      // One open task
      case 'task-back':
        this.openTaskId = null;
        return;
      case 'task-done':
        if (openTask) this.toggleTaskDone(openTask.id);
        return;
      case 'task-timer':
        if (!openTask) return;
        if (openTask.completed) {
          this.ui.flashStatus('Mark the task as not done to run its timer');
          return;
        }
        this.host.commitTasks(toggleTaskTimer(tasks, openTask.id));
        return;
      case 'task-pin':
        if (!openTask) return;
        this.setMode('pin-add');
        this.pendingPinContent = pinContentFromTask(openTask);
        return;
      case 'task-edit':
        if (!openTask) return;
        this.taskForm = {
          taskId: openTask.id,
          title: openTask.title,
          note: openTask.note,
          dueLabel: openTask.dueLabel,
          type: openTask.type,
          timerMinutes: Math.max(1, Math.round((openTask.timerSeconds ?? 25 * 60) / 60)),
        };
        return;
      case 'task-delete':
        if (!openTask || !this.confirmTwice(`task:${openTask.id}`)) return;
        this.host.commitTasks(tasks.filter((t) => t.id !== openTask.id));
        this.openTaskId = null;
        this.ui.flashStatus('Task deleted');
        return;

      // New / edit task form
      case 'form-title':
        this.editTaskText('title');
        return;
      case 'form-due':
        this.editTaskText('dueLabel');
        return;
      case 'form-note':
        this.editTaskText('note');
        return;
      case 'form-type':
        if (this.taskForm) {
          this.taskForm.type = this.taskForm.type === 'task' ? 'reminder' : 'task';
        }
        return;
      case 'form-timer-down':
      case 'form-timer-up':
        if (this.taskForm) {
          this.taskForm.timerMinutes = this.nextTimerPreset(
            this.taskForm.timerMinutes,
            name === 'form-timer-up' ? 1 : -1,
          );
        }
        return;
      case 'form-cancel':
        this.taskForm = null;
        return;
      case 'form-save':
        this.commitTextEdit();
        this.saveTaskForm();
        return;
    }
  }

  private toggleTaskDone(taskId: string) {
    const tasks = toggleTaskDone(this.host.getTasks(), taskId);
    this.host.commitTasks(tasks);
    lotusSound.playTaskTick(Boolean(tasks.find((t) => t.id === taskId)?.completed));
  }

  /** The timer preset one step from `minutes`, staying within the presets. */
  private nextTimerPreset(minutes: number, direction: 1 | -1): number {
    const presets = TASK_TIMER_PRESETS_MIN;
    const next =
      direction === 1
        ? presets.find((m) => m > minutes)
        : [...presets].reverse().find((m) => m < minutes);
    return next ?? minutes;
  }

  private saveTaskForm() {
    const form = this.taskForm;
    if (!form) return;
    if (!form.title.trim()) {
      this.ui.flashStatus('Add a title first');
      return;
    }
    const tasks = this.host.getTasks();
    if (form.taskId === null) {
      this.host.commitTasks([createTask(form), ...tasks]);
      this.ui.flashStatus(form.type === 'reminder' ? 'Reminder added' : 'Task added');
    } else {
      const timerSeconds = form.timerMinutes * 60;
      this.host.commitTasks(
        tasks.map((t) =>
          t.id === form.taskId
            ? {
                ...t,
                title: form.title.trim(),
                note: form.note.trim(),
                dueLabel: form.dueLabel.trim() || (form.type === 'reminder' ? 'Reminder' : ''),
                type: form.type,
                // A new length restarts the timer; otherwise it keeps its place.
                ...(timerSeconds === t.timerSeconds
                  ? {}
                  : {timerSeconds, remainingSeconds: timerSeconds, timerRunning: false}),
              }
            : t,
        ),
      );
    }
    this.taskForm = null;
    lotusSound.playPinCreated();
  }

  private changeSetting(id: string, direction: 1 | -1) {
    const def = findXRSetting(id);
    if (!def) return;
    const ui = this.host.ui;
    const timerSetting = def.id === 'timer-mode' || def.id === 'focus-length';
    if (timerSetting && ui.getIsTimerRunning()) {
      // Changing the clock under a running timer would make it jump.
      this.ui.flashStatus('Stop the focus timer to change this');
      return;
    }
    const patch = def.step(ui.getSettings(), direction);
    ui.applySettings(patch);
    if (patch.defaultPinStyle) {
      // As on the 2D screen, the pin shape applies to every pin.
      const style = patch.defaultPinStyle;
      this.host.commitPins(this.host.getPins().map((p) => ({...p, shapeStyle: style})));
      const cardPin = this.findPin(this.ui.getCardPinId());
      if (cardPin) this.ui.refreshCard(cardPin);
    }
  }

  private drawerData(): XRDrawerData {
    const data: XRDrawerData = {
      tasks: [],
      taskFilter: this.taskFilter,
      hasCompletedTasks: false,
      openTask: null,
      taskForm: null,
      pins: [],
      pinSort: this.pinSort,
      settings: [],
    };
    switch (this.ui.getDrawerTab()) {
      case 'tasks':
        this.fillTaskData(data);
        break;
      case 'pins':
        this.fillPinData(data);
        break;
      case 'settings': {
        const s = this.host.ui.getSettings();
        data.settings = XR_SETTINGS.map((def) => ({
          id: def.id,
          name: def.name,
          kind: def.kind,
          hint: def.hint,
          value: def.value(s),
          swatch: def.swatch?.(s),
        }));
        break;
      }
    }
    return data;
  }

  private fillTaskData(data: XRDrawerData) {
    const tasks = this.host.getTasks();
    if (this.taskForm) {
      const {taskId, ...draft} = this.taskForm;
      data.taskForm = {editing: taskId !== null, ...draft};
      return;
    }
    const open = tasks.find((t) => t.id === this.openTaskId);
    if (open) {
      data.openTask = {
        task: open,
        clock: taskClockText(open),
        deleteArmed: this.armed?.key === `task:${open.id}`,
      };
      return;
    }
    this.openTaskId = null;
    data.hasCompletedTasks = tasks.some((t) => t.completed);
    data.tasks = tasks
      .filter(
        (t) =>
          this.taskFilter === 'all' ||
          (this.taskFilter === 'completed') === t.completed,
      )
      // To-do first; the sort is stable, so each group keeps its order.
      .sort((a, b) => Number(a.completed) - Number(b.completed))
      .map((task) => ({task, clock: taskClockText(task)}));
  }

  private fillPinData(data: XRDrawerData) {
    const {pinManager} = this.host;
    for (const pin of this.host.getPins()) {
      const distance = pinManager.getPinWorldPosition(pin.id, _pinPos)
        ? _pinPos.distanceTo(_camPos)
        : Infinity;
      data.pins.push({pin, distance});
    }
    data.pins.sort(
      this.pinSort === 'proximity'
        ? (a, b) => a.distance - b.distance
        : (a, b) => b.pin.createdAt - a.pin.createdAt,
    );
  }

  // ---------------------------------------------------------------------------
  // Pin card
  // ---------------------------------------------------------------------------

  private runCardAction(action: XRCardAction) {
    if (action !== 'delete') this.armed = null;
    const pinId = this.ui.getCardPinId();
    if (!pinId) return;
    switch (action) {
      case 'move-card':
        return; // A drag, handled in selectStart.
      case 'close':
        this.closeCard();
        return;
      case 'delete':
        if (!this.confirmTwice(`pin:${pinId}`)) return;
        this.closeCard();
        this.host.commitPins(this.host.getPins().filter((p) => p.id !== pinId));
        this.ui.flashStatus('Pin deleted');
        return;
      case 'edit':
        this.ui.setCardEditing(true);
        return;
      case 'edit-done':
        // Text still on the keyboard counts, as if Done was pressed there.
        this.commitTextEdit();
        this.ui.setCardEditing(false);
        return;
      case 'field-title':
        this.editPinText(pinId, 'title');
        return;
      case 'field-body':
        this.editPinText(pinId, 'body');
        return;
      case 'field-place':
        this.editPinText(pinId, 'surfaceLabel');
        return;
      case 'toggle-done':
        this.updatePin(pinId, (pin) => ({...pin, completed: !pin.completed}));
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
          shapeStyle:
            (pin.shapeStyle ?? this.host.ui.getSettings().defaultPinStyle) === 'dot'
              ? 'revolving'
              : 'dot',
        }));
        return;
    }
  }

  /** Applies `change` to one pin, commits, and redraws its card. */
  private updatePin(pinId: string, change: (pin: SpatialPin) => SpatialPin) {
    const pins = this.host.getPins();
    const pin = pins.find((p) => p.id === pinId);
    if (!pin) return;
    const updated = change(pin);
    this.host.commitPins(pins.map((p) => (p === pin ? updated : p)));
    this.host.pinManager.triggerClickEffect(pinId);
    this.ui.refreshCard(updated);
  }

  private openCard(pinId: string) {
    const pin = this.findPin(pinId);
    if (!pin) return;
    this.closeEditor();
    this.armed = null;
    this.ui.openCard(pin);
    this.host.pinManager.triggerClickEffect(pinId);
    lotusSound.playPinOpen();
  }

  private closeCard() {
    this.closeEditor();
    this.ui.closeCard();
  }

  private findPin(pinId: string | null): SpatialPin | undefined {
    return pinId ? this.host.getPins().find((p) => p.id === pinId) : undefined;
  }

  // ---------------------------------------------------------------------------
  // Text entry
  // ---------------------------------------------------------------------------

  /** Opens the keyboard for one of a pin's text fields. */
  private editPinText(
    pinId: string,
    field: PinTextField,
    request?: XRTextRequest,
  ) {
    const pin = this.findPin(pinId);
    if (!pin) return;
    this.requestText(
      request ?? {...PIN_TEXT_FIELDS[field], initial: pin[field]},
      (text) => {
        // A pin always keeps a title: an emptied one stays as it was.
        if (!text && field === 'title') return;
        this.updatePin(pinId, (p) => (p[field] === text ? p : {...p, [field]: text}));
      },
      () => this.ui.getCardPinId() === pinId && Boolean(this.findPin(pinId)),
    );
  }

  /** Opens the keyboard for one field of the task form. */
  private editTaskText(field: TaskTextField) {
    const form = this.taskForm;
    if (!form) return;
    this.requestText(
      {...TASK_TEXT_FIELDS[field], initial: form[field]},
      (text) => {
        if (this.taskForm === form) form[field] = text;
      },
      () =>
        this.taskForm === form &&
        this.ui.getDrawerTab() === 'tasks' &&
        !this.ui.isHudHidden(),
    );
  }

  /**
   * Opens the keyboard. `apply` receives the trimmed text when the user
   * presses Done; Cancel drops the edit. The keyboard closes by itself once
   * `alive` turns false. Moving on to another field keeps what was typed in
   * the current one.
   */
  private requestText(
    request: XRTextRequest,
    apply: (text: string) => void,
    alive: () => boolean,
  ) {
    this.commitTextEdit();
    this.stopTextTools();
    this.textEdit = {apply, alive};
    this.ui.editor.open(request, {
      voice: isSpeechSupported(),
      systemKeyboard: this.systemKeyboard,
    });
  }

  private closeEditor() {
    this.stopTextTools();
    this.textEdit = null;
    this.ui.editor.close();
  }

  /** Saves what is on the keyboard to its field, as Done would, but keeps the keyboard open. */
  private commitTextEdit() {
    const edit = this.textEdit;
    if (!edit || !this.ui.editor.isOpen() || !edit.alive()) return;
    edit.apply(this.ui.editor.getText().trim());
  }

  /** Stops dictation and the headset keyboard, whichever is running. */
  private stopTextTools() {
    this.pendingSystemKeyboard = false;
    this.stopDictation?.();
    this.stopDictation = null;
    this.stopSystemKeyboard?.();
    this.stopSystemKeyboard = null;
  }

  private runEditorAction(action: XRKeyAction) {
    const editor = this.ui.editor;
    if (editor.press(action)) {
      // Typing dismisses an old message, but not "Listening…".
      if (!this.stopDictation) editor.setStatus('');
      return;
    }
    switch (action) {
      case 'done': {
        const apply = this.textEdit?.apply;
        const text = editor.getText().trim();
        this.closeEditor();
        apply?.(text);
        return;
      }
      case 'cancel':
        this.closeEditor();
        return;
      case 'move':
        return; // A drag, handled in selectStart.
      case 'voice':
        this.toggleDictation();
        return;
      case 'system-keyboard':
        this.stopTextTools();
        // Opens on release; see `pendingSystemKeyboard`.
        this.pendingSystemKeyboard = true;
        return;
    }
  }

  private toggleDictation() {
    const editor = this.ui.editor;
    if (this.stopDictation) {
      this.stopDictation();
      this.stopDictation = null;
      editor.setStatus('');
      return;
    }
    this.stopTextTools();
    const edit = this.textEdit;
    const stop = dictateOnce(
      (text) => {
        if (this.textEdit === edit) editor.insert(text);
      },
      (failed) => {
        if (this.stopDictation !== stop) return;
        this.stopDictation = null;
        editor.setStatus(failed ? 'Could not hear that. Check mic access and try again.' : '');
      },
    );
    if (!stop) {
      editor.setStatus('Voice input is not available in this browser.');
      return;
    }
    this.stopDictation = stop;
    editor.setStatus('Listening… speak now', true);
  }

  private openSystemKeyboard() {
    if (!this.pendingSystemKeyboard) return;
    this.pendingSystemKeyboard = false;
    const editor = this.ui.editor;
    const edit = this.textEdit;
    if (!edit || !editor.isOpen()) return;
    const stop = editWithSystemKeyboard(
      editor.getText(),
      (text) => {
        if (this.textEdit === edit) editor.setText(text);
      },
      (text) => {
        if (this.stopSystemKeyboard !== stop) return;
        this.stopSystemKeyboard = null;
        editor.setText(text);
        editor.setStatus('');
      },
    );
    if (!stop) {
      editor.setStatus('The headset keyboard did not open. Use the keys below.');
      return;
    }
    this.stopSystemKeyboard = stop;
    editor.setStatus('Type on the headset keyboard, then close it and press Done');
  }
}

/** The panel a hit's grip button moves, or null when the hit is not on a grip. */
function gripOf(hit: XRPanelHit): XRMovablePanel | null {
  if (hit.panel === 'hud' && hit.action === 'move-hud') return 'hud';
  // The drawer rides on the control panel: its grip moves both.
  if (hit.panel === 'drawer' && hit.action === 'move-drawer') return 'hud';
  if (hit.panel === 'card' && hit.action === 'move-card') return 'card';
  if (hit.panel === 'editor' && hit.action === 'move') return 'editor';
  return null;
}
