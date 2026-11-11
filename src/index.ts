import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as xb from 'xrblocks';

import {CameraGate} from './CameraGate';
import {CameraPassthrough} from './CameraPassthrough';
import {FocusVolume3D} from './FocusVolume3D';
import {LotusUI} from './LotusUI';
import {PinManager3D} from './PinManager3D';
import {RoomAnchor} from './RoomAnchor';
import {StudyRoomBuilder} from './StudyRoomBuilder';
import {XRInterface, XRPanelHit, XRPointerRay, dictateOnce} from './XRInterface';
import {lotusSound} from './sound';
import {
  DEFAULT_FOCUS_ZONE,
  DEFAULT_PINS,
  loadFocusZone,
  loadLotusSettings,
  loadSavedPins,
  loadSavedTasks,
  saveFocusZoneToStorage,
  saveLotusSettings,
  savePinsToStorage,
  saveTasksToStorage,
  vec3,
} from './storage';
import {
  AppMode,
  FocusZoneBounds,
  LotusSettings,
  LotusTask,
  PinScreenProjection,
  RoomWaypoint,
  SpatialPin,
  Vector3Data,
} from './types';

const _ndcPointer = new THREE.Vector2();
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _rayPoint = new THREE.Vector3();
const _lookAtTarget = new THREE.Vector3(0, 1.15, -1.5);
const _desiredCamPos = new THREE.Vector3(0, 1.45, -0.25);
const _desiredLookAt = new THREE.Vector3(0, 1.15, -1.5);
const _xrVec = new THREE.Vector3();
const _xrVec2 = new THREE.Vector3();
const _xrQuat = new THREE.Quaternion();
const _xrCamPos = new THREE.Vector3();

/** Standalone headsets never composite the DOM into an immersive session. */
const IS_STANDALONE_HEADSET = /OculusBrowser|Quest/i.test(navigator.userAgent);

interface SpatialHit {
  /** Position in room space (the space pins and the focus zone are stored in). */
  point: Vector3Data;
  normal: Vector3Data;
  surfaceLabel: string;
  /** False when nothing was hit and the point is the fallback along the ray. */
  isSurface: boolean;
  /** Distance from the ray origin, in metres. */
  distance: number;
}

/**
 * Main XR Blocks script for LOTUS:
 * Real-World Camera AR Memory Pins & Study Focus Zone with Timer-Driven Peripheral Blur.
 */
class LotusSpatialApp extends xb.Script {
  private cameraPassthrough!: CameraPassthrough;
  private roomBuilder!: StudyRoomBuilder;
  private pinManager!: PinManager3D;
  private focusVolume!: FocusVolume3D;
  private ui!: LotusUI;
  private cameraGate?: CameraGate;
  private webcamWanted = false;

  private pins: SpatialPin[] = [];
  private tasks: LotusTask[] = [];
  private focusZone: FocusZoneBounds = {...DEFAULT_FOCUS_ZONE};
  private settings: LotusSettings = loadLotusSettings();
  private mode: AppMode = 'explore';

  private raycaster = new THREE.Raycaster();
  private unbindXRSession?: () => void;

  // Dragging state for Focus Area selection
  private isDraggingFocus = false;
  private dragStart3D: Vector3Data | null = null;
  private dragStartScreen = {x: 0, y: 0};

  // Pinch / Drag-to-Move state for Spatial Pins
  private activeDragPinId: string | null = null;
  private hasMovedDuringPinDrag = false;
  private pinDragFromDOM = false;
  private pinDragStartScreen = {x: 0, y: 0};
  private xrDragPinId: string | null = null;
  private xrDragController: THREE.Object3D | null = null;
  private xrPinMoved = false;
  private xrDragStartPos = new THREE.Vector3();
  private xrDragStartDir = new THREE.Vector3();
  private xrDragDistance = 1;

  // Immersive-session state. `worldRoot` holds everything stored in room space
  // (pins, focus zone); the room anchor moves it so content stays on the real
  // room between sessions.
  private worldRoot = new THREE.Group();
  private roomAnchor = new RoomAnchor();
  private xrUI!: XRInterface;
  private xrSeenControllers = new Set<THREE.Object3D>();
  private xrFocusController: THREE.Object3D | null = null;
  private xrFocusDragged = false;
  private xrStartTimerAfterZone = false;
  private xrStatus = '';
  private xrStatusUntil = 0;
  private xrRays: XRPointerRay[] = [];
  private stopXRDictation?: () => void;

  // Camera glide animation state
  private isGlidingCamera = false;
  private keysPressed: Record<string, boolean> = {};

