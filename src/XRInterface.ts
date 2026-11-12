import * as THREE from 'three';
import {
  ACCENT,
  ButtonContent,
  CanvasPanel,
  DANGER_TEXT,
  FONT_BODY,
  FONT_MONO,
  PANEL_BG,
  RestingSpot,
  TEXT_DIM,
  TEXT_MAIN,
  fitText,
  restingPosition,
  roundRectPath,
  wrapLines,
} from './XRPanel';
import {XRKeyAction, XRTextEditor} from './XRTextEditor';
import {drawIcon} from './icons';
import {
  AppMode,
  LotusTask,
  PinScreenProjection,
  PinSortBy,
  SpatialPin,
  TaskItemType,
} from './types';
import {XRSettingId} from './xrSettings';

/**
 * In-headset interface. The DOM overlay (LotusUI) is not composited into an
 * immersive session, so everything the user needs while wearing the headset is
 * drawn here as canvas-textured panels in the 3D scene:
 *  - a control panel that stays where it is in the room: it never follows the
 *    user. Its grip moves it by hand; hiding and showing it again (chip, B/Y,
 *    palm-up pinch) brings it back beside the user. Hidden, it shrinks to a
 *    small chip.
 *  - a drawer above the control panel: tasks (list, one task, the new / edit
 *    form), the pin list, or settings
 *  - a card for an opened pin, held at a readable distance between the user
 *    and the pin, with a leader line to the pin
 *  - a confirm / cancel bar on the focus area while it is being set
 *  - the keyboard (XRTextEditor). While it is open the other panels still
 *    work; only pins and the room ignore pinches.
 * The control panel (with its drawer), the pin card and the keyboard each
 * have a grip button in their top-right corner that moves them.
 *  - a title label above pins that are hovered or within proximity
 *  - a ray and cursor dot per controller / hand so the user can see where they aim
 *
 * This class only draws and reports what a ray hits; ImmersiveSession decides
 * what a press does. Buttons are icons (see icons.ts); the name of the button
 * under the ray shows in the panel's status line.
 */

export type XRHudAction =
  | 'toggle-timer'
  | 'place-pin'
  | 'focus-zone'
  | 'tab-tasks'
  | 'tab-pins'
  | 'tab-settings'
  | 'hide-hud'
  | 'move-hud'
  | 'exit-xr'
  // The "Start how?" choice that replaces the buttons after Play.
  | 'start-timer-only'
  | 'start-with-area'
  | 'start-cancel';
export type XRChipAction = 'show-hud';
export type XRZoneAction = 'zone-confirm' | 'zone-cancel';
export type XRDrawerTab = 'tasks' | 'pins' | 'settings';
export type XRDrawerAction =
  | 'move-drawer'
  | 'page-prev'
  | 'page-next'
  // Task list
  | `task-toggle:${string}`
  | `task-open:${string}`
  | 'task-new'
  | 'task-filter'
  | 'task-clear-done'
  // One open task
  | 'task-back'
  | 'task-done'
  | 'task-timer'
  | 'task-pin'
  | 'task-edit'
  | 'task-delete'
  // New / edit task form
  | 'form-title'
  | 'form-due'
  | 'form-note'
  | 'form-type'
  | 'form-timer-down'
  | 'form-timer-up'
  | 'form-cancel'
  | 'form-save'
  // Pins and settings
  | `pin:${string}`
  | 'pin-sort'
  | `setting:${XRSettingId}:${'prev' | 'next'}`;
export type XRCardAction =
  | 'move-card'
  | 'close'
  | 'edit'
  | 'edit-done'
  | 'field-title'
  | 'field-body'
  | 'field-place'
  | 'toggle-done'
  | 'color'
  | 'shape'
  | 'delete';

export interface XRHudState {
  clock: string;
  timerRunning: boolean;
  mode: AppMode;
  /** What to do next, shown when no button is hovered and nothing was flashed. */
  hint: string;
  /** Play was pressed: show the timer-only / focus-area choice instead of the buttons. */
  askingStart: boolean;
}

/** The panels a grip can move. The drawer moves with the control panel. */
export type XRMovablePanel = 'hud' | 'card' | 'editor';

export type XRTaskFilter = 'all' | 'ongoing' | 'completed';

export interface XRTaskRow {
  task: LotusTask;
  /** Time left on the task's timer, MM:SS. */
  clock: string;
}

/** The task being created or edited in the drawer. */
export interface XRTaskForm {
  /** True when an existing task is being edited, false for a new one. */
  editing: boolean;
  title: string;
  dueLabel: string;
  note: string;
  type: TaskItemType;
  timerMinutes: number;
}

export interface XRSettingRow {
  id: XRSettingId;
  name: string;
  kind: 'stepper' | 'cycle';
  hint: string;
  value: string;
  swatch?: string;
}

/** What the drawer shows; supplied every frame while it is open. */
export interface XRDrawerData {
  /** Already filtered and ordered for display. */
  tasks: XRTaskRow[];
  taskFilter: XRTaskFilter;
  hasCompletedTasks: boolean;
  /** Set while one task is open; the drawer then shows it instead of the list. */
  openTask: (XRTaskRow & {deleteArmed: boolean}) | null;
  /** Set while a task is being created or edited; takes over the tasks tab. */
  taskForm: XRTaskForm | null;
  /** Already ordered for display. */
  pins: {pin: SpatialPin; distance: number}[];
  pinSort: PinSortBy;
  settings: XRSettingRow[];
}

/** A ray resting on a panel; `action` is null over the panel body. */
export type XRPanelHit =
  | {panel: 'hud'; distance: number; action: XRHudAction | null}
  | {panel: 'chip'; distance: number; action: XRChipAction | null}
  | {panel: 'drawer'; distance: number; action: XRDrawerAction | null}
  | {panel: 'card'; distance: number; action: XRCardAction | null}
  | {panel: 'zone'; distance: number; action: XRZoneAction | null}
  | {panel: 'editor'; distance: number; action: XRKeyAction | null};

export interface XRPointerRay {
  origin: THREE.Vector3;
  quaternion: THREE.Quaternion;
  distance: number;
  showDot: boolean;
}

const TASK_FILTER_TEXT: Record<XRTaskFilter, string> = {
  all: 'All',
  ongoing: 'To do',
  completed: 'Done',
};

/**
 * Comfortable viewing distance for the control panel: Meta's guidance is to
 * keep ray-targeted UI at 1 m or more and out of the 0.5–0.8 m band. Panel
 * sizes below are given at REFERENCE_DISTANCE and scaled to keep the same
 * angular size wherever a panel sits.
 */
const REFERENCE_DISTANCE = 0.55;
const HUD_DISTANCE = 1.1;
const HUD_SCALE = HUD_DISTANCE / REFERENCE_DISTANCE;
/** Below eye level by ~14°, so it does not cover what the user looks at. */
const HUD_DROP_RADIANS = 0.25;
/** The panel rests ~24° to one side of where the user faces, never dead ahead. */
const HUD_SIDE_RADIANS = 0.42;
/** Where the panel appears when shown: to the user's left, below eye level. */
const HUD_SPOT: RestingSpot = {
  distance: HUD_DISTANCE,
  drop: HUD_DROP_RADIANS,
  yaw: HUD_SIDE_RADIANS,
};

