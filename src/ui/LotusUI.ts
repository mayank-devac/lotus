import MONO_LOTUS_SVG from '../../assets/icon.svg?raw';
import {lotusSound} from '../sound';
import {getShieldStrength} from '../storage';
import {advanceTaskTimers, taskClockText} from '../tasks';
import {
  AppMode,
  FocusZoneBounds,
  LotusSettings,
  LotusTask,
  PinScreenProjection,
  ProjectedRect,
  SpatialPin,
  Vector3Data,
} from '../types';
import {BottomDock} from './BottomDock';
import {captureModalBodyScroll, escapeHtml, restoreModalBodyScroll} from './dom';
import {FocusShield} from './FocusShield';
import type {FocusTimer, FocusTimerEvent} from '../FocusTimer';
import {buildLayout} from './layout';
import {PinComposerModal} from './PinComposerModal';
import {PinDirectoryModal} from './PinDirectoryModal';
import {PinInspectorModal} from './PinInspectorModal';
import {PinMarkers} from './PinMarkers';
import {SetupModal} from './SetupModal';
import {TasksModal} from './TasksModal';
import {TasksNavWidget} from './TasksNavWidget';
import {
  LotusUICallbacks,
  ModalId,
  NavModalId,
  PendingPinContent,
  SharedDictation,
  UIHost,
} from './UIHost';

export type {LotusUICallbacks} from './UIHost';
/**
 * Minimal, clutter-free real-world AR interface for LOTUS:
 * - Transparent top bar (Monochromatic Lotus brand, Tasks, Pins, Setup)
 * - Compact translucent bottom action dock (+ Add Pin, Tasks, Focus Area, Start/Stop Focus)
 * - Tasks & Reminders manager with tick buttons separating Ongoing and Completed tasks
 * - Focus Area mode: shows previously selected area, visibility slider, Okay and Again buttons, hides main UI except Lotus & icon
 * - Active Focus Timer mode: hides main UI and shows a compact underlined Stop Focus text button with shadow in corner
 * - Pin Directory sorting by Proximity to user or Creation Date
 *
 * This class owns the UI state (mode, which modal is open, pin placement,
 * the focus area on screen) and the top bar, mode banner and focus corner
 * bar. Each modal, the dock, the pin markers, the focus shield and the focus
 * timer live in `src/ui/`; they reach this state through the `UIHost`
 * built in `createHost`.
 */
export class LotusUI {
  private container: HTMLElement;
  private callbacks: LotusUICallbacks;
  private settings: LotusSettings;
  private pins: SpatialPin[] = [];
  private tasks: LotusTask[] = [];
  private focusZone: FocusZoneBounds;
  private currentMode: AppMode = 'explore';

  // Optional user-dragged 2D screen focus box (overrides 3D projection when dragged on camera)
  private customScreenFocusRect: ProjectedRect | null = null;
  private lastProjectedFocusRect: ProjectedRect | null = null;
  private isRedraggingFocusArea = false;

  // Which modal is open. More than one flag can be set; `renderModals` shows
  // the first in its order.
  private isWelcomeOpen = false;
  private isPinDirectoryOpen = false;
  private isTasksOpen = false;
  private isComposerOpen = false;
  private inspectedPinId: string | null = null;

  private taskTickerIntervalId: number | null = null;

  // Pending template when user clicks "+ 3D Pin" from a task so they place it in surroundings first
  private pendingPinFromTask: PendingPinContent | null = null;
  private repositioningPinId: string | null = null;
  private draggingPinId: string | null = null;
  private suppressNextClickPinId: string | null = null;

  /** A message waiting in the banner; see `showNotice`. */
  private noticeText = '';

  private readonly dictation = new SharedDictation();
  private readonly markers: PinMarkers;
  private readonly shield: FocusShield;
  private readonly tasksNav: TasksNavWidget;
  private readonly dock: BottomDock;
  private readonly setupModal: SetupModal;
  private readonly composer: PinComposerModal;
  private readonly inspector: PinInspectorModal;
  private readonly directory: PinDirectoryModal;
  private readonly tasksModal: TasksModal;

