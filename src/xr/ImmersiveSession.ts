import * as THREE from 'three';
import * as xb from 'xrblocks';

import {
  FOCUS_RAY_FALLBACK_METERS,
  focusZoneFromDrag,
  focusZoneYawFacing,
} from '../FocusVolume3D';
import type {FocusTimerEvent} from '../FocusTimer';
import {lotusSound} from '../sound';
import {AppMode, PinScreenProjection, SpatialHit} from '../types';
import {ConfirmGuard} from './ConfirmGuard';
import {ImmersiveHost, PinContent} from './ImmersiveHost';
import {RoomAnchor} from './RoomAnchor';
import {RoomPlanes} from './RoomPlanes';
import {XRDrawerController} from './XRDrawerController';
import {XRFocusZoneEditor} from './XRFocusZoneEditor';
import {XRInterface} from './XRInterface';
import {
  XRHudAction,
  XRMovablePanel,
  XRPanelHit,
  XRPointerRay,
} from './XRInterfaceTypes';
import {XRPinCardController} from './XRPinCardController';
import {XRTextEntry} from './XRTextEntry';

export type {ImmersiveHost} from './ImmersiveHost';
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
      /** The area faces the user: its sides run along and across their aim. */
      yaw: number;
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
/**
 * When the ray lands on no plane from room setup, a focus-area drag that
 * starts with the ray pointing down by more than ~20° marks out a surface
 * (desk, floor); a flatter ray marks out a wall area.
 */