  init() {
    this.pins = loadSavedPins();
    this.tasks = loadSavedTasks();
    this.focusZone = loadFocusZone();
    this.settings = loadLotusSettings();
    lotusSound.enabled = this.settings.soundEnabled;

    // 1. Show the onboarding card on every device. A user tap either opens the
    //    webcam (browser prompt) or, on immersive-ar devices, enters XR, where
    //    the device supplies the room view instead.
    this.cameraPassthrough = new CameraPassthrough();
    this.setupCameraAccess();
    this.bindXRSessionEvents();

    this.setupLightingAndTransparentCanvas();

    // 2. Build optional 3D Study Room (hidden by default so user sees their real house camera)
    this.roomBuilder = new StudyRoomBuilder();
    this.roomBuilder.setVisible(this.settings.showVirtualRoom);
    this.add(this.roomBuilder.root);

    // 3. Build 3D Lotus Memory Pin Manager
    this.pinManager = new PinManager3D();
    this.pinManager.syncPins(this.pins, this.settings.defaultPinStyle);
    this.worldRoot.name = 'LotusRoomSpace';
    this.worldRoot.add(this.pinManager.root);

    // 4. Build 3D Focus Zone Volume
    this.focusVolume = new FocusVolume3D(this.focusZone);
    this.worldRoot.add(this.focusVolume.root);
    this.add(this.worldRoot);

    // 4b. In-headset interface (the DOM UI is not visible in an immersive session)
    this.xrUI = new XRInterface();
    this.add(this.xrUI.root);

    // 5. Set initial camera pose
    const camera = xb.core?.camera;
    if (camera) {
      camera.position.set(0, 1.45, -0.25);
      camera.lookAt(0, 1.15, -1.5);
      _desiredCamPos.copy(camera.position);
    }

    // 6. Initialize Simple, Clutter-Free UI
    this.ui = new LotusUI(this.pins, this.tasks, this.focusZone, this.settings, {
      onModeChange: (newMode) => {
        this.mode = newMode;
        this.pinManager.updatePreview(false);
        this.syncFocusVisuals();
      },
      onSavePin: (savedPin) => {
        const idx = this.pins.findIndex((p) => p.id === savedPin.id);
        if (idx >= 0) {
          this.pins[idx] = savedPin;
        } else {
          this.pins.unshift(savedPin);
        }
        savePinsToStorage(this.pins);
        this.pinManager.syncPins(this.pins, this.settings.defaultPinStyle);
        this.ui.setPins(this.pins);
      },
      onDeletePin: (pinId) => {
        this.pins = this.pins.filter((p) => p.id !== pinId);
        savePinsToStorage(this.pins);
        this.pinManager.syncPins(this.pins, this.settings.defaultPinStyle);
        this.ui.setPins(this.pins);
      },
      onClearAllPins: () => {
        this.pins = [];
        savePinsToStorage(this.pins);
        this.pinManager.syncPins(this.pins, this.settings.defaultPinStyle);
        this.ui.setPins(this.pins);
      },
      onApplyStyleToAllPins: (style) => {
        this.pins = this.pins.map((p) => ({...p, shapeStyle: style}));
        savePinsToStorage(this.pins);
        this.pinManager.syncPins(this.pins, style);
        this.ui.setPins(this.pins);
      },
      onSaveTasks: (updatedTasks) => {
        this.tasks = [...updatedTasks];
        saveTasksToStorage(this.tasks);
        this.ui.setTasks(this.tasks);
      },
      onHoverPin: (pinId) => {
        this.pinManager.setHoveredPin(pinId);
      },
      onClickPinEffect: (pinId) => {
        this.pinManager.triggerClickEffect(pinId);
      },
      onWalkToWaypoint: (wp: RoomWaypoint) => {
        _desiredCamPos.set(wp.position.x, wp.position.y, wp.position.z);
        _desiredLookAt.set(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z);
        this.isGlidingCamera = true;
      },
      onWalkToPin: (pin: SpatialPin) => {
        _desiredCamPos.set(
          pin.position.x,
          Math.max(1.25, pin.position.y + 0.15),
          pin.position.z + 1.15,
        );
        _desiredLookAt.set(pin.position.x, pin.position.y, pin.position.z);
        this.isGlidingCamera = true;
      },
      onSettingsChange: (updatedSettings) => {
        this.settings = {...updatedSettings};
        saveLotusSettings(this.settings);
        lotusSound.enabled = this.settings.soundEnabled;
        this.roomBuilder.setVisible(this.settings.showVirtualRoom);
        this.pinManager.syncPins(this.pins, this.settings.defaultPinStyle);
        this.syncFocusVisuals();
      },
      onFocusZoneChange: (updatedZone) => {
        this.focusZone = {...updatedZone};
        saveFocusZoneToStorage(this.focusZone);
      },
      onTimerStateChange: () => {
        this.syncFocusVisuals();
      },
      onFlipCamera: () => {
        void this.cameraPassthrough.flipCamera();
      },
    });

    this.bindPointerAndKeyboardEvents();
  }

  /**
   * Always show the gate: before an XR session starts there is nothing behind
   * the transparent canvas, so a headset/emulator would otherwise see a blank
   * page. On immersive-ar devices the gate offers "Enter XR" as the main
   * action; the webcam opens only after an explicit tap.
   */
  private setupCameraAccess() {
    this.cameraGate = new CameraGate(
      async () => {
        const ok = await this.cameraPassthrough.startCamera('environment');
        this.webcamWanted = ok;
        // The permission prompt can resolve after an XR session has started;
        // the device owns the view then, so keep the webcam off until it ends.
        if (ok && this.isXRPresenting()) {
          this.cameraPassthrough.stopCamera();
          this.cameraPassthrough.setVisible(false);
        }
        return ok;
      },
      () => {},
    );
  }

  /**
   * In an immersive-ar session (Meta Quest, Android XR…) the device composites
   * real-world passthrough itself, so release the getUserMedia stream and hide
   * the onboarding card. When the session ends, fall back to the web camera,
   * or to the card again if the webcam was never enabled.
   */
  private bindXRSessionEvents() {
    const renderer = xb.core?.renderer as THREE.WebGLRenderer | undefined;
    const xrManager = renderer?.xr;
    if (!xrManager || !renderer) return;
    // xrblocks resizes the renderer on every window resize, but the device owns
    // the framebuffer size during a session and three.js ignores (and warns
    // about) the call. Skip it while presenting and replay it afterwards.
    const originalSetSize = renderer.setSize;
    let resizeSkipped = false;
    renderer.setSize = (width, height, updateStyle) => {
      if (xrManager.isPresenting) {
        resizeSkipped = true;
        return;
      }
      originalSetSize.call(renderer, width, height, updateStyle);
    };
    const onSessionStart = () => {
      // During XR the headset/emulator owns the canvas layout. Our full-screen
      // `canvas.lotus-canvas` rules (fixed, z-index 5, !important) would sit on
      // top of the emulator's toolbar, gizmos and controller panels and swallow
      // every click, so drop them until the session ends.
      renderer.domElement.classList.remove('lotus-canvas');
      // Emulators present the session in their own full-page layer; lift the
      // DOM UI above it so the dock, panels and modals stay usable.
      document.body.classList.add('lotus-xr-active');
      this.cameraGate?.onSessionStart();
      this.cameraPassthrough.stopCamera();
      this.cameraPassthrough.setVisible(false);
      this.enterXRInterface(xrManager.getSession());
    };
    const onSessionEnd = () => {
      renderer.domElement.classList.add('lotus-canvas');
      document.body.classList.remove('lotus-xr-active');
      this.exitXRInterface();
      this.cameraGate?.onSessionEnd(!this.webcamWanted);
      if (this.webcamWanted) {
        this.cameraPassthrough.setVisible(true);
        void this.cameraPassthrough.startCamera();
      }
      if (resizeSkipped) {
        resizeSkipped = false;
        // Deferred so it runs after three.js restores its pre-session size;
        // xrblocks' resize handler then applies the current window size.
        setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
      }
    };
    xrManager.addEventListener('sessionstart', onSessionStart);
    xrManager.addEventListener('sessionend', onSessionEnd);
    this.unbindXRSession = () => {
      xrManager.removeEventListener('sessionstart', onSessionStart);
      xrManager.removeEventListener('sessionend', onSessionEnd);
      renderer.setSize = originalSetSize;
      document.body.classList.remove('lotus-xr-active');
    };
  }