  // DOM References
  private readonly modalLayerEl: HTMLElement;
  private readonly topBarEl: HTMLElement;
  private readonly modeToastEl: HTMLElement;
  private readonly bottomDockEl: HTMLElement;
  private readonly dragBoxOverlayEl: HTMLElement;
  private readonly pinPlacementReticleEl: HTMLElement;
  private readonly focusCornerBarEl: HTMLElement;

  constructor(
    initialPins: SpatialPin[],
    initialTasks: LotusTask[],
    initialFocusZone: FocusZoneBounds,
    initialSettings: LotusSettings,
    /** The app's focus timer; this UI starts and stops it and follows what it does. */
    private readonly timer: FocusTimer,
    callbacks: LotusUICallbacks,
  ) {
    this.pins = initialPins;
    this.tasks = initialTasks;
    this.focusZone = initialFocusZone;
    this.customScreenFocusRect = initialFocusZone.customScreenRect ?? null;
    this.settings = initialSettings;
    this.callbacks = callbacks;

    this.container = document.createElement('div');
    this.container.id = 'lotus-ui-root';
    document.body.appendChild(this.container);

    const layout = buildLayout(this.container, this.settings.shieldStyle);
    this.modalLayerEl = layout.modalLayer;
    this.topBarEl = layout.topBar;
    this.modeToastEl = layout.modeToast;
    this.bottomDockEl = layout.bottomDock;
    this.dragBoxOverlayEl = layout.dragBoxOverlay;
    this.pinPlacementReticleEl = layout.pinPlacementReticle;
    this.focusCornerBarEl = layout.focusCornerBar;

    this.shield = new FocusShield(this.container);
    this.markers = new PinMarkers(layout.pinLayer, layout.proximityPulseLayer, {
      onHover: (pinId) => this.callbacks.onHoverPin(pinId),
      onClick: (pinId) => this.onPinMarkerClick(pinId),
    });
    const host = this.createHost();
    this.tasksNav = new TasksNavWidget(host, this.container);
    this.dock = new BottomDock(host, this.bottomDockEl);
    this.setupModal = new SetupModal(host, this.modalLayerEl);
    this.composer = new PinComposerModal(host, this.modalLayerEl);
    this.inspector = new PinInspectorModal(host, this.modalLayerEl);
    this.directory = new PinDirectoryModal(host, this.modalLayerEl);
    this.tasksModal = new TasksModal(host, this.modalLayerEl);

    this.timer.subscribe((event) => this.onFocusTimer(event));
    this.startTaskTimersEngine();
    this.renderAllPanels();
  }

  /** What the views in `src/ui/` see of this class; see `UIHost`. */
  private createHost(): UIHost {
    const ui = this;
    return {
      get callbacks() {
        return ui.callbacks;
      },
      get settings() {
        return ui.settings;
      },
      get pins() {
        return ui.pins;
      },
      set pins(pins) {
        ui.pins = pins;
      },
      get tasks() {
        return ui.tasks;
      },
      set tasks(tasks) {
        ui.tasks = tasks;
      },
      get mode() {
        return ui.currentMode;
      },
      set mode(mode) {
        ui.currentMode = mode;
      },
      get focusZone() {
        return ui.focusZone;
      },
      get redraggingFocusArea() {
        return ui.isRedraggingFocusArea;
      },
      set redraggingFocusArea(value) {
        ui.isRedraggingFocusArea = value;
      },
      timer: ui.timer,
      markers: ui.markers,
      shield: ui.shield,
      dictation: ui.dictation,
      isModalOpen: (id) => ui.isModalOpen(id),
      closeModal: (id) => ui.closeModal(id),
      showOnlyModal: (id, open) => ui.showOnlyModal(id, open),
      renderAll: () => ui.renderAllPanels(),
      refreshPinMarkers: () => ui.refreshPinMarkerContent(),
      updateTimerReadouts: () => ui.updateTimerReadoutsOnly(),
      enterPinAddMode: (pending) => ui.enterPinAddMode(pending),
      enterPinRepositionMode: (pinId) => ui.enterPinRepositionMode(pinId),
      enterFocusAreaMode: () => ui.enterFocusAreaMode(),
      openComposerForEditPin: (pin) => ui.openComposerForEditPin(pin),
      inspectPin: (pinId) => ui.inspectPin(pinId),
      startFocusTimer: () => ui.startFocusTimer(),
      updateDragBox2D: (visible) => ui.updateDragBox2D(visible),
      updatePinPlacementReticle: (visible) => ui.updatePinPlacementReticle(visible),
    };
  }