const FOCUS_SURFACE_PITCH = -0.34;
/** A corner further than this (m) from the first one is a stray ray, not a drag. */
const FOCUS_MAX_SPAN = 15;
/** Length of a ray that points at nothing. */
const IDLE_RAY_LENGTH = 1.2;

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
  private readonly roomAnchor = new RoomAnchor(() =>
    this.notify('Could not find this room again. Pins and the focus area may be out of place.'),
  );
  private readonly raycaster = new THREE.Raycaster();
  /** Desks, floors and walls from the headset's room setup, if it has one. */
  private readonly planes = new RoomPlanes();
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
  /** Hands whose palm faced up last frame (summons the control panel). */
  private palmUp = new Set<XRHandedness>();
  /** Menu button state last frame, per controller, for edge detection. */
  private menuButtonDown = new Set<XRHandedness>();
  /** Destructive buttons (delete, Exit XR) need a confirming second press. */
  private readonly confirm = new ConfirmGuard();
  /** Text for the next placed pin, when it is being placed for a task. */
  private pendingPinContent: PinContent | null = null;

  // The parts of the session with their own state; see each class.
  private readonly text = new XRTextEntry(this.ui);
  private readonly zone: XRFocusZoneEditor;
  private readonly card: XRPinCardController;
  private readonly drawer: XRDrawerController;
  private readonly onNativeSelect = () => this.text.openSystemKeyboard();
  private readonly unsubscribeTimer: () => void;

  constructor(private readonly host: ImmersiveHost) {
    this.zone = new XRFocusZoneEditor(host, this.ui, (mode) => this.setMode(mode));
    this.card = new XRPinCardController(host, this.ui, this.text, this.confirm);
    this.drawer = new XRDrawerController(
      host,
      this.ui,
      this.text,
      this.confirm,
      this.card,
      (content) => {
        this.setMode('pin-add');
        this.pendingPinContent = content;
      },
    );
    this.unsubscribeTimer = host.timer.subscribe((event) => this.onFocusTimer(event));
  }

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
    this.text.setSession(session);
    this.ui.setActive(true);
    if (this.host.timer.running) this.ui.setHudHidden(true);
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
    this.planes.clear();
    // Back on a 2D screen the room space is the scene space again.
    const root = this.host.worldRoot;
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    this.reset();
    this.seenControllers.clear();
    this.ui.setActive(false);
  }

  public dispose() {
    this.unsubscribeTimer();
    this.xrSession?.removeEventListener('select', this.onNativeSelect);
    this.text.close();
    this.roomAnchor.end();
    this.ui.dispose();
  }

  private reset() {
    this.text.close();
    this.gesture = IDLE;
    this.confirm.clear();
    this.zone.reset();
    this.drawer.reset();
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
    if (from === 'focus-drag') this.zone.discard();
    if (from === 'pin-add') this.pendingPinContent = null;
    if (mode === 'focus-drag') this.zone.beginEdit();
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
    this.planes.update(frame, referenceSpace);
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
    this.confirm.expire();

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
    this.ui.updatePointers(this.rays, controllers.length);

    this.text.closeIfStale();
    const typing = this.ui.editor.isOpen();
    // A hidden panel cannot show the question.
    if (this.ui.isHudHidden()) this.zone.closeQuestion();
    const {timer} = this.host;
    this.ui.updateHud(
      {
        clock: timer.clockText() || '00:00',
        timerRunning: timer.running,
        mode,
        hint: this.hint(mode),
        askingStart: this.zone.isAsking(),
        exitArmed: this.confirm.isArmed('exit-xr'),
      },
      camera,
    );
    this.drawer.setViewerPosition(_camPos);
    this.ui.updateDrawer(this.drawer.getData);
    this.ui.updateZoneBar(camera, this.zone.barAnchor(mode));
    this.ui.editor.update(camera);

    const cardPinId = this.ui.getCardPinId();
    if (cardPinId) {
      if (pinManager.getPinWorldPosition(cardPinId, _pinPos)) {
        this.ui.setCardDeleteArmed(this.confirm.isArmed(`pin:${cardPinId}`));
        this.ui.updateCard(camera, _pinPos, delta, typing);
      } else {
        this.card.close();
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
    if (this.zone.isAsking()) return 'Start how? Timer only, or dim around a focus area';
    if (this.ui.editor.isOpen()) return 'Type on the keyboard, then press Done';
    switch (mode) {
      case 'explore':
        return 'Pinch a pin to open it, drag to move it';
      case 'pin-add':
        return this.pendingPinContent
          ? "Pinch where the task's pin should go"
          : 'Pinch where the pin should go';
      case 'focus-drag':
        return this.zone.hint();
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

  /**
   * Focus starting puts the panel away; focus ending brings it back. The
   * timer may be started from either interface, so this follows the timer
   * rather than the buttons.
   */
  private onFocusTimer(event: FocusTimerEvent) {
    if (!this.active) return;
    switch (event.type) {
      case 'start':
        this.zone.closeQuestion();
        this.ui.setDrawerTab(null);
        this.ui.setHudHidden(true);
        return;
      case 'stop':
        this.ui.setHudHidden(false);
        this.ui.flashStatus(event.completed ? 'Focus session complete' : 'Focus session ended');
        return;
      case 'tick':
        return; // The panel reads the clock every frame.
    }
  }

  /**
   * Tells the user something they did not ask about (a failed save, a room
   * that was not recognised). Brings the control panel back if it is hidden,
   * since the message shows on it. Outside a session it does nothing.
   */
  public notify(text: string) {
    if (!this.active) return;
    this.ui.setHudHidden(false);
    this.ui.flashStatus(text, 8);
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
      this.zone.preview(
        focusZoneFromDrag(g.start, corner, g.onSurface, 'room', g.yaw),
      );
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
    this.text.openSystemKeyboard();
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
          this.card.open(g.pinId);
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
        this.card.open(pin.id);
        this.pulse(controller, 0.4, 30);
        if (content) {
          this.ui.flashStatus('Pin placed for the task');
        } else {
          // Like the 2D composer: a new pin asks for its name straight away.
          this.card.editText(pin.id, 'title', {
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
        if (this.ui.getCardPinId()) this.card.close();
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
      // Keys do not change the drawer; text that is applied invalidates it
      // where it is applied.
      lotusSound.playKeyTap();
      this.text.runAction(hit.action);
      return;
    }
    lotusSound.playHoverTick();
    switch (hit.panel) {
      case 'hud':
        this.runHudAction(hit.action);
        break;
      case 'chip':
        this.ui.setHudHidden(false, true);
        break;
      case 'drawer':
        this.drawer.runAction(hit.action);
        break;
      case 'card':
        this.card.runAction(hit.action);
        break;
      case 'zone':
        this.zone.runAction(hit.action);
        break;
    }
    // The drawer only looks at its data a few times a second; a press must
    // show at once.
    this.ui.invalidateDrawer();
  }

  private runHudAction(action: XRHudAction) {
    const mode = this.host.getMode();
    // Any other button answers the "Start how?" question with "not now".
    if (action !== 'start-timer-only' && action !== 'start-with-area') {
      this.zone.closeQuestion();
    }
    // Any other button also withdraws a first press on Exit XR.
    if (action !== 'exit-xr') this.confirm.clear();
    switch (action) {
      case 'toggle-timer':
        this.zone.pressPlay();
        return;
      case 'start-timer-only':
        this.zone.startTimerOnly();
        return;
      case 'start-with-area':
        this.zone.startWithArea();
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
        // Leaving ends the session, so it takes two presses like a delete.
        if (!this.confirm.confirm('exit-xr')) return;
        void this.xrSession?.end();
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Focus area drag (the area itself is XRFocusZoneEditor's)
  // ---------------------------------------------------------------------------
  /**
   * Desk or wall? Where the ray lands on a plane from the headset's room
   * setup, that plane says (and a wall area lies flat on the wall). Without
   * one, the angle of the ray decides: aiming down marks out a desk or floor.
   */
  private startFocusDrag(controller: xb.Controller, hit: SpatialHit) {
    const {origin, direction} = this.raycaster.ray;
    const plane = this.planes.hit(this.raycaster.ray, hit.isSurface ? hit.distance : Infinity);
    const ray = this.roomRay();
    // The first corner: the room surface the ray hit, else the room-setup
    // plane, else far out along the ray (a far aim must start the corner
    // there, not at the short pick fallback; the cast showed nothing blocks it).
    const start = new THREE.Vector3();
    if (hit.isSurface) {
      start.set(hit.point.x, hit.point.y, hit.point.z);
    } else if (plane) {
      this.host.worldRoot.worldToLocal(start.copy(plane.point));
    } else {
      ray.at(FOCUS_RAY_FALLBACK_METERS, start);
    }

    const onSurface = plane
      ? plane.orientation === 'horizontal'
      : ray.direction.y < FOCUS_SURFACE_PITCH;
    // The plane the second corner slides across, in room space.
    const normal = new THREE.Vector3(0, 1, 0);
    let facing = ray.direction;
    if (!onSurface) {
      if (plane) {
        // Flat on the wall, and squared up with it rather than with the aim.
        // (`roomRay()` above has just set _roomFromWorld.)
        normal.copy(plane.normal).transformDirection(_roomFromWorld);
      } else {
        // An upright plane facing the user, through the first corner.
        normal.set(-ray.direction.x, 0, -ray.direction.z);
      }
      normal.y = 0;
      if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
      normal.normalize();
      facing = new THREE.Vector3().copy(normal).negate();
    }
    this.gesture = {
      kind: 'focus',
      controller,
      startOrigin: origin.clone(),
      startDir: direction.clone(),
      start,
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start),
      onSurface,
      yaw: focusZoneYawFacing(facing),
      moved: false,
    };
  }
}

/** The panel a hit's grip button moves, or null when the hit is not on a grip. */
function gripOf(hit: XRPanelHit): XRMovablePanel | null {
  if (hit.panel === 'hud' && hit.action === 'move-hud') return 'hud';
  // The drawer rides on the control panel: its grip moves both.
  if (hit.panel === 'drawer' && hit.action?.kind === 'move-drawer') return 'hud';
  if (hit.panel === 'card' && hit.action === 'move-card') return 'card';
  if (hit.panel === 'editor' && hit.action === 'move') return 'editor';
  return null;
}