  // ===========================================================================
  // IMMERSIVE SESSION (headset) INTERFACE
  // ===========================================================================

  /** Session started: switch from the DOM UI to the in-headset interface. */
  private enterXRInterface(session: XRSession | null) {
    // A DOM modal cannot be seen or dismissed inside the headset.
    this.ui.closeAllModals();
    this.resetXRInteraction();
    this.setXRMode('explore');
    this.removeUntouchedSamplePin();
    this.xrUI.setActive(true);
    this.focusVolume.setXRPresentation(true);
    if (session) this.roomAnchor.begin(session);
    this.syncFocusVisuals();
  }

  private exitXRInterface() {
    this.roomAnchor.end();
    // Back on a 2D screen the room space is the scene space again.
    this.worldRoot.position.set(0, 0, 0);
    this.worldRoot.quaternion.identity();
    this.worldRoot.scale.set(1, 1, 1);
    this.worldRoot.updateMatrixWorld(true);
    this.resetXRInteraction();
    this.xrUI.setActive(false);
    this.focusVolume.setXRPresentation(false);
    this.setXRMode('explore');
  }

  private resetXRInteraction() {
    this.stopXRDictation?.();
    this.stopXRDictation = undefined;
    this.xrDragPinId = null;
    this.xrDragController = null;
    this.xrPinMoved = false;
    this.xrFocusController = null;
    this.xrFocusDragged = false;
    this.xrStartTimerAfterZone = false;
    this.xrStatus = '';
    this.dragStart3D = null;
    this.pinManager.setDraggingPin(null);
    this.pinManager.setHoveredPin(null);
    this.pinManager.updatePreview(false);
  }

  /**
   * The seeded sample pin sits at made-up "desk" coordinates. In a real room
   * that is an arbitrary spot in mid-air, so drop it if it was never touched.
   */
  private removeUntouchedSamplePin() {
    const sample = DEFAULT_PINS[0];
    if (!sample) return;
    const remaining = this.pins.filter(
      (p) =>
        !(
          p.id === sample.id &&
          p.title === sample.title &&
          p.position.x === sample.position.x &&
          p.position.y === sample.position.y &&
          p.position.z === sample.position.z
        ),
    );
    if (remaining.length === this.pins.length) return;
    this.pins = remaining;
    savePinsToStorage(this.pins);
    this.pinManager.syncPins(this.pins, this.settings.defaultPinStyle);
    this.ui.setPins(this.pins);
  }

  /** The focus zone still holds the made-up default, not a real spot. */
  private focusZoneNeedsDefining(): boolean {
    return (
      !this.focusZone.defined ||
      this.focusZone.label === DEFAULT_FOCUS_ZONE.label
    );
  }

  /** One place that decides which focus visuals show for the current state. */
  private syncFocusVisuals() {
    const running = this.ui.getIsTimerRunning();
    const presenting = this.isXRPresenting();
    this.focusVolume.setFocusTimerState(
      running && this.settings.showVirtualRoom,
      this.settings.shieldStyle,
      this.mode === 'focus-drag' &&
        (this.settings.showVirtualRoom || presenting),
    );
    const visibility = Math.max(
      0,
      Math.min(100, this.settings.focusAreaVisibility ?? 25),
    );
    this.focusVolume.setXRDim(
      presenting && running && !this.focusZoneNeedsDefining(),
      1 - visibility / 100,
      this.settings.shieldStyle,
    );
  }

  private setXRMode(mode: AppMode) {
    this.mode = mode;
    this.ui.setMode(mode);
    this.pinManager.updatePreview(false);
    this.syncFocusVisuals();
  }

  private flashXRStatus(text: string, seconds = 4) {
    this.xrStatus = text;
    this.xrStatusUntil = performance.now() + seconds * 1000;
  }

  private getXRStatusText(): string {
    if (this.xrStatus && performance.now() < this.xrStatusUntil) {
      return this.xrStatus;
    }
    if (this.mode === 'pin-add') return 'Pinch where the pin should go';
    if (this.mode === 'focus-drag') {
      return 'Pinch and drag across your focus area';
    }
    return 'Pinch a pin to open it, drag to move it';
  }

  private setRayFromController(controller: THREE.Object3D) {
    controller.getWorldPosition(_xrVec);
    controller.getWorldQuaternion(_xrQuat);
    _xrVec2.set(0, 0, -1).applyQuaternion(_xrQuat).normalize();
    this.raycaster.set(_xrVec, _xrVec2);
  }

  /** Tracked controllers / hands that currently have a pose. */
  private getActiveXRControllers(): THREE.Object3D[] {
    const controllers = (xb.core?.input?.controllers ?? []) as Array<
      THREE.Object3D & {inputSource?: Partial<XRInputSource>}
    >;
    return controllers.filter(
      (c) =>
        c.visible &&
        (c.inputSource?.targetRayMode === 'tracked-pointer' ||
          this.xrSeenControllers.has(c)),
    );
  }