  private isModalOpen(id: ModalId): boolean {
    switch (id) {
      case 'welcome':
        return this.isWelcomeOpen;
      case 'tasks':
        return this.isTasksOpen;
      case 'composer':
        return this.isComposerOpen;
      case 'directory':
        return this.isPinDirectoryOpen;
      case 'inspector':
        return this.inspectedPinId !== null;
    }
  }

  private closeModal(id: ModalId) {
    switch (id) {
      case 'welcome':
        this.isWelcomeOpen = false;
        return;
      case 'tasks':
        this.isTasksOpen = false;
        return;
      case 'composer':
        this.isComposerOpen = false;
        return;
      case 'directory':
        this.isPinDirectoryOpen = false;
        return;
      case 'inspector':
        this.inspectedPinId = null;
        return;
    }
  }

  /** Opens one top-bar modal and closes every other (`open` false closes them all). */
  private showOnlyModal(id: NavModalId, open: boolean) {
    this.isTasksOpen = open && id === 'tasks';
    this.isWelcomeOpen = open && id === 'welcome';
    this.isPinDirectoryOpen = open && id === 'directory';
    this.isComposerOpen = false;
    this.inspectedPinId = null;
  }

  /** A click on a pin's marker: opens it, unless it ends a drag or a mode is placing something. */
  private onPinMarkerClick(pinId: string) {
    if (this.suppressNextClickPinId === pinId || this.draggingPinId) {
      this.suppressNextClickPinId = null;
      return;
    }
    if (this.currentMode === 'pin-add' || this.currentMode === 'focus-drag') {
      return;
    }
    this.inspectPin(pinId);
  }
  private startTaskTimersEngine() {
    if (this.taskTickerIntervalId !== null) {
      window.clearInterval(this.taskTickerIntervalId);
    }
    // Count from the wall clock, not from ticks: browsers throttle intervals
    // (background tabs, busy XR frames), and a tick-counted timer runs slow.
    let countedUntil = Date.now();
    this.taskTickerIntervalId = window.setInterval(() => {
      const wholeSeconds = Math.floor((Date.now() - countedUntil) / 1000);
      if (wholeSeconds < 1) return;
      countedUntil += wholeSeconds * 1000;
      const step = advanceTaskTimers(this.tasks, wholeSeconds);
      if (!step.changed) return;
      this.tasks = step.tasks;
      if (step.finished) {
        lotusSound.playTimerComplete();
        this.callbacks.onSaveTasks(this.tasks);
        this.renderAllPanels();
      } else {
        this.tasksNav.updateReadouts();
        this.dock.updateReadouts();
      }
    }, 250);
  }

  public formatTaskTimer(task: LotusTask): string {
    return taskClockText(task);
  }

  public setPins(pins: SpatialPin[]) {
    this.pins = pins;
    this.markers.prune(new Set(pins.map((p) => p.id)));
    this.renderAllPanels();
  }

  /** The live task list, including timers that are counting down. */
  public getTasks(): LotusTask[] {
    return this.tasks;
  }

  public setTasks(tasks: LotusTask[]) {
    this.tasks = tasks;
    this.renderAllPanels();
  }

  public setFocusZone(zone: FocusZoneBounds) {
    this.focusZone = zone;
    if (zone.customScreenRect !== undefined) {
      this.customScreenFocusRect = zone.customScreenRect;
    }
    this.renderAllPanels();
  }

  public setCustomScreenFocusRect(rect: ProjectedRect | null) {
    this.customScreenFocusRect = rect;
    this.focusZone.customScreenRect = rect;
  }

  public getCustomScreenFocusRect(): ProjectedRect | null {
    return this.customScreenFocusRect;
  }