/**
 * The pin card sits between the user and the pin, within this range, so a
 * far pin's card is still at a readable, comfortable distance.
 */
const CARD_MIN_DISTANCE = 0.9;
const CARD_MAX_DISTANCE = 1.2;
/** Card size is defined at this distance, then scaled to keep its angular size. */
const CARD_REFERENCE_DISTANCE = 0.72;
/** The card follows once it is this far (m) from its spot; leaning in does not move it. */
const CARD_FOLLOW_START = 0.35;
/** While typing, the card's bottom edge stays this far (m) below eye level, above the keyboard's top. */
const CARD_ABOVE_KEYBOARD = 0.2;
/** Pin labels keep their natural size up to here, then grow with distance. */
const LABEL_FULL_SIZE_DISTANCE = 0.8;
const MAX_LABEL_SCALE = 30;
const LABEL_FADE_RATE = 12;

// Drawer canvas layout (720 × 680 px).
const DRAWER_ROW_TOP = 104;
const DRAWER_ROW_STEP = 108;
const DRAWER_ROW_H = 96;
const DRAWER_FOOTER_Y = 572;
const DRAWER_FOOTER_H = 84;
const LIST_ROWS_PER_PAGE = 4;
const SETTING_ROWS_PER_PAGE = 5;

const _camPos = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _target = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function formatDistance(meters: number): string {
  return meters < 10 ? `${meters.toFixed(1)} m` : `${Math.round(meters)} m`;
}

/** The button ids of panel `P`. */
type ActionOn<P extends XRPanelHit['panel']> = NonNullable<
  Extract<XRPanelHit, {panel: P}>['action']
>;

/** The buttons of `panel` that the hits rest on. */
function hoveredOn<P extends XRPanelHit['panel']>(
  hits: XRPanelHit[],
  panel: P,
): ActionOn<P>[] {
  const actions: string[] = [];
  for (const hit of hits) {
    if (hit.panel === panel && hit.action && !actions.includes(hit.action)) {
      actions.push(hit.action);
    }
  }
  return actions as unknown as ActionOn<P>[];
}

interface PinLabel {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
  key: string;
  /** Faded rather than toggled, so a brief hover change cannot flicker it. */
  opacity: number;
}

interface PointerVisual {
  line: THREE.Line;
  dot: THREE.Mesh;
}

export class XRInterface {
  public readonly root = new THREE.Group();
  public readonly editor = new XRTextEditor();

  // Control panel (720 × 360 px at 0.36 × 0.18 m) and its hidden-state chip.
  private hud = new CanvasPanel<XRHudAction>(0.36, 0.18, 720, 360);
  private chip = new CanvasPanel<XRChipAction>(0.15, 0.06, 300, 120);
  private hudState: XRHudState = {
    clock: '00:00',
    timerRunning: false,
    mode: 'explore',
    hint: '',
    askingStart: false,
  };
  private hudStatus = '';
  private flashText = '';
  private flashUntil = 0;
  private hudKey = '';
  private chipKey = '';
  private hudHidden = false;
  private hudNeedsSnap = true;

  // Drawer above the control panel.
  private drawer = new CanvasPanel<XRDrawerAction>(0.36, 0.34, 720, 680);
  private drawerTab: XRDrawerTab | null = null;
  private drawerPage = 0;
  private drawerKey = '';
  private drawerData: XRDrawerData | null = null;

  // Pin card.
  private card = new CanvasPanel<XRCardAction>(0.36, 0.3, 720, 600);
  private cardPin: SpatialPin | null = null;
  private cardEditing = false;
  private cardStatus = '';
  private cardDeleteArmed = false;
  private cardNeedsSnap = true;
  /** The user moved the card by its grip: it stays exactly there. */
  private cardPlaced = false;
  private leaderGeo: THREE.BufferGeometry;
  private leaderMat: THREE.LineBasicMaterial;
  private leader: THREE.Line;

  // Confirm / cancel bar shown on the focus area while it is being set.
  private zoneBar = new CanvasPanel<XRZoneAction>(0.3, 0.07, 600, 140);
  private zoneBarKey = '';

  private labels = new Map<string, PinLabel>();
  private pointers: PointerVisual[] = [];
  private pointerLineGeo: THREE.BufferGeometry;
  private pointerLineMat: THREE.LineBasicMaterial;
  private pointerDotGeo: THREE.SphereGeometry;
  private pointerDotMat: THREE.MeshBasicMaterial;
  private disposed = false;