  private handleXRPanelAction(hit: XRPanelHit) {
    if (!hit.action) return; // Pressed the panel body: swallow the pinch.
    lotusSound.playHoverTick();

    if (hit.panel === 'hud') {
      switch (hit.action) {
        case 'toggle-timer':
          if (this.ui.getIsTimerRunning()) {
            this.ui.stopFocusTimer();
          } else if (this.focusZoneNeedsDefining()) {
            this.xrStartTimerAfterZone = true;
            this.setXRMode('focus-drag');
            this.flashXRStatus('First pinch and drag across your focus area', 8);
          } else {
            this.ui.startFocusTimer();
          }
          break;
        case 'place-pin':
          this.xrStartTimerAfterZone = false;
          this.setXRMode(this.mode === 'pin-add' ? 'explore' : 'pin-add');
          break;
        case 'focus-zone':
          this.xrStartTimerAfterZone = false;
          this.setXRMode(this.mode === 'focus-drag' ? 'explore' : 'focus-drag');
          break;
        case 'exit-xr': {
          const renderer = xb.core?.renderer as THREE.WebGLRenderer | undefined;
          void renderer?.xr?.getSession()?.end();
          break;
        }
      }
      return;
    }

    switch (hit.action) {
      case 'close':
        this.closeXRCard();
        break;
      case 'delete': {
        const pinId = this.xrUI.getCardPinId();
        if (!pinId || !this.xrUI.confirmDelete()) break;
        this.closeXRCard();
        this.pins = this.pins.filter((p) => p.id !== pinId);
        savePinsToStorage(this.pins);
        this.pinManager.syncPins(this.pins, this.settings.defaultPinStyle);
        this.ui.setPins(this.pins);
        this.flashXRStatus('Pin deleted');
        break;
      }
      case 'dictate-title':
        this.startXRDictation('title');
        break;
      case 'dictate-note':
        this.startXRDictation('body');
        break;
    }
  }

  private openXRCard(pinId: string) {
    const pin = this.pins.find((p) => p.id === pinId);
    if (!pin) return;
    this.stopXRDictation?.();
    this.xrUI.openCard(pin);
    this.pinManager.triggerClickEffect(pinId);
    lotusSound.playPinOpen();
  }

  private closeXRCard() {
    this.stopXRDictation?.();
    this.stopXRDictation = undefined;
    this.xrUI.closeCard();
  }

  /** Voice is the text input inside the headset (no keyboard, no DOM fields). */
  private startXRDictation(field: 'title' | 'body') {
    const pinId = this.xrUI.getCardPinId();
    if (!pinId) return;
    this.stopXRDictation?.();
    const stop = dictateOnce(
      (text) => {
        const pin = this.pins.find((p) => p.id === pinId);
        if (!pin) return;
        pin[field] = text;
        savePinsToStorage(this.pins);
        this.pinManager.syncPins(this.pins, this.settings.defaultPinStyle);
        this.ui.setPins(this.pins);
        this.xrUI.refreshCard(pin);
      },
      (failed) => {
        this.stopXRDictation = undefined;
        if (this.xrUI.getCardPinId() !== pinId) return;
        this.xrUI.setCardStatus(
          failed ? 'Could not hear that. Check mic access and try again.' : '',
        );
      },
    );
    if (!stop) {
      this.xrUI.setCardStatus('Voice input is not available in this browser.');
      return;
    }
    this.stopXRDictation = stop;
    this.xrUI.setCardStatus(
      field === 'title' ? 'Listening for the title…' : 'Listening for the note…',
    );
  }

  /** Per-frame headset work: anchor, aiming rays, hover, panels and labels. */
  private updateXRInterface(
    camera: THREE.Camera,
    delta: number,
    elapsed: number,
    pinProjections: PinScreenProjection[],
  ) {
    camera.getWorldPosition(_xrCamPos);
    this.focusVolume.updateDim(_xrCamPos);

    let panelHover: XRPanelHit | null = null;
    let hoveredPinId: string | null = null;
    let previewPoint: Vector3Data | null = null;
    const controllers = this.getActiveXRControllers();
    const rays: XRPointerRay[] = [];

    controllers.forEach((controller, i) => {
      this.setRayFromController(controller);
      const ray = (this.xrRays[i] ??= {
        origin: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        distance: 1,
        showDot: false,
      });
      ray.origin.copy(this.raycaster.ray.origin);
      ray.quaternion.copy(_xrQuat);
      rays.push(ray);

      // While this hand carries a pin, the ray simply ends at the pin.
      if (this.xrDragPinId && controller === this.xrDragController) {
        ray.distance = this.pinManager.getPinWorldPosition(
          this.xrDragPinId,
          _xrVec2,
        )
          ? ray.origin.distanceTo(_xrVec2)
          : this.xrDragDistance;
        ray.showDot = true;
        return;
      }

      const panelHit = this.xrUI.hitTest(this.raycaster);
      const pinHit =
        this.mode === 'explore'
          ? this.raycaster.intersectObjects(
              this.pinManager.getHitMeshes(),
              false,
            )[0]
          : undefined;
      if (panelHit && (!pinHit || panelHit.distance <= pinHit.distance)) {
        ray.distance = panelHit.distance;
        ray.showDot = true;
        panelHover ??= panelHit;
        return;
      }
      if (pinHit) {
        ray.distance = pinHit.distance;
        ray.showDot = true;
        hoveredPinId ??= (pinHit.object.userData.pinId as string) || null;
        return;
      }
      const spatial = this.raycastSpatialPoint();
      ray.distance = spatial.distance;
      // In explore mode a cursor floating in mid-air is noise; show it only on
      // real surfaces, or whenever the pinch will place something.
      ray.showDot = spatial.isSurface || this.mode !== 'explore';
      if (this.mode === 'pin-add') previewPoint ??= spatial.point;
    });

    this.xrUI.setPanelHover(panelHover);
    this.pinManager.setHoveredPin(this.xrDragPinId ?? hoveredPinId);
    if (previewPoint) {
      this.pinManager.updatePreview(true, previewPoint, elapsed);
    } else {
      this.pinManager.updatePreview(false);
    }
    this.xrUI.updatePointers(rays);

    this.xrUI.updateHud(
      {
        clock: this.ui.getTimerClockText(),
        timerRunning: this.ui.getIsTimerRunning(),
        mode: this.mode,
        status: this.getXRStatusText(),
      },
      camera,
      delta,
    );

    const cardPinId = this.xrUI.getCardPinId();
    if (cardPinId) {
      if (this.pinManager.getPinWorldPosition(cardPinId, _xrVec2)) {
        this.xrUI.updateCard(camera, _xrVec2);
      } else {
        this.closeXRCard();
      }
    }
    this.xrUI.updateLabels(this.pins, pinProjections, (pinId, target) =>
      this.pinManager.getPinWorldPosition(pinId, target),
    );
  }