  public ensurePreviousFocusRectSelected(): ProjectedRect {
    if (this.customScreenFocusRect && this.customScreenFocusRect.visible) {
      return this.customScreenFocusRect;
    }
    if (this.focusZone.customScreenRect?.visible) {
      this.customScreenFocusRect = {...this.focusZone.customScreenRect};
      return this.customScreenFocusRect;
    }
    if (this.lastProjectedFocusRect && this.lastProjectedFocusRect.visible) {
      this.customScreenFocusRect = {...this.lastProjectedFocusRect};
      return this.customScreenFocusRect;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.customScreenFocusRect = {
      visible: true,
      x: Math.round(vw * 0.2),
      y: Math.round(vh * 0.18),
      width: Math.round(vw * 0.6),
      height: Math.round(vh * 0.56),
    };
    return this.customScreenFocusRect;
  }

  public enterFocusAreaMode() {
    this.currentMode = 'focus-drag';
    this.isRedraggingFocusArea = false;
    const prevRect = this.ensurePreviousFocusRectSelected();
    this.updateDragBox2D(false);
    this.focusZone.customScreenRect = prevRect;
    this.callbacks.onModeChange('focus-drag');
    this.renderAllPanels();
  }

  public completeFocusAreaDrag(rect: ProjectedRect, updatedZone: FocusZoneBounds) {
    this.customScreenFocusRect = rect;
    this.focusZone = {
      ...updatedZone,
      customScreenRect: rect,
    };
    this.isRedraggingFocusArea = false;
    this.updateDragBox2D(false);
    this.callbacks.onFocusZoneChange(this.focusZone);
    this.renderAllPanels();
  }

  public enterPinAddMode(pendingFromTask?: {
    title: string;
    body: string;
    surfaceLabel: string;
  }) {
    this.repositioningPinId = null;
    this.pendingPinFromTask = pendingFromTask ?? null;
    this.isWelcomeOpen = false;
    this.isTasksOpen = false;
    this.isPinDirectoryOpen = false;
    this.isComposerOpen = false;
    this.inspectedPinId = null;
    this.currentMode = 'pin-add';
    this.updatePinPlacementReticle(
      true,
      window.innerWidth * 0.5,
      window.innerHeight * 0.5,
      'TAP HERE TO PLACE PIN',
    );
    this.callbacks.onModeChange('pin-add');
    this.renderAllPanels();
  }

  public enterPinRepositionMode(pinId: string) {
    this.repositioningPinId = pinId;
    this.pendingPinFromTask = null;
    this.isWelcomeOpen = false;
    this.isTasksOpen = false;
    this.isPinDirectoryOpen = false;
    this.isComposerOpen = false;
    this.inspectedPinId = null;
    this.currentMode = 'pin-add';
    this.updatePinPlacementReticle(
      true,
      window.innerWidth * 0.5,
      window.innerHeight * 0.5,
      'TAP NEW SPOT TO MOVE PIN',
    );
    this.callbacks.onModeChange('pin-add');
    this.renderAllPanels();
  }

  public markPinJustDragged(pinId: string) {
    this.suppressNextClickPinId = pinId;
    window.setTimeout(() => {
      if (this.suppressNextClickPinId === pinId) {
        this.suppressNextClickPinId = null;
      }
    }, 320);
  }

  public setDraggingPinState(
    pinId: string | null,
    _screenX = window.innerWidth * 0.5,
    _screenY = window.innerHeight * 0.5,
  ) {
    const prevId = this.draggingPinId;
    this.draggingPinId = pinId;
    this.markers.setDragging(pinId);
    if (prevId !== pinId) {
      this.renderModeToast();
    }
  }

  public updatePinPlacementReticle(
    visible: boolean,
    screenX = window.innerWidth * 0.5,
    screenY = window.innerHeight * 0.5,
    customCaption?: string,
  ) {
    if (!this.pinPlacementReticleEl) return;
    if (!visible || (this.currentMode !== 'pin-add' && !this.draggingPinId) || this.isComposerOpen) {
      this.pinPlacementReticleEl.style.display = 'none';
      return;
    }
    const capEl = this.pinPlacementReticleEl.querySelector(
      '.lotus-reticle-caption',
    );
    if (capEl) {
      capEl.textContent =
        customCaption ||
        (this.repositioningPinId
          ? 'TAP NEW SPOT TO MOVE PIN'
          : 'TAP HERE TO PLACE PIN');
    }
    this.pinPlacementReticleEl.style.display = 'flex';
    this.pinPlacementReticleEl.style.transform = `translate3d(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px, 0)`;
  }

  public setMode(mode: AppMode) {
    this.currentMode = mode;
    if (mode !== 'focus-drag') {
      this.isRedraggingFocusArea = false;
      this.updateDragBox2D(false);
    }
    if (mode !== 'pin-add') {
      this.repositioningPinId = null;
      this.updatePinPlacementReticle(false);
    }
    this.renderAllPanels();
  }

  public openComposerForNewPin(
    position: Vector3Data,
    normal: Vector3Data,
    surfaceLabel: string,
  ) {
    // If relocating an existing pin via "Move Pin", update its position immediately and return to explore!
    if (this.repositioningPinId) {
      const targetId = this.repositioningPinId;
      this.repositioningPinId = null;
      const existingPin = this.pins.find((p) => p.id === targetId);
      if (existingPin) {
        const movedPin: SpatialPin = {
          ...existingPin,
          position: {...position},
          normal: {...normal},
          surfaceLabel: surfaceLabel || existingPin.surfaceLabel,
        };
        this.updatePinPlacementReticle(false);
        this.currentMode = 'explore';
        lotusSound.playPinCreated();
        this.callbacks.onSavePin(movedPin);
        this.callbacks.onClickPinEffect(movedPin.id);
        this.callbacks.onModeChange('explore');
        this.refreshPinMarkerContent();
        this.renderAllPanels();
        return;
      }
    }

    this.composer.startNew(position, normal, surfaceLabel, this.pendingPinFromTask);
    this.pendingPinFromTask = null;
    this.updatePinPlacementReticle(false);
    this.isComposerOpen = true;
    this.isWelcomeOpen = false;
    this.isTasksOpen = false;
    this.inspectedPinId = null;
    this.isPinDirectoryOpen = false;
    this.renderAllPanels();
  }

  public openComposerForEditPin(pin: SpatialPin) {
    this.composer.startEdit(pin);
    this.isComposerOpen = true;
    this.isTasksOpen = false;
    this.inspectedPinId = null;
    this.renderAllPanels();
  }

  public inspectPin(pinId: string) {
    const found = this.pins.find((p) => p.id === pinId);
    if (!found) return;
    lotusSound.playPinOpen();
    this.callbacks.onClickPinEffect(pinId);
    this.trigger2DClickRipple(pinId);
    this.inspectedPinId = pinId;
    this.isComposerOpen = false;
    this.isTasksOpen = false;
    this.isWelcomeOpen = false;
    this.renderAllPanels();
  }

  public trigger2DClickRipple(pinId: string) {
    this.markers.ripple(pinId);
  }

  public updateDragBox2D(
    visible: boolean,
    x1 = 0,
    y1 = 0,
    x2 = 0,
    y2 = 0,
  ) {
    if (!visible) {
      this.dragBoxOverlayEl.style.display = 'none';
      return;
    }
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.max(32, Math.abs(x2 - x1));
    const height = Math.max(32, Math.abs(y2 - y1));
    this.dragBoxOverlayEl.style.display = 'flex';
    this.dragBoxOverlayEl.style.left = `${left}px`;
    this.dragBoxOverlayEl.style.top = `${top}px`;
    this.dragBoxOverlayEl.style.width = `${width}px`;
    this.dragBoxOverlayEl.style.height = `${height}px`;
    this.dragBoxOverlayEl.innerHTML = `<span class="lotus-drag-box-label">FOCUS AREA</span>`;
  }

  public updateFrameProjections(
    pinProjections: PinScreenProjection[],
    focusRect3D: ProjectedRect,
    userPosition?: Vector3Data,
  ) {
    this.lastProjectedFocusRect = focusRect3D;
    if (userPosition) {
      this.markers.setUserPosition(userPosition);
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const activeRect = this.customScreenFocusRect || focusRect3D;
    const rx = Math.round(activeRect.visible ? activeRect.x : vw * 0.2);
    const ry = Math.round(activeRect.visible ? activeRect.y : vh * 0.18);
    const rw = Math.round(activeRect.visible ? activeRect.width : vw * 0.6);
    const rh = Math.round(activeRect.visible ? activeRect.height : vh * 0.56);

    const focusCenterX = rx + rw * 0.5;
    const focusCenterY = ry + rh * 0.5;
    const halfW = Math.max(40, rw * 0.5);
    const halfH = Math.max(40, rh * 0.5);

    // Higher VISIBILITY % means MORE visibility of surroundings (less mask/blur opacity)
    const shieldStrength = getShieldStrength(this.settings);

    // 1. Update projected spatial pins (with dynamic Depth-of-Field blur based on distance from focus center)
    this.markers.update(this.pins, pinProjections, {
      settings: this.settings,
      tasks: this.tasks,
      timerRunning: this.timer.running,
      timerUsesArea: this.timer.dimsArea,
      vw,
      vh,
      focusCenterX,
      focusCenterY,
      halfW,
      halfH,
      shieldStrength,
    });
    // 2. Show single continuous peripheral focus shield when Timer is running OR when previewing selected area in Focus Area mode
    const isPreviewingFocusArea =
      this.currentMode === 'focus-drag' && !this.isRedraggingFocusArea;

    const shieldOn = this.timer.dimsArea;
    if (!shieldOn && !isPreviewingFocusArea) {
      this.shield.hide();
    } else {
      const left = Math.max(0, rx);
      const top = Math.max(0, ry);
      const right = Math.min(vw, rx + rw);
      const bottom = Math.min(vh, ry + rh);
      const formatted = this.timer.clockText();
      this.shield.show(
        {left, top, right, bottom},
        shieldStrength,
        this.settings.shieldStyle,
        this.timer.running ? `FOCUS${formatted ? ` · ${formatted}` : ''}` : 'FOCUS AREA',
      );
    }
  }

  public refreshPinMarkerContent() {
    this.markers.clear();
  }

  // ===========================================================================
  // FOCUS TIMER (the clock itself is FocusTimer)
  // ===========================================================================
  /**
   * `withArea` false runs only the clock: nothing around the focus area is
   * dimmed. By default the "Start focus" setting decides.
   */
  public startFocusTimer(withArea = this.settings.focusStart !== 'timer') {
    this.timer.start(withArea);
  }

  public stopFocusTimer() {
    this.timer.stop();
  }

  /**
   * The timer may be started or stopped here or in the headset; this view
   * follows it either way. Sounds and the 3D scene are the app's (index.ts).
   */
  private onFocusTimer(event: FocusTimerEvent) {
    switch (event.type) {
      case 'tick':
        this.updateTimerReadoutsOnly();
        return;
      case 'start':
        // A session hides the main interface; no modal stays over it.
        this.isWelcomeOpen = false;
        this.isPinDirectoryOpen = false;
        this.isTasksOpen = false;
        this.isComposerOpen = false;
        this.inspectedPinId = null;
        break;
      case 'stop':
        this.shield.hide();
        break;
    }
    this.renderAllPanels();
  }

  private updateTimerReadoutsOnly() {
    const formatted = this.timer.clockText();
    const dockClock = this.bottomDockEl.querySelector('#lotus-dock-clock');
    if (dockClock) dockClock.textContent = formatted;
    if (this.timer.running) {
      this.shield.setLabel(`FOCUS${formatted ? ` · ${formatted}` : ''}`);
    }
  }

  // ===========================================================================
  // RENDER PANELS (Minimal, Clutter-Free Layout)
  // ===========================================================================

  private renderAllPanels() {
    // Re-renders rebuild DOM via innerHTML, which would scroll panels back to
    // the top. Capture scroll position before, restore after.
    const prevModalScroll = captureModalBodyScroll(this.modalLayerEl);
    const prevListScrolls = this.captureHoverListScrolls();
    try {
      this.renderTopBar();
      this.renderCornerStopFocusButton();
      this.renderModeToast();
      this.renderModals();
      this.dock.render();
    } finally {
      restoreModalBodyScroll(this.modalLayerEl, prevModalScroll);
      this.restoreHoverListScrolls(prevListScrolls);
    }
  }

  private captureHoverListScrolls(): Array<{ el: HTMLElement; top: number }> {
    const roots: Array<HTMLElement> = [this.topBarEl, this.focusCornerBarEl];
    return roots
      .flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>('.lotus-tasks-hover-list')))
      .map((el) => ({ el, top: el.scrollTop }));
  }

