import * as THREE from 'three';
import * as xb from 'xrblocks';

import {FocusVolume3D} from './FocusVolume3D';
import {LotusUI} from './LotusUI';
import {PinManager3D} from './PinManager3D';
import {RoomAnchor} from './RoomAnchor';
import {
  XRCardAction,
  XRHudAction,
  XRInterface,
  XRPanelHit,
  XRPointerRay,
} from './XRInterface';
import {lotusSound} from './sound';
import {dictateOnce} from './speech';
import {
  AppMode,
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
  >;
  getMode(): AppMode;
  setMode(mode: AppMode): void;
  getPins(): SpatialPin[];
  /** Replaces the pin list everywhere (storage, 3D pins, DOM UI). */
  commitPins(pins: SpatialPin[]): void;
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

const _rayQuat = new THREE.Quaternion();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _pinPos = new THREE.Vector3();
const _camPos = new THREE.Vector3();

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
    if (session) {
      this.roomAnchor.begin(session);
      session.addEventListener('select', this.onNativeSelect);
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
    const {pinManager} = this.host;
    pinManager.setDraggingPin(null);
    pinManager.setHoveredPin(null);
    pinManager.updatePreview(false);
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  /** Puts room content back on the real room. Run before pins are read. */
  public updateAnchor(frame: XRFrame, referenceSpace: XRReferenceSpace) {
    if (this.active) {
      this.roomAnchor.update(frame, referenceSpace, this.host.worldRoot);
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

    let panelHover: XRPanelHit | null = null;
    let hoveredPinId: string | null = null;
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
          hoveredPinId ??= target.pinId;
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
    pinManager.setHoveredPin(
      this.gesture.kind === 'pin' ? this.gesture.pinId : hoveredPinId,
    );
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

    const cardPinId = this.ui.getCardPinId();
    if (cardPinId) {
      if (pinManager.getPinWorldPosition(cardPinId, _pinPos)) {
        this.ui.updateCard(camera, _pinPos);
      } else {
        this.closeCard();
      }
    }
    this.ui.updateLabels(this.host.getPins(), pinProjections, (pinId, out) =>
      pinManager.getPinWorldPosition(pinId, out),
    );
  }

  // ---------------------------------------------------------------------------
  // Pinch gestures (controller trigger or hand pinch)
  // ---------------------------------------------------------------------------

  public selectStart(controller: xb.Controller) {
    if (!this.active) return;
    this.seenControllers.add(controller);
    // One gesture at a time: ignore the other hand while one is running.
    if (this.gesture.kind !== 'idle') return;
    this.aim(controller);

    const target = this.pick();
    switch (target.kind) {
      case 'panel':
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
      return;
    }

    if (!g.dragged) return; // A tap without a drag: stay in focus-area mode.
    this.host.commitFocusZone();
    lotusSound.playPinCreated();
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
        ? this.raycaster.intersectObjects(
            this.host.pinManager.getHitMeshes(),
            false,
          )[0]
        : undefined;
    if (panel && (!pin || panel.distance <= pin.distance)) {
      return {kind: 'panel', hit: panel};
    }
    const pinId = pin?.object.userData.pinId as string | undefined;
    if (pin && pinId) return {kind: 'pin', pinId, distance: pin.distance};
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
    if (hit.panel === 'hud') {
      this.runHudAction(hit.action);
    } else {
      this.runCardAction(hit.action);
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
      case 'exit-xr':
        void this.xrSession?.end();
        return;
    }
  }

  private runCardAction(action: XRCardAction) {
    switch (action) {
      case 'close':
        this.closeCard();
        return;
      case 'delete': {
        const pinId = this.ui.getCardPinId();
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
    }
  }

  // ---------------------------------------------------------------------------
  // Pin card and text entry
  // ---------------------------------------------------------------------------

  private openCard(pinId: string) {
    const pin = this.host.getPins().find((p) => p.id === pinId);
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