  constructor() {
    this.root.name = 'LotusXRInterface';
    this.root.visible = false;
    // The app does its own ray tests against these panels.
    (this.root as unknown as {xb?: {pointerEvents: string}}).xb = {
      pointerEvents: 'none',
    };
    this.hud.setVisible(true);
    // The drawer rides on the control panel, just above it.
    this.drawer.mesh.position.set(
      0,
      (this.hud.heightMeters + this.drawer.heightMeters) / 2 + 0.012,
      0,
    );
    this.hud.mesh.add(this.drawer.mesh);
    // The keyboard is drawn over everything else it may overlap.
    this.editor.panel.mesh.renderOrder = 6;
    this.root.add(
      this.hud.mesh,
      this.chip.mesh,
      this.card.mesh,
      this.zoneBar.mesh,
      this.editor.panel.mesh,
    );

    this.leaderGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    this.leaderMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.leader = new THREE.Line(this.leaderGeo, this.leaderMat);
    this.leader.frustumCulled = false;
    this.leader.visible = false;
    this.root.add(this.leader);

    this.pointerLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    this.pointerLineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.45,
    });
    this.pointerDotGeo = new THREE.SphereGeometry(0.007, 12, 12);
    this.pointerDotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthTest: false,
      toneMapped: false,
    });

    this.drawHud();
    this.redrawWhenFontsLoad();
  }

  /**
   * Canvas text does not wait for web fonts: anything drawn before they load
   * uses the fallback font. Load them explicitly and redraw once they arrive.
   */
  private redrawWhenFontsLoad() {
    const fonts = document.fonts;
    if (!fonts?.load) return;
    void Promise.all([
      fonts.load(`700 80px ${FONT_MONO}`),
      fonts.load(`500 28px ${FONT_BODY}`),
      fonts.load(`700 28px ${FONT_BODY}`),
    ])
      .catch(() => undefined)
      .then(() => {
        if (this.disposed) return;
        this.hudKey = '';
        this.chipKey = '';
        this.drawerKey = '';
        this.zoneBarKey = '';
        for (const label of this.labels.values()) label.key = '';
        this.drawHud();
        if (this.cardPin) this.drawCard();
      });
  }

  public setActive(active: boolean) {
    this.root.visible = active;
    this.flashText = '';
    if (active) {
      this.hudNeedsSnap = true;
      this.setHudHidden(false);
    } else {
      this.editor.close();
      this.closeCard();
      this.setDrawerTab(null);
      this.zoneBar.setVisible(false);
      this.updatePointers([]);
      for (const label of this.labels.values()) {
        label.opacity = 0;
        label.sprite.visible = false;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Control panel
  // ---------------------------------------------------------------------------

  /** Shows a temporary message on the control panel in place of the hint. */
  public flashStatus(text: string, seconds = 4) {
    this.flashText = text;
    this.flashUntil = performance.now() + seconds * 1000;
  }

  public isHudHidden(): boolean {
    return this.hudHidden;
  }

  /**
   * Hidden, the panel turns into a small chip left exactly where the panel
   * was. Shown again, the panel appears beside where the user is facing:
   * that is how a panel left behind in the room is brought back.
   */
  public setHudHidden(hidden: boolean, inPlace = false) {
    if (this.hudHidden === hidden) return;
    this.hudHidden = hidden;
    this.hud.setVisible(!hidden);
    this.chip.setVisible(hidden);
    if (hidden) {
      this.chip.mesh.position.copy(this.hud.mesh.position);
      this.chip.mesh.quaternion.copy(this.hud.mesh.quaternion);
      this.chip.mesh.scale.setScalar(HUD_SCALE);
      this.chipKey = '';
    } else {
      // From the chip the panel opens exactly where the chip is; otherwise it
      // is brought beside the user.
      this.hudNeedsSnap = !inPlace;
      this.hudKey = '';
    }
  }

  /** Where a movable panel's centre is, in world space. */
  public getPanelPosition(panel: XRMovablePanel, out: THREE.Vector3): THREE.Vector3 {
    switch (panel) {
      case 'hud':
        return out.copy(this.hud.mesh.position);
      case 'card':
        return out.copy(this.card.mesh.position);
      case 'editor':
        return out.copy(this.editor.panel.mesh.position);
    }
  }

  /** Puts a panel where the user dragged it by its grip; it stays there. */
  public setPanelPosition(panel: XRMovablePanel, position: THREE.Vector3) {
    switch (panel) {
      case 'hud':
        this.hud.mesh.position.copy(position);
        this.hudNeedsSnap = false;
        return;
      case 'card':
        this.card.mesh.position.copy(position);
        this.cardNeedsSnap = false;
        this.cardPlaced = true;
        return;
      case 'editor':
        this.editor.setPosition(position);
        return;
    }
  }

  /** Redraws the control panel when its content changed and keeps it facing the user. */
  public updateHud(state: XRHudState, camera: THREE.Camera) {
    camera.getWorldPosition(_camPos);

    if (this.hudHidden) {
      const key = `${state.clock}|${state.timerRunning}|${this.chip.hoverKey()}`;
      if (key !== this.chipKey) {
        this.chipKey = key;
        this.hudState = state;
        this.drawChip();
      }
      // World-locked: only turn to face the user so it stays readable.
      this.chip.mesh.lookAt(_camPos);
      return;
    }

    const status =
      this.hud.hoveredLabel() ??
      this.drawer.hoveredLabel() ??
      (this.flashText && performance.now() < this.flashUntil ? this.flashText : state.hint);
    const key = `${state.clock}|${state.timerRunning}|${state.mode}|${state.askingStart}|${status}|${this.hud.hoverKey()}|${this.drawerTab}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.hudState = state;
      this.hudStatus = status;
      this.drawHud();
    }

    this.placeHud(camera);
    this.hud.mesh.lookAt(_camPos);
  }

  /**
   * World-locked: the panel is placed beside the user when it is shown and
   * then stays put. It never follows the head or the user; only its grip, or
   * hiding and showing it again, moves it.
   */
  private placeHud(camera: THREE.Camera) {
    const mesh = this.hud.mesh;
    mesh.scale.setScalar(HUD_SCALE);
    if (this.hudNeedsSnap && restingPosition(camera, HUD_SPOT, mesh.position)) {
      this.hudNeedsSnap = false;
    }
  }

  private drawHud() {
    const {hud, hudState: s} = this;
    const {ctx} = hud;
    hud.clear();
    hud.drawBackground();

    ctx.fillStyle = ACCENT;
    ctx.font = `700 26px ${FONT_BODY}`;
    ctx.fillText('LOTUS', 36, 54);

    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `700 80px ${FONT_MONO}`;
    ctx.fillText(s.clock, 32, 142);

    ctx.fillStyle = TEXT_DIM;
    ctx.font = `500 28px ${FONT_BODY}`;
    ctx.fillText(fitText(ctx, this.hudStatus, 650), 36, 190);

    hud.drawButton('move-hud', 'Pinch and drag to move this panel', {icon: 'grip'}, 514, 26, 84, 84);
    hud.drawButton('hide-hud', 'Hide panel', {icon: 'eyeOff'}, 610, 26, 84, 84);

    const y = 214;
    const h = 116;
    if (s.askingStart) {
      hud.drawButton(
        'start-timer-only',
        'Just run the timer; the room stays clear',
        {text: 'Timer only'},
        30, y, 252, h,
        {active: true, fontSize: 34},
      );
      hud.drawButton(
        'start-with-area',
        'Dim everything outside your focus area',
        {text: 'Focus area'},
        294, y, 252, h,
        {fontSize: 34},
      );
      hud.drawButton('start-cancel', 'Do not start', {icon: 'close'}, 558, y, 132, h);
      hud.commit();
      return;
    }
    const w = 84;
    const gap = 12;
    let x = 30;
    const next = () => {
      const at = x;
      x += w + gap;
      return at;
    };
    hud.drawButton(
      'toggle-timer',
      s.timerRunning ? 'Stop focus' : 'Start focus',
      {icon: s.timerRunning ? 'stop' : 'play'},
      next(), y, w, h,
      {active: s.timerRunning},
    );
    hud.drawButton(
      'place-pin',
      s.mode === 'pin-add' ? 'Cancel placing a pin' : 'Place pin',
      {icon: 'pin'},
      next(), y, w, h,
      {active: s.mode === 'pin-add'},
    );
    hud.drawButton(
      'focus-zone',
      s.mode === 'focus-drag' ? 'Cancel setting the focus area' : 'Set focus area',
      {icon: 'focusArea'},
      next(), y, w, h,
      {active: s.mode === 'focus-drag'},
    );
    hud.drawButton('tab-tasks', 'Tasks', {icon: 'tasks'}, next(), y, w, h, {
      active: this.drawerTab === 'tasks',
    });
    hud.drawButton('tab-pins', 'All pins', {icon: 'list'}, next(), y, w, h, {
      active: this.drawerTab === 'pins',
    });
    hud.drawButton('tab-settings', 'Settings', {icon: 'settings'}, next(), y, w, h, {
      active: this.drawerTab === 'settings',
    });
    hud.drawButton('exit-xr', 'Exit XR', {icon: 'exit'}, next(), y, w, h, {
      danger: true,
    });
    hud.commit();
  }

  private drawChip() {
    const {chip, hudState: s} = this;
    const {ctx} = chip;
    chip.clear();
    chip.drawButton(
      'show-hud',
      'Show panel',
      {
        paint: (c, x, y, _w, h) => {
          drawIcon(c, 'eye', x + 58, y + h / 2, 48, TEXT_MAIN);
          c.fillStyle = s.timerRunning ? TEXT_MAIN : TEXT_DIM;
          c.font = s.timerRunning ? `700 44px ${FONT_MONO}` : `600 34px ${FONT_BODY}`;
          c.textBaseline = 'middle';
          c.fillText(s.timerRunning ? s.clock : 'LOTUS', x + 104, y + h / 2 + 2);
        },
      },
      4, 4, 292, 112,
    );
    // Solid backdrop behind the translucent button colour.
    ctx.globalCompositeOperation = 'destination-over';
    roundRectPath(ctx, 4, 4, 292, 112, 22);
    ctx.fillStyle = PANEL_BG;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    chip.commit();
  }

  // ---------------------------------------------------------------------------
  // Drawer: tasks, pins, settings
  // ---------------------------------------------------------------------------

  public getDrawerTab(): XRDrawerTab | null {
    return this.drawerTab;
  }

  public setDrawerTab(tab: XRDrawerTab | null) {
    if (this.drawerTab !== tab) this.drawerPage = 0;
    this.drawerTab = tab;
    this.drawer.setVisible(tab !== null);
    this.drawerKey = '';
    this.hudKey = '';
  }

  public turnDrawerPage(step: 1 | -1) {
    this.drawerPage = Math.max(0, this.drawerPage + step);
    this.drawerKey = '';
  }

  /** Redraws the drawer when what it shows has changed. */
  public updateDrawer(data: XRDrawerData) {
    if (!this.drawerTab || this.hudHidden) return;
    this.drawerData = data;
    const key = `${this.drawerTab}|${this.drawerPage}|${this.drawer.hoverKey()}|${this.drawerContentKey(data)}`;
    if (key === this.drawerKey) return;
    this.drawerKey = key;
    this.drawDrawer();
  }

  /** Everything the current view draws, as text: the drawer redraws when it changes. */
  private drawerContentKey(data: XRDrawerData): string {
    switch (this.drawerTab) {
      case 'tasks':
        if (data.taskForm) return JSON.stringify(data.taskForm);
        if (data.openTask) return JSON.stringify(data.openTask);
        return JSON.stringify([
          data.taskFilter,
          data.hasCompletedTasks,
          data.tasks.map(({task, clock}) => [
            task.id,
            task.title,
            task.dueLabel,
            task.completed,
            task.timerRunning,
            clock,
          ]),
        ]);
      case 'pins':
        return JSON.stringify([
          data.pinSort,
          data.pins.map(({pin, distance}) => [
            pin.id,
            pin.title,
            pin.surfaceLabel,
            pin.color,
            pin.completed,
            distance.toFixed(1),
          ]),
        ]);
      case 'settings':
        return JSON.stringify(data.settings);
      default:
        return '';
    }
  }

  private drawDrawer() {
    const data = this.drawerData;
    const tab = this.drawerTab;
    if (!data || !tab) return;
    const {drawer} = this;
    drawer.clear();
    drawer.drawBackground();
    drawer.drawButton('move-drawer', 'Pinch and drag to move this panel', {icon: 'grip'}, 624, 22, 72, 64);
    if (tab === 'settings') {
      this.drawSettings(data.settings);
    } else if (tab === 'pins') {
      this.drawPinList(data);
    } else if (data.taskForm) {
      this.drawTaskForm(data.taskForm);
    } else if (data.openTask) {
      this.drawOpenTask(data.openTask);
    } else {
      this.drawTaskList(data);
    }
    drawer.commit();
  }

  private drawDrawerTitle(title: string, x = 36) {
    const {ctx} = this.drawer;
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `700 34px ${FONT_BODY}`;
    ctx.fillText(title, x, 64);
  }

  /**
   * Clamps the current page to `rowCount` rows, draws the pager when there is
   * more than one page, and returns the index of the first row to show.
   */
  private drawPager(rowCount: number, rowsPerPage: number): number {
    const {drawer} = this;
    const {ctx} = drawer;
    const pages = Math.max(1, Math.ceil(rowCount / rowsPerPage));
    this.drawerPage = Math.min(this.drawerPage, pages - 1);
    if (pages > 1) {
      ctx.fillStyle = TEXT_DIM;
      ctx.font = `500 26px ${FONT_BODY}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${this.drawerPage + 1} / ${pages}`, 436, 62);
      ctx.textAlign = 'left';
      drawer.drawButton('page-prev', 'Previous page', {icon: 'chevronLeft'}, 456, 22, 72, 64, {
        disabled: this.drawerPage === 0,
      });
      drawer.drawButton('page-next', 'Next page', {icon: 'chevronRight'}, 540, 22, 72, 64, {
        disabled: this.drawerPage === pages - 1,
      });
    }
    return this.drawerPage * rowsPerPage;
  }

  private drawDrawerMessage(text: string) {
    const {ctx} = this.drawer;
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `500 28px ${FONT_BODY}`;
    wrapLines(ctx, text, 640, 3).forEach((line, i) => ctx.fillText(line, 36, 160 + i * 40));
  }

  private drawTaskList(data: XRDrawerData) {
    const {drawer} = this;
    this.drawDrawerTitle('Tasks');
    const start = this.drawPager(data.tasks.length, LIST_ROWS_PER_PAGE);
    if (data.tasks.length === 0) {
      this.drawDrawerMessage(
        data.taskFilter === 'all'
          ? 'No tasks yet. Press "New task" to add one.'
          : `No tasks under "${TASK_FILTER_TEXT[data.taskFilter]}".`,
      );
    }

    data.tasks.slice(start, start + LIST_ROWS_PER_PAGE).forEach(({task, clock}, i) => {
      const y = DRAWER_ROW_TOP + i * DRAWER_ROW_STEP;
      drawer.drawButton(
        `task-toggle:${task.id}`,
        task.completed ? 'Mark as not done' : 'Mark as done',
        {
          paint: (c, x, by, w, h) =>
            drawIcon(c, task.completed ? 'check' : 'box', x + w / 2, by + h / 2, 44,
              task.completed ? ACCENT : TEXT_MAIN),
        },
        28, y, 96, DRAWER_ROW_H,
      );
      drawer.drawButton(
        `task-open:${task.id}`,
        `Open "${task.title}"`,
        {
          paint: (c, x, by, w, h) => {
            const showClock = !task.completed;
            const textWidth = w - (showClock ? 170 : 48);
            c.fillStyle = task.completed ? TEXT_DIM : TEXT_MAIN;
            c.font = `600 30px ${FONT_BODY}`;
            c.fillText(fitText(c, task.title, textWidth), x + 24, by + (task.dueLabel ? 42 : 58));
            if (task.dueLabel) {
              c.fillStyle = TEXT_DIM;
              c.font = `500 24px ${FONT_BODY}`;
              c.fillText(fitText(c, task.dueLabel, textWidth), x + 24, by + 76);
            }
            if (showClock) {
              c.fillStyle = task.timerRunning ? ACCENT : TEXT_DIM;
              c.font = `600 28px ${FONT_MONO}`;
              c.textAlign = 'right';
              c.fillText(clock, x + w - 24, by + h / 2 + 10);
            }
          },
        },
        136, y, 556, DRAWER_ROW_H,
      );
    });

    drawer.drawButton('task-new', 'Add a task or reminder', {text: '+ New task'},
      28, DRAWER_FOOTER_Y, 236, DRAWER_FOOTER_H, {active: true});
    drawer.drawButton(
      'task-filter',
      'Change which tasks are listed',
      {text: `Show: ${TASK_FILTER_TEXT[data.taskFilter]}`},
      276, DRAWER_FOOTER_Y, 212, DRAWER_FOOTER_H,
    );
    drawer.drawButton('task-clear-done', 'Remove all done tasks', {text: 'Clear done'},
      500, DRAWER_FOOTER_Y, 192, DRAWER_FOOTER_H, {disabled: !data.hasCompletedTasks});
  }

  private drawOpenTask({task, clock, deleteArmed}: NonNullable<XRDrawerData['openTask']>) {
    const {drawer} = this;
    const {ctx} = drawer;
    drawer.drawButton('task-back', 'Back to all tasks', {icon: 'chevronLeft'}, 28, 22, 72, 64);
    this.drawDrawerTitle(task.type === 'reminder' ? 'Reminder' : 'Task', 120);

    ctx.fillStyle = task.completed ? TEXT_DIM : TEXT_MAIN;
    ctx.font = `700 38px ${FONT_BODY}`;
    const titleLines = wrapLines(ctx, task.title, 648, 2);
    titleLines.forEach((line, i) => ctx.fillText(line, 36, 150 + i * 48));
    let y = 150 + titleLines.length * 48;

    const facts = [task.completed ? 'Done' : '', task.dueLabel].filter(Boolean).join(' · ');
    if (facts) {
      ctx.fillStyle = TEXT_DIM;
      ctx.font = `500 26px ${FONT_BODY}`;
      ctx.fillText(fitText(ctx, facts, 648), 36, y - 4);
      y += 40;
    }
    if (task.note) {
      ctx.fillStyle = TEXT_MAIN;
      ctx.font = `400 28px ${FONT_BODY}`;
      const noteLines = Math.max(1, Math.floor((440 - y) / 38));
      wrapLines(ctx, task.note, 648, noteLines).forEach((line, i) =>
        ctx.fillText(line, 36, y + i * 38),
      );
    }

    ctx.fillStyle = task.timerRunning ? ACCENT : TEXT_MAIN;
    ctx.font = `700 60px ${FONT_MONO}`;
    ctx.fillText(clock, 36, 532);
    const armed = deleteArmed;
    ctx.fillStyle = armed ? DANGER_TEXT : TEXT_DIM;
    ctx.font = `500 26px ${FONT_BODY}`;
    ctx.fillText(
      armed
        ? 'Press delete again to remove'
        : task.timerRunning ? 'Timer running' : 'Timer paused',
      250, 524,
    );

    const gap = 12;
    const w = (664 - gap * 4) / 5;
    let x = 28;
    const next = () => {
      const at = x;
      x += w + gap;
      return at;
    };
    drawer.drawButton('task-done', task.completed ? 'Mark as not done' : 'Mark as done',
      {icon: 'check'}, next(), DRAWER_FOOTER_Y, w, DRAWER_FOOTER_H, {active: task.completed});
    drawer.drawButton(
      'task-timer',
      task.timerRunning ? 'Pause this task\'s timer' : 'Start this task\'s timer',
      {icon: task.timerRunning ? 'pause' : 'timer'},
      next(), DRAWER_FOOTER_Y, w, DRAWER_FOOTER_H,
      {active: Boolean(task.timerRunning), disabled: task.completed},
    );
    drawer.drawButton('task-pin', 'Place a pin for this task', {icon: 'pin'},
      next(), DRAWER_FOOTER_Y, w, DRAWER_FOOTER_H);
    drawer.drawButton('task-edit', 'Edit this task', {icon: 'edit'},
      next(), DRAWER_FOOTER_Y, w, DRAWER_FOOTER_H);
    drawer.drawButton(
      'task-delete',
      armed ? 'Confirm delete' : 'Delete this task',
      {icon: armed ? 'check' : 'trash'},
      next(), DRAWER_FOOTER_Y, w, DRAWER_FOOTER_H,
      {danger: true, armed},
    );
  }

  private drawTaskForm(form: XRTaskForm) {
    const {drawer} = this;
    const {ctx} = drawer;
    const noun = form.type === 'reminder' ? 'reminder' : 'task';
    this.drawDrawerTitle(form.editing ? `Edit ${noun}` : `New ${noun}`);

    this.drawField(drawer, 'form-title', 'Title', form.title, 'What needs doing?', 28, 104, 664, 92);
    this.drawField(drawer, 'form-due', 'Due', form.dueLabel, 'Optional, e.g. Today 5 PM', 28, 208, 664, 92);
    this.drawField(drawer, 'form-note', 'Note', form.note, 'Optional details', 28, 312, 664, 92);

    const y = 428;
    drawer.drawButton(
      'form-type',
      'Switch between task and reminder',
      {text: form.type === 'reminder' ? 'Reminder' : 'Task'},
      28, y, 232, 92,
    );
    drawer.drawButton('form-timer-down', 'Shorter timer', {icon: 'minus'}, 284, y, 84, 92);
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `600 28px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${form.timerMinutes} min timer`, 488, y + 56);
    ctx.textAlign = 'left';
    drawer.drawButton('form-timer-up', 'Longer timer', {icon: 'plus'}, 608, y, 84, 92);

    drawer.drawButton('form-cancel', 'Cancel', {text: 'Cancel'},
      28, DRAWER_FOOTER_Y, 200, DRAWER_FOOTER_H);
    const ready = form.title.trim().length > 0;
    drawer.drawButton(
      'form-save',
      ready ? (form.editing ? 'Save changes' : `Add this ${noun}`) : 'Add a title first',
      {text: form.editing ? 'Save' : `Add ${noun}`},
      240, DRAWER_FOOTER_Y, 452, DRAWER_FOOTER_H,
      {active: ready, disabled: !ready},
    );
  }

  private drawPinList(data: XRDrawerData) {
    const {drawer} = this;
    const {ctx} = drawer;
    this.drawDrawerTitle('Pins');
    const start = this.drawPager(data.pins.length, LIST_ROWS_PER_PAGE);
    if (data.pins.length === 0) {
      this.drawDrawerMessage('No pins yet. Use the pin button to place one.');
    }

    data.pins.slice(start, start + LIST_ROWS_PER_PAGE).forEach(({pin, distance}, i) => {
      drawer.drawButton(
        `pin:${pin.id}`,
        `Open "${pin.title}"`,
        {
          paint: (c, x, by, w, h) => {
            c.beginPath();
            c.arc(x + 46, by + h / 2, 16, 0, Math.PI * 2);
            this.fillPinColor(c, pin);
            c.fillStyle = pin.completed ? TEXT_DIM : TEXT_MAIN;
            c.font = `600 30px ${FONT_BODY}`;
            c.fillText(fitText(c, pin.title || 'Untitled pin', w - 230), x + 84, by + 42);
            c.fillStyle = TEXT_DIM;
            c.font = `500 24px ${FONT_BODY}`;
            const place = pin.surfaceLabel || 'Room';
            c.fillText(fitText(c, pin.completed ? `Done · ${place}` : place, w - 230), x + 84, by + 76);
            c.font = `600 28px ${FONT_MONO}`;
            c.textAlign = 'right';
            c.fillText(formatDistance(distance), x + w - 28, by + h / 2 + 10);
          },
        },
        28, DRAWER_ROW_TOP + i * DRAWER_ROW_STEP, 664, DRAWER_ROW_H,
      );
    });

    drawer.drawButton(
      'pin-sort',
      'Change the order of the list',
      {text: data.pinSort === 'proximity' ? 'Sort: Nearest first' : 'Sort: Newest first'},
      28, DRAWER_FOOTER_Y, 340, DRAWER_FOOTER_H,
    );
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `500 26px ${FONT_BODY}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${data.pins.length} ${data.pins.length === 1 ? 'pin' : 'pins'}`, 684, DRAWER_FOOTER_Y + 52);
    ctx.textAlign = 'left';
  }

  private drawSettings(rows: XRSettingRow[]) {
    const {drawer} = this;
    const {ctx} = drawer;
    this.drawDrawerTitle('Settings');
    const start = this.drawPager(rows.length, SETTING_ROWS_PER_PAGE);

    rows.slice(start, start + SETTING_ROWS_PER_PAGE).forEach((row, i) => {
      const y = DRAWER_ROW_TOP + i * DRAWER_ROW_STEP;
      ctx.fillStyle = TEXT_MAIN;
      ctx.font = `600 30px ${FONT_BODY}`;
      ctx.fillText(row.name, 36, y + 58);

      if (row.kind === 'stepper') {
        drawer.drawButton(`setting:${row.id}:prev`, row.hint, {icon: 'minus'}, 340, y, 84, DRAWER_ROW_H);
        ctx.fillStyle = TEXT_MAIN;
        ctx.font = `700 30px ${FONT_MONO}`;
        ctx.textAlign = 'center';
        ctx.fillText(row.value, 516, y + 58);
        ctx.textAlign = 'left';
        drawer.drawButton(`setting:${row.id}:next`, row.hint, {icon: 'plus'}, 608, y, 84, DRAWER_ROW_H);
        return;
      }
      // The whole value pill is the button; a press moves to the next value.
      drawer.drawButton(
        `setting:${row.id}:next`,
        row.hint,
        {
          paint: (c, x, by, w, h) => {
            c.font = `600 28px ${FONT_BODY}`;
            c.textBaseline = 'middle';
            c.textAlign = 'center';
            const text = fitText(c, row.value, w - (row.swatch ? 90 : 30));
            const textX = x + w / 2 + (row.swatch ? 22 : 0);
            if (row.swatch) {
              c.beginPath();
              c.arc(textX - c.measureText(text).width / 2 - 30, by + h / 2, 15, 0, Math.PI * 2);
              c.fillStyle = row.swatch;
              c.fill();
              c.lineWidth = 2;
              c.strokeStyle = TEXT_MAIN;
              c.stroke();
            }
            c.fillStyle = TEXT_MAIN;
            c.fillText(text, textX, by + h / 2 + 2);
          },
        },
        340, y, 352, DRAWER_ROW_H,
      );
    });
  }

  /**
   * A text field: its name, its value (or a faint placeholder), and a pencil.
   * Pressing it opens the keyboard for that field.
   */
  private drawField<Id extends string>(
    panel: CanvasPanel<Id>,
    id: Id,
    name: string,
    value: string,
    placeholder: string,
    x: number,
    y: number,
    w: number,
    h: number,
    valueLines = 1,
  ) {
    panel.drawButton(
      id,
      `Edit ${name.toLowerCase()}`,
      {
        paint: (c, bx, by) => {
          c.fillStyle = TEXT_DIM;
          c.font = `600 22px ${FONT_BODY}`;
          c.fillText(name.toUpperCase(), bx + 22, by + 32);
          c.font = `500 30px ${FONT_BODY}`;
          c.fillStyle = value ? TEXT_MAIN : 'rgba(245, 244, 239, 0.4)';
          wrapLines(c, value || placeholder, w - 110, valueLines).forEach((line, i) =>
            c.fillText(line, bx + 22, by + 70 + i * 38),
          );
          drawIcon(c, 'edit', bx + w - 46, by + h / 2, 34, TEXT_DIM);
        },
      },
      x, y, w, h,
    );
  }

  // ---------------------------------------------------------------------------
  // Pin card
  // ---------------------------------------------------------------------------

  public openCard(pin: SpatialPin) {
    if (this.cardPin?.id !== pin.id) {
      this.cardNeedsSnap = true;
      this.cardPlaced = false;
    }
    this.cardPin = pin;
    this.cardEditing = false;
    this.cardStatus = '';
    this.cardDeleteArmed = false;
    this.card.setVisible(true);
    this.drawCard();
  }

  public closeCard() {
    this.cardPin = null;
    this.cardEditing = false;
    this.cardStatus = '';
    this.cardDeleteArmed = false;
    this.card.setVisible(false);
    this.leader.visible = false;
  }

  public getCardPinId(): string | null {
    return this.cardPin?.id ?? null;
  }

  /** Redraw after the pin changed. */
  public refreshCard(pin: SpatialPin) {
    if (this.cardPin?.id !== pin.id) return;
    this.cardPin = pin;
    this.drawCard();
  }

  /** Switches the card between reading the pin and its editable fields. */
  public setCardEditing(editing: boolean) {
    if (this.cardEditing === editing) return;
    this.cardEditing = editing;
    if (this.cardPin) this.drawCard();
  }

  public setCardStatus(text: string) {
    if (this.cardStatus === text) return;
    this.cardStatus = text;
    if (this.cardPin) this.drawCard();
  }

  /** Shows the delete button as waiting for its confirming second press. */
  public setCardDeleteArmed(armed: boolean) {
    if (this.cardDeleteArmed === armed) return;
    this.cardDeleteArmed = armed;
    if (this.cardPin) this.drawCard();
  }

  /**
   * Holds the card between the user and the pin at a comfortable distance
   * (CARD_MIN_DISTANCE–CARD_MAX_DISTANCE), just above the line of sight to the
   * pin, at a constant angular size. A far pin's card is therefore as large
   * and sharp as a near one's; a thin leader line points to the pin.
   * `held` keeps the card still while the user is typing into it.
   */
  public updateCard(
    camera: THREE.Camera,
    pinWorldPos: THREE.Vector3,
    delta: number,
    held: boolean,
  ) {
    if (!this.cardPin) return;
    camera.getWorldPosition(_camPos);
    _forward.copy(pinWorldPos).sub(_camPos);
    const pinDist = _forward.length();
    if (pinDist < 1e-3) return;
    _forward.divideScalar(pinDist);

    const cardDist = THREE.MathUtils.clamp(pinDist, CARD_MIN_DISTANCE, CARD_MAX_DISTANCE);
    const scale = cardDist / CARD_REFERENCE_DISTANCE;
    const halfH = (this.card.heightMeters * scale) / 2;
    _target
      .copy(_camPos)
      .addScaledVector(_forward, cardDist)
      .addScaledVector(_up, halfH + 0.05 * scale);

    const mesh = this.card.mesh;
    mesh.scale.setScalar(scale);
    if (this.cardNeedsSnap) {
      mesh.position.copy(_target);
      this.cardNeedsSnap = false;
    }
    // The card stays where it opened; it never chases the head. A card the
    // user moved by its grip is left exactly where they put it.
    if (held && !this.cardPlaced) {
      // While typing, keep the card above the keyboard (which rests below eye
      // level) so a pin near the floor does not put them on top of each other.
      const minY = _camPos.y - CARD_ABOVE_KEYBOARD + halfH;
      if (mesh.position.y < minY) {
        mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, minY, 1 - Math.exp(-8 * delta));
      }
    }
    mesh.lookAt(_camPos);

    // Leader line from the card's bottom edge to the pin, when they are apart.
    _tmp.copy(mesh.position).addScaledVector(_up, -halfH);
    const showLeader = _tmp.distanceTo(pinWorldPos) > 0.12;
    this.leader.visible = showLeader;
    if (showLeader) {
      const pos = this.leaderGeo.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, _tmp.x, _tmp.y, _tmp.z);
      pos.setXYZ(1, pinWorldPos.x, pinWorldPos.y, pinWorldPos.z);
      pos.needsUpdate = true;
    }
  }

  private drawCard() {
    const pin = this.cardPin;
    if (!pin) return;
    const {card} = this;
    card.clear();
    card.drawBackground();
    card.drawButton('move-card', 'Pinch and drag to move this card', {icon: 'grip'}, 612, 20, 72, 64);
    if (this.cardEditing) {
      this.drawCardFields(pin);
    } else {
      this.drawCardView(pin);
    }
    card.commit();
  }

  /** The line above the card's buttons: the hovered button's name, or a message. */
  private drawCardStatus() {
    const {card} = this;
    const {ctx} = card;
    const status =
      card.hoveredLabel() ??
      (this.cardDeleteArmed ? 'Press delete again to remove this pin' : this.cardStatus);
    if (!status) return;
    ctx.fillStyle = this.cardDeleteArmed ? DANGER_TEXT : ACCENT;
    ctx.font = `600 26px ${FONT_BODY}`;
    ctx.fillText(fitText(ctx, status, 648), 36, 470);
  }

  private drawCardView(pin: SpatialPin) {
    const {card} = this;
    const {ctx} = card;
    roundRectPath(ctx, 36, 40, 12, 100, 6);
    this.fillPinColor(ctx, pin);

    ctx.fillStyle = pin.completed ? TEXT_DIM : TEXT_MAIN;
    ctx.font = `700 44px ${FONT_BODY}`;
    // Narrower than the card: the grip sits in the top-right corner.
    const titleLines = wrapLines(ctx, pin.title || 'Untitled pin', 530, 2);
    titleLines.forEach((line, i) => ctx.fillText(line, 66, 82 + i * 52));

    let y = 82 + titleLines.length * 52;
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `500 26px ${FONT_BODY}`;
    const place = pin.surfaceLabel || 'Room';
    ctx.fillText(fitText(ctx, pin.completed ? `Done · ${place}` : place, 530), 66, y - 6);
    y += 46;

    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `400 30px ${FONT_BODY}`;
    const maxBodyLines = Math.max(1, Math.floor((436 - y) / 40));
    wrapLines(ctx, pin.body || '', 648, maxBodyLines).forEach((line, i) =>
      ctx.fillText(line, 36, y + i * 40),
    );
    this.drawCardStatus();

    const armed = this.cardDeleteArmed;
    const buttons: {id: XRCardAction; label: string; content: ButtonContent; active?: boolean}[] = [
      {id: 'close', label: 'Close', content: {icon: 'close'}},
      {id: 'edit', label: 'Edit title, note and place', content: {icon: 'edit'}},
      {
        id: 'toggle-done',
        label: pin.completed ? 'Mark as not done' : 'Mark as done',
        content: {icon: 'check'},
        active: Boolean(pin.completed),
      },
      {
        id: 'color',
        label: 'Change colour',
        content: {
          paint: (c, x, by, w, h) => {
            c.beginPath();
            c.arc(x + w / 2, by + h / 2, 20, 0, Math.PI * 2);
            c.fillStyle = pin.color || ACCENT;
            c.fill();
            c.lineWidth = 3;
            c.strokeStyle = TEXT_MAIN;
            c.stroke();
          },
        },
      },
      {
        id: 'shape',
        label: pin.shapeStyle === 'dot' ? 'Show as shape' : 'Show as dot',
        content: {icon: pin.shapeStyle === 'dot' ? 'shapeDot' : 'shapeRevolving'},
      },
      {
        id: 'delete',
        label: armed ? 'Confirm delete' : 'Delete pin',
        content: {icon: armed ? 'check' : 'trash'},
      },
    ];
    const gap = 14;
    const w = (648 - gap * (buttons.length - 1)) / buttons.length;
    let x = 36;
    for (const b of buttons) {
      card.drawButton(b.id, b.label, b.content, x, 496, w, 84, {
        active: b.active,
        danger: b.id === 'delete',
        armed: b.id === 'delete' && armed,
      });
      x += w + gap;
    }
  }

  /**
   * Fills the current path with the pin's colour. The faint outline keeps
   * dark colours visible against the dark panels.
   */
  private fillPinColor(ctx: CanvasRenderingContext2D, pin: SpatialPin) {
    ctx.fillStyle = pin.color || ACCENT;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.stroke();
  }

  private drawCardFields(pin: SpatialPin) {
    const {card} = this;
    const {ctx} = card;
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `700 34px ${FONT_BODY}`;
    ctx.fillText('Edit pin', 36, 64);

    this.drawField(card, 'field-title', 'Title', pin.title, 'Short header to remember', 36, 88, 648, 92);
    this.drawField(card, 'field-body', 'Note', pin.body, 'Full note details', 36, 192, 648, 130, 2);
    this.drawField(card, 'field-place', 'Place', pin.surfaceLabel, 'Where is this point?', 36, 334, 648, 92);
    this.drawCardStatus();
    card.drawButton('edit-done', 'Finish editing', {text: 'Done'}, 36, 496, 648, 84, {
      active: true,
      fontSize: 32,
    });
  }

  // ---------------------------------------------------------------------------
  // Focus area bar
  // ---------------------------------------------------------------------------

  /**
   * Shows Cancel / Use this area just above the focus area while it is being
   * set, so the choice is made where the user is looking. `anchor` is the top
   * centre of the area in world space, or null to hide the bar.
   */
  public updateZoneBar(camera: THREE.Camera, anchor: THREE.Vector3 | null) {
    const bar = this.zoneBar;
    if (!anchor) {
      if (bar.mesh.visible) bar.setVisible(false);
      return;
    }
    if (!bar.mesh.visible) {
      bar.setVisible(true);
      this.zoneBarKey = '';
    }
    const key = `zone|${bar.hoverKey()}`;
    if (key !== this.zoneBarKey) {
      this.zoneBarKey = key;
      bar.clear();
      bar.drawBackground(30);
      bar.drawButton('zone-cancel', 'Keep the previous focus area', {text: 'Cancel'}, 16, 18, 170, 104, {
        fontSize: 32,
      });
      bar.drawButton('zone-confirm', 'Save this focus area', {text: 'Use this area'}, 198, 18, 386, 104, {
        active: true,
        fontSize: 34,
      });
      bar.commit();
    }
    camera.getWorldPosition(_camPos);
    // Constant angular size: the same reach whether the area is near or far.
    const scale = THREE.MathUtils.clamp(_camPos.distanceTo(anchor), 0.7, 4);
    bar.mesh.scale.setScalar(scale);
    bar.mesh.position.copy(anchor);
    bar.mesh.position.y += (bar.heightMeters / 2 + 0.04) * scale;
    bar.mesh.lookAt(_camPos);
  }

  // ---------------------------------------------------------------------------
  // Ray hit testing and hover
  // ---------------------------------------------------------------------------

  /** Nearest panel under the ray, with the button it lands on (if any). */
  public hitTest(raycaster: THREE.Raycaster): XRPanelHit | null {
    let best: XRPanelHit | null = null;
    const consider = (hit: XRPanelHit | null) => {
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    };
    const hud = this.hud.hit(raycaster);
    if (hud) consider({panel: 'hud', distance: hud.distance, action: hud.buttonId});
    const chip = this.chip.hit(raycaster);
    if (chip) consider({panel: 'chip', distance: chip.distance, action: chip.buttonId});
    const drawer = this.drawer.hit(raycaster);
    if (drawer) consider({panel: 'drawer', distance: drawer.distance, action: drawer.buttonId});
    const card = this.card.hit(raycaster);
    if (card) consider({panel: 'card', distance: card.distance, action: card.buttonId});
    const zone = this.zoneBar.hit(raycaster);
    if (zone) consider({panel: 'zone', distance: zone.distance, action: zone.buttonId});
    if (this.editor.isOpen()) {
      const editor = this.editor.panel.hit(raycaster);
      if (editor) consider({panel: 'editor', distance: editor.distance, action: editor.buttonId});
    }
    return best;
  }

  /** Highlights the buttons the rays rest on: one hit per hand, or none. */
  public setPanelHover(hits: XRPanelHit[]) {
    // The control panel, chip, drawer and focus bar redraw from their update
    // calls, which key on the hover.
    this.hud.setHovered(hoveredOn(hits, 'hud'));
    this.chip.setHovered(hoveredOn(hits, 'chip'));
    this.drawer.setHovered(hoveredOn(hits, 'drawer'));
    this.zoneBar.setHovered(hoveredOn(hits, 'zone'));
    this.editor.setHovered(hoveredOn(hits, 'editor'));
    if (this.card.setHovered(hoveredOn(hits, 'card')) && this.cardPin) this.drawCard();
  }

  // ---------------------------------------------------------------------------
  // Pin title labels
  // ---------------------------------------------------------------------------

  public updateLabels(
    pins: SpatialPin[],
    projections: PinScreenProjection[],
    getWorldPosition: (pinId: string, target: THREE.Vector3) => boolean,
    hoveredPinId: string | null,
    delta: number,
  ) {
    const live = new Set<string>();
    const fade = 1 - Math.exp(-LABEL_FADE_RATE * delta);
    for (const proj of projections) {
      const pin = pins.find((p) => p.id === proj.id);
      if (!pin) continue;
      live.add(pin.id);
      const wanted =
        (proj.isWithinProximity || pin.id === hoveredPinId) &&
        this.cardPin?.id !== pin.id;
      let label = this.labels.get(pin.id);
      if (!label) {
        if (!wanted) continue;
        label = this.createLabel();
        this.labels.set(pin.id, label);
      }
      label.opacity += ((wanted ? 1 : 0) - label.opacity) * fade;
      if (label.opacity < 0.02 && !wanted) {
        label.opacity = 0;
        label.sprite.visible = false;
        continue;
      }
      if (!getWorldPosition(pin.id, _tmp)) {
        label.sprite.visible = false;
        continue;
      }
      const key = `${pin.title}|${pin.color}`;
      if (label.key !== key) {
        label.key = key;
        this.drawLabel(label, pin);
      }
      const scale = THREE.MathUtils.clamp(
        proj.distanceMeters / LABEL_FULL_SIZE_DISTANCE,
        1,
        MAX_LABEL_SCALE,
      );
      label.material.opacity = label.opacity;
      label.sprite.visible = true;
      label.sprite.position.copy(_tmp);
      label.sprite.position.y += 0.07 * scale;
      label.sprite.scale.set(0.26 * scale, 0.065 * scale, 1);
    }
    for (const [id, label] of this.labels) {
      if (live.has(id)) continue;
      this.root.remove(label.sprite);
      label.material.dispose();
      label.texture.dispose();
      this.labels.delete(id);
    }
  }

  private createLabel(): PinLabel {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 4;
    sprite.visible = false;
    this.root.add(sprite);
    return {sprite, canvas, texture, material, key: '', opacity: 0};
  }

  private drawLabel(label: PinLabel, pin: SpatialPin) {
    const ctx = label.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 128);
    roundRectPath(ctx, 4, 14, 504, 100, 50);
    ctx.fillStyle = PANEL_BG;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(58, 64, 16, 0, Math.PI * 2);
    this.fillPinColor(ctx, pin);
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `600 40px ${FONT_BODY}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, pin.title || 'Untitled pin', 380), 92, 66);
    ctx.textBaseline = 'alphabetic';
    label.texture.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------
  // Aiming rays
  // ---------------------------------------------------------------------------

  public updatePointers(rays: XRPointerRay[]) {
    while (this.pointers.length < rays.length) {
      const line = new THREE.Line(this.pointerLineGeo, this.pointerLineMat);
      line.frustumCulled = false;
      const dot = new THREE.Mesh(this.pointerDotGeo, this.pointerDotMat);
      dot.renderOrder = 10;
      this.root.add(line, dot);
      this.pointers.push({line, dot});
    }
    this.pointers.forEach((pointer, i) => {
      const ray = rays[i];
      if (!ray) {
        pointer.line.visible = false;
        pointer.dot.visible = false;
        return;
      }
      const length = Math.min(ray.distance, 3);
      pointer.line.visible = true;
      pointer.line.position.copy(ray.origin);
      pointer.line.quaternion.copy(ray.quaternion);
      pointer.line.scale.set(1, 1, length);
      pointer.dot.visible = ray.showDot;
      if (ray.showDot) {
        _tmp.set(0, 0, -1).applyQuaternion(ray.quaternion);
        pointer.dot.position.copy(ray.origin).addScaledVector(_tmp, ray.distance);
        pointer.dot.scale.setScalar(THREE.MathUtils.clamp(ray.distance, 0.4, 3));
      }
    });
  }

  public dispose() {
    this.disposed = true;
    this.hud.dispose();
    this.chip.dispose();
    this.drawer.dispose();
    this.card.dispose();
    this.zoneBar.dispose();
    this.editor.dispose();
    for (const label of this.labels.values()) {
      label.material.dispose();
      label.texture.dispose();
    }
    this.labels.clear();
    this.leaderGeo.dispose();
    this.leaderMat.dispose();
    this.pointerLineGeo.dispose();
    this.pointerLineMat.dispose();
    this.pointerDotGeo.dispose();
    this.pointerDotMat.dispose();
  }
}
