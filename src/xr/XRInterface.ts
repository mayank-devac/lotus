import * as THREE from 'three';
import {PinScreenProjection, SpatialPin} from '../types';
import {
  ACCENT,
  CanvasPanel,
  FONT_BODY,
  FONT_MONO,
  PANEL_BG,
  RestingSpot,
  TEXT_DIM,
  TEXT_MAIN,
  fitText,
  restingPosition,
  roundRectPath,
} from './XRPanel';
import {XRDrawer} from './XRDrawer';
import {
  XRChipAction,
  XRDrawerData,
  XRDrawerTab,
  XRHudAction,
  XRHudState,
  XRMovablePanel,
  XRPanelHit,
  XRPointerRay,
  XRZoneAction,
} from './XRInterfaceTypes';
import {XRPinCard} from './XRPinCard';
import {XRPinLabels} from './XRPinLabels';
import {XRPointers} from './XRPointers';
import {XRTextEditor} from './XRTextEditor';
import {drawIcon} from './icons';
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

const _camPos = new THREE.Vector3();
/** The button ids of panel `P`. */
type ActionOn<P extends XRPanelHit['panel']> = NonNullable<
  Extract<XRPanelHit, {panel: P}>['action']
>;

/** The buttons of `panel` that the hits rest on (CanvasPanel drops repeats). */
function hoveredOn<P extends XRPanelHit['panel']>(
  hits: XRPanelHit[],
  panel: P,
): ActionOn<P>[] {
  const actions: ActionOn<P>[] = [];
  for (const hit of hits) {
    // Safe: a hit on `panel` carries that panel's actions (see XRPanelHit);
    // TypeScript cannot narrow a union through a generic `P`.
    if (hit.panel === panel && hit.action) actions.push(hit.action as ActionOn<P>);
  }
  return actions;
}

/** Part of a redraw key: the task timer pill's clock and run state, or "none". */
function taskTimerKey(taskTimer: XRHudState['taskTimer']): string {
  return taskTimer ? `${taskTimer.clock}|${taskTimer.running}` : 'none';
}

export class XRInterface {
  public readonly root = new THREE.Group();
  public readonly editor = new XRTextEditor();

  // Control panel (720 × 360 px at 0.36 × 0.18 m) and its hidden-state chip.
  private hud = new CanvasPanel<XRHudAction>(0.36, 0.18, 720, 360);
  private chip = new CanvasPanel<XRChipAction>(0.19, 0.06, 380, 120);
  private hudState: XRHudState = {
    clock: '00:00',
    timerRunning: false,
    timerPaused: false,
    taskTimer: null,
    mode: 'explore',
    hint: '',
    askingStart: false,
    exitArmed: false,
  };
  private hudStatus = '';
  private flashText = '';
  private flashUntil = 0;
  private hudKey = '';
  private chipKey = '';
  private hudHidden = false;
  private hudNeedsSnap = true;

  /** Drawer above the control panel (tasks, pins, settings). */
  private readonly drawer = new XRDrawer();
  private readonly card = new XRPinCard();
  // Confirm / cancel bar shown on the focus area while it is being set.
  private zoneBar = new CanvasPanel<XRZoneAction>(0.3, 0.07, 600, 140);
  private zoneBarKey = '';