  private restoreHoverListScrolls(prev: Array<{ el: HTMLElement; top: number }>): void {
    for (const { el, top } of prev) {
      if (el.isConnected) el.scrollTop = top;
    }
  }

  private renderCornerStopFocusButton() {
    if (!this.timer.running) {
      this.focusCornerBarEl.style.display = 'none';
      this.focusCornerBarEl.innerHTML = '';
      return;
    }

    this.focusCornerBarEl.style.display = 'flex';
    this.focusCornerBarEl.innerHTML = `
      ${this.tasksNav.html(true)}
      <button type="button" id="lotus-corner-stop-btn" class="lotus-corner-stop-btn">
        <span>Stop Focus</span>
      </button>
    `;

    this.tasksNav.bind(this.focusCornerBarEl);
    this.focusCornerBarEl
      .querySelector('#lotus-corner-stop-btn')
      ?.addEventListener('click', () => {
        this.stopFocusTimer();
      });
  }

  private renderTopBar() {
    // Hide the main top bar when Focus Timer is running (Focus corner bar shows Task + Stop Focus)
    if (this.timer.running) {
      this.topBarEl.style.display = 'none';
      this.topBarEl.innerHTML = '';
      return;
    }

    this.topBarEl.style.display = 'flex';

    // When in Focus Area mode or Pin Placement mode, hide main UI except the LOTUS text and icon so surroundings are clear
    if (this.currentMode === 'focus-drag' || this.currentMode === 'pin-add') {
      this.topBarEl.innerHTML = `
        <a href="#welcome" id="nav-brand-link" class="lotus-brand-zone">
          ${MONO_LOTUS_SVG}
          <span>LOTUS</span>
        </a>
      `;
      this.topBarEl
        .querySelector('#nav-brand-link')
        ?.addEventListener('click', (e) => {
          e.preventDefault();
        });
      return;
    }

    this.topBarEl.innerHTML = `
      <a href="#welcome" id="nav-brand-link" class="lotus-brand-zone">
        ${MONO_LOTUS_SVG}
        <span>LOTUS</span>
      </a>

      <nav class="lotus-nav-zone" aria-label="Workspace actions">
        ${this.tasksNav.html(false)}

        <button type="button" data-nav="pin-list" class="lotus-nav-link ${this.isPinDirectoryOpen ? 'is-active' : ''}">
          PINS (${this.pins.length})
        </button>
        <button type="button" data-nav="welcome" class="lotus-nav-link ${this.isWelcomeOpen ? 'is-active' : ''}">
          SETUP
        </button>
      </nav>
    `;

    this.topBarEl
      .querySelector('#nav-brand-link')
      ?.addEventListener('click', (e) => {
        e.preventDefault();
        this.showOnlyModal('welcome', !this.isWelcomeOpen);
        this.renderAllPanels();
      });

    this.tasksNav.bind(this.topBarEl);

    this.topBarEl
      .querySelectorAll('[data-nav="pin-list"], [data-nav="welcome"]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const nav = (btn as HTMLElement).dataset.nav;
          if (nav === 'welcome') {
            this.showOnlyModal('welcome', !this.isWelcomeOpen);
            this.renderAllPanels();
          } else if (nav === 'pin-list') {
            this.showOnlyModal('directory', !this.isPinDirectoryOpen);
            this.renderAllPanels();
          }
        });
      });
  }

  private renderModeToast() {
    if (this.draggingPinId) {
      const draggedPin = this.pins.find((p) => p.id === this.draggingPinId);
      const pinTitle = draggedPin ? draggedPin.title : 'Pin';
      this.modeToastEl.innerHTML = `
        <div class="lotus-banner-pill is-pin-mode">
          <span>Moving "${escapeHtml(pinTitle)}" — drag to new spot &amp; release to replace</span>
        </div>
      `;
      return;
    }

    if (this.timer.running) {
      this.modeToastEl.innerHTML = '';
      return;
    }

    if (this.currentMode === 'pin-add' && !this.isComposerOpen) {
      const repositioningPin = this.repositioningPinId
        ? this.pins.find((p) => p.id === this.repositioningPinId)
        : null;
      const pendingLabel = repositioningPin
        ? `Tap a new spot in your surroundings to move "${escapeHtml(repositioningPin.title)}"`
        : this.pendingPinFromTask
          ? `Tap anywhere in your surroundings to place "${escapeHtml(this.pendingPinFromTask.title)}"`
          : 'Point & tap anywhere in your surroundings to place pin — then Save UI will open';
      this.modeToastEl.innerHTML = `
        <div class="lotus-banner-pill is-pin-mode">
          <span>${pendingLabel}</span>
          <button type="button" id="banner-cancel-pin" class="lotus-banner-action">Cancel</button>
        </div>
      `;
      this.modeToastEl
        .querySelector('#banner-cancel-pin')
        ?.addEventListener('click', () => {
          this.pendingPinFromTask = null;
          this.repositioningPinId = null;
          this.currentMode = 'explore';
          this.updatePinPlacementReticle(false);
          this.callbacks.onModeChange('explore');
          this.renderAllPanels();
        });
      return;
    }

    if (this.currentMode === 'focus-drag' && this.isRedraggingFocusArea) {
      this.modeToastEl.innerHTML = `
        <div class="lotus-banner-pill is-drag-mode">
          <span>Drag a box on screen to select your new Focus Area</span>
        </div>
      `;
      return;
    }

    if (this.noticeText) {
      this.modeToastEl.innerHTML = `
        <div class="lotus-banner-pill">
          <span>${escapeHtml(this.noticeText)}</span>
          <button type="button" id="banner-dismiss-notice" class="lotus-banner-action">OK</button>
        </div>
      `;
      this.modeToastEl
        .querySelector('#banner-dismiss-notice')
        ?.addEventListener('click', () => {
          this.noticeText = '';
          this.renderAllPanels();
        });
      return;
    }

    this.modeToastEl.innerHTML = '';
  }

  /**
   * Shows a message in the banner until the user dismisses it. For things the
   * user must know but did not ask about, such as a failed save.
   */
  public showNotice(text: string) {
    this.noticeText = text;
    this.renderAllPanels();
  }

  private renderModals() {
    if (this.isTasksOpen) {
      this.tasksModal.render();
      return;
    }
    if (this.isWelcomeOpen) {
      this.setupModal.render();
      return;
    }
    if (this.isComposerOpen) {
      this.composer.render();
      return;
    }
    if (this.inspectedPinId) {
      const pin = this.pins.find((p) => p.id === this.inspectedPinId);
      if (pin) {
        this.inspector.render(pin);
        return;
      }
    }
    if (this.isPinDirectoryOpen) {
      this.directory.render();
      return;
    }

    this.modalLayerEl.innerHTML = '';
    this.modalLayerEl.style.pointerEvents = 'none';
  }

  /**
   * Closes every modal. Used when an immersive session starts: the DOM is not
   * visible in a headset, so an open modal could never be dismissed there.
   */
  public closeAllModals() {
    if (!this.isAnyModalOpen()) return;
    this.isTasksOpen = false;
    this.isWelcomeOpen = false;
    this.isComposerOpen = false;
    this.isPinDirectoryOpen = false;
    this.inspectedPinId = null;
    this.renderAllPanels();
  }

  public isAnyModalOpen(): boolean {
    return (
      this.isTasksOpen ||
      this.isWelcomeOpen ||
      this.isComposerOpen ||
      this.isPinDirectoryOpen ||
      Boolean(this.inspectedPinId)
    );
  }

  public getSettings(): Readonly<LotusSettings> {
    return this.settings;
  }

  /**
   * Settings changed outside the 2D settings screen (the in-headset drawer).
   * Goes through the same path as the screen: storage, 3D scene, clock,
   * re-render.
   */
  public applySettings(patch: Partial<LotusSettings>) {
    Object.assign(this.settings, patch);
    this.callbacks.onSettingsChange(this.settings);
    this.renderAllPanels();
  }

}
