import * as d3 from 'd3';
import MONO_LOTUS_SVG from '../assets/icon.svg?raw';
import {lotusSound} from './sound';
import {ROOM_WAYPOINTS, vec3} from './storage';
import {
  AppMode,
  FocusZoneBounds,
  LotusSettings,
  LotusTask,
  PinScreenProjection,
  PinShapeStyle,
  PinSortBy,
  ProjectedRect,
  RoomWaypoint,
  AmbientLightMode,
  ShieldStyle,
  SpatialPin,
  TaskFilterTab,
  TaskItemType,
  TimerMode,
  Vector3Data,
} from './types';

export interface LotusUICallbacks {
  onModeChange: (mode: AppMode) => void;
  onSavePin: (pin: SpatialPin) => void;
  onDeletePin: (pinId: string) => void;
  onClearAllPins: () => void;
  onApplyStyleToAllPins: (style: PinShapeStyle) => void;
  onSaveTasks: (tasks: LotusTask[]) => void;
  onHoverPin: (pinId: string | null) => void;
  onClickPinEffect: (pinId: string) => void;
  onWalkToWaypoint: (waypoint: RoomWaypoint) => void;
  onWalkToPin: (pin: SpatialPin) => void;
  onSettingsChange: (settings: LotusSettings) => void;
  onFocusZoneChange: (zone: FocusZoneBounds) => void;
  onTimerStateChange: (isRunning: boolean) => void;
  onFlipCamera: () => void;
}

export const PIN_COLOR_OPTIONS = [
  {label: 'Vermilion Accent', value: '#E84D2B'},
  {label: 'Charcoal Ink', value: '#1B1B19'},
  {label: 'Lotus White', value: '#FFFFFF'},
  {label: 'Electric Cyan', value: '#06B6D4'},
  {label: 'Study Amber', value: '#F59E0B'},
  {label: 'Sage Emerald', value: '#10B981'},
  {label: 'Royal Violet', value: '#8B5CF6'},
  {label: 'Rose Coral', value: '#F43F5E'},
];

const QWERTY_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ':'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '?'],
];