  /** Creates a pin at a ray hit (headset placement; text is added by voice). */
  private createPinAtHit(hit: SpatialHit): SpatialPin {
    const pin: SpatialPin = {
      id: `pin-${Date.now()}`,
      title: `Pin ${this.pins.length + 1}`,
      body: `Dropped on ${hit.surfaceLabel}.`,
      surfaceLabel: hit.surfaceLabel,
      color: this.settings.defaultPinColor || '#E84D2B',
      shapeStyle: this.settings.defaultPinStyle,
      position: hit.point,
      normal: hit.normal,
      createdAt: Date.now(),
    };
    this.pins.unshift(pin);
    savePinsToStorage(this.pins);
    this.pinManager.syncPins(this.pins, this.settings.defaultPinStyle);
    this.ui.setPins(this.pins);
    this.pinManager.triggerClickEffect(pin.id);
    lotusSound.playPinCreated();
    return pin;
  }

  private isXRPresenting(): boolean {
    const renderer = xb.core?.renderer as THREE.WebGLRenderer | undefined;
    return Boolean(renderer?.xr?.isPresenting);
  }

  private setupLightingAndTransparentCanvas() {
    const renderer = xb.core?.renderer as THREE.WebGLRenderer | undefined;
    const scene = xb.core?.scene;
    if (scene) {
      scene.background = null;
    }
    if (renderer) {
      // Scope the canvas CSS to our own canvas so emulator canvases (IWER) keep their layout
      renderer.domElement.classList.add('lotus-canvas');
      try {
        renderer.setClearColor(0x000000, 0);
        if (scene) {
          const pmrem = new THREE.PMREMGenerator(renderer);
          scene.environment = pmrem.fromScene(
            new RoomEnvironment(),
            0.04,
          ).texture;
          pmrem.dispose();
        }
      } catch {
        // Ignore if unsupported
      }
    }

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x334155, 2.4);
    hemiLight.position.set(0, 3.0, 0);
    this.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.2);
    keyLight.position.set(1.5, 3.5, 1.5);
    this.add(keyLight);
  }

  private bindPointerAndKeyboardEvents() {
    window.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    window.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    window.addEventListener('pointerup', (e) => this.handlePointerUp(e));
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (this.isTypingInInput(e.target)) return;
      this.keysPressed[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keysPressed[e.code] = false;
    });
  }

  private isTypingInInput(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || target.isContentEditable;
  }

  private isEventOnUI(e: PointerEvent): boolean {
    const target = e.target as HTMLElement | null;
    if (!target) return false;
    return Boolean(
      target.closest('.lotus-top-bar') ||
        target.closest('.lotus-focus-corner-bar') ||
        target.closest('.lotus-bottom-dock') ||
        target.closest('.lotus-modal-card') ||
        target.closest('.lotus-banner-pill') ||
        target.closest('.lotus-corner-stop-btn'),
    );
  }

  private getPinIdFromEventDOM(e: PointerEvent): string | null {
    const target = e.target as HTMLElement | null;
    if (!target) return null;
    const marker = target.closest('.lotus-pin-marker') as HTMLElement | null;
    return marker?.dataset.pinId || null;
  }

  private isEventOnPinDOM(e: PointerEvent): boolean {
    return Boolean(this.getPinIdFromEventDOM(e));
  }

  private updateRaycasterFromPointer(e: PointerEvent): THREE.Camera | null {
    const camera = xb.core?.camera;
    if (!camera) return null;
    _ndcPointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    _ndcPointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    this.raycaster.setFromCamera(_ndcPointer, camera);
    return camera;
  }

  /**
   * Raycasts against either WebXR depth mesh, virtual room furniture (if enabled),
   * or a real-world spatial anchor plane 1.4m in front of the camera in Live Camera mode.
   */
  private raycastSpatialPoint(): SpatialHit {
    const targets: THREE.Object3D[] = [];
    if (this.settings.showVirtualRoom) {
      targets.push(...this.roomBuilder.interactableMeshes);
    }
    const depthMesh = (
      xb.core as unknown as {depth?: {depthMesh?: THREE.Object3D}}
    )?.depth?.depthMesh;
    if (depthMesh) {
      targets.push(depthMesh);
    }

    if (targets.length > 0) {
      const hits = this.raycaster.intersectObjects(targets, true);
      if (hits.length > 0) {
        const hit = hits[0];
        let label = 'Room Point';
        let curr: THREE.Object3D | null = hit.object;
        while (curr) {
          if (curr.userData?.surfaceLabel) {
            label = curr.userData.surfaceLabel;
            break;
          }
          curr = curr.parent;
        }
        // Stored positions live in room space (see `worldRoot`).
        this.worldRoot.worldToLocal(_rayPoint.copy(hit.point));
        return {
          point: vec3(_rayPoint.x, _rayPoint.y, _rayPoint.z),
          normal: vec3(0, 1, 0),
          surfaceLabel: label,
          isSurface: true,
          distance: hit.distance,
        };
      }
    }

    // In Real-World Camera mode, anchor point at 1.4m along the camera ray
    this.raycaster.ray.at(1.4, _rayPoint);
    this.worldRoot.worldToLocal(_rayPoint);
    return {
      point: vec3(_rayPoint.x, _rayPoint.y, _rayPoint.z),
      normal: vec3(0, 1, 0),
      surfaceLabel: 'Room Object',
      isSurface: false,
      distance: 1.4,
    };
  }

  private handlePointerMove(e: PointerEvent) {
    if (this.ui.isAnyModalOpen()) {
      this.pinManager.updatePreview(false);
      return;
    }

    if (!this.updateRaycasterFromPointer(e)) return;

    // 0. If user is pinching/dragging a Pin to move & replace it
    if (this.activeDragPinId) {
      const dist = Math.hypot(
        e.clientX - this.pinDragStartScreen.x,
        e.clientY - this.pinDragStartScreen.y,
      );
      if (dist >= 6 || this.hasMovedDuringPinDrag) {
        if (!this.hasMovedDuringPinDrag) {
          this.hasMovedDuringPinDrag = true;
          lotusSound.playHoverTick();
          this.pinManager.setDraggingPin(this.activeDragPinId);
        }
        document.body.style.cursor = 'grabbing';
        const hit = this.raycastSpatialPoint();
        if (hit) {
          this.pinManager.updatePinPositionLive(
            this.activeDragPinId,
            hit.point,
            hit.surfaceLabel,
          );
          this.pinManager.updatePreview(
            true,
            hit.point,
            xb.getElapsedTime(),
          );
          this.ui.setDraggingPinState(this.activeDragPinId, e.clientX, e.clientY);
        }
      }
      return;
    }

    // 1. If actively dragging Focus Area
    if (this.isDraggingFocus) {
      const dragDist = Math.hypot(
        e.clientX - this.dragStartScreen.x,
        e.clientY - this.dragStartScreen.y,
      );
      if (dragDist >= 8) {
        this.ui.updateDragBox2D(
          true,
          this.dragStartScreen.x,
          this.dragStartScreen.y,
          e.clientX,
          e.clientY,
        );
        if (this.dragStart3D) {
          const hit = this.raycastSpatialPoint();
          if (hit) {
            this.focusZone = this.focusVolume.setBoundsFromDrag(
              this.dragStart3D,
              hit.point,
              'Focus Area',
            );
          }
        }
      }
      return;
    }

    if (this.isEventOnUI(e)) {
      this.pinManager.updatePreview(false);
      this.pinManager.setHoveredPin(null);
      this.ui.updatePinPlacementReticle(false);
      return;
    }

    // If pointer is on the 2D hit target of a pin, LotusUI's pointerenter already manages hover
    if (this.isEventOnPinDOM(e) && this.mode === 'explore') {
      this.pinManager.updatePreview(false);
      this.ui.updatePinPlacementReticle(false);
      return;
    }

    // 2. Check 3D raycast pin hover
    const pinHits = this.raycaster.intersectObjects(
      this.pinManager.getHitMeshes(),
      false,
    );
    if (pinHits.length > 0 && this.mode === 'explore') {
      const hoveredId = pinHits[0].object.userData.pinId || null;
      this.pinManager.setHoveredPin(hoveredId);
      document.body.style.cursor = 'grab';
    } else {
      this.pinManager.setHoveredPin(null);
      document.body.style.cursor =
        this.mode === 'pin-add' || this.mode === 'focus-drag'
          ? 'crosshair'
          : 'default';
    }

    // 3. Preview marker in Pin Add mode
    if (this.mode === 'pin-add') {
      this.ui.updatePinPlacementReticle(true, e.clientX, e.clientY);
      const hit = this.raycastSpatialPoint();
      if (hit) {
        this.pinManager.updatePreview(
          true,
          hit.point,
          xb.getElapsedTime(),
        );
      }
    } else {
      this.ui.updatePinPlacementReticle(false);
      this.pinManager.updatePreview(false);
    }
  }

  private handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (this.ui.isAnyModalOpen() || this.isEventOnUI(e)) return;
    if (!this.updateRaycasterFromPointer(e)) return;

    this.isGlidingCamera = false;

    // 1. If in Focus Area Drag mode
    if (this.mode === 'focus-drag') {
      this.isDraggingFocus = true;
      this.dragStartScreen = {x: e.clientX, y: e.clientY};
      const hit = this.raycastSpatialPoint();
      this.dragStart3D = hit ? hit.point : null;
      return;
    }

    // 2. If in Pin Add mode, place a new memory point (or finish moving an existing pin) where tapped
    if (this.mode === 'pin-add') {
      const hit = this.raycastSpatialPoint();
      if (hit) {
        this.pinManager.updatePreview(false);
        this.ui.openComposerForNewPin(
          hit.point,
          hit.normal,
          hit.surfaceLabel,
        );
      }
      return;
    }

    // 3. Check if user pressed/pinched on a 2D pin marker (card or hit target) to drag or inspect
    const domPinId = this.getPinIdFromEventDOM(e);
    if (domPinId) {
      this.activeDragPinId = domPinId;
      this.hasMovedDuringPinDrag = false;
      this.pinDragFromDOM = true;
      this.pinDragStartScreen = {x: e.clientX, y: e.clientY};
      return;
    }

    // 4. Check if user pressed/pinched an existing 3D Lotus Pin via 3D raycast to drag or inspect
    const pinHits = this.raycaster.intersectObjects(
      this.pinManager.getHitMeshes(),
      false,
    );
    if (pinHits.length > 0) {
      const pinId = pinHits[0].object.userData.pinId;
      if (pinId) {
        this.activeDragPinId = pinId;
        this.hasMovedDuringPinDrag = false;
        this.pinDragFromDOM = false;
        this.pinDragStartScreen = {x: e.clientX, y: e.clientY};
        return;
      }
    }
  }

  // Support WebXR controller / hand pinch selection and pinch-drag directly on 3D points
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onSelectStart(event: any) {
    // On 2D screens the DOM pointer handlers above own all interaction.
    if (!this.isXRPresenting()) return;
    const controller = event?.source?.controller as THREE.Object3D | undefined;
    if (!controller) return;
    this.xrSeenControllers.add(controller);
    // One gesture at a time: ignore the other hand while a drag is running.
    if (this.xrDragPinId || this.xrFocusController) return;
    this.setRayFromController(controller);

    // 1. In-headset panels (control panel, pin card) come first.
    const panelHit = this.xrUI.hitTest(this.raycaster);
    const pinHit =
      this.mode === 'explore'
        ? this.raycaster.intersectObjects(
            this.pinManager.getHitMeshes(),
            false,
          )[0]
        : undefined;
    if (panelHit && (!pinHit || panelHit.distance <= pinHit.distance)) {
      this.handleXRPanelAction(panelHit);
      return;
    }

    // 2. A pin: start a press that becomes a drag if the hand moves, or opens
    //    the pin's card if it does not.
    const pinId = pinHit?.object.userData.pinId as string | undefined;
    if (pinId) {
      this.xrDragPinId = pinId;
      this.xrDragController = controller;
      this.xrPinMoved = false;
      this.xrDragStartPos.copy(this.raycaster.ray.origin);
      this.xrDragStartDir.copy(this.raycaster.ray.direction);
      this.xrDragDistance = this.pinManager.getPinWorldPosition(pinId, _xrVec2)
        ? this.raycaster.ray.origin.distanceTo(_xrVec2)
        : pinHit!.distance;
      this.pinManager.setDraggingPin(pinId);
      return;
    }

    // 3. Empty space: only an explicit mode places anything, so a stray pinch
    //    never litters the room with pins.
    if (this.mode === 'pin-add') {
      const pin = this.createPinAtHit(this.raycastSpatialPoint());
      this.setXRMode('explore');
      this.openXRCard(pin.id);
      this.flashXRStatus(
        this.xrUI.speechSupported
          ? 'Pin placed. Use "Say title" to name it'
          : 'Pin placed',
      );
      return;
    }
    if (this.mode === 'focus-drag') {
      this.xrFocusController = controller;
      this.xrFocusDragged = false;
      this.dragStart3D = this.raycastSpatialPoint().point;
      return;
    }
    if (this.xrUI.getCardPinId()) this.closeXRCard();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onSelecting(event: any) {
    if (!this.isXRPresenting()) return;
    const controller = event?.source?.controller as THREE.Object3D | undefined;
    if (!controller) return;

    // Dragging a pin with the hand that grabbed it.
    if (this.xrDragPinId && controller === this.xrDragController) {
      this.setRayFromController(controller);
      const ray = this.raycaster.ray;
      // A drag starts when the ray itself moves: either the hand travels or
      // the wrist turns. Position alone missed aiming from across the room.
      if (
        !this.xrPinMoved &&
        (ray.origin.distanceTo(this.xrDragStartPos) > 0.025 ||
          ray.direction.angleTo(this.xrDragStartDir) > 0.052)
      ) {
        this.xrPinMoved = true;
        lotusSound.playHoverTick();
      }
      if (!this.xrPinMoved) return;

      // Snap to a real surface when the ray finds one, otherwise carry the
      // pin at the distance it was grabbed from.
      const hit = this.raycastSpatialPoint();
      let point = hit.point;
      if (!hit.isSurface) {
        ray.at(this.xrDragDistance, _xrVec2);
        this.worldRoot.worldToLocal(_xrVec2);
        point = vec3(_xrVec2.x, _xrVec2.y, _xrVec2.z);
      }
      this.pinManager.updatePinPositionLive(
        this.xrDragPinId,
        point,
        hit.isSurface ? hit.surfaceLabel : undefined,
      );
      return;
    }

    // Dragging out the focus area.
    if (this.xrFocusController === controller && this.dragStart3D) {
      this.setRayFromController(controller);
      const hit = this.raycastSpatialPoint();
      this.xrFocusDragged = true;
      this.focusZone = this.focusVolume.setBoundsFromDrag(
        this.dragStart3D,
        hit.point,
        'Focus Area',
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onSelectEnd(event?: any) {
    if (!this.isXRPresenting()) return;
    const controller = event?.source?.controller as THREE.Object3D | undefined;

    if (this.xrDragPinId && (!controller || controller === this.xrDragController)) {
      const pinId = this.xrDragPinId;
      const moved = this.xrPinMoved;
      this.xrDragPinId = null;
      this.xrDragController = null;
      this.xrPinMoved = false;
      this.pinManager.setDraggingPin(null);

      if (moved) {
        savePinsToStorage(this.pins);
        this.ui.setPins(this.pins);
        this.pinManager.triggerClickEffect(pinId);
        lotusSound.playPinCreated();
      } else {
        this.openXRCard(pinId);
      }
      return;
    }

    if (
      this.xrFocusController &&
      (!controller || controller === this.xrFocusController)
    ) {
      const dragged = this.xrFocusDragged;
      this.xrFocusController = null;
      this.xrFocusDragged = false;
      this.dragStart3D = null;
      if (!dragged) return; // A tap without a drag: stay in focus-area mode.

      // The zone is now defined in 3D; a stale 2D screen rectangle would
      // override it on screens.
      this.focusZone = {...this.focusZone, customScreenRect: null};
      saveFocusZoneToStorage(this.focusZone);
      this.ui.setFocusZone(this.focusZone);
      lotusSound.playPinCreated();
      const startTimer = this.xrStartTimerAfterZone;
      this.xrStartTimerAfterZone = false;
      this.setXRMode('explore');
      if (startTimer && !this.ui.getIsTimerRunning()) {
        this.ui.startFocusTimer();
        this.flashXRStatus('Focus area set. Timer started');
      } else {
        this.flashXRStatus('Focus area set');
      }
    }
  }

  private handlePointerUp(e: PointerEvent) {
    if (this.activeDragPinId) {
      const draggedId = this.activeDragPinId;
      const wasDragged = this.hasMovedDuringPinDrag;
      const fromDOM = this.pinDragFromDOM;

      this.activeDragPinId = null;
      this.hasMovedDuringPinDrag = false;
      this.pinDragFromDOM = false;
      this.pinManager.setDraggingPin(null);
      this.pinManager.updatePreview(false);
      this.ui.setDraggingPinState(null);
      document.body.style.cursor = 'default';

      if (wasDragged) {
        this.ui.markPinJustDragged(draggedId);
        savePinsToStorage(this.pins);
        this.pinManager.syncPins(this.pins, this.settings.defaultPinStyle);
        this.ui.setPins(this.pins);
        this.ui.refreshPinMarkerContent();
        this.pinManager.triggerClickEffect(draggedId);
        lotusSound.playPinCreated();
      } else if (!fromDOM) {
        this.ui.inspectPin(draggedId);
      }
      return;
    }

    if (this.isDraggingFocus) {
      this.isDraggingFocus = false;
      this.ui.updateDragBox2D(false);

      const dragDist = Math.hypot(
        e.clientX - this.dragStartScreen.x,
        e.clientY - this.dragStartScreen.y,
      );

      if (dragDist >= 12) {
        const left = Math.min(this.dragStartScreen.x, e.clientX);
        const top = Math.min(this.dragStartScreen.y, e.clientY);
        const width = Math.max(80, Math.abs(e.clientX - this.dragStartScreen.x));
        const height = Math.max(80, Math.abs(e.clientY - this.dragStartScreen.y));

        this.ui.completeFocusAreaDrag(
          {
            visible: true,
            x: left,
            y: top,
            width,
            height,
          },
          this.focusZone,
        );
      }

      this.dragStart3D = null;
    }
  }

  update(_time?: number, frame?: XRFrame) {
    const delta = Math.min(xb.getDeltaTime(), 0.1);
    const elapsed = xb.getElapsedTime();
    const camera = xb.core?.camera;
    if (!camera) return;

    // Keep WebGL background transparent so real-world camera feed is visible
    const renderer = xb.core?.renderer as THREE.WebGLRenderer | undefined;
    if (renderer && !this.settings.showVirtualRoom) {
      renderer.setClearColor(0x000000, 0);
    }

    // Put the room content back on the real room before anything reads pin
    // positions this frame.
    const presenting = this.isXRPresenting();
    if (presenting && frame) {
      const referenceSpace = renderer?.xr?.getReferenceSpace();
      if (referenceSpace) {
        this.roomAnchor.update(frame, referenceSpace, this.worldRoot);
      }
    }

    if (this.isGlidingCamera) {
      camera.position.x = THREE.MathUtils.damp(
        camera.position.x,
        _desiredCamPos.x,
        5.5,
        delta,
      );
      camera.position.y = THREE.MathUtils.damp(
        camera.position.y,
        _desiredCamPos.y,
        5.5,
        delta,
      );
      camera.position.z = THREE.MathUtils.damp(
        camera.position.z,
        _desiredCamPos.z,
        5.5,
        delta,
      );

      _lookAtTarget.lerp(_desiredLookAt, Math.min(1, delta * 6));
      camera.lookAt(_lookAtTarget);

      if (camera.position.distanceToSquared(_desiredCamPos) < 0.002) {
        this.isGlidingCamera = false;
      }
    }

    // Arrow-key stepping to test 2m proximity
    const moveSpeed = 1.6 * delta;
    if (
      this.keysPressed['ArrowUp'] ||
      this.keysPressed['ArrowDown'] ||
      this.keysPressed['ArrowLeft'] ||
      this.keysPressed['ArrowRight']
    ) {
      this.isGlidingCamera = false;
      camera.getWorldDirection(_camForward);
      _camForward.y = 0;
      if (_camForward.lengthSq() > 0.0001) _camForward.normalize();
      _camRight.crossVectors(_camForward, THREE.Object3D.DEFAULT_UP).normalize();

      if (this.keysPressed['ArrowUp']) {
        camera.position.addScaledVector(_camForward, moveSpeed);
      }
      if (this.keysPressed['ArrowDown']) {
        camera.position.addScaledVector(_camForward, -moveSpeed);
      }
      if (this.keysPressed['ArrowRight']) {
        camera.position.addScaledVector(_camRight, moveSpeed);
      }
      if (this.keysPressed['ArrowLeft']) {
        camera.position.addScaledVector(_camRight, -moveSpeed);
      }
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pinProjections = this.pinManager.updateAndProject(
      camera,
      delta,
      elapsed,
      this.settings.proximityDistanceMeters,
      this.settings.proximityMode,
      this.settings.headerPopEnabled,
      this.settings.defaultPinStyle,
      vw,
      vh,
    );

    if (presenting) {
      this.updateXRInterface(camera, delta, elapsed, pinProjections);
      // A standalone headset never shows the DOM, so skip rewriting the 2D
      // pin markers and focus shield every frame. Desktop XR emulators do
      // show it, so they keep the 2D layer alive.
      if (IS_STANDALONE_HEADSET) return;
    }

    const focusRect = this.focusVolume.projectFocusWindow(camera, vw, vh);
    this.ui.updateFrameProjections(pinProjections, focusRect, {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    });
  }

  dispose() {
    this.unbindXRSession?.();
    this.cameraGate?.dispose();
    this.cameraPassthrough?.stopCamera();
    this.roomBuilder?.dispose();
    this.pinManager?.dispose();
    this.focusVolume?.dispose();
    this.stopXRDictation?.();
    this.roomAnchor.end();
    this.xrUI?.dispose();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const options = new xb.Options();
  options.setAppTitle('LOTUS');
  options.setAppDescription(
    'Real-world camera AR memory pins and distraction-free study focus zone.',
  );
  // The xrblocks simulator auto-starts on non-XR browsers and paints its own
  // virtual room over the page, hiding the real camera feed. Real devices
  // (Quest, Android XR) use immersive-ar passthrough; everything else uses the
  // getUserMedia video behind the transparent canvas.
  // options.enableSimulator = auto;
  // options.xrButton.alwaysAutostartSimulator = false;
  // options.xrButton.showEnterSimulatorButton = false;
  // No options.enableCamera(): LOTUS opens the webcam itself (CameraPassthrough),
  // and xrblocks' own camera only adds a second permission request plus a
  // "Raw Camera Access not available" warning on devices/emulators without it.
  options.enableDepth();
  try {
    // By default the depth mesh is rebuilt every frame, which on a headset
    // means a GPU-to-CPU depth readback per frame. Pin placement only needs
    // the room surface a few times a second.
    options.depth.depthMesh.depthMeshUpdateFps = 8;
  } catch {
    // Options object is read-only in this xrblocks build: keep its default.
  }
  // Persistent anchor that keeps saved pins on the real room (see RoomAnchor).
  if (!options.webxrOptionalFeatures.includes('anchors')) {
    options.webxrOptionalFeatures.push('anchors');
  }
  // LOTUS draws its own aiming rays and cursor in the headset (XRInterface),
  // so the xrblocks reticle stays off and the desktop view stays clean.
  options.reticles.enabled = false;

  xb.add(new LotusSpatialApp());
  xb.init(options);
});