  private readonly labels = new XRPinLabels(this.root);
  private readonly pointers = new XRPointers(this.root);
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
    this.drawer.panel.mesh.position.set(
      0,
      (this.hud.heightMeters + this.drawer.panel.heightMeters) / 2 + 0.012,
      0,
    );
    this.hud.mesh.add(this.drawer.panel.mesh);
    // The keyboard is drawn over everything else it may overlap.
    this.editor.panel.mesh.renderOrder = 6;
    this.root.add(
      this.hud.mesh,
      this.chip.mesh,
      this.card.panel.mesh,
      this.zoneBar.mesh,
      this.editor.panel.mesh,
    );
    this.root.add(this.card.leader);

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
        this.drawer.invalidate();
        this.zoneBarKey = '';
        this.labels.invalidate();
        this.drawHud();
        this.card.redraw();
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
      this.card.close();
      this.setDrawerTab(null);
      this.zoneBar.setVisible(false);
      this.updatePointers([], 0);
      this.labels.hideAll();
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
        return out.copy(this.card.panel.mesh.position);
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
        this.card.setPosition(position);
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
      const key = `${state.clock}|${state.timerRunning}|${state.timerPaused}|${taskTimerKey(state.taskTimer)}|${this.chip.hoverKey()}`;
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
      this.drawer.panel.hoveredLabel() ??
      (this.flashText && performance.now() < this.flashUntil ? this.flashText : state.hint);
    const key = `${state.clock}|${state.timerRunning}|${taskTimerKey(state.taskTimer)}|${state.mode}|${state.askingStart}|${state.exitArmed}|${status}|${this.hud.hoverKey()}|${this.drawer.getTab()}`;
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
      if (s.taskTimer) {
        // The task timer takes over the question as the full-text primary
        // choice; the two ways to start focus become icons beside it.
        const {running, clock} = s.taskTimer;
        hud.drawButton(
          'toggle-task-timer',
          `${running ? 'Pause' : 'Resume'} task${clock ? ` (${clock})` : ''}`,
          {text: `${running ? 'Pause' : 'Resume'} task${clock ? ` · ${clock}` : ''}`},
          30, y, 372, h,
          {active: !running, fontSize: 34},
        );
        hud.drawButton(
          'start-timer-only',
          'Just run the timer; the room stays clear',
          {icon: 'timer'},
          414, y, 84, h,
        );
        hud.drawButton(
          'start-with-area',
          'Dim everything outside your focus area',
          {icon: 'focusArea'},
          510, y, 84, h,
        );
        hud.drawButton('start-cancel', 'Do not start', {icon: 'close'}, 606, y, 84, h);
        hud.commit();
        return;
      }
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
      active: this.drawer.getTab() === 'tasks',
    });
    hud.drawButton('tab-pins', 'All pins', {icon: 'list'}, next(), y, w, h, {
      active: this.drawer.getTab() === 'pins',
    });
    hud.drawButton('tab-settings', 'Settings', {icon: 'settings'}, next(), y, w, h, {
      active: this.drawer.getTab() === 'settings',
    });
    hud.drawButton(
      'exit-xr',
      s.exitArmed ? 'Press again to exit XR' : 'Exit XR',
      {icon: s.exitArmed ? 'check' : 'exit'},
      next(), y, w, h,
      {danger: true, armed: s.exitArmed},
    );
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
      4, 4, 258, 112,
    );
    // While a session runs, its clock can be held and continued right here,
    // whichever mode it counts in; the panel stays hidden.
    if (s.timerRunning) {
      chip.drawButton(
        'timer-pause',
        s.timerPaused ? 'Resume the session clock' : 'Pause the session clock',
        {icon: s.timerPaused ? 'play' : 'pause'},
        266, 4, 110, 112,
        {active: !s.timerPaused},
      );
    }
    // Solid backdrop behind the translucent button colour, sized to the row:
    // with a session running the pause button joins the chip (372px wide),
    // without one only the eye button is there (258px).
    ctx.globalCompositeOperation = 'destination-over';
    roundRectPath(ctx, 4, 4, s.timerRunning ? 372 : 258, 112, 22);
    ctx.fillStyle = PANEL_BG;
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    chip.commit();
  }

  // ---------------------------------------------------------------------------
  // Drawer: tasks, pins, settings (drawn by XRDrawer)
  // ---------------------------------------------------------------------------

  public getDrawerTab(): XRDrawerTab | null {
    return this.drawer.getTab();
  }

  public setDrawerTab(tab: XRDrawerTab | null) {
    this.drawer.setTab(tab);
    this.hudKey = '';
  }

  public turnDrawerPage(step: 1 | -1) {
    this.drawer.turnPage(step);
  }

  /** Makes the next `updateDrawer` ask for fresh data and redraw, e.g. after a press. */
  public invalidateDrawer() {
    this.drawer.invalidate();
  }

  /** See `XRDrawer.update`; nothing happens while the control panel is hidden. */
  public updateDrawer(getData: () => XRDrawerData) {
    if (this.hudHidden) return;
    this.drawer.update(getData);
  }

  // ---------------------------------------------------------------------------
  // Pin card (drawn by XRPinCard)
  // ---------------------------------------------------------------------------

  public openCard(pin: SpatialPin) {
    this.card.open(pin);
  }

  public closeCard() {
    this.card.close();
  }

  public getCardPinId(): string | null {
    return this.card.getPinId();
  }

  /** Redraw after the pin changed. */
  public refreshCard(pin: SpatialPin) {
    this.card.refresh(pin);
  }

  /** Switches the card between reading the pin and its editable fields. */
  public setCardEditing(editing: boolean) {
    this.card.setEditing(editing);
  }

  public setCardStatus(text: string) {
    this.card.setStatus(text);
  }

  /** Shows the delete button as waiting for its confirming second press. */
  public setCardDeleteArmed(armed: boolean) {
    this.card.setDeleteArmed(armed);
  }

  /** See `XRPinCard.update`. */
  public updateCard(
    camera: THREE.Camera,
    pinWorldPos: THREE.Vector3,
    delta: number,
    held: boolean,
  ) {
    this.card.update(camera, pinWorldPos, delta, held);
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
    if (hud) consider({panel: 'hud', distance: hud.distance, action: hud.action});
    const chip = this.chip.hit(raycaster);
    if (chip) consider({panel: 'chip', distance: chip.distance, action: chip.action});
    const drawer = this.drawer.panel.hit(raycaster);
    if (drawer) consider({panel: 'drawer', distance: drawer.distance, action: drawer.action});
    const card = this.card.panel.hit(raycaster);
    if (card) consider({panel: 'card', distance: card.distance, action: card.action});
    const zone = this.zoneBar.hit(raycaster);
    if (zone) consider({panel: 'zone', distance: zone.distance, action: zone.action});
    if (this.editor.isOpen()) {
      const editor = this.editor.panel.hit(raycaster);
      if (editor) consider({panel: 'editor', distance: editor.distance, action: editor.action});
    }
    return best;
  }

  /** Highlights the buttons the rays rest on: one hit per hand, or none. */
  public setPanelHover(hits: XRPanelHit[]) {
    // The control panel, chip, drawer and focus bar redraw from their update
    // calls, which key on the hover.
    this.hud.setHovered(hoveredOn(hits, 'hud'));
    this.chip.setHovered(hoveredOn(hits, 'chip'));
    this.drawer.panel.setHovered(hoveredOn(hits, 'drawer'));
    this.zoneBar.setHovered(hoveredOn(hits, 'zone'));
    this.editor.setHovered(hoveredOn(hits, 'editor'));
    this.card.setHovered(hoveredOn(hits, 'card'));
  }

  // ---------------------------------------------------------------------------
  // Pin title labels and aiming rays
  // ---------------------------------------------------------------------------

  public updateLabels(
    pins: SpatialPin[],
    projections: PinScreenProjection[],
    getWorldPosition: (pinId: string, target: THREE.Vector3) => boolean,
    hoveredPinId: string | null,
    delta: number,
    runningTaskClocks: ReadonlyMap<string, string>,
  ) {
    this.labels.update(
      pins,
      projections,
      getWorldPosition,
      hoveredPinId,
      delta,
      this.card.getPinId(),
      runningTaskClocks,
    );
  }

  /**
   * Draws the first `count` rays of `rays` and hides every other pointer. The
   * count is separate so the caller can reuse one array without slicing it
   * each frame.
   */
  public updatePointers(rays: XRPointerRay[], count: number) {
    this.pointers.update(rays, count);
  }

  public dispose() {
    this.disposed = true;
    this.hud.dispose();
    this.chip.dispose();
    this.drawer.panel.dispose();
    this.card.dispose();
    this.zoneBar.dispose();
    this.editor.dispose();
    this.labels.dispose();
    this.pointers.dispose();
  }
}