/**
 * Minimal, clutter-free real-world AR interface for LOTUS:
 * - Transparent top bar (Monochromatic Lotus brand, Tasks, Pins, Setup)
 * - Compact translucent bottom action dock (+ Add Pin, Tasks, Focus Area, Start/Stop Focus)
 * - Tasks & Reminders manager with tick buttons separating Ongoing and Completed tasks
 * - Focus Area mode: shows previously selected area, visibility slider, Okay and Again buttons, hides main UI except Lotus & icon
 * - Active Focus Timer mode: hides main UI and shows a compact underlined Stop Focus text button with shadow in corner
 * - Pin Directory sorting by Proximity to user or Creation Date
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

  // Sorting & proximity state for Pin Directory
  private pinSortBy: PinSortBy = 'proximity';
  private pinDistances = new Map<string, number>();
  private userPosition: Vector3Data = vec3(0, 1.45, -0.25);

  // Timer state
  private isTimerRunning = false;
  private timerRemainingSec = 25 * 60;
  private timerElapsedSec = 0;
  private timerIntervalId: number | null = null;

  // Modals state
  private isWelcomeOpen = false;
  private isPinDirectoryOpen = false;
  private isTasksOpen = false;
  private inspectedPinId: string | null = null;
  private activeWaypointId = 'desk';

  // Tasks & Reminders composer and filter state
  private taskFilterTab: TaskFilterTab = 'all';
  private draftTaskTitle = '';
  private draftTaskNote = '';
  private draftTaskDueLabel = '';
  private draftTaskTimerMin = 25;
  private draftTaskType: TaskItemType = 'task';
  private taskTickerIntervalId: number | null = null;

  // Pending template when user clicks "+ 3D Pin" from a task so they place it in surroundings first
  private pendingPinFromTask: {
    title: string;
    body: string;
    surfaceLabel: string;
  } | null = null;
  private repositioningPinId: string | null = null;
  private draggingPinId: string | null = null;
  private suppressNextClickPinId: string | null = null;

  // Composer state
  private isComposerOpen = false;
  private editingPinId: string | null = null;
  private draftTitle = '';
  private draftBody = '';
  private draftSurfaceLabel = 'Room Point';
  private draftColor = '#E84D2B';
  private draftShapeStyle: PinShapeStyle = 'revolving';
  private draftPosition: Vector3Data = vec3(0, 1.32, -1.4);
  private draftNormal: Vector3Data = vec3(0, 1, 0);
  private activeKeyboardField: 'title' | 'body' | 'surface' = 'title';
  private xrKeyboardShift = false;
  private showXrKeyboard = false;

  // Voice recognition state
  private isListeningVoice = false;
  private isListeningInspectorVoice = false;
  private voiceTargetField: 'title' | 'body' = 'body';
  private voiceStatusText = 'Tap microphone to speak or type directly';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private speechRecognizer: any = null;

  // DOM References
  private proximityPulseLayerEl!: HTMLElement;
  private pinAmbientStartedAt = new Map<string, number>();
  private pinCornerPulseElements = new Map<string, HTMLElement>();
  private pinLayerEl!: HTMLElement;
  private pinMarkerElements = new Map<string, HTMLElement>();
  private apertureRootEl!: HTMLElement;
  private surroundShieldEl!: HTMLElement;
  private focusWindowFrameEl!: HTMLElement;
  private focusWindowBadgeEl!: HTMLElement;

  private modalLayerEl!: HTMLElement;
  private topBarEl!: HTMLElement;
  private modeToastEl!: HTMLElement;
  private bottomDockEl!: HTMLElement;
  private dragBoxOverlayEl!: HTMLElement;
  private pinPlacementReticleEl!: HTMLElement;
  private focusCornerBarEl!: HTMLElement;

  constructor(
    initialPins: SpatialPin[],
    initialTasks: LotusTask[],
    initialFocusZone: FocusZoneBounds,
    initialSettings: LotusSettings,
    callbacks: LotusUICallbacks,
  ) {
    this.pins = initialPins;
    this.tasks = initialTasks;
    this.focusZone = initialFocusZone;
    this.customScreenFocusRect = initialFocusZone.customScreenRect ?? null;
    this.settings = initialSettings;
    this.callbacks = callbacks;

    this.resetTimerClockFromSettings();

    this.container = document.createElement('div');
    this.container.id = 'lotus-ui-root';
    document.body.appendChild(this.container);

    this.buildStaticDOMStructure();
    this.startTaskTimersEngine();
    this.renderAllPanels();
  }

  private resetTimerClockFromSettings() {
    if (this.settings.timerMode === 'preset') {
      this.timerRemainingSec = this.settings.presetMinutes * 60;
    } else if (this.settings.timerMode === 'custom') {
      this.timerRemainingSec =
        this.settings.customMinutes * 60 + this.settings.customSeconds;
    } else {
      this.timerElapsedSec = 0;
    }
  }

  private startTaskTimersEngine() {
    if (this.taskTickerIntervalId !== null) {
      window.clearInterval(this.taskTickerIntervalId);
    }
    this.taskTickerIntervalId = window.setInterval(() => {
      let anyUpdated = false;
      let anyCompletedByTimer = false;
      this.tasks = this.tasks.map((t) => {
        if (!t.completed && t.timerRunning) {
          const cur =
            t.remainingSeconds ?? t.timerSeconds ?? this.settings.presetMinutes * 60;
          const next = Math.max(0, cur - 1);
          anyUpdated = true;
          if (next === 0) {
            anyCompletedByTimer = true;
            return {
              ...t,
              remainingSeconds: 0,
              timerRunning: false,
            };
          }
          return {
            ...t,
            remainingSeconds: next,
          };
        }
        return t;
      });

      if (anyCompletedByTimer) {
        lotusSound.playTimerComplete();
        this.callbacks.onSaveTasks(this.tasks);
        this.renderAllPanels();
      } else if (anyUpdated) {
        this.updateTaskTimerDOMReadouts();
      }
    }, 1000);
  }

  public formatTaskTimer(task: LotusTask): string {
    const sec =
      task.remainingSeconds ??
      task.timerSeconds ??
      this.settings.presetMinutes * 60;
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }

  private getTasksNavButtonLabelHtml(): string {
    const ongoingTasks = this.tasks.filter((t) => !t.completed);
    const runningTask = ongoingTasks.find((t) => t.timerRunning);
    if (runningTask) {
      const rawTitle = runningTask.title.trim();
      const shortTitle =
        rawTitle.length > 18
          ? `${rawTitle.slice(0, 16).trimEnd()}..`
          : rawTitle;
      const timerStr = this.formatTaskTimer(runningTask);
      return `${this.escapeHtml(shortTitle)}(${timerStr})`;
    }
    return `TASKS (${ongoingTasks.length})`;
  }

  private updateTaskTimerDOMReadouts() {
    for (const task of this.tasks) {
      const formatted = this.formatTaskTimer(task);
      this.container
        .querySelectorAll(`[data-task-timer-readout="${task.id}"]`)
        .forEach((el) => {
          el.textContent = `⏱ ${formatted}`;
        });
    }
    const navLabelHtml = this.getTasksNavButtonLabelHtml();
    const hasRunning = this.tasks.some((t) => !t.completed && t.timerRunning);
    this.container
      .querySelectorAll('[data-tasks-nav-btn="true"]')
      .forEach((btn) => {
        btn.innerHTML = navLabelHtml;
        btn.classList.toggle('is-task-timer-running', hasRunning);
      });
  }

  private buildStaticDOMStructure() {
    this.container.innerHTML = `
      <!-- Single Continuous Surround Shield (Engaged when Timer is ON or previewing Focus Area — zero quadrant seams) -->
      <div id="lotus-aperture-root" class="lotus-aperture-root shield-${this.settings.shieldStyle}" style="display: none;">
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

    this.apertureRootEl = this.container.querySelector('#lotus-aperture-root')!;
    this.surroundShieldEl = this.container.querySelector(
      '#lotus-surround-shield',
    )!;
    this.focusWindowFrameEl = this.container.querySelector(
      '#lotus-focus-window-frame',
    )!;
    this.focusWindowBadgeEl = this.container.querySelector(
      '#lotus-focus-window-badge',
    )!;
    this.dragBoxOverlayEl = this.container.querySelector(
      '#lotus-drag-box-overlay',
    )!;
    this.pinPlacementReticleEl = this.container.querySelector(
      '#lotus-pin-placement-reticle',
    )!;
    this.proximityPulseLayerEl = this.container.querySelector(
      '#lotus-proximity-pulse-layer',
    )!;
    this.pinLayerEl = this.container.querySelector('#lotus-pin-layer')!;
    this.topBarEl = this.container.querySelector('#lotus-top-bar')!;
    this.focusCornerBarEl = this.container.querySelector(
      '#lotus-focus-corner-bar',
    )!;
    this.modeToastEl = this.container.querySelector('#lotus-mode-toast')!;
    this.modalLayerEl = this.container.querySelector('#lotus-modal-layer')!;
    this.bottomDockEl = this.container.querySelector('#lotus-bottom-dock')!;
  }

  public setPins(pins: SpatialPin[]) {
    this.pins = pins;
    const validIds = new Set(pins.map((p) => p.id));
    for (const [id, el] of this.pinMarkerElements.entries()) {
      if (!validIds.has(id)) {
        el.remove();
        this.pinMarkerElements.delete(id);
      }
    }
    for (const [id, pulseEl] of this.pinCornerPulseElements.entries()) {
      if (!validIds.has(id)) {
        pulseEl.remove();
        this.pinCornerPulseElements.delete(id);
      }
    }
    this.renderAllPanels();
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
    for (const [id, markerEl] of this.pinMarkerElements.entries()) {
      markerEl.classList.toggle('is-dragging', id === pinId);
    }
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

    this.editingPinId = null;
    if (this.pendingPinFromTask) {
      this.draftTitle = this.pendingPinFromTask.title;
      this.draftBody = this.pendingPinFromTask.body;
      this.draftSurfaceLabel =
        this.pendingPinFromTask.surfaceLabel || surfaceLabel || 'Room Object';
      this.pendingPinFromTask = null;
    } else {
      this.draftTitle = '';
      this.draftBody = '';
      this.draftSurfaceLabel = surfaceLabel || 'Room Object';
    }
    this.draftColor = this.settings.defaultPinColor || '#E84D2B';
    this.draftShapeStyle = this.settings.defaultPinStyle || 'revolving';
    this.draftPosition = {...position};
    this.draftNormal = {...normal};
    this.activeKeyboardField = 'title';
    this.updatePinPlacementReticle(false);
    this.isComposerOpen = true;
    this.isWelcomeOpen = false;
    this.isTasksOpen = false;
    this.inspectedPinId = null;
    this.isPinDirectoryOpen = false;
    this.renderAllPanels();
  }

  public openComposerForEditPin(pin: SpatialPin) {
    this.editingPinId = pin.id;
    this.draftTitle = pin.title;
    this.draftBody = pin.body;
    this.draftSurfaceLabel = pin.surfaceLabel;
    this.draftColor = pin.color || '#E84D2B';
    this.draftShapeStyle =
      pin.shapeStyle ?? this.settings.defaultPinStyle ?? 'revolving';
    this.draftPosition = {...pin.position};
    this.draftNormal = {...pin.normal};
    this.activeKeyboardField = 'body';
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
    const markerEl = this.pinMarkerElements.get(pinId);
    if (!markerEl) return;
    markerEl.classList.remove('is-click-pulsing');
    void markerEl.offsetWidth;
    markerEl.classList.add('is-click-pulsing');
    window.setTimeout(() => {
      markerEl.classList.remove('is-click-pulsing');
    }, 450);
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
      this.userPosition = userPosition;
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
    const visibilityPercent = Math.max(
      0,
      Math.min(100, this.settings.focusAreaVisibility ?? 25),
    );
    const shieldStrength = 1 - visibilityPercent / 100;

    // 1. Update projected spatial pins (with dynamic Depth-of-Field blur based on distance from focus center)
    for (const proj of pinProjections) {
      this.pinDistances.set(proj.id, proj.distanceMeters);
      const pin = this.pins.find((p) => p.id === proj.id);
      if (!pin) continue;

      let markerEl = this.pinMarkerElements.get(pin.id);
      if (!markerEl) {
        markerEl = this.createPinMarkerDOM(pin);
        this.pinLayerEl.appendChild(markerEl);
        this.pinMarkerElements.set(pin.id, markerEl);
      }

      const maxProximityDist = Math.max(
        0.5,
        this.settings.proximityDistanceMeters || 0.5,
      );
      const isWithinRadius =
        proj.isWithinRadius ?? proj.distanceMeters <= maxProximityDist;

      // Update directional corner/side screen pulse when user moves within proximity distance of this pin
      let pulseEl = this.pinCornerPulseElements.get(pin.id);
      if (!pulseEl) {
        pulseEl = this.createPinCornerPulseDOM(pin);
        this.proximityPulseLayerEl.appendChild(pulseEl);
        this.pinCornerPulseElements.set(pin.id, pulseEl);
      }

      const pinHex = pin.color || '#E84D2B';
      pulseEl.style.setProperty('--pin-pulse-color', pinHex);
      pulseEl.style.setProperty(
        '--pin-pulse-rgb',
        this.hexToRgbTuple(pinHex),
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

      const ambientMode = this.settings.ambientLightMode ?? 'timer';
      const ambientAllowed =
        ambientMode === 'all' ||
        (ambientMode === 'timer' &&
          (this.isTimerRunning ||
            this.tasks.some((t) => !t.completed && t.timerRunning)));
      const nowMs = performance.now();
      let ambientPhase: 'off' | 'on' | 'flicker' = 'off';
      if (ambientAllowed && isWithinRadius && !isInViewpoint) {
        let startedAt = this.pinAmbientStartedAt.get(pin.id);
        if (startedAt === undefined) {
          startedAt = nowMs;
          this.pinAmbientStartedAt.set(pin.id, startedAt);
        }
        const durMs =
          Math.max(1, this.settings.ambientLightDurationSec ?? 6) * 1000;
        const elapsed = nowMs - startedAt;
        ambientPhase =
          elapsed < durMs ? 'on' : elapsed < durMs + 1300 ? 'flicker' : 'off';
      } else {
        this.pinAmbientStartedAt.delete(pin.id);
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
      if (this.isTimerRunning) {
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

      if (proj.isWithinProximity && this.settings.headerPopEnabled) {
        markerEl.classList.add('is-proximity-active');
        markerEl.classList.remove('is-compact-far');
      } else {
        markerEl.classList.remove('is-proximity-active');
        markerEl.classList.add('is-compact-far');
      }
    }

    // 2. Show single continuous peripheral focus shield when Timer is running OR when previewing selected area in Focus Area mode
    const isPreviewingFocusArea =
      this.currentMode === 'focus-drag' && !this.isRedraggingFocusArea;

    if (!this.isTimerRunning && !isPreviewingFocusArea) {
      this.apertureRootEl.style.display = 'none';
    } else {
      this.apertureRootEl.style.display = 'block';
      this.apertureRootEl.className = `lotus-aperture-root shield-${this.settings.shieldStyle}`;

      const left = Math.max(0, rx);
      const top = Math.max(0, ry);
      const right = Math.min(vw, rx + rw);
      const bottom = Math.min(vh, ry + rh);

      this.surroundShieldEl.style.opacity = `${shieldStrength.toFixed(3)}`;
      this.surroundShieldEl.style.setProperty(
        '--shield-blur',
        `${(shieldStrength * 16).toFixed(1)}px`,
      );
      this.surroundShieldEl.style.clipPath = `polygon(0px 0px, 100% 0px, 100% 100%, 0px 100%, 0px 0px, ${left}px ${top}px, ${left}px ${bottom}px, ${right}px ${bottom}px, ${right}px ${top}px, ${left}px ${top}px)`;

      this.focusWindowFrameEl.style.left = `${left}px`;
      this.focusWindowFrameEl.style.top = `${top}px`;
      this.focusWindowFrameEl.style.width = `${Math.max(0, right - left)}px`;
      this.focusWindowFrameEl.style.height = `${Math.max(0, bottom - top)}px`;
      this.focusWindowFrameEl.style.opacity = '1';

      const labelSpan = this.focusWindowBadgeEl.querySelector(
        '#lotus-focus-window-label',
      );
      if (labelSpan) {
        const formatted = this.formatClockDisplay();
        labelSpan.textContent = this.isTimerRunning
          ? `FOCUS${formatted ? ` · ${formatted}` : ''}`
          : 'FOCUS AREA';
      }
    }
  }

  /**
   * Creates the DOM anchor for a spatial pin at (screenX, screenY).
   */
  private createPinMarkerDOM(pin: SpatialPin): HTMLElement {
    const el = document.createElement('div');
    el.className = 'lotus-pin-marker is-proximity-active';
    el.dataset.pinId = pin.id;
    el.style.setProperty('--pin-accent', pin.color || '#E84D2B');

    el.innerHTML = `
      <button type="button" class="lotus-pin-header-card" data-pin-id="${pin.id}" aria-label="Open or drag note: ${this.escapeHtml(pin.title)}">
        <div class="lotus-pin-meta-row">
          <span class="lotus-pin-surface">${this.escapeHtml(pin.surfaceLabel)}</span>
          <span aria-hidden="true">·</span>
          <span class="lotus-pin-dist">1.2m</span>
        </div>
        <div class="lotus-pin-title">${this.escapeHtml(pin.title)}</div>
        <div class="lotus-pin-cta-hint">CLICK FOR NOTE · PINCH/DRAG TO MOVE</div>
      </button>
      <button
        type="button"
        class="lotus-pin-hit-target"
        data-pin-id="${pin.id}"
        aria-label="Inspect or drag spatial point: ${this.escapeHtml(pin.title)}"
        title="${this.escapeHtml(pin.title)} — Click to open note, or pinch/drag to move"
      >
        <span class="lotus-pin-hover-ring"></span>
        <span class="lotus-pin-click-wave"></span>
      </button>
    `;

    const onEnter = () => {
      el.classList.add('is-hovered');
      this.callbacks.onHoverPin(pin.id);
    };
    const onLeave = () => {
      el.classList.remove('is-hovered');
      this.callbacks.onHoverPin(null);
    };
    const onClick = (e: Event) => {
      e.stopPropagation();
      if (this.suppressNextClickPinId === pin.id || this.draggingPinId) {
        this.suppressNextClickPinId = null;
        return;
      }
      if (this.currentMode === 'pin-add' || this.currentMode === 'focus-drag') {
        return;
      }
      this.inspectPin(pin.id);
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

  private createPinCornerPulseDOM(pin: SpatialPin): HTMLElement {
    const el = document.createElement('div');
    el.className = 'lotus-pin-corner-pulse';
    el.dataset.pinId = pin.id;
    const pinHex = pin.color || '#E84D2B';
    el.style.setProperty('--pin-pulse-color', pinHex);
    el.style.setProperty('--pin-pulse-rgb', this.hexToRgbTuple(pinHex));
    el.innerHTML = `
      <span class="lotus-corner-pulse-glow"></span>
      <span class="lotus-side-pulse-glow"></span>
      <span class="lotus-corner-pulse-rim"></span>
    `;
    return el;
  }

  private hexToRgbTuple(hex: string): string {
    const cleaned = (hex || '#E84D2B').replace('#', '').trim();
    if (cleaned.length === 3) {
      const r = parseInt(cleaned[0] + cleaned[0], 16) || 232;
      const g = parseInt(cleaned[1] + cleaned[1], 16) || 77;
      const b = parseInt(cleaned[2] + cleaned[2], 16) || 43;
      return `${r}, ${g}, ${b}`;
    }
    if (cleaned.length >= 6) {
      const r = parseInt(cleaned.slice(0, 2), 16);
      const g = parseInt(cleaned.slice(2, 4), 16);
      const b = parseInt(cleaned.slice(4, 6), 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return `${r}, ${g}, ${b}`;
      }
    }
    return '232, 77, 43';
  }

  public refreshPinMarkerContent() {
    this.pinLayerEl.innerHTML = '';
    this.pinMarkerElements.clear();
    this.proximityPulseLayerEl.innerHTML = '';
    this.pinCornerPulseElements.clear();
  }

  // ===========================================================================
  // TIMER ENGINE
  // ===========================================================================

  public startFocusTimer() {
    if (this.isTimerRunning) return;
    if (
      this.settings.timerMode !== 'stopwatch' &&
      this.timerRemainingSec <= 0
    ) {
      this.resetTimerClockFromSettings();
    }

    this.isTimerRunning = true;
    this.isWelcomeOpen = false;
    this.isPinDirectoryOpen = false;
    this.isTasksOpen = false;
    this.isComposerOpen = false;
    this.inspectedPinId = null;

    lotusSound.playFocusStart();
    this.callbacks.onTimerStateChange(true);

    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
    }

    this.timerIntervalId = window.setInterval(() => {
      if (this.settings.timerMode === 'stopwatch') {
        this.timerElapsedSec += 1;
      } else {
        this.timerRemainingSec = Math.max(0, this.timerRemainingSec - 1);
        if (this.timerRemainingSec === 0) {
          lotusSound.playTimerComplete();
          this.stopFocusTimer();
          return;
        }
      }
      this.updateTimerReadoutsOnly();
    }, 1000);

    this.renderAllPanels();
  }

  public stopFocusTimer() {
    if (!this.isTimerRunning && this.timerIntervalId === null) return;
    this.isTimerRunning = false;
    if (this.timerIntervalId !== null) {
      window.clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    lotusSound.playFocusStop();
    this.callbacks.onTimerStateChange(false);
    this.apertureRootEl.style.display = 'none';
    this.renderAllPanels();
  }

  private formatClockDisplay(): string {
    if (
      this.settings.timerMode === 'stopwatch' &&
      this.timerElapsedSec === 0
    ) {
      return '';
    }

    const totalSec =
      this.settings.timerMode === 'stopwatch'
        ? this.timerElapsedSec
        : this.timerRemainingSec;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  private updateTimerReadoutsOnly() {
    const formatted = this.formatClockDisplay();
    const dockClock = this.bottomDockEl.querySelector('#lotus-dock-clock');
    if (dockClock) dockClock.textContent = formatted;
    const labelSpan = this.focusWindowBadgeEl.querySelector(
      '#lotus-focus-window-label',
    );
    if (labelSpan && this.isTimerRunning) {
      labelSpan.textContent = `FOCUS${formatted ? ` · ${formatted}` : ''}`;
    }
  }

  // ===========================================================================
  // RENDER PANELS (Minimal, Clutter-Free Layout)
  // ===========================================================================

  private renderAllPanels() {
    // Re-renders rebuild DOM via innerHTML, which would scroll panels back to
    // the top. Capture scroll position before, restore after.
    const prevModalScroll = this.captureModalBodyScroll();
    const prevListScrolls = this.captureHoverListScrolls();
    try {
      this.renderTopBar();
      this.renderCornerStopFocusButton();
      this.renderModeToast();
      this.renderModals();
      this.renderBottomDock();
    } finally {
      this.restoreModalBodyScroll(prevModalScroll);
      this.restoreHoverListScrolls(prevListScrolls);
    }
  }

  private captureModalBodyScroll(): { id: string; top: number } | null {
    const body = this.modalLayerEl.querySelector<HTMLElement>('.lotus-modal-body[data-modal-id]');
    if (!body?.dataset.modalId) return null;
    return { id: body.dataset.modalId, top: body.scrollTop };
  }

  private restoreModalBodyScroll(prev: { id: string; top: number } | null): void {
    if (!prev) return;
    const body = this.modalLayerEl.querySelector<HTMLElement>('.lotus-modal-body[data-modal-id]');
    if (body?.dataset.modalId === prev.id) body.scrollTop = prev.top;
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

  private buildTasksNavWidgetHtml(isFocusCorner = false): string {
    const ongoingTasks = this.tasks.filter((t) => !t.completed);
    const ongoingTasksCount = ongoingTasks.length;
    const hasRunning = ongoingTasks.some((t) => t.timerRunning);
    const btnLabelHtml = this.getTasksNavButtonLabelHtml();
    const focusClock = this.formatClockDisplay();

    const hoverTaskRowsHtml =
      ongoingTasks.length === 0
        ? `<div class="lotus-tasks-hover-empty">No ongoing tasks — click to add one.</div>`
        : ongoingTasks
            .map((task) => {
              const timerStr = this.formatTaskTimer(task);
              const isRunning = Boolean(task.timerRunning);
              return `
                <div class="lotus-hover-task-row">
                  <button
                    type="button"
                    data-hover-tick-task="${task.id}"
                    class="lotus-task-tick-btn lotus-hover-tick-btn"
                    title="Tick to mark completed"
                    aria-label="Mark ${this.escapeHtml(task.title)} completed"
                  >
                    <span class="lotus-task-tick-icon">✓</span>
                  </button>
                  <div class="lotus-hover-task-info" data-hover-open-tasks="true">
                    <div class="lotus-hover-task-title">${this.escapeHtml(task.title)}</div>
                    <div class="lotus-hover-task-sub">
                      <span>${task.type === 'reminder' ? '⏰ Reminder' : 'Task'}</span>
                      ${task.dueLabel ? `<span>· ${this.escapeHtml(task.dueLabel)}</span>` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-hover-toggle-timer="${task.id}"
                    class="lotus-hover-timer-pill ${isRunning ? 'is-running' : ''}"
                    title="${isRunning ? 'Pause task timer' : 'Start task timer'}"
                  >
                    <span>${isRunning ? '⏸' : '▶'}</span>
                    <span class="lotus-tabular" data-task-timer-readout="${task.id}">⏱ ${timerStr}</span>
                  </button>
                </div>
              `;
            })
            .join('');

    return `
      <div class="lotus-tasks-nav-wrapper ${isFocusCorner ? 'is-focus-corner' : ''}">
        <button
          type="button"
          data-nav="tasks"
          data-tasks-nav-btn="true"
          class="lotus-nav-link ${isFocusCorner ? 'lotus-focus-corner-task-btn' : ''} ${this.isTasksOpen ? 'is-active' : ''} ${hasRunning ? 'is-task-timer-running' : ''}"
        >${btnLabelHtml}</button>

        <div class="lotus-tasks-hover-card" role="region" aria-label="Ongoing task with timer">
          <div class="lotus-tasks-hover-header">
            <span>ONGOING TASK (${ongoingTasksCount})</span>
            <span class="lotus-tabular">FOCUS${focusClock ? ` ⏱ ${focusClock}` : ''}</span>
          </div>
          <div class="lotus-tasks-hover-list">
            ${hoverTaskRowsHtml}
          </div>
          <button type="button" data-hover-open-tasks="true" class="lotus-tasks-hover-footer-btn">
            + Add / Manage Tasks &amp; Reminders
          </button>
        </div>
      </div>
    `;
  }

  private bindTasksNavWidgetEvents(rootEl: HTMLElement) {
    rootEl.querySelectorAll('[data-nav="tasks"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.isTasksOpen = !this.isTasksOpen;
        this.isWelcomeOpen = false;
        this.isPinDirectoryOpen = false;
        this.isComposerOpen = false;
        this.inspectedPinId = null;
        this.renderAllPanels();
      });
    });

    rootEl.querySelectorAll('[data-hover-open-tasks]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.isTasksOpen = true;
        this.isWelcomeOpen = false;
        this.isPinDirectoryOpen = false;
        this.isComposerOpen = false;
        this.inspectedPinId = null;
        this.renderAllPanels();
      });
    });

    rootEl.querySelectorAll('[data-hover-tick-task]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = (btn as HTMLElement).dataset.hoverTickTask;
        if (!taskId) return;
        this.tasks = this.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                completed: true,
                timerRunning: false,
                completedAt: Date.now(),
              }
            : t,
        );
        lotusSound.playTaskTick(true);
        this.callbacks.onSaveTasks(this.tasks);
        this.renderAllPanels();
      });
    });

    rootEl.querySelectorAll('[data-hover-toggle-timer]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = (btn as HTMLElement).dataset.hoverToggleTimer;
        if (!taskId) return;
        const targetTask = this.tasks.find((t) => t.id === taskId);
        const willRun = targetTask ? !targetTask.timerRunning : false;
        this.tasks = this.tasks.map((t) => {
          if (t.id === taskId) {
            const rem =
              (t.remainingSeconds ?? t.timerSeconds ?? 25 * 60) <= 0
                ? (t.timerSeconds ?? 25 * 60)
                : (t.remainingSeconds ?? t.timerSeconds ?? 25 * 60);
            return {
              ...t,
              timerRunning: willRun,
              remainingSeconds: rem,
            };
          }
          return willRun ? {...t, timerRunning: false} : t;
        });
        lotusSound.playKeyTap();
        this.callbacks.onSaveTasks(this.tasks);
        this.renderAllPanels();
      });
    });
  }

  private renderCornerStopFocusButton() {
    if (!this.isTimerRunning) {
      this.focusCornerBarEl.style.display = 'none';
      this.focusCornerBarEl.innerHTML = '';
      return;
    }

    this.focusCornerBarEl.style.display = 'flex';
    this.focusCornerBarEl.innerHTML = `
      ${this.buildTasksNavWidgetHtml(true)}
      <button type="button" id="lotus-corner-stop-btn" class="lotus-corner-stop-btn">
        <span>Stop Focus</span>
      </button>
    `;

    this.bindTasksNavWidgetEvents(this.focusCornerBarEl);
    this.focusCornerBarEl
      .querySelector('#lotus-corner-stop-btn')
      ?.addEventListener('click', () => {
        this.stopFocusTimer();
      });
  }

  private renderTopBar() {
    // Hide the main top bar when Focus Timer is running (Focus corner bar shows Task + Stop Focus)
    if (this.isTimerRunning) {
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
        ${this.buildTasksNavWidgetHtml(false)}

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
        this.isWelcomeOpen = !this.isWelcomeOpen;
        this.isTasksOpen = false;
        this.isPinDirectoryOpen = false;
        this.isComposerOpen = false;
        this.inspectedPinId = null;
        this.renderAllPanels();
      });

    this.bindTasksNavWidgetEvents(this.topBarEl);

    this.topBarEl
      .querySelectorAll('[data-nav="pin-list"], [data-nav="welcome"]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const nav = (btn as HTMLElement).dataset.nav;
          if (nav === 'welcome') {
            this.isWelcomeOpen = !this.isWelcomeOpen;
            this.isTasksOpen = false;
            this.isPinDirectoryOpen = false;
            this.isComposerOpen = false;
            this.inspectedPinId = null;
            this.renderAllPanels();
          } else if (nav === 'pin-list') {
            this.isPinDirectoryOpen = !this.isPinDirectoryOpen;
            this.isTasksOpen = false;
            this.isWelcomeOpen = false;
            this.isComposerOpen = false;
            this.inspectedPinId = null;
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
          <span>Moving "${this.escapeHtml(pinTitle)}" — drag to new spot &amp; release to replace</span>
        </div>
      `;
      return;
    }

    if (this.isTimerRunning) {
      this.modeToastEl.innerHTML = '';
      return;
    }

    if (this.currentMode === 'pin-add' && !this.isComposerOpen) {
      const repositioningPin = this.repositioningPinId
        ? this.pins.find((p) => p.id === this.repositioningPinId)
        : null;
      const pendingLabel = repositioningPin
        ? `Tap a new spot in your surroundings to move "${this.escapeHtml(repositioningPin.title)}"`
        : this.pendingPinFromTask
          ? `Tap anywhere in your surroundings to place "${this.escapeHtml(this.pendingPinFromTask.title)}"`
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

    this.modeToastEl.innerHTML = '';
  }

  private renderModals() {
    if (this.isTasksOpen) {
      this.renderTasksModal();
      return;
    }
    if (this.isWelcomeOpen) {
      this.renderWelcomeSetupModal();
      return;
    }
    if (this.isComposerOpen) {
      this.renderNoteComposerModal();
      return;
    }
    if (this.inspectedPinId) {
      const pin = this.pins.find((p) => p.id === this.inspectedPinId);
      if (pin) {
        this.renderPinInspectorModal(pin);
        return;
      }
    }
    if (this.isPinDirectoryOpen) {
      this.renderPinDirectoryModal();
      return;
    }

    this.modalLayerEl.innerHTML = '';
    this.modalLayerEl.style.pointerEvents = 'none';
  }

  private renderWelcomeSetupModal() {
    this.modalLayerEl.style.pointerEvents = 'auto';
    this.modalLayerEl.innerHTML = `
      <div class="lotus-modal-backdrop">
        <section class="lotus-modal-card lotus-welcome-modal" role="dialog" aria-labelledby="welcome-title">
          <div class="lotus-modal-header">
            <div class="lotus-welcome-brand-row">
              <div class="lotus-mono-badge">${MONO_LOTUS_SVG}</div>
              <div>
                <h2 id="welcome-title" class="lotus-modal-title">LOTUS Setup</h2>
                <p class="lotus-modal-subtitle">Configure point style, header pop-ups, focus timer, and peripheral blur.</p>
              </div>
            </div>
            <button type="button" id="welcome-close-btn" class="lotus-icon-close-btn" aria-label="Close">✕</button>
          </div>

          <div class="lotus-modal-body" data-modal-id="welcome">
            <!-- 1. Point Appearance & Header Auto-Pop Switch -->
            <div class="lotus-setup-section">
              <div class="lotus-setup-label-row">
                <h3 class="lotus-setup-heading">01. Spatial Point Style, Color &amp; Header Pop-Up</h3>
              </div>

              <div class="lotus-segmented-grid" style="grid-template-columns: repeat(2, 1fr);">
                <button type="button" data-default-style="revolving" class="lotus-choice-btn ${this.settings.defaultPinStyle === 'revolving' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">◆ Revolving 3D Shape</span>
                  <span class="lotus-choice-desc">Floating geometric crystal that revolves in space</span>
                </button>
                <button type="button" data-default-style="dot" class="lotus-choice-btn ${this.settings.defaultPinStyle === 'dot' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">● Minimalistic Dot (Just a Point)</span>
                  <span class="lotus-choice-desc">Clean, minimal floating sphere point</span>
                </button>
              </div>

              <div class="lotus-proximity-controls-row" style="margin-top: 6px; justify-content: space-between;">
                <div class="lotus-inline-field">
                  <span>Default Color:</span>
                  <div class="lotus-color-swatch-row">
                    ${PIN_COLOR_OPTIONS.map(
                      (c) => `
                      <button
                        type="button"
                        data-default-color="${c.value}"
                        class="lotus-color-swatch ${this.settings.defaultPinColor === c.value ? 'is-selected' : ''}"
                        style="background-color: ${c.value};"
                        aria-label="${c.label}"
                      ></button>
                    `,
                    ).join('')}
                    <input
                      type="color"
                      id="setup-custom-color"
                      value="${this.settings.defaultPinColor || '#E84D2B'}"
                      class="lotus-color-picker-input"
                      title="Pick custom color"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  id="setup-header-pop-toggle"
                  class="lotus-chip-btn ${this.settings.headerPopEnabled ? 'is-active' : ''}"
                >
                  Popping Header UI: ${this.settings.headerPopEnabled ? 'ON' : 'OFF (Point Only)'}
                </button>
              </div>
            </div>

            <!-- 2. Timer Mode -->
            <div class="lotus-setup-section">
              <div class="lotus-setup-label-row">
                <h3 class="lotus-setup-heading">02. Focus Timer Mode</h3>
              </div>
              <div class="lotus-segmented-grid">
                <button type="button" data-timer-mode="preset" class="lotus-choice-btn ${this.settings.timerMode === 'preset' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Preset Durations</span>
                  <span class="lotus-choice-desc">1m, 15m, 25m, 45m, 60m</span>
                </button>
                <button type="button" data-timer-mode="custom" class="lotus-choice-btn ${this.settings.timerMode === 'custom' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Custom Countdown</span>
                  <span class="lotus-choice-desc">Set exact minutes &amp; seconds</span>
                </button>
                <button type="button" data-timer-mode="stopwatch" class="lotus-choice-btn ${this.settings.timerMode === 'stopwatch' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Stopwatch Mode</span>
                  <span class="lotus-choice-desc">Counts up from 00:00</span>
                </button>
              </div>

              <div class="lotus-timer-subconfig">
                ${
                  this.settings.timerMode === 'preset'
                    ? `
                  <div class="lotus-preset-row">
                    ${[1, 15, 25, 45, 60]
                      .map(
                        (m) => `
                      <button type="button" data-preset-min="${m}" class="lotus-chip-btn ${this.settings.presetMinutes === m ? 'is-active' : ''}">
                        ${m === 1 ? '1m' : `${m}m`}
                      </button>
                    `,
                      )
                      .join('')}
                  </div>
                `
                    : this.settings.timerMode === 'custom'
                      ? `
                  <div class="lotus-custom-time-row">
                    <label class="lotus-inline-field">
                      <span>Min:</span>
                      <input type="number" id="custom-min-input" min="0" max="180" value="${this.settings.customMinutes}" class="lotus-num-input" />
                    </label>
                    <label class="lotus-inline-field">
                      <span>Sec:</span>
                      <input type="number" id="custom-sec-input" min="0" max="59" value="${this.settings.customSeconds}" class="lotus-num-input" />
                    </label>
                  </div>
                `
                      : ''
                }
              </div>
            </div>

            <!-- 3. Peripheral Shield Style -->
            <div class="lotus-setup-section">
              <div class="lotus-setup-label-row">
                <h3 class="lotus-setup-heading">03. Peripheral Blur Style</h3>
              </div>
              <div class="lotus-segmented-grid">
                <button type="button" data-shield-style="frosted" class="lotus-choice-btn ${this.settings.shieldStyle === 'frosted' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Frosted Blur</span>
                  <span class="lotus-choice-desc">Translucent optical blur outside focus area</span>
                </button>
                <button type="button" data-shield-style="dark" class="lotus-choice-btn ${this.settings.shieldStyle === 'dark' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Opaque Dark Mask</span>
                  <span class="lotus-choice-desc">Deep dark blackout outside focus area</span>
                </button>
                <button type="button" data-shield-style="ambient" class="lotus-choice-btn ${this.settings.shieldStyle === 'ambient' ? 'is-selected' : ''}">
                  <span class="lotus-choice-title">Soft Ambient Tint</span>
                  <span class="lotus-choice-desc">Warm study tint + soft blur</span>
                </button>
              </div>
            </div>

            <!-- 4. Camera & Proximity Radius -->
            <div class="lotus-setup-section">
              <div class="lotus-setup-label-row">
                <h3 class="lotus-setup-heading">04. Real-World Camera &amp; Proximity Radius</h3>
              </div>
              <div class="lotus-proximity-controls-row">
                <label class="lotus-slider-label">
                  <span>Auto-Pop Radius: <strong class="lotus-tabular" id="prox-radius-readout">${this.settings.proximityDistanceMeters.toFixed(1)}m</strong></span>
                  <input type="range" id="prox-radius-slider" min="0.5" max="4.0" step="0.1" value="${this.settings.proximityDistanceMeters}" />
                </label>

                <label class="lotus-slider-label">
                  <span>Light Duration: <strong class="lotus-tabular" id="ambient-duration-readout">${this.settings.ambientLightDurationSec}s</strong></span>
                  <input type="range" id="ambient-duration-slider" min="2" max="30" step="1" value="${this.settings.ambientLightDurationSec}" />
                </label>

                <label class="lotus-slider-label is-wide">
                  <span>Ambient Border Light</span>
                  <select id="ambient-mode-select" class="lotus-select">
                    <option value="none" ${this.settings.ambientLightMode === 'none' ? 'selected' : ''}>None</option>
                    <option value="timer" ${this.settings.ambientLightMode === 'timer' ? 'selected' : ''}>Timer running</option>
                    <option value="all" ${this.settings.ambientLightMode === 'all' ? 'selected' : ''}>Every pin</option>
                  </select>
                </label>

                <button type="button" id="setup-flip-cam-btn" class="lotus-chip-btn">
                  Flip Camera
                </button>

                <button type="button" id="setup-step-dist-btn" class="lotus-chip-btn ${this.activeWaypointId === 'desk' ? 'is-active' : ''}">
                  Distance: ${this.activeWaypointId === 'desk' ? 'Near (1.2m)' : 'Far (2.7m)'}
                </button>

                <button type="button" id="toggle-room-mesh-btn" class="lotus-chip-btn ${!this.settings.showVirtualRoom ? 'is-active' : ''}">
                  ${!this.settings.showVirtualRoom ? 'Live Camera Mode (Real World)' : '3D Demo Furniture Shown'}
                </button>
              </div>
            </div>
          </div>

          <div class="lotus-modal-footer">
            <button type="button" id="welcome-done-btn" class="lotus-primary-cta">Done</button>
          </div>
        </section>
      </div>
    `;

    const close = () => {
      this.isWelcomeOpen = false;
      this.renderAllPanels();
    };
    this.modalLayerEl
      .querySelector('#welcome-close-btn')
      ?.addEventListener('click', close);
    this.modalLayerEl
      .querySelector('#welcome-done-btn')
      ?.addEventListener('click', close);

    this.modalLayerEl
      .querySelectorAll('[data-default-style]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const style = (btn as HTMLElement).dataset
            .defaultStyle as PinShapeStyle;
          this.settings.defaultPinStyle = style;
          this.callbacks.onApplyStyleToAllPins(style);
          this.callbacks.onSettingsChange(this.settings);
          this.renderAllPanels();
        });
      });

    this.modalLayerEl
      .querySelectorAll('[data-default-color]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const col =
            (btn as HTMLElement).dataset.defaultColor || '#E84D2B';
          this.settings.defaultPinColor = col;
          this.callbacks.onSettingsChange(this.settings);
          this.renderAllPanels();
        });
      });

    const setupColorPicker = this.modalLayerEl.querySelector(
      '#setup-custom-color',
    ) as HTMLInputElement | null;
    setupColorPicker?.addEventListener('input', () => {
      this.settings.defaultPinColor = setupColorPicker.value;
      this.callbacks.onSettingsChange(this.settings);
    });

    this.modalLayerEl
      .querySelector('#setup-header-pop-toggle')
      ?.addEventListener('click', () => {
        this.settings.headerPopEnabled = !this.settings.headerPopEnabled;
        this.callbacks.onSettingsChange(this.settings);
        this.renderAllPanels();
      });

    this.modalLayerEl.querySelectorAll('[data-timer-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.settings.timerMode = (btn as HTMLElement).dataset
          .timerMode as TimerMode;
        this.resetTimerClockFromSettings();
        this.callbacks.onSettingsChange(this.settings);
        this.renderAllPanels();
      });
    });

    this.modalLayerEl.querySelectorAll('[data-preset-min]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.settings.presetMinutes = Number(
          (btn as HTMLElement).dataset.presetMin,
        );
        this.resetTimerClockFromSettings();
        this.callbacks.onSettingsChange(this.settings);
        this.renderAllPanels();
      });
    });

    const customMinInput = this.modalLayerEl.querySelector(
      '#custom-min-input',
    ) as HTMLInputElement | null;
    const customSecInput = this.modalLayerEl.querySelector(
      '#custom-sec-input',
    ) as HTMLInputElement | null;
    const onCustomTimeChange = () => {
      this.settings.customMinutes = Math.max(
        0,
        Math.min(180, Number(customMinInput?.value || 0)),
      );
      this.settings.customSeconds = Math.max(
        0,
        Math.min(59, Number(customSecInput?.value || 0)),
      );
      if (
        this.settings.customMinutes === 0 &&
        this.settings.customSeconds === 0
      ) {
        this.settings.customSeconds = 30;
      }
      this.resetTimerClockFromSettings();
      this.callbacks.onSettingsChange(this.settings);
      this.updateTimerReadoutsOnly();
    };
    customMinInput?.addEventListener('change', onCustomTimeChange);
    customSecInput?.addEventListener('change', onCustomTimeChange);

    this.modalLayerEl.querySelectorAll('[data-shield-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.settings.shieldStyle = (btn as HTMLElement).dataset
          .shieldStyle as ShieldStyle;
        this.callbacks.onSettingsChange(this.settings);
        this.renderAllPanels();
      });
    });

    const radiusSlider = this.modalLayerEl.querySelector(
      '#prox-radius-slider',
    ) as HTMLInputElement | null;
    radiusSlider?.addEventListener('input', () => {
      this.settings.proximityDistanceMeters = Number(radiusSlider.value);
      this.callbacks.onSettingsChange(this.settings);
      // Update the readout in place — re-rendering the panel on 'input' would
      // replace the slider DOM mid-drag and kill the drag gesture.
      const readout = this.modalLayerEl.querySelector('#prox-radius-readout');
      if (readout) {
        readout.textContent = `${this.settings.proximityDistanceMeters.toFixed(1)}m`;
      }
    });
    radiusSlider?.addEventListener('change', () => {
      // Full panel refresh only after the drag fully ends.
      this.renderAllPanels();
    });

    this.modalLayerEl
      .querySelector('#ambient-mode-select')
      ?.addEventListener('change', (e) => {
        this.settings.ambientLightMode = (e.target as HTMLSelectElement)
          .value as AmbientLightMode;
        this.pinAmbientStartedAt.clear();
        this.callbacks.onSettingsChange(this.settings);
      });
    const ambientSlider = this.modalLayerEl.querySelector(
      '#ambient-duration-slider',
    ) as HTMLInputElement | null;
    ambientSlider?.addEventListener('input', () => {
      this.settings.ambientLightDurationSec = Number(ambientSlider.value);
      this.callbacks.onSettingsChange(this.settings);
      const r = this.modalLayerEl.querySelector('#ambient-duration-readout');
      if (r) r.textContent = `${this.settings.ambientLightDurationSec}s`;
    });

    this.modalLayerEl
      .querySelector('#setup-flip-cam-btn')
      ?.addEventListener('click', () => {
        this.callbacks.onFlipCamera();
      });

    this.modalLayerEl
      .querySelector('#setup-step-dist-btn')
      ?.addEventListener('click', () => {
        const nextWp =
          this.activeWaypointId === 'desk'
            ? ROOM_WAYPOINTS.find((w) => w.id === 'doorway')
            : ROOM_WAYPOINTS.find((w) => w.id === 'desk');
        if (nextWp) {
          this.activeWaypointId = nextWp.id;
          this.callbacks.onWalkToWaypoint(nextWp);
          this.renderAllPanels();
        }
      });

    this.modalLayerEl
      .querySelector('#toggle-room-mesh-btn')
      ?.addEventListener('click', () => {
        this.settings.showVirtualRoom = !this.settings.showVirtualRoom;
        this.callbacks.onSettingsChange(this.settings);
        this.renderAllPanels();
      });
  }

  private renderNoteComposerModal() {
    this.modalLayerEl.style.pointerEvents = 'auto';
    const isEditing = Boolean(this.editingPinId);

    this.modalLayerEl.innerHTML = `
      <div class="lotus-modal-backdrop">
        <section class="lotus-modal-card lotus-composer-modal" role="dialog" aria-labelledby="composer-title">
          <div class="lotus-modal-header">
            <div>
              <h2 id="composer-title" class="lotus-modal-title">${isEditing ? 'Edit Memory Point' : 'New Memory Point'}</h2>
              <p class="lotus-modal-subtitle">Choose point shape, color, and speak or type your note.</p>
            </div>
            <button type="button" id="composer-close-btn" class="lotus-icon-close-btn" aria-label="Cancel">✕</button>
          </div>

          <div class="lotus-modal-body" data-modal-id="composer">
            <div class="lotus-composer-top-row">
              <label class="lotus-field-group" style="flex: 1;">
                <span class="lotus-field-label">Location / Object (e.g. Desk, Sofa, Fridge)</span>
                <input
                  type="text"
                  id="pin-surface-input"
                  value="${this.escapeHtml(this.draftSurfaceLabel)}"
                  placeholder="Where is this point?"
                  class="lotus-text-input ${this.activeKeyboardField === 'surface' ? 'is-kb-focused' : ''}"
                />
              </label>

              <div class="lotus-field-group">
                <span class="lotus-field-label">Point Visual</span>
                <div class="lotus-preset-row">
                  <button
                    type="button"
                    data-pin-style="revolving"
                    class="lotus-chip-btn ${this.draftShapeStyle === 'revolving' ? 'is-active' : ''}"
                  >
                    ◆ Revolving Shape
                  </button>
                  <button
                    type="button"
                    data-pin-style="dot"
                    class="lotus-chip-btn ${this.draftShapeStyle === 'dot' ? 'is-active' : ''}"
                  >
                    ● Minimalistic Dot
                  </button>
                </div>
              </div>
            </div>

            <div class="lotus-field-group">
              <span class="lotus-field-label">Point Color</span>
              <div class="lotus-color-swatch-row">
                ${PIN_COLOR_OPTIONS.map(
                  (c) => `
                  <button
                    type="button"
                    data-pin-color="${c.value}"
                    class="lotus-color-swatch ${this.draftColor.toUpperCase() === c.value.toUpperCase() ? 'is-selected' : ''}"
                    style="background-color: ${c.value};"
                    aria-label="${c.label}"
                    title="${c.label}"
                  ></button>
                `,
                ).join('')}
                <input
                  type="color"
                  id="pin-custom-color-input"
                  value="${this.draftColor}"
                  class="lotus-color-picker-input"
                  title="Custom color"
                />
              </div>
            </div>

            <label class="lotus-field-group">
              <div class="lotus-field-header-row">
                <span class="lotus-field-label">Header (Shown within ${this.settings.proximityDistanceMeters.toFixed(1)}m when Headers ON)</span>
                <button type="button" data-voice-field="title" class="lotus-voice-btn ${this.isListeningVoice && this.voiceTargetField === 'title' ? 'is-listening' : ''}">
                  🎤 ${this.isListeningVoice && this.voiceTargetField === 'title' ? 'Stop' : 'Voice'}
                </button>
              </div>
              <input
                type="text"
                id="pin-title-input"
                value="${this.escapeHtml(this.draftTitle)}"
                placeholder="Short header to remember…"
                class="lotus-text-input ${this.activeKeyboardField === 'title' ? 'is-kb-focused' : ''}"
              />
            </label>

            <label class="lotus-field-group">
              <div class="lotus-field-header-row">
                <span class="lotus-field-label">Full Note (Shown when you click the point)</span>
                <button type="button" data-voice-field="body" class="lotus-voice-btn ${this.isListeningVoice && this.voiceTargetField === 'body' ? 'is-listening' : ''}">
                  🎤 ${this.isListeningVoice && this.voiceTargetField === 'body' ? 'Stop' : 'Voice'}
                </button>
              </div>
              <textarea
                id="pin-body-input"
                rows="3"
                placeholder="Full note details…"
                class="lotus-textarea-input ${this.activeKeyboardField === 'body' ? 'is-kb-focused' : ''}"
              >${this.escapeHtml(this.draftBody)}</textarea>
            </label>

            <div class="lotus-input-assist-bar">
              <span class="lotus-voice-status">${this.escapeHtml(this.voiceStatusText)}</span>
              <button type="button" id="toggle-xr-kb-btn" class="lotus-chip-btn ${this.showXrKeyboard ? 'is-active' : ''}">
                ⌨ ${this.showXrKeyboard ? 'Hide XR Keyboard' : 'XR Keyboard'}
              </button>
            </div>

            ${
              this.showXrKeyboard
                ? `
              <div class="lotus-xr-keyboard" aria-label="Virtual XR Keyboard">
                <div class="lotus-xr-kb-target-row">
                  <span class="lotus-xr-kb-label">Target:</span>
                  <button type="button" data-kb-target="title" class="lotus-chip-btn ${this.activeKeyboardField === 'title' ? 'is-active' : ''}">Header</button>
                  <button type="button" data-kb-target="body" class="lotus-chip-btn ${this.activeKeyboardField === 'body' ? 'is-active' : ''}">Full Note</button>
                  <button type="button" data-kb-target="surface" class="lotus-chip-btn ${this.activeKeyboardField === 'surface' ? 'is-active' : ''}">Location</button>
                </div>
                ${QWERTY_ROWS.map(
                  (row) => `
                  <div class="lotus-xr-kb-row">
                    ${row
                      .map((char) => {
                        const outChar = this.xrKeyboardShift
                          ? char.toUpperCase()
                          : char;
                        return `<button type="button" data-kb-key="${outChar}" class="lotus-xr-key">${outChar}</button>`;
                      })
                      .join('')}
                  </div>
                `,
                ).join('')}
                <div class="lotus-xr-kb-row">
                  <button type="button" id="xr-key-shift" class="lotus-xr-key is-wide ${this.xrKeyboardShift ? 'is-active' : ''}">⇧ Shift</button>
                  <button type="button" data-kb-key=" " class="lotus-xr-key is-space">Space</button>
                  <button type="button" id="xr-key-backspace" class="lotus-xr-key is-wide">⌫ Back</button>
                  <button type="button" id="xr-key-clear" class="lotus-xr-key is-wide">Clear</button>
                </div>
              </div>
            `
                : ''
            }
          </div>

          <div class="lotus-modal-footer">
            <button type="button" id="composer-cancel-btn" class="lotus-secondary-btn">Cancel</button>
            <button type="button" id="composer-save-btn" class="lotus-primary-cta">Save Point</button>
          </div>
        </section>
      </div>
    `;

    const surfaceInput = this.modalLayerEl.querySelector(
      '#pin-surface-input',
    ) as HTMLInputElement;
    const titleInput = this.modalLayerEl.querySelector(
      '#pin-title-input',
    ) as HTMLInputElement;
    const bodyInput = this.modalLayerEl.querySelector(
      '#pin-body-input',
    ) as HTMLTextAreaElement;

    surfaceInput?.addEventListener('input', () => {
      this.draftSurfaceLabel = surfaceInput.value;
    });
    titleInput?.addEventListener('input', () => {
      this.draftTitle = titleInput.value;
    });
    bodyInput?.addEventListener('input', () => {
      this.draftBody = bodyInput.value;
    });

    this.modalLayerEl.querySelectorAll('[data-pin-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.draftShapeStyle = (btn as HTMLElement).dataset
          .pinStyle as PinShapeStyle;
        this.renderNoteComposerModal();
      });
    });

    this.modalLayerEl.querySelectorAll('[data-pin-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.draftColor =
          (btn as HTMLElement).dataset.pinColor || '#E84D2B';
        this.renderNoteComposerModal();
      });
    });

    const customColorInput = this.modalLayerEl.querySelector(
      '#pin-custom-color-input',
    ) as HTMLInputElement | null;
    customColorInput?.addEventListener('input', () => {
      this.syncComposerInputsFromDOM();
      this.draftColor = customColorInput.value;
    });

    this.modalLayerEl.querySelectorAll('[data-voice-field]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        const target = (btn as HTMLElement).dataset.voiceField as
          | 'title'
          | 'body';
        this.toggleVoiceDictation(target);
      });
    });

    this.modalLayerEl
      .querySelector('#toggle-xr-kb-btn')
      ?.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.showXrKeyboard = !this.showXrKeyboard;
        this.renderNoteComposerModal();
      });

    this.modalLayerEl.querySelectorAll('[data-kb-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.activeKeyboardField = (btn as HTMLElement).dataset.kbTarget as
          | 'title'
          | 'body'
          | 'surface';
        this.renderNoteComposerModal();
      });
    });

    this.modalLayerEl.querySelectorAll('[data-kb-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        lotusSound.playKeyTap();
        const ch = (btn as HTMLElement).dataset.kbKey || '';
        this.appendTextToActiveField(ch);
        if (this.xrKeyboardShift) this.xrKeyboardShift = false;
        this.renderNoteComposerModal();
      });
    });

    this.modalLayerEl
      .querySelector('#xr-key-shift')
      ?.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.xrKeyboardShift = !this.xrKeyboardShift;
        this.renderNoteComposerModal();
      });

    this.modalLayerEl
      .querySelector('#xr-key-backspace')
      ?.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        if (this.activeKeyboardField === 'title') {
          this.draftTitle = this.draftTitle.slice(0, -1);
        } else if (this.activeKeyboardField === 'body') {
          this.draftBody = this.draftBody.slice(0, -1);
        } else {
          this.draftSurfaceLabel = this.draftSurfaceLabel.slice(0, -1);
        }
        this.renderNoteComposerModal();
      });

    this.modalLayerEl
      .querySelector('#xr-key-clear')
      ?.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        if (this.activeKeyboardField === 'title') {
          this.draftTitle = '';
        } else if (this.activeKeyboardField === 'body') {
          this.draftBody = '';
        } else {
          this.draftSurfaceLabel = '';
        }
        this.renderNoteComposerModal();
      });

    const closeComposer = () => {
      this.stopVoiceDictation();
      this.isComposerOpen = false;
      this.renderAllPanels();
    };
    this.modalLayerEl
      .querySelector('#composer-close-btn')
      ?.addEventListener('click', closeComposer);
    this.modalLayerEl
      .querySelector('#composer-cancel-btn')
      ?.addEventListener('click', closeComposer);

    this.modalLayerEl
      .querySelector('#composer-save-btn')
      ?.addEventListener('click', () => {
        this.syncComposerInputsFromDOM();
        this.stopVoiceDictation();
        const finalTitle =
          this.draftTitle.trim() ||
          `Reminder at ${this.draftSurfaceLabel || 'Room'}`;
        const finalBody =
          this.draftBody.trim() ||
          `Saved note on ${this.draftSurfaceLabel}.`;

        const savedPin: SpatialPin = {
          id: this.editingPinId || `pin-${Date.now()}`,
          title: finalTitle,
          body: finalBody,
          surfaceLabel: this.draftSurfaceLabel.trim() || 'Room Point',
          color: this.draftColor,
          shapeStyle: this.draftShapeStyle,
          position: {...this.draftPosition},
          normal: {...this.draftNormal},
          createdAt: Date.now(),
        };

        this.isComposerOpen = false;
        this.currentMode = 'explore';
        lotusSound.playPinCreated();
        this.callbacks.onSavePin(savedPin);
        this.callbacks.onModeChange('explore');
        this.refreshPinMarkerContent();
        this.renderAllPanels();
      });
  }

  private syncComposerInputsFromDOM() {
    const surfaceInput = this.modalLayerEl.querySelector(
      '#pin-surface-input',
    ) as HTMLInputElement | null;
    const titleInput = this.modalLayerEl.querySelector(
      '#pin-title-input',
    ) as HTMLInputElement | null;
    const bodyInput = this.modalLayerEl.querySelector(
      '#pin-body-input',
    ) as HTMLTextAreaElement | null;

    if (surfaceInput) this.draftSurfaceLabel = surfaceInput.value;
    if (titleInput) this.draftTitle = titleInput.value;
    if (bodyInput) this.draftBody = bodyInput.value;
  }

  private appendTextToActiveField(text: string) {
    if (this.activeKeyboardField === 'title') {
      this.draftTitle += text;
    } else if (this.activeKeyboardField === 'body') {
      this.draftBody += text;
    } else {
      this.draftSurfaceLabel += text;
    }
  }

  private toggleVoiceDictation(targetField: 'title' | 'body') {
    if (this.isListeningVoice) {
      this.stopVoiceDictation();
      this.renderNoteComposerModal();
      return;
    }

    this.voiceTargetField = targetField;
    this.activeKeyboardField = targetField;

    const SpeechRecognitionCtor =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      this.voiceStatusText = 'Voice note captured.';
      if (targetField === 'title') {
        this.draftTitle =
          this.draftTitle || `Check ${this.draftSurfaceLabel}`;
      } else {
        this.draftBody =
          (this.draftBody ? this.draftBody + ' ' : '') +
          `Remember to check ${this.draftSurfaceLabel}.`;
      }
      this.renderNoteComposerModal();
      return;
    }

    try {
      const recognizer = new SpeechRecognitionCtor();
      this.speechRecognizer = recognizer;
      recognizer.lang = 'en-US';
      recognizer.interimResults = false;
      recognizer.maxAlternatives = 1;

      this.isListeningVoice = true;
      this.voiceStatusText = 'Listening… Speak now.';
      this.renderNoteComposerModal();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognizer.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        if (transcript) {
          if (this.voiceTargetField === 'title') {
            this.draftTitle = (this.draftTitle + ' ' + transcript).trim();
          } else {
            this.draftBody = (this.draftBody + ' ' + transcript).trim();
          }
          this.voiceStatusText = `Heard: "${transcript}"`;
        }
      };

      recognizer.onerror = () => {
        this.isListeningVoice = false;
        this.voiceStatusText = 'Mic unavailable — type or use XR Keyboard.';
        if (this.isComposerOpen) this.renderNoteComposerModal();
      };

      recognizer.onend = () => {
        this.isListeningVoice = false;
        if (this.isComposerOpen) this.renderNoteComposerModal();
      };

      recognizer.start();
    } catch {
      this.isListeningVoice = false;
      this.renderNoteComposerModal();
    }
  }

  private stopVoiceDictation() {
    this.isListeningVoice = false;
    this.isListeningInspectorVoice = false;
    if (this.speechRecognizer) {
      try {
        this.speechRecognizer.stop();
      } catch {
        // Ignore
      }
      this.speechRecognizer = null;
    }
  }

  private toggleInspectorVoiceDictation(
    pin: SpatialPin,
    noteTextarea: HTMLTextAreaElement | null,
    micBtn: HTMLButtonElement | null,
  ) {
    if (this.isListeningInspectorVoice) {
      this.stopVoiceDictation();
      micBtn?.classList.remove('is-listening');
      return;
    }

    const SpeechRecognitionCtor =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitSpeechRecognition;

    const applyDictatedNote = (spokenText: string) => {
      const currentVal = noteTextarea ? noteTextarea.value : pin.body;
      const nextBody = currentVal.trim()
        ? `${currentVal.trim()} ${spokenText.trim()}`
        : spokenText.trim();
      if (noteTextarea) {
        noteTextarea.value = nextBody;
      }
      pin.body = nextBody;
      this.pins = this.pins.map((p) => (p.id === pin.id ? {...pin} : p));
      this.callbacks.onSavePin({...pin});
      this.refreshPinMarkerContent();
    };

    if (!SpeechRecognitionCtor) {
      lotusSound.playKeyTap();
      noteTextarea?.focus();
      applyDictatedNote(`Voice note added for ${pin.surfaceLabel}.`);
      return;
    }

    try {
      const recognizer = new SpeechRecognitionCtor();
      this.speechRecognizer = recognizer;
      recognizer.lang = 'en-US';
      recognizer.interimResults = false;
      recognizer.maxAlternatives = 1;

      this.isListeningInspectorVoice = true;
      micBtn?.classList.add('is-listening');
      lotusSound.playKeyTap();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognizer.onresult = (event: any) => {
        const transcript = event.results?.[0]?.[0]?.transcript || '';
        if (transcript) {
          applyDictatedNote(transcript);
        }
      };

      recognizer.onerror = () => {
        this.isListeningInspectorVoice = false;
        micBtn?.classList.remove('is-listening');
      };

      recognizer.onend = () => {
        this.isListeningInspectorVoice = false;
        micBtn?.classList.remove('is-listening');
      };

      recognizer.start();
    } catch {
      this.isListeningInspectorVoice = false;
      micBtn?.classList.remove('is-listening');
    }
  }

  private renderPinInspectorModal(pin: SpatialPin) {
    this.modalLayerEl.style.pointerEvents = 'auto';
    const currentStyle: PinShapeStyle =
      pin.shapeStyle ?? this.settings.defaultPinStyle ?? 'revolving';

    this.modalLayerEl.innerHTML = `
      <div class="lotus-modal-backdrop">
        <section class="lotus-modal-card lotus-inspector-modal" role="dialog" aria-labelledby="inspector-title">
          <div class="lotus-modal-header">
            <div style="flex: 1; min-width: 0;">
              <div class="lotus-inspector-meta">
                <span class="lotus-pin-color-dot" style="background: ${pin.color};"></span>
                <span>${this.escapeHtml(pin.surfaceLabel)}</span>
              </div>
              <input
                type="text"
                id="inspector-inline-title-input"
                class="lotus-inline-title-input"
                value="${this.escapeHtml(pin.title)}"
                aria-label="Pin title"
              />
            </div>
            <button type="button" id="inspector-close-btn" class="lotus-icon-close-btn" aria-label="Close">✕</button>
          </div>

          <div class="lotus-modal-body" data-modal-id="inspector">
            <!-- Directly Editable Note Box + Mic Button -->
            <div class="lotus-full-note-box lotus-editable-note-box">
              <textarea
                id="inspector-inline-note-input"
                class="lotus-inline-note-textarea"
                rows="2"
                aria-label="Note content"
                placeholder="Write or speak your note here…"
              >${this.escapeHtml(pin.body)}</textarea>
              <button
                type="button"
                id="inspector-inline-mic-btn"
                class="lotus-inline-mic-btn ${this.isListeningInspectorVoice ? 'is-listening' : ''}"
                aria-label="Dictate note with microphone"
                title="Voice input (Microphone)"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="8" y1="22" x2="16" y2="22"/>
                </svg>
              </button>
            </div>

            <!-- Instant 1-Tap Color & Point Style Controls -->
            <div class="lotus-setup-section" style="padding-top: 4px; border-bottom: none; padding-bottom: 0;">
              <div class="lotus-proximity-controls-row" style="justify-content: space-between;">
                <div class="lotus-inline-field">
                  <span>Style:</span>
                  <button
                    type="button"
                    data-quick-style="revolving"
                    class="lotus-chip-btn ${currentStyle === 'revolving' ? 'is-active' : ''}"
                  >
                    ◆ Revolving Shape
                  </button>
                  <button
                    type="button"
                    data-quick-style="dot"
                    class="lotus-chip-btn ${currentStyle === 'dot' ? 'is-active' : ''}"
                  >
                    ● Minimalistic Dot
                  </button>
                </div>

                <div class="lotus-inline-field">
                  <span>Color:</span>
                  <div class="lotus-color-swatch-row">
                    ${PIN_COLOR_OPTIONS.map(
                      (c) => `
                      <button
                        type="button"
                        data-quick-color="${c.value}"
                        class="lotus-color-swatch ${pin.color.toUpperCase() === c.value.toUpperCase() ? 'is-selected' : ''}"
                        style="background-color: ${c.value};"
                        aria-label="${c.label}"
                        title="${c.label}"
                      ></button>
                    `,
                    ).join('')}
                    <input
                      type="color"
                      id="inspector-custom-color"
                      value="${pin.color || '#E84D2B'}"
                      class="lotus-color-picker-input"
                      title="Custom color"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="lotus-modal-footer">
            <button type="button" id="inspector-delete-btn" class="lotus-danger-btn">Delete</button>
            <div style="flex: 1;"></div>
            <button type="button" id="inspector-move-pin-btn" class="lotus-secondary-btn" title="Move pin to a new location in your surroundings">✥ Move Pin</button>
            <button type="button" id="inspector-edit-btn" class="lotus-primary-cta">Edit Note</button>
          </div>
        </section>
      </div>
    `;

    const inlineTitleInput = this.modalLayerEl.querySelector(
      '#inspector-inline-title-input',
    ) as HTMLInputElement | null;
    const inlineNoteInput = this.modalLayerEl.querySelector(
      '#inspector-inline-note-input',
    ) as HTMLTextAreaElement | null;
    const inlineMicBtn = this.modalLayerEl.querySelector(
      '#inspector-inline-mic-btn',
    ) as HTMLButtonElement | null;

    const persistInlineEdits = () => {
      const nextTitle =
        inlineTitleInput?.value.trim() ||
        pin.title ||
        `Reminder at ${pin.surfaceLabel}`;
      const nextBody = inlineNoteInput?.value ?? pin.body;
      pin.title = nextTitle;
      pin.body = nextBody;
      this.pins = this.pins.map((p) => (p.id === pin.id ? {...pin} : p));
      this.callbacks.onSavePin({...pin});
      this.refreshPinMarkerContent();
    };

    inlineTitleInput?.addEventListener('input', persistInlineEdits);
    inlineNoteInput?.addEventListener('input', persistInlineEdits);

    inlineMicBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleInspectorVoiceDictation(pin, inlineNoteInput, inlineMicBtn);
    });

    this.modalLayerEl
      .querySelector('#inspector-close-btn')
      ?.addEventListener('click', () => {
        persistInlineEdits();
        this.stopVoiceDictation();
        this.inspectedPinId = null;
        this.renderAllPanels();
      });

    this.modalLayerEl
      .querySelector('#inspector-move-pin-btn')
      ?.addEventListener('click', () => {
        persistInlineEdits();
        this.stopVoiceDictation();
        this.enterPinRepositionMode(pin.id);
      });

    this.modalLayerEl
      .querySelector('#inspector-edit-btn')
      ?.addEventListener('click', () => {
        persistInlineEdits();
        this.stopVoiceDictation();
        this.openComposerForEditPin(pin);
      });

    this.modalLayerEl
      .querySelector('#inspector-delete-btn')
      ?.addEventListener('click', () => {
        this.stopVoiceDictation();
        this.inspectedPinId = null;
        this.callbacks.onDeletePin(pin.id);
        this.refreshPinMarkerContent();
        this.renderAllPanels();
      });

    this.modalLayerEl.querySelectorAll('[data-quick-style]').forEach((btn) => {
      btn.addEventListener('click', () => {
        persistInlineEdits();
        const nextStyle = (btn as HTMLElement).dataset
          .quickStyle as PinShapeStyle;
        const updated: SpatialPin = {...pin, shapeStyle: nextStyle};
        lotusSound.playKeyTap();
        this.callbacks.onSavePin(updated);
        this.renderPinInspectorModal(updated);
      });
    });

    this.modalLayerEl.querySelectorAll('[data-quick-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        persistInlineEdits();
        const nextColor =
          (btn as HTMLElement).dataset.quickColor || '#E84D2B';
        const updated: SpatialPin = {...pin, color: nextColor};
        lotusSound.playKeyTap();
        this.callbacks.onSavePin(updated);
        this.refreshPinMarkerContent();
        this.renderPinInspectorModal(updated);
      });
    });

    const customPicker = this.modalLayerEl.querySelector(
      '#inspector-custom-color',
    ) as HTMLInputElement | null;
    customPicker?.addEventListener('input', () => {
      persistInlineEdits();
      const updated: SpatialPin = {...pin, color: customPicker.value};
      this.callbacks.onSavePin(updated);
      this.refreshPinMarkerContent();
    });
  }

  private getPinDistanceMeters(pin: SpatialPin): number {
    const cached = this.pinDistances.get(pin.id);
    if (cached !== undefined && Number.isFinite(cached)) {
      return cached;
    }
    return Math.hypot(
      pin.position.x - this.userPosition.x,
      pin.position.y - this.userPosition.y,
      pin.position.z - this.userPosition.z,
    );
  }

  private formatPinCreatedDate(createdAt: number): string {
    if (!createdAt) return 'Saved';
    const diffSec = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const date = new Date(createdAt);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  private renderTasksModal() {
    this.modalLayerEl.style.pointerEvents = 'auto';

    const ongoingTasks = this.tasks.filter((t) => !t.completed);
    const completedTasks = this.tasks.filter((t) => t.completed);

    const renderTaskRow = (task: LotusTask) => {
      const isDone = task.completed;
      const typeBadgeLabel = task.type === 'reminder' ? '⏰ REMINDER' : '✓ TASK';
      const createdAgo = this.formatPinCreatedDate(task.createdAt);
      const timerStr = this.formatTaskTimer(task);
      const isRunning = Boolean(task.timerRunning);

      return `
        <div class="lotus-task-item ${isDone ? 'is-completed' : 'is-ongoing'}">
          <button
            type="button"
            data-tick-task="${task.id}"
            class="lotus-task-tick-btn ${isDone ? 'is-checked' : ''}"
            aria-label="${isDone ? 'Mark as ongoing' : 'Tick to mark completed'}: ${this.escapeHtml(task.title)}"
            title="${isDone ? 'Click to move back to Ongoing' : 'Click to mark as Completed'}"
          >
            <span class="lotus-task-tick-icon">✓</span>
          </button>

          <div class="lotus-task-content" data-tick-task="${task.id}">
            <div class="lotus-task-meta-row">
              <span class="lotus-task-type-badge ${task.type === 'reminder' ? 'is-reminder' : 'is-task'}">${typeBadgeLabel}</span>
              ${
                task.dueLabel
                  ? `<span class="lotus-task-due-badge">${this.escapeHtml(task.dueLabel)}</span>`
                  : ''
              }
              <span class="lotus-task-time-label">${this.escapeHtml(createdAgo)}</span>
            </div>
            <div class="lotus-task-title">${this.escapeHtml(task.title)}</div>
            ${
              task.note
                ? `<div class="lotus-task-note">${this.escapeHtml(task.note)}</div>`
                : ''
            }
          </div>

          <div class="lotus-task-actions">
            ${
              !isDone
                ? `
              <button
                type="button"
                data-toggle-task-timer="${task.id}"
                class="lotus-hover-timer-pill ${isRunning ? 'is-running' : ''}"
                title="${isRunning ? 'Pause task timer' : 'Start task timer'}"
              >
                <span>${isRunning ? '⏸' : '▶'}</span>
                <span class="lotus-tabular" data-task-timer-readout="${task.id}">⏱ ${timerStr}</span>
              </button>
            `
                : ''
            }
            <button
              type="button"
              data-pin-from-task="${task.id}"
              class="lotus-chip-btn"
              title="Tap surroundings to place this task as a 3D Spatial Pin"
            >
              + 3D Pin
            </button>
            <button
              type="button"
              data-delete-task="${task.id}"
              class="lotus-task-delete-btn"
              aria-label="Delete ${this.escapeHtml(task.title)}"
              title="Delete"
            >
              ✕
            </button>
          </div>
        </div>
      `;
    };

    const showOngoingSection =
      this.taskFilterTab === 'all' || this.taskFilterTab === 'ongoing';
    const showCompletedSection =
      this.taskFilterTab === 'all' || this.taskFilterTab === 'completed';
    const showInsightsSection = this.taskFilterTab === 'insights';

    const last7DaysData = this.getLast7DaysCompletedStats();
    const total7DayCompleted = last7DaysData.reduce(
      (acc, d) => acc + d.count,
      0,
    );
    const avgDailyCompleted = (total7DayCompleted / 7).toFixed(1);
    const completionRate =
      this.tasks.length > 0
        ? Math.round((completedTasks.length / this.tasks.length) * 100)
        : 0;
    const peakDayObj = last7DaysData.reduce(
      (best, cur) => (cur.count >= best.count ? cur : best),
      last7DaysData[0],
    );

    this.modalLayerEl.innerHTML = `
      <div class="lotus-modal-backdrop">
        <section class="lotus-modal-card lotus-tasks-modal" role="dialog" aria-labelledby="tasks-modal-title">
          <div class="lotus-modal-header">
            <div>
              <h2 id="tasks-modal-title" class="lotus-modal-title">Tasks &amp; Reminders</h2>
              <p class="lotus-modal-subtitle">Add new tasks or reminders with timers, and use tick buttons to separate ongoing from completed items.</p>
            </div>
            <button type="button" id="tasks-close-btn" class="lotus-icon-close-btn" aria-label="Close">✕</button>
          </div>

          <div class="lotus-modal-body" data-modal-id="tasks">
            <!-- Add New Task / Reminder Form -->
            <div class="lotus-task-composer-box">
              <div class="lotus-task-composer-top">
                <div class="lotus-task-type-toggle" role="group" aria-label="Entry type">
                  <button
                    type="button"
                    data-new-task-type="task"
                    class="lotus-chip-btn ${this.draftTaskType === 'task' ? 'is-active' : ''}"
                  >
                    ✓ Task
                  </button>
                  <button
                    type="button"
                    data-new-task-type="reminder"
                    class="lotus-chip-btn ${this.draftTaskType === 'reminder' ? 'is-active' : ''}"
                  >
                    ⏰ Reminder
                  </button>
                </div>

                <div class="lotus-task-due-presets">
                  <span class="lotus-field-label" style="font-size: 0.66rem;">Timer:</span>
                  ${[15, 25, 45, 60]
                    .map(
                      (min) => `
                    <button
                      type="button"
                      data-timer-preset="${min}"
                      class="lotus-due-preset-chip ${this.draftTaskTimerMin === min ? 'is-selected' : ''}"
                    >
                      ⏱ ${min}m
                    </button>
                  `,
                    )
                    .join('')}
                </div>
              </div>

              <div class="lotus-task-input-row">
                <input
                  type="text"
                  id="new-task-title-input"
                  value="${this.escapeHtml(this.draftTaskTitle)}"
                  placeholder="${this.draftTaskType === 'reminder' ? 'Add a new reminder (e.g. Call study group at 4pm)…' : 'Add a new task (e.g. Finish problem set #5)…'}"
                  class="lotus-text-input"
                />
                <button type="button" id="add-task-submit-btn" class="lotus-primary-cta">
                  + Add ${this.draftTaskType === 'reminder' ? 'Reminder' : 'Task'}
                </button>
              </div>

              <div class="lotus-task-Optional-row">
                <input
                  type="text"
                  id="new-task-due-input"
                  value="${this.escapeHtml(this.draftTaskDueLabel)}"
                  placeholder="Reminder time / due label (optional, e.g. Today 5:00 PM)"
                  class="lotus-text-input lotus-input-compact"
                />
                <input
                  type="text"
                  id="new-task-note-input"
                  value="${this.escapeHtml(this.draftTaskNote)}"
                  placeholder="Additional note or details (optional)"
                  class="lotus-text-input lotus-input-compact"
                />
              </div>
            </div>

            <!-- Filter Bar to view All (Separated), Ongoing, Completed, or Insights -->
            <div class="lotus-dir-sort-bar" role="group" aria-label="Filter tasks">
              <div class="lotus-dir-sort-options">
                <button
                  type="button"
                  data-task-filter="all"
                  class="lotus-chip-btn ${this.taskFilterTab === 'all' ? 'is-active' : ''}"
                >
                  All Separated (${this.tasks.length})
                </button>
                <button
                  type="button"
                  data-task-filter="ongoing"
                  class="lotus-chip-btn ${this.taskFilterTab === 'ongoing' ? 'is-active' : ''}"
                >
                  Ongoing (${ongoingTasks.length})
                </button>
                <button
                  type="button"
                  data-task-filter="completed"
                  class="lotus-chip-btn ${this.taskFilterTab === 'completed' ? 'is-active' : ''}"
                >
                  Completed (${completedTasks.length})
                </button>
                <button
                  type="button"
                  data-task-filter="insights"
                  class="lotus-chip-btn ${this.taskFilterTab === 'insights' ? 'is-active' : ''}"
                >
                  📊 Insights
                </button>
              </div>

              ${
                completedTasks.length > 0 && !showInsightsSection
                  ? `<button type="button" id="clear-completed-tasks-btn" class="lotus-danger-btn" style="padding: 5px 10px; font-size: 0.68rem;">Clear Completed (${completedTasks.length})</button>`
                  : ''
              }
            </div>

            <!-- D3 7-Day Completed Tasks Insights Section -->
            ${
              showInsightsSection
                ? `
              <div class="lotus-task-insights-section">
                <div class="lotus-task-section-header">
                  <span class="lotus-task-section-title">COMPLETED TASKS · LAST 7 DAYS (D3 VISUALIZATION)</span>
                  <span class="lotus-task-count-pill is-done">${total7DayCompleted} COMPLETED (7D)</span>
                </div>

                <div class="lotus-insights-kpi-grid">
                  <div class="lotus-insights-kpi-card">
                    <span class="lotus-insights-kpi-label">7-DAY COMPLETED</span>
                    <span class="lotus-insights-kpi-value lotus-tabular">${total7DayCompleted}</span>
                  </div>
                  <div class="lotus-insights-kpi-card">
                    <span class="lotus-insights-kpi-label">DAILY AVERAGE</span>
                    <span class="lotus-insights-kpi-value lotus-tabular">${avgDailyCompleted}/day</span>
                  </div>
                  <div class="lotus-insights-kpi-card">
                    <span class="lotus-insights-kpi-label">COMPLETION RATE</span>
                    <span class="lotus-insights-kpi-value lotus-tabular">${completionRate}%</span>
                  </div>
                  <div class="lotus-insights-kpi-card">
                    <span class="lotus-insights-kpi-label">PEAK DAY</span>
                    <span class="lotus-insights-kpi-value lotus-tabular">${this.escapeHtml(peakDayObj.dayShort)} (${peakDayObj.count})</span>
                  </div>
                </div>

                <div class="lotus-d3-chart-card">
                  <div id="lotus-d3-insights-chart" class="lotus-d3-insights-chart" aria-label="D3 bar chart of completed tasks over the last 7 days"></div>
                  <div id="lotus-d3-tooltip" class="lotus-d3-tooltip" style="display: none;"></div>
                </div>
              </div>
            `
                : ''
            }

            <!-- Separated Ongoing Tasks & Reminders Section -->
            ${
              showOngoingSection
                ? `
              <div class="lotus-task-section">
                <div class="lotus-task-section-header">
                  <span class="lotus-task-section-title">ONGOING TASKS &amp; REMINDERS</span>
                  <span class="lotus-task-count-pill">${ongoingTasks.length} ONGOING</span>
                </div>
                ${
                  ongoingTasks.length === 0
                    ? `<div class="lotus-empty-state">All caught up! Add a new task or reminder above.</div>`
                    : `<div class="lotus-task-list">${ongoingTasks.map(renderTaskRow).join('')}</div>`
                }
              </div>
            `
                : ''
            }

            <!-- Separated Completed Tasks & Reminders Section -->
            ${
              showCompletedSection
                ? `
              <div class="lotus-task-section is-completed-section">
                <div class="lotus-task-section-header">
                  <span class="lotus-task-section-title">COMPLETED TASKS &amp; REMINDERS</span>
                  <span class="lotus-task-count-pill is-done">${completedTasks.length} COMPLETED</span>
                </div>
                ${
                  completedTasks.length === 0
                    ? `<div class="lotus-empty-state">No completed tasks yet. Click the tick button (✓) next to any ongoing task to mark it complete.</div>`
                    : `<div class="lotus-task-list">${completedTasks.map(renderTaskRow).join('')}</div>`
                }
              </div>
            `
                : ''
            }
          </div>

          <div class="lotus-modal-footer">
            <span class="lotus-tabular" style="font-size: 0.76rem; color: var(--ink-muted);">
              ${ongoingTasks.length} ongoing · ${completedTasks.length} completed
            </span>
            <div style="flex: 1;"></div>
            <button type="button" id="tasks-done-btn" class="lotus-primary-cta">Done</button>
          </div>
        </section>
      </div>
    `;

    if (showInsightsSection) {
      this.renderD3TaskInsightsChart(last7DaysData);
    }

    const titleInput = this.modalLayerEl.querySelector(
      '#new-task-title-input',
    ) as HTMLInputElement | null;
    const dueInput = this.modalLayerEl.querySelector(
      '#new-task-due-input',
    ) as HTMLInputElement | null;
    const noteInput = this.modalLayerEl.querySelector(
      '#new-task-note-input',
    ) as HTMLInputElement | null;

    const syncDraftTaskFields = () => {
      if (titleInput) this.draftTaskTitle = titleInput.value;
      if (dueInput) this.draftTaskDueLabel = dueInput.value;
      if (noteInput) this.draftTaskNote = noteInput.value;
    };

    titleInput?.addEventListener('input', syncDraftTaskFields);
    dueInput?.addEventListener('input', syncDraftTaskFields);
    noteInput?.addEventListener('input', syncDraftTaskFields);

    const handleAddTask = () => {
      syncDraftTaskFields();
      const trimmedTitle = this.draftTaskTitle.trim();
      if (!trimmedTitle) {
        titleInput?.focus();
        return;
      }

      const durationSec = Math.max(1, this.draftTaskTimerMin) * 60;
      const newTask: LotusTask = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: trimmedTitle,
        note: this.draftTaskNote.trim(),
        dueLabel:
          this.draftTaskDueLabel.trim() ||
          (this.draftTaskType === 'reminder' ? 'Reminder' : ''),
        type: this.draftTaskType,
        timerSeconds: durationSec,
        remainingSeconds: durationSec,
        timerRunning: false,
        completed: false,
        createdAt: Date.now(),
      };

      this.tasks = [newTask, ...this.tasks];
      this.draftTaskTitle = '';
      this.draftTaskNote = '';
      this.draftTaskDueLabel = '';
      lotusSound.playPinCreated();
      this.callbacks.onSaveTasks(this.tasks);
      this.renderAllPanels();
    };

    this.modalLayerEl
      .querySelector('#add-task-submit-btn')
      ?.addEventListener('click', handleAddTask);

    titleInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTask();
      }
    });
    dueInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTask();
      }
    });
    noteInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTask();
      }
    });

    this.modalLayerEl
      .querySelectorAll('[data-new-task-type]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          syncDraftTaskFields();
          this.draftTaskType = (btn as HTMLElement).dataset
            .newTaskType as TaskItemType;
          lotusSound.playKeyTap();
          this.renderTasksModal();
        });
      });

    this.modalLayerEl.querySelectorAll('[data-timer-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncDraftTaskFields();
        this.draftTaskTimerMin = Number(
          (btn as HTMLElement).dataset.timerPreset || 25,
        );
        lotusSound.playKeyTap();
        this.renderTasksModal();
      });
    });

    this.modalLayerEl.querySelectorAll('[data-task-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncDraftTaskFields();
        this.taskFilterTab = (btn as HTMLElement).dataset
          .taskFilter as TaskFilterTab;
        lotusSound.playKeyTap();
        this.renderTasksModal();
      });
    });

    this.modalLayerEl
      .querySelectorAll('[data-toggle-task-timer]')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          syncDraftTaskFields();
          const taskId = (btn as HTMLElement).dataset.toggleTaskTimer;
          if (!taskId) return;
          const targetTask = this.tasks.find((t) => t.id === taskId);
          const willRun = targetTask ? !targetTask.timerRunning : false;
          this.tasks = this.tasks.map((t) => {
            if (t.id === taskId) {
              const rem =
                (t.remainingSeconds ?? t.timerSeconds ?? 25 * 60) <= 0
                  ? (t.timerSeconds ?? 25 * 60)
                  : (t.remainingSeconds ?? t.timerSeconds ?? 25 * 60);
              return {
                ...t,
                timerRunning: willRun,
                remainingSeconds: rem,
              };
            }
            return willRun ? {...t, timerRunning: false} : t;
          });
          lotusSound.playKeyTap();
          this.callbacks.onSaveTasks(this.tasks);
          this.renderAllPanels();
        });
      });

    this.modalLayerEl.querySelectorAll('[data-tick-task]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        syncDraftTaskFields();
        const taskId = (el as HTMLElement).dataset.tickTask;
        if (!taskId) return;
        let nextCompletedState = false;
        this.tasks = this.tasks.map((t) => {
          if (t.id === taskId) {
            nextCompletedState = !t.completed;
            return {
              ...t,
              completed: nextCompletedState,
              timerRunning: false,
              completedAt: nextCompletedState ? Date.now() : undefined,
            };
          }
          return t;
        });
        lotusSound.playTaskTick(nextCompletedState);
        this.callbacks.onSaveTasks(this.tasks);
        this.renderAllPanels();
      });
    });

    this.modalLayerEl.querySelectorAll('[data-delete-task]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        syncDraftTaskFields();
        const taskId = (btn as HTMLElement).dataset.deleteTask;
        if (!taskId) return;
        this.tasks = this.tasks.filter((t) => t.id !== taskId);
        lotusSound.playKeyTap();
        this.callbacks.onSaveTasks(this.tasks);
        this.renderAllPanels();
      });
    });

    this.modalLayerEl
      .querySelectorAll('[data-pin-from-task]')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const taskId = (btn as HTMLElement).dataset.pinFromTask;
          const task = this.tasks.find((t) => t.id === taskId);
          if (!task) return;
          // Show surroundings first so user taps where to place the pin, then open Save UI!
          this.enterPinAddMode({
            title: task.title,
            body:
              [task.dueLabel ? `Due: ${task.dueLabel}` : '', task.note]
                .filter(Boolean)
                .join(' — ') || task.title,
            surfaceLabel:
              task.type === 'reminder' ? 'Reminder Pin' : 'Task Pin',
          });
        });
      });

    this.modalLayerEl
      .querySelector('#clear-completed-tasks-btn')
      ?.addEventListener('click', () => {
        syncDraftTaskFields();
        this.tasks = this.tasks.filter((t) => !t.completed);
        lotusSound.playKeyTap();
        this.callbacks.onSaveTasks(this.tasks);
        this.renderAllPanels();
      });

    const closeTasks = () => {
      syncDraftTaskFields();
      this.isTasksOpen = false;
      this.renderAllPanels();
    };
    this.modalLayerEl
      .querySelector('#tasks-close-btn')
      ?.addEventListener('click', closeTasks);
    this.modalLayerEl
      .querySelector('#tasks-done-btn')
      ?.addEventListener('click', closeTasks);
  }

  private getLast7DaysCompletedStats(): Array<{
    dateKey: string;
    dayShort: string;
    dateLabel: string;
    isToday: boolean;
    count: number;
    titles: string[];
  }> {
    const now = new Date();
    const days: Array<{
      dateKey: string;
      dayShort: string;
      dateLabel: string;
      isToday: boolean;
      count: number;
      titles: string[];
    }> = [];

    const toLocalKey = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    for (let i = 6; i >= 0; i--) {
      const d = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - i,
      );
      const key = toLocalKey(d);
      const dayShort =
        i === 0
          ? 'Today'
          : d.toLocaleDateString(undefined, {weekday: 'short'});
      const dateLabel = d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      days.push({
        dateKey: key,
        dayShort,
        dateLabel,
        isToday: i === 0,
        count: 0,
        titles: [],
      });
    }

    const bucketMap = new Map(days.map((item) => [item.dateKey, item]));

    for (const task of this.tasks) {
      if (!task.completed) continue;
      const ts = task.completedAt || task.createdAt;
      if (!ts) continue;
      const key = toLocalKey(new Date(ts));
      const bucket = bucketMap.get(key);
      if (bucket) {
        bucket.count += 1;
        bucket.titles.push(task.title);
      }
    }

    return days;
  }

  private renderD3TaskInsightsChart(
    data: Array<{
      dateKey: string;
      dayShort: string;
      dateLabel: string;
      isToday: boolean;
      count: number;
      titles: string[];
    }>,
  ) {
    const chartContainer = this.modalLayerEl.querySelector(
      '#lotus-d3-insights-chart',
    ) as HTMLElement | null;
    const tooltipEl = this.modalLayerEl.querySelector(
      '#lotus-d3-tooltip',
    ) as HTMLElement | null;

    if (!chartContainer) return;
    chartContainer.innerHTML = '';

    const width = 600;
    const height = 240;
    const margin = {top: 28, right: 24, bottom: 42, left: 40};
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const maxCount = Math.max(4, d3.max(data, (d) => d.count) ?? 4);

    const svg = d3
      .select(chartContainer)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('class', 'lotus-d3-svg');

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleBand<string>()
      .domain(data.map((d) => d.dayShort))
      .range([0, innerWidth])
      .padding(0.34);

    const y = d3
      .scaleLinear()
      .domain([0, maxCount])
      .nice()
      .range([innerHeight, 0]);

    // Horizontal dashed gridlines
    const yTicks = y.ticks(Math.min(6, maxCount));
    g.append('g')
      .attr('class', 'lotus-d3-grid')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
      .attr('stroke', '#1B1B19')
      .attr('stroke-opacity', 0.16)
      .attr('stroke-dasharray', '3,3');

    // Y Axis
    const yAxis = d3
      .axisLeft(y)
      .ticks(Math.min(6, maxCount))
      .tickFormat((d) => `${Math.round(Number(d))}`);

    g.append('g')
      .attr('class', 'lotus-d3-axis lotus-d3-y-axis')
      .call(yAxis)
      .call((axisG) => {
        axisG.select('.domain').attr('stroke', '#1B1B19').attr('stroke-width', 2);
        axisG.selectAll('.tick line').attr('stroke', '#1B1B19');
        axisG
          .selectAll('.tick text')
          .attr('fill', '#1B1B19')
          .attr('font-family', 'JetBrains Mono, monospace')
          .attr('font-size', '11px')
          .attr('font-weight', '700');
      });

    // X Axis
    const xAxis = d3.axisBottom(x).tickSizeOuter(0);
    g.append('g')
      .attr('class', 'lotus-d3-axis lotus-d3-x-axis')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(xAxis)
      .call((axisG) => {
        axisG.select('.domain').attr('stroke', '#1B1B19').attr('stroke-width', 2);
        axisG.selectAll('.tick line').attr('stroke', '#1B1B19');
        axisG
          .selectAll('.tick text')
          .attr('fill', '#1B1B19')
          .attr('font-family', 'JetBrains Mono, monospace')
          .attr('font-size', '11px')
          .attr('font-weight', '700')
          .attr('dy', '1.15em');
      });

    // Hard-ink shadow bars behind main bars
    g.selectAll('.lotus-d3-bar-shadow')
      .data(data)
      .join('rect')
      .attr('class', 'lotus-d3-bar-shadow')
      .attr('x', (d) => (x(d.dayShort) ?? 0) + 3)
      .attr('y', (d) => (d.count > 0 ? y(d.count) + 3 : innerHeight))
      .attr('width', x.bandwidth())
      .attr('height', (d) =>
        d.count > 0 ? Math.max(0, innerHeight - y(d.count)) : 0,
      )
      .attr('fill', '#1B1B19');

    // Interactive main bars
    const bars = g
      .selectAll('.lotus-d3-bar')
      .data(data)
      .join('rect')
      .attr('class', 'lotus-d3-bar')
      .attr('x', (d) => x(d.dayShort) ?? 0)
      .attr('y', innerHeight)
      .attr('width', x.bandwidth())
      .attr('height', 0)
      .attr('fill', (d) => (d.isToday ? '#E84D2B' : '#10B981'))
      .attr('stroke', '#1B1B19')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer');

    bars
      .transition()
      .duration(420)
      .ease(d3.easeCubicOut)
      .attr('y', (d) => y(d.count))
      .attr('height', (d) => Math.max(0, innerHeight - y(d.count)));

    // Smooth D3 trend line connecting daily counts
    const lineGen = d3
      .line<(typeof data)[0]>()
      .x((d) => (x(d.dayShort) ?? 0) + x.bandwidth() / 2)
      .y((d) => y(d.count))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#1B1B19')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,3')
      .attr('d', lineGen);

    // Trend points
    g.selectAll('.lotus-d3-dot')
      .data(data)
      .join('circle')
      .attr('class', 'lotus-d3-dot')
      .attr('cx', (d) => (x(d.dayShort) ?? 0) + x.bandwidth() / 2)
      .attr('cy', (d) => y(d.count))
      .attr('r', 4)
      .attr('fill', (d) => (d.isToday ? '#E84D2B' : '#F8F7F4'))
      .attr('stroke', '#1B1B19')
      .attr('stroke-width', 2);

    // Count labels above each bar
    g.selectAll('.lotus-d3-bar-label')
      .data(data)
      .join('text')
      .attr('class', 'lotus-d3-bar-label')
      .attr('x', (d) => (x(d.dayShort) ?? 0) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.count) - 8)
      .attr('text-anchor', 'middle')
      .attr('fill', '#1B1B19')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .text((d) => `${d.count}`);

    // Hover interactions for bars
    bars
      .on('pointerenter', (event, d) => {
        if (!tooltipEl) return;
        const titlesList =
          d.titles.length > 0
            ? d.titles
                .slice(0, 3)
                .map((t) => `• ${this.escapeHtml(t)}`)
                .join('<br/>')
            : 'No completed tasks on this day';
        tooltipEl.innerHTML = `
          <div class="lotus-d3-tooltip-head">${this.escapeHtml(d.dateLabel)} · <strong>${d.count} completed</strong></div>
          <div class="lotus-d3-tooltip-body">${titlesList}</div>
        `;
        tooltipEl.style.display = 'block';
        // Absolute positioning inside the chart card: anchor next to the pointer.
        const card = chartContainer.parentElement;
        if (card && event instanceof PointerEvent) {
          const rect = card.getBoundingClientRect();
          const left = Math.max(
            6,
            Math.min(event.clientX - rect.left + 14, rect.width - 250),
          );
          const top = Math.max(6, event.clientY - rect.top + 14);
          tooltipEl.style.left = `${left}px`;
          tooltipEl.style.top = `${top}px`;
        }
      })
      .on('pointerleave', () => {
        if (tooltipEl) {
          tooltipEl.style.display = 'none';
        }
      });
  }

  private renderPinDirectoryModal() {
    this.modalLayerEl.style.pointerEvents = 'auto';

    const sortedPins = [...this.pins].sort((a, b) => {
      if (this.pinSortBy === 'proximity') {
        return this.getPinDistanceMeters(a) - this.getPinDistanceMeters(b);
      }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    const ongoingPins = sortedPins.filter((p) => !p.completed);
    const completedPins = sortedPins.filter((p) => p.completed);

    const renderPinItem = (pin: SpatialPin) => {
      const distMeters = this.getPinDistanceMeters(pin);
      const createdLabel = this.formatPinCreatedDate(pin.createdAt);
      const isDone = Boolean(pin.completed);
      return `
        <div class="lotus-dir-item ${isDone ? 'is-completed' : ''}">
          <button
            type="button"
            data-tick-pin="${pin.id}"
            class="lotus-task-tick-btn ${isDone ? 'is-checked' : ''}"
            aria-label="${isDone ? 'Mark pin as ongoing' : 'Mark pin as completed'}"
            title="${isDone ? 'Completed — click to mark ongoing' : 'Tick to mark completed'}"
          >
            <span class="lotus-task-tick-icon">✓</span>
          </button>
          <div class="lotus-dir-item-main" data-open-pin="${pin.id}">
            <div class="lotus-dir-item-meta">
              <span class="lotus-pin-color-dot" style="background: ${pin.color};"></span>
              <span>${this.escapeHtml(pin.surfaceLabel)}</span>
              <span>·</span>
              <span class="lotus-tabular" style="color: var(--accent);">${distMeters.toFixed(1)}m</span>
              <span>·</span>
              <span>${this.escapeHtml(createdLabel)}</span>
              <span>·</span>
              <span>${(pin.shapeStyle ?? this.settings.defaultPinStyle) === 'dot' ? '● Dot' : '◆ Revolving Shape'}</span>
            </div>
            <div class="lotus-dir-item-title ${isDone ? 'is-line-through' : ''}">${this.escapeHtml(pin.title)}</div>
            <div class="lotus-dir-item-preview">${this.escapeHtml(pin.body)}</div>
          </div>
          <div class="lotus-dir-item-actions">
            <button type="button" data-open-pin="${pin.id}" class="lotus-chip-btn is-active">Open</button>
          </div>
        </div>
      `;
    };

    this.modalLayerEl.innerHTML = `
      <div class="lotus-modal-backdrop">
        <section class="lotus-modal-card lotus-directory-modal" role="dialog" aria-labelledby="dir-title">
          <div class="lotus-modal-header">
            <div>
              <h2 id="dir-title" class="lotus-modal-title">Saved Memory Points (${this.pins.length})</h2>
              <p class="lotus-modal-subtitle">Order spatial pins by proximity or date, and tick off completed reminders.</p>
            </div>
            <button type="button" id="dir-close-btn" class="lotus-icon-close-btn" aria-label="Close">✕</button>
          </div>

          <div class="lotus-modal-body" data-modal-id="directory">
            <div class="lotus-dir-sort-bar" role="group" aria-label="Sort saved pins">
              <span class="lotus-dir-sort-label">Sort by:</span>
              <div class="lotus-dir-sort-options">
                <button
                  type="button"
                  data-sort-pins="proximity"
                  class="lotus-chip-btn ${this.pinSortBy === 'proximity' ? 'is-active' : ''}"
                >
                  ◎ Proximity
                </button>
                <button
                  type="button"
                  data-sort-pins="date"
                  class="lotus-chip-btn ${this.pinSortBy === 'date' ? 'is-active' : ''}"
                >
                  ◷ Creation Date
                </button>
              </div>
            </div>

            ${
              sortedPins.length === 0
                ? `<div class="lotus-empty-state">No points yet. Tap "+ ADD PIN" and tap anywhere on your camera feed.</div>`
                : `
              <div class="lotus-task-section">
                <div class="lotus-task-section-header">
                  <span class="lotus-task-section-title">ONGOING PINS</span>
                  <span class="lotus-task-count-pill">${ongoingPins.length} ONGOING</span>
                </div>
                ${
                  ongoingPins.length === 0
                    ? `<div class="lotus-empty-state">All spatial pins are marked completed!</div>`
                    : `<div class="lotus-pin-directory-list">${ongoingPins.map(renderPinItem).join('')}</div>`
                }
              </div>

              ${
                completedPins.length > 0
                  ? `
                <div class="lotus-task-section is-completed-section">
                  <div class="lotus-task-section-header">
                    <span class="lotus-task-section-title">COMPLETED PINS</span>
                    <span class="lotus-task-count-pill is-done">${completedPins.length} COMPLETED</span>
                  </div>
                  <div class="lotus-pin-directory-list">${completedPins.map(renderPinItem).join('')}</div>
                </div>
              `
                  : ''
              }
            `
            }
          </div>

          <div class="lotus-modal-footer">
            ${
              this.pins.length > 0
                ? `<button type="button" id="dir-clear-all-btn" class="lotus-danger-btn">Clear All</button>`
                : ''
            }
            <div style="flex: 1;"></div>
            <button type="button" id="dir-add-pin-btn" class="lotus-primary-cta">+ Add New Point</button>
          </div>
        </section>
      </div>
    `;

    this.modalLayerEl
      .querySelector('#dir-close-btn')
      ?.addEventListener('click', () => {
        this.isPinDirectoryOpen = false;
        this.renderAllPanels();
      });

    this.modalLayerEl.querySelectorAll('[data-sort-pins]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sortMode = (btn as HTMLElement).dataset.sortPins as PinSortBy;
        if (sortMode && this.pinSortBy !== sortMode) {
          this.pinSortBy = sortMode;
          lotusSound.playKeyTap();
          this.renderPinDirectoryModal();
        }
      });
    });

    this.modalLayerEl.querySelectorAll('[data-tick-pin]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pinId = (btn as HTMLElement).dataset.tickPin;
        const found = this.pins.find((p) => p.id === pinId);
        if (!found) return;
        const updated: SpatialPin = {
          ...found,
          completed: !found.completed,
        };
        lotusSound.playTaskTick(Boolean(updated.completed));
        this.callbacks.onSavePin(updated);
        this.refreshPinMarkerContent();
        this.renderPinDirectoryModal();
      });
    });

    this.modalLayerEl
      .querySelector('#dir-clear-all-btn')
      ?.addEventListener('click', () => {
        this.callbacks.onClearAllPins();
        this.refreshPinMarkerContent();
        this.renderAllPanels();
      });

    this.modalLayerEl
      .querySelector('#dir-add-pin-btn')
      ?.addEventListener('click', () => {
        this.enterPinAddMode();
      });

    this.modalLayerEl.querySelectorAll('[data-open-pin]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.openPin;
        if (id) {
          this.isPinDirectoryOpen = false;
          this.inspectPin(id);
        }
      });
    });
  }

  private renderBottomDock() {
    // When Focus Timer is running or user is placing a pin in surroundings, hide the bottom dock
    if (this.isTimerRunning || (this.currentMode === 'pin-add' && !this.isComposerOpen)) {
      this.bottomDockEl.style.display = 'none';
      this.bottomDockEl.innerHTML = '';
      return;
    }

    this.bottomDockEl.style.display = 'flex';
    this.bottomDockEl.className = 'lotus-bottom-dock';

    // When in Focus Area mode: show Visibility slider, Again button, and Okay button
    if (this.currentMode === 'focus-drag') {
      const visibilityVal = Math.round(
        this.settings.focusAreaVisibility ?? 25,
      );
      this.bottomDockEl.innerHTML = `
        <div class="lotus-dock-surface lotus-focus-area-controls">
          <label class="lotus-focus-vis-control" for="focus-visibility-slider">
            <span class="lotus-focus-vis-label">VISIBILITY</span>
            <input
              type="range"
              id="focus-visibility-slider"
              class="lotus-focus-vis-slider"
              min="0"
              max="100"
              step="1"
              value="${visibilityVal}"
            />
            <span id="focus-visibility-val" class="lotus-tabular lotus-focus-vis-val">${visibilityVal}%</span>
          </label>

          <button type="button" id="focus-area-again-btn" class="lotus-dock-btn">
            AGAIN
          </button>

          <button type="button" id="focus-area-okay-btn" class="lotus-dock-cta">
            OKAY
          </button>
        </div>
      `;

      const visSlider = this.bottomDockEl.querySelector(
        '#focus-visibility-slider',
      ) as HTMLInputElement | null;
      const visValEl = this.bottomDockEl.querySelector(
        '#focus-visibility-val',
      ) as HTMLElement | null;

      visSlider?.addEventListener('input', () => {
        const nextVal = Number(visSlider.value);
        this.settings.focusAreaVisibility = nextVal;
        if (visValEl) {
          visValEl.textContent = `${nextVal}%`;
        }
        // Higher VISIBILITY % -> more visibility of surroundings (lower shield strength)
        const shieldStrength = Math.max(0, Math.min(1, 1 - nextVal / 100));
        this.surroundShieldEl.style.opacity = `${shieldStrength.toFixed(3)}`;
        this.surroundShieldEl.style.setProperty(
          '--shield-blur',
          `${(shieldStrength * 16).toFixed(1)}px`,
        );
        this.callbacks.onSettingsChange(this.settings);
      });

      this.bottomDockEl
        .querySelector('#focus-area-again-btn')
        ?.addEventListener('click', () => {
          lotusSound.playKeyTap();
          this.isRedraggingFocusArea = true;
          this.updateDragBox2D(false);
          this.apertureRootEl.style.display = 'none';
          this.renderAllPanels();
        });

      this.bottomDockEl
        .querySelector('#focus-area-okay-btn')
        ?.addEventListener('click', () => {
          lotusSound.playKeyTap();
          this.isRedraggingFocusArea = false;
          this.updateDragBox2D(false);
          this.currentMode = 'explore';
          this.callbacks.onFocusZoneChange(this.focusZone);
          this.callbacks.onModeChange('explore');
          this.renderAllPanels();
        });

      return;
    }

    const clockStr = this.formatClockDisplay();

    this.bottomDockEl.innerHTML = `
      <div class="lotus-dock-surface">
        <button type="button" id="dock-mode-pin" class="lotus-dock-btn ${this.currentMode === 'pin-add' ? 'is-active' : ''}">
          + ADD PIN
        </button>

        <button type="button" id="dock-mode-drag" class="lotus-dock-btn">
          ⬚ 
        </button>

        <button type="button" id="dock-timer-toggle" class="lotus-dock-cta">
          <span>FOCUS</span>
          <span id="lotus-dock-clock" class="lotus-tabular">${clockStr}</span>
        </button>
      </div>
    `;

    this.bottomDockEl
      .querySelector('#dock-mode-pin')
      ?.addEventListener('click', () => {
        if (this.currentMode === 'pin-add') {
          this.currentMode = 'explore';
          this.updatePinPlacementReticle(false);
          this.callbacks.onModeChange('explore');
          this.renderAllPanels();
        } else {
          this.enterPinAddMode();
        }
      });

    this.bottomDockEl
      .querySelector('#dock-mode-drag')
      ?.addEventListener('click', () => {
        this.isTasksOpen = false;
        this.enterFocusAreaMode();
      });

    this.bottomDockEl
      .querySelector('#dock-timer-toggle')
      ?.addEventListener('click', () => {
        if (this.currentMode !== 'explore') {
          this.currentMode = 'explore';
          this.callbacks.onModeChange('explore');
        }
        this.startFocusTimer();
      });
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

  public getIsTimerRunning(): boolean {
    return this.isTimerRunning;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
