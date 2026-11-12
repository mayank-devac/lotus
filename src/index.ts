import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as xb from 'xrblocks';

import {CameraGate} from './CameraGate';
import {CameraPassthrough} from './CameraPassthrough';
import {FocusTimer, clockSettingsChanged} from './FocusTimer';
import {
  FocusVolume3D,
  FOCUS_RAY_FALLBACK_METERS,
  focusZoneFromDrag,
} from './FocusVolume3D';
import {LotusUI} from './ui/LotusUI';
import {ImmersiveSession} from './xr/ImmersiveSession';
import type {PinContent} from './xr/ImmersiveHost';
import {PinManager3D} from './PinManager3D';
import {StudyRoomBuilder} from './StudyRoomBuilder';
import {lotusSound} from './sound';
import {
  DEFAULT_FOCUS_ZONE,
  getShieldStrength,
  isPristineSamplePin,
  isRoomFocusZone,
  loadFocusZone,
  loadLotusSettings,
  loadSavedPins,
  loadSavedTasks,
  onStorageFailure,
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
  PinShapeStyle,
  RoomWaypoint,
  SpatialHit,
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

/**
 * Main XR Blocks script for LOTUS:
 * Real-World Camera AR Memory Pins & Study Focus Zone with Timer-Driven Peripheral Blur.
 */
class LotusSpatialApp extends xb.Script {
  private cameraPassthrough!: CameraPassthrough;
  private roomBuilder!: StudyRoomBuilder;
  private pinManager!: PinManager3D;
  private focusVolume!: FocusVolume3D;
  /** The one focus session clock; both interfaces start, stop and follow it. */
  private timer!: FocusTimer;
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

  // `worldRoot` holds everything stored in room space (pins, focus zone); in a
  // headset the room anchor moves it so content stays on the real room.
  private worldRoot = new THREE.Group();
  private immersive!: ImmersiveSession;

  // Camera glide animation state
  private isGlidingCamera = false;
  private keysPressed: Record<string, boolean> = {};

  init() {
    this.pins = loadSavedPins();
    this.tasks = loadSavedTasks();
    this.focusZone = loadFocusZone();
    this.settings = loadLotusSettings();
    lotusSound.enabled = this.settings.soundEnabled;
    this.timer = new FocusTimer(() => this.settings);
    // Whichever interface started or stopped it, the sound and the 3D scene
    // follow the timer from here.
    this.timer.subscribe((event) => {
      if (event.type === 'tick') return;
      if (event.type === 'start') lotusSound.playFocusStart();
      else if (event.completed) lotusSound.playTimerComplete();
      else lotusSound.playFocusStop();
      this.syncFocusVisuals();
    });

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

    // 5. Set initial camera pose
    const camera = xb.core?.camera;
    if (camera) {
      camera.position.set(0, 1.45, -0.25);
      camera.lookAt(0, 1.15, -1.5);
      _desiredCamPos.copy(camera.position);
    }

    // 6. Initialize Simple, Clutter-Free UI
    // The UI edits its own copy of the settings and reports each change back
    // (`onSettingsChange`), so this class can tell what changed.
    this.ui = new LotusUI(this.pins, this.tasks, this.focusZone, {...this.settings}, this.timer, {
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
        this.commitPins(this.pins);
      },
      onDeletePin: (pinId) => {
        this.commitPins(this.pins.filter((p) => p.id !== pinId));
      },
      onClearAllPins: () => {
        this.commitPins([]);
      },
      onApplyStyleToAllPins: (style) => {
        this.commitPins(
          this.pins.map((p) => ({...p, shapeStyle: style})),
          style,
        );
      },
      onSaveTasks: (updatedTasks) => this.commitTasks(updatedTasks),
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
        const before = this.settings;
        this.settings = {...updatedSettings};
        // A new length or mode applies from the next session; a running
        // clock would jump.
        if (!this.timer.running && clockSettingsChanged(before, this.settings)) {
          this.timer.resetClock();
        }
        saveLotusSettings(this.settings);
        lotusSound.enabled = this.settings.soundEnabled;
        this.roomBuilder.setVisible(this.settings.showVirtualRoom);
        this.pinManager.syncPins(this.pins, this.settings.defaultPinStyle);
        this.syncFocusVisuals();
      },
      onFocusZoneChange: (updatedZone) => {
        this.focusZone = {...updatedZone};
        saveFocusZoneToStorage(this.focusZone);
        this.syncFocusVisuals();
      },
      onFlipCamera: () => {
        void this.cameraPassthrough.flipCamera();
      },
    });

    // 7. In-headset interface and gestures (the DOM UI is not visible there)
    this.immersive = new ImmersiveSession({
      pinManager: this.pinManager,
      focusVolume: this.focusVolume,
      worldRoot: this.worldRoot,
      timer: this.timer,
      ui: this.ui,
      getMode: () => this.mode,
      setMode: (mode) => this.setMode(mode),
      getPins: () => this.pins,
      commitPins: (pins) => this.commitPins(pins),
      // The UI's list is the live one: it counts task timers down in place.
      getTasks: () => this.ui.getTasks(),
      commitTasks: (tasks) => this.commitTasks(tasks),
      createPinAt: (hit, content) => this.createPinAt(hit, content),
      raycastSpatialPoint: (raycaster, fallbackDistance) =>
        this.raycastSpatialPoint(raycaster, fallbackDistance),
      getFocusZone: () => this.focusZone,
      focusZoneNeedsDefining: () => !isRoomFocusZone(this.focusZone),
      previewFocusZone: (zone) => {
        this.focusZone = zone;
        this.syncFocusVisuals();
      },
      commitFocusZone: () => {
        // The zone is now defined in 3D; a stale 2D screen rectangle would
        // override it on screens.
        this.focusZone = {...this.focusZone, customScreenRect: null};
        saveFocusZoneToStorage(this.focusZone);
        this.ui.setFocusZone(this.focusZone);
      },
    });
    this.add(this.immersive.root);

    // A save that fails (storage full, or blocked) must not pass silently:
    // say so on whichever interface the user is looking at.
    onStorageFailure(() => {
      const text = 'Could not save. Storage is full or blocked, so changes may be lost.';
      this.ui.showNotice(text);
      this.immersive.notify(text);
    });

    this.bindPointerAndKeyboardEvents();
  }

  /** Replaces the pin list everywhere: storage, 3D pins and the DOM UI. */
  private commitPins(
    pins: SpatialPin[],
    defaultPinStyle: PinShapeStyle = this.settings.defaultPinStyle,
  ) {
    this.pins = pins;
    savePinsToStorage(pins);
    this.pinManager.syncPins(pins, defaultPinStyle);
    this.ui.setPins(pins);
  }

  /** Replaces the task list everywhere: storage and the DOM UI. */
  private commitTasks(tasks: LotusTask[]) {
    this.tasks = [...tasks];
    saveTasksToStorage(this.tasks);
    this.ui.setTasks(this.tasks);
  }

  private setMode(mode: AppMode) {
    this.mode = mode;
    this.ui.setMode(mode);
    this.pinManager.updatePreview(false);
    this.syncFocusVisuals();
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
   * the onboarding card. When the session ends, fall back to the web camera
   * if it was enabled; the card stays dismissed and only the chip shows.
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
      // The in-headset panels are the whole UI during a session. A headset
      // never shows the page; desktop emulators do, so hide the 2D layer
      // there too rather than show duplicate controls over the scene.
      document.body.classList.add('lotus-xr-active');
      this.cameraGate?.onSessionStart();
      this.cameraPassthrough.stopCamera();
      this.cameraPassthrough.setVisible(false);
      // A DOM modal cannot be seen or dismissed inside the headset.
      this.ui.closeAllModals();
      this.removePristineSamplePin();
      this.immersive.begin(xrManager.getSession());
      this.syncFocusVisuals();
    };
    const onSessionEnd = () => {
      renderer.domElement.classList.add('lotus-canvas');
      document.body.classList.remove('lotus-xr-active');
      this.immersive.end();
      this.syncFocusVisuals();
      // The 2D layer is coming back. Whatever a phantom input opened while
      // the DOM was hidden (session events can leak in emulators) must not
      // greet the user; the same reset runs on session start.
      this.ui.closeAllModals();
      // Leaving XR is deliberate: don't re-show the onboarding card, just the
      // "Enter XR" chip so the user can go back in.
      this.cameraGate?.onSessionEnd(false);
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

  /**
   * The seeded sample pin sits at made-up "desk" coordinates. In a real room
   * that is an arbitrary spot in mid-air, so drop it if it was never touched.
   */
  private removePristineSamplePin() {
    const kept = this.pins.filter((p) => !isPristineSamplePin(p));
    if (kept.length !== this.pins.length) this.commitPins(kept);
  }

  /**
   * Hands the 3D focus visuals everything they depend on. Call it whenever
   * any of these changes; FocusVolume3D decides what that shows.
   */
  private syncFocusVisuals() {
    this.focusVolume.setState({
      bounds: this.focusZone,
      presenting: this.isXRPresenting(),
      editing: this.mode === 'focus-drag',
      // A timer-only session leaves the room undimmed.
      timerWithArea: this.timer.dimsArea,
      virtualRoom: this.settings.showVirtualRoom,
      style: this.settings.shieldStyle,
      strength: getShieldStrength(this.settings),
    });
  }

  /**
   * Creates a pin at a ray hit (headset placement). `content` supplies its
   * text, e.g. from a task; otherwise it gets a default name to edit.
   */
  private createPinAt(
    hit: SpatialHit,
    content?: PinContent,
  ): SpatialPin {
    const pin: SpatialPin = {
      id: `pin-${Date.now()}`,
      title: `Pin ${this.pins.length + 1}`,
      body: '',
      surfaceLabel: hit.surfaceLabel,
      ...content,
      color: this.settings.defaultPinColor || '#E84D2B',
      shapeStyle: this.settings.defaultPinStyle,
      position: hit.point,
      normal: hit.normal,
      createdAt: Date.now(),
    };
    this.commitPins([pin, ...this.pins]);
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
   * or, on a miss, a point `fallbackDistance` along the ray (1.4m in front of
   * the camera in Live Camera mode).
   */
  private raycastSpatialPoint(
    raycaster: THREE.Raycaster = this.raycaster,
    fallbackDistance = 1.4,
  ): SpatialHit {
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
      const hits = raycaster.intersectObjects(targets, true);
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

    // Nothing hit: anchor the point a fixed distance along the ray.
    raycaster.ray.at(fallbackDistance, _rayPoint);
    this.worldRoot.worldToLocal(_rayPoint);
    return {
      point: vec3(_rayPoint.x, _rayPoint.y, _rayPoint.z),
      normal: vec3(0, 1, 0),
      surfaceLabel: 'Room Object',
      isSurface: false,
      distance: fallbackDistance,
    };
  }

  private handlePointerMove(e: PointerEvent) {
    // An immersive session owns all input. Emulators (IWE) keep firing page
    // pointer events while XR runs, and those must not drive the hidden 2D UI
    // (e.g. raycast hovers or a phantom pin drag behind the session).
    if (this.isXRPresenting()) return;
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
      if (dragDist >= 8 && this.dragStart3D) {
        this.ui.updateDragBox2D(
          true,
          this.dragStartScreen.x,
          this.dragStartScreen.y,
          e.clientX,
          e.clientY,
        );
        // Dragged on a 2D screen: the box only means something to that screen.
        this.focusZone = focusZoneFromDrag(
          this.dragStart3D,
          this.raycastSpatialPoint(this.raycaster, FOCUS_RAY_FALLBACK_METERS).point,
          true,
          'screen',
        );
        this.syncFocusVisuals();
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
    // See handlePointerMove: DOM input is inert during a session. A stray
    // click in pin-add mode would otherwise open the composer invisibly, and
    // it would greet the user when the 2D layer returns after the session.
    if (this.isXRPresenting()) return;
    if (e.button !== 0) return;
    if (this.ui.isAnyModalOpen() || this.isEventOnUI(e)) return;
    if (!this.updateRaycasterFromPointer(e)) return;

    this.isGlidingCamera = false;

    // 1. If in Focus Area Drag mode
    if (this.mode === 'focus-drag') {
      this.isDraggingFocus = true;
      this.dragStartScreen = {x: e.clientX, y: e.clientY};
      this.dragStart3D = this.raycastSpatialPoint(
        this.raycaster,
        FOCUS_RAY_FALLBACK_METERS,
      ).point;
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

  // WebXR controller / hand pinches. They only act inside an immersive session;
  // on 2D screens the DOM pointer handlers above own all interaction.
  override onSelectStart(event: xb.SelectEvent) {
    this.immersive.selectStart(event.source.controller);
  }

  override onSelecting(event: xb.SelectEvent) {
    this.immersive.selecting(event.source.controller);
  }

  override onSelectEnd(event: xb.SelectEndEvent) {
    this.immersive.selectEnd(event.source.controller);
  }

  private handlePointerUp(e: PointerEvent) {
    // See handlePointerMove: DOM input is inert during a session.
    if (this.isXRPresenting()) return;
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
        // The drag moved the pin object in place; persist the list as it is.
        this.commitPins(this.pins);
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
    const referenceSpace = renderer?.xr?.getReferenceSpace();
    if (frame && referenceSpace) {
      this.immersive.updateFrame(frame, referenceSpace);
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

    this.immersive.update(camera, delta, elapsed, pinProjections);

    // During a session the in-headset panels are the whole UI and the 2D
    // layer is hidden (see `lotus-xr-active`), so skip rewriting it per frame.
    if (!this.isXRPresenting()) {
      const focusRect = this.focusVolume.projectFocusWindow(camera, vw, vh);
      this.ui.updateFrameProjections(pinProjections, focusRect, {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      });
    }
  }

  dispose() {
    this.timer?.dispose();
    this.unbindXRSession?.();
    this.cameraGate?.dispose();
    this.cameraPassthrough?.stopCamera();
    this.roomBuilder?.dispose();
    this.pinManager?.dispose();
    this.focusVolume?.dispose();
    this.immersive?.dispose();
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
  // Desks and walls from the headset's room setup tell a desk focus area
  // from a wall one (see RoomPlanes). Optional: without it, or without a
  // room setup, the angle of the ray decides.
  for (const feature of ['anchors', 'plane-detection']) {
    if (!options.webxrOptionalFeatures.includes(feature)) {
      options.webxrOptionalFeatures.push(feature);
    }
  }
  // LOTUS draws its own aiming rays and cursor in the headset (XRInterface),
  // so the xrblocks reticle stays off and the desktop view stays clean.
  options.reticles.enabled = false;

  xb.add(new LotusSpatialApp());
  xb.init(options);
});
