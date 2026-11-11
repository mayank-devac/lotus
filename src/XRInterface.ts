import * as THREE from 'three';
import {IconName, drawIcon} from './icons';
import {AppMode, LotusTask, PinScreenProjection, SpatialPin} from './types';
import {XRTextInputMethod} from './xrTextInput';

/**
 * In-headset interface. The DOM overlay (LotusUI) is not composited into an
 * immersive session, so everything the user needs while wearing the headset is
 * drawn here as canvas-textured panels in the 3D scene:
 *  - a control panel that lazily follows the head (timer, place pin, focus
 *    area, tasks / pins / settings drawer, hide, exit). Hidden, it shrinks to
 *    a small world-locked chip that stays where it was left.
 *  - a drawer above the control panel: tasks, the pin list, or settings
 *  - a card for an opened pin, held at a readable distance between the user
 *    and the pin, with a leader line to the pin
 *  - a title label above pins that are hovered or within proximity
 *  - a ray and cursor dot per controller / hand so the user can see where they aim
 *
 * Buttons are icons (see icons.ts); the name of the button under the ray shows
 * in the panel's status line. Hit testing is done by the caller's raycaster
 * against the panel planes, so it works the same for controllers and hands.
 */

export type XRHudAction =
  | 'toggle-timer'
  | 'place-pin'
  | 'focus-zone'
  | 'tab-tasks'
  | 'tab-pins'
  | 'tab-settings'
  | 'hide-hud'
  | 'exit-xr';
export type XRChipAction = 'show-hud';
export type XRDrawerTab = 'tasks' | 'pins' | 'settings';
export type XRDrawerAction =
  | `task:${string}`
  | `pin:${string}`
  | 'page-prev'
  | 'page-next'
  | 'minutes-down'
  | 'minutes-up'
  | 'sound'
  | 'labels'
  | 'dim';
export type XRCardAction =
  | 'close'
  | 'delete'
  | 'edit-title'
  | 'edit-note'
  | 'color'
  | 'shape';

export interface XRHudState {
  clock: string;
  timerRunning: boolean;
  mode: AppMode;
}

export type XRLabelMode = 'hover' | 'nearby' | 'always';

/** What the drawer shows; supplied every frame while it is open. */
export interface XRDrawerData {
  tasks: LotusTask[];
  /** Nearest first. */
  pins: {pin: SpatialPin; distance: number}[];
  settings: {
    /** Countdown length in minutes, or null in stopwatch mode. */
    focusMinutes: number | null;
    sound: boolean;
    labels: XRLabelMode;
    /** How strongly the room is dimmed while focusing, 0–100. */
    dimPercent: number;
  };
}

/** A ray resting on a panel; `action` is null over the panel body. */
export type XRPanelHit =
  | {panel: 'hud'; distance: number; action: XRHudAction | null}
  | {panel: 'chip'; distance: number; action: XRChipAction | null}
  | {panel: 'drawer'; distance: number; action: XRDrawerAction | null}
  | {panel: 'card'; distance: number; action: XRCardAction | null};

export interface XRPointerRay {
  origin: THREE.Vector3;
  quaternion: THREE.Quaternion;
  distance: number;
  showDot: boolean;
}

interface PanelButton<Id extends string> {
  id: Id;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ButtonContent {
  icon?: IconName;
  text?: string;
  /** Custom painter for the button face (drawn after the background). */
  paint?: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
}

/** What the control panel says when no temporary message is showing. */
const MODE_HINTS: Record<AppMode, string> = {
  'explore': 'Pinch a pin to open it, drag to move it',
  'pin-add': 'Pinch where the pin should go',
  'focus-drag': 'Pinch and drag across your focus area',
};

const LABEL_MODE_TEXT: Record<XRLabelMode, string> = {
  hover: 'When pointed at',
  nearby: 'When nearby',
  always: 'Always',
};

const FONT_BODY = '"Space Grotesk", system-ui, sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, monospace';
const ACCENT = '#E84D2B';
const PANEL_BG = 'rgba(22, 22, 20, 0.92)';
const BUTTON_BG = 'rgba(255, 255, 255, 0.1)';
const BUTTON_HOVER_BG = 'rgba(255, 255, 255, 0.26)';
const DANGER_BG = 'rgba(244, 63, 94, 0.3)';
const DANGER_HOVER_BG = 'rgba(244, 63, 94, 0.6)';
const TEXT_MAIN = '#F5F4EF';
const TEXT_DIM = '#B9B8B0';

/**
 * Comfortable viewing distance for the control panel: Meta's guidance is to
 * keep ray-targeted UI at 1 m or more and out of the 0.5–0.8 m band. Panel
 * sizes below are given at REFERENCE_DISTANCE and scaled to keep the same
 * angular size wherever a panel sits.
 */
const REFERENCE_DISTANCE = 0.55;
const HUD_DISTANCE = 1.1;
/** Below eye level by ~14°, so it does not cover what the user looks at. */
const HUD_DROP_RADIANS = 0.25;
const HUD_SCALE = HUD_DISTANCE / REFERENCE_DISTANCE;
/** The control panel catches up once it is this far (m) from where it should be. */
const HUD_FOLLOW_START = 0.5;
/** Rays that just miss a panel's edge still count, up to this many metres. */
const PANEL_EDGE_MARGIN = 0.015;
/** Gaps between buttons resolve to the nearest button within this (px). */
const BUTTON_HIT_PAD_PX = 12;
/** The hovered button keeps hover a bit further out, so jitter can't flicker it. */
const BUTTON_HOVER_KEEP_PX = 24;

/**
 * The pin card sits between the user and the pin, within this range, so a
 * far pin's card is still at a readable, comfortable distance.
 */
const CARD_MIN_DISTANCE = 0.9;
const CARD_MAX_DISTANCE = 1.2;
/** Card size is defined at this distance, then scaled to keep its angular size. */
const CARD_REFERENCE_DISTANCE = 0.72;
/** Pin labels keep their natural size up to here, then grow with distance. */
const LABEL_FULL_SIZE_DISTANCE = 0.8;
const MAX_LABEL_SCALE = 30;
const LABEL_FADE_RATE = 12;

const ROWS_PER_PAGE = 4;

const _camPos = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _target = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _hitInverse = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _hitLocal = new THREE.Vector3();
const _hitWorld = new THREE.Vector3();
const _hitScale = new THREE.Vector3();

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(fitText(ctx, line, maxWidth));
  }
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = fitText(ctx, `${cut[maxLines - 1]}…`, maxWidth);
    return cut;
  }
  return lines;
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}…`;
}

function formatDistance(meters: number): string {
  return meters < 10 ? `${meters.toFixed(1)} m` : `${Math.round(meters)} m`;
}

/** A flat panel whose face is a 2D canvas with rectangular button regions. */
class CanvasPanel<Id extends string> {
  public readonly mesh: THREE.Mesh;
  public readonly ctx: CanvasRenderingContext2D;
  public buttons: PanelButton<Id>[] = [];
  public hoveredButton: Id | null = null;
  private readonly canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private geometry: THREE.PlaneGeometry;
  private material: THREE.MeshBasicMaterial;

  constructor(
    public readonly widthMeters: number,
    public readonly heightMeters: number,
    public readonly pxWidth: number,
    public readonly pxHeight: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxWidth;
    this.canvas.height = pxHeight;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.geometry = new THREE.PlaneGeometry(widthMeters, heightMeters);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      // Fully transparent corners must not write depth, or they would punch
      // undimmed holes into the focus dim behind the panel.
      alphaTest: 0.05,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 5;
  }

  public clear() {
    this.ctx.clearRect(0, 0, this.pxWidth, this.pxHeight);
    this.buttons = [];
  }

  public drawBackground(radius = 36) {
    const {ctx} = this;
    roundRectPath(ctx, 4, 4, this.pxWidth - 8, this.pxHeight - 8, radius);
    ctx.fillStyle = PANEL_BG;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.stroke();
  }

  /**
   * A button region. `label` names the button; it is what the status line
   * shows while the ray rests on it.
   */
  public drawButton(
    id: Id,
    label: string,
    content: ButtonContent,
    x: number,
    y: number,
    w: number,
    h: number,
    opts: {active?: boolean; danger?: boolean; armed?: boolean} = {},
  ) {
    const {ctx} = this;
    const hovered = this.hoveredButton === id;
    roundRectPath(ctx, x, y, w, h, 22);
    if (opts.active || opts.armed) {
      ctx.fillStyle = opts.armed ? '#E11D48' : ACCENT;
    } else if (opts.danger) {
      ctx.fillStyle = hovered ? DANGER_HOVER_BG : DANGER_BG;
    } else {
      ctx.fillStyle = hovered ? BUTTON_HOVER_BG : BUTTON_BG;
    }
    ctx.fill();
    if (hovered) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
    }
    if (content.paint) {
      content.paint(ctx, x, y, w, h);
    } else if (content.icon) {
      const size = Math.min(52, h * 0.5, w * 0.5);
      drawIcon(ctx, content.icon, x + w / 2, y + h / 2, size, TEXT_MAIN);
    } else if (content.text) {
      ctx.fillStyle = TEXT_MAIN;
      ctx.font = `600 28px ${FONT_BODY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, content.text, w - 20), x + w / 2, y + h / 2 + 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    this.buttons.push({id, label, x, y, w, h});
  }

  /** Name of the button under the ray, if any. */
  public hoveredLabel(): string | null {
    if (!this.hoveredButton) return null;
    return this.buttons.find((b) => b.id === this.hoveredButton)?.label ?? null;
  }

  public commit() {
    this.texture.needsUpdate = true;
  }

  public isShown(): boolean {
    let o: THREE.Object3D | null = this.mesh;
    while (o) {
      if (!o.visible) return false;
      o = o.parent;
    }
    return true;
  }

  /**
   * Returns the hit distance and the button under the ray, if any.
   *
   * Intersects the panel's plane directly instead of its triangles, so a ray
   * grazing the edge (within PANEL_EDGE_MARGIN) still lands, and picks the
   * nearest button within a few pixels so the gaps between buttons aren't
   * dead zones.
   */
  public hit(
    raycaster: THREE.Raycaster,
  ): {distance: number; buttonId: Id | null} | null {
    if (!this.isShown()) return null;
    const mesh = this.mesh;
    mesh.updateWorldMatrix(true, false);
    _hitInverse.copy(mesh.matrixWorld).invert();
    _localRay.copy(raycaster.ray).applyMatrix4(_hitInverse);
    // Panel is the local z = 0 plane.
    if (Math.abs(_localRay.direction.z) < 1e-6) return null;
    const t = -_localRay.origin.z / _localRay.direction.z;
    if (t < 0) return null;
    _localRay.at(t, _hitLocal);
    const scale = mesh.getWorldScale(_hitScale).x || 1;
    const margin = PANEL_EDGE_MARGIN / scale;
    const halfW = this.widthMeters / 2;
    const halfH = this.heightMeters / 2;
    if (Math.abs(_hitLocal.x) > halfW + margin) return null;
    if (Math.abs(_hitLocal.y) > halfH + margin) return null;
    _hitWorld.copy(_hitLocal).applyMatrix4(mesh.matrixWorld);
    const distance = _hitWorld.distanceTo(raycaster.ray.origin);
    if (distance < raycaster.near || distance > raycaster.far) return null;

    const px = (_hitLocal.x / this.widthMeters + 0.5) * this.pxWidth;
    const py = (0.5 - _hitLocal.y / this.heightMeters) * this.pxHeight;
    let best: PanelButton<Id> | null = null;
    let bestGap = Infinity;
    for (const b of this.buttons) {
      const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
      const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
      const gap = Math.hypot(dx, dy);
      const pad =
        b.id === this.hoveredButton ? BUTTON_HOVER_KEEP_PX : BUTTON_HIT_PAD_PX;
      if (gap <= pad && gap < bestGap) {
        best = b;
        bestGap = gap;
      }
    }
    return {distance, buttonId: best?.id ?? null};
  }

  public dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
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
  /** Decides the card's text buttons; set when a session starts. */
  private textInput: XRTextInputMethod = 'none';

  // Control panel (720 × 360 px at 0.36 × 0.18 m) and its hidden-state chip.
  private hud = new CanvasPanel<XRHudAction>(0.36, 0.18, 720, 360);
  private chip = new CanvasPanel<XRChipAction>(0.15, 0.06, 300, 120);
  private hudState: XRHudState = {
    clock: '00:00',
    timerRunning: false,
    mode: 'explore',
  };
  private hudStatus = '';
  private flashText = '';
  private flashUntil = 0;
  private hudKey = '';
  private chipKey = '';
  private hudNeedsSnap = true;
  private hudFollowing = false;
  private hudHidden = false;

  // Drawer above the control panel.
  private drawer = new CanvasPanel<XRDrawerAction>(0.36, 0.28, 720, 560);
  private drawerTab: XRDrawerTab | null = null;
  private drawerPage = 0;
  private drawerKey = '';
  private drawerData: XRDrawerData | null = null;

  // Pin card.
  private card = new CanvasPanel<XRCardAction>(0.36, 0.3, 720, 600);
  private cardPin: SpatialPin | null = null;
  private cardStatus = '';
  private deleteArmedUntil = 0;
  private cardNeedsSnap = true;
  private cardFollowing = false;
  private leaderGeo: THREE.BufferGeometry;
  private leaderMat: THREE.LineBasicMaterial;
  private leader: THREE.Line;

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
    this.card.mesh.visible = false;
    this.chip.mesh.visible = false;
    this.drawer.mesh.visible = false;
    // The drawer rides on the control panel, just above it.
    this.drawer.mesh.position.set(0, (0.18 + 0.28) / 2 + 0.012, 0);
    this.hud.mesh.add(this.drawer.mesh);
    this.root.add(this.hud.mesh, this.chip.mesh, this.card.mesh);

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
        for (const label of this.labels.values()) label.key = '';
        this.drawHud();
        if (this.cardPin) this.drawCard();
      });
  }

  public setTextInputMethod(method: XRTextInputMethod) {
    this.textInput = method;
    if (this.cardPin) this.drawCard();
  }

  public setActive(active: boolean) {
    this.root.visible = active;
    this.flashText = '';
    if (active) {
      this.hudNeedsSnap = true;
      this.setHudHidden(false);
    } else {
      this.closeCard();
      this.setDrawerTab(null);
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

  /** Shows a temporary message on the control panel in place of the mode hint. */
  public flashStatus(text: string, seconds = 4) {
    this.flashText = text;
    this.flashUntil = performance.now() + seconds * 1000;
  }

  public isHudHidden(): boolean {
    return this.hudHidden;
  }

  /**
   * Hidden, the panel turns into a small chip left exactly where the panel
   * was: it does not follow the head. Shown again, the panel appears in front
   * of the user.
   */
  public setHudHidden(hidden: boolean) {
    if (this.hudHidden === hidden) return;
    this.hudHidden = hidden;
    this.hud.mesh.visible = !hidden;
    this.chip.mesh.visible = hidden;
    this.hud.hoveredButton = null;
    this.chip.hoveredButton = null;
    if (hidden) {
      this.chip.mesh.position.copy(this.hud.mesh.position);
      this.chip.mesh.quaternion.copy(this.hud.mesh.quaternion);
      this.chip.mesh.scale.setScalar(HUD_SCALE);
      this.chipKey = '';
    } else {
      this.hudNeedsSnap = true;
      this.hudKey = '';
    }
  }

  public updateHud(state: XRHudState, camera: THREE.Camera, delta: number) {
    const now = performance.now();
    const status =
      this.hud.hoveredLabel() ??
      (this.flashText && now < this.flashUntil ? this.flashText : MODE_HINTS[state.mode]);
    camera.getWorldPosition(_camPos);

    if (this.hudHidden) {
      const key = `${state.clock}|${state.timerRunning}|${this.chip.hoveredButton}`;
      if (key !== this.chipKey) {
        this.chipKey = key;
        this.hudState = state;
        this.drawChip();
      }
      // World-locked: only turn to face the user so it stays readable.
      this.chip.mesh.lookAt(_camPos);
      return;
    }

    const key = `${state.clock}|${state.timerRunning}|${state.mode}|${status}|${this.hud.hoveredButton}|${this.drawerTab}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.hudState = state;
      this.hudStatus = status;
      this.drawHud();
    }

    // Lazy follow: stay put while the user works, catch up once they turn or
    // walk away, so the panel never chases every small head movement.
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    if (_forward.lengthSq() > 0.0001) {
      _forward.normalize();
      _target.copy(_camPos).addScaledVector(_forward, HUD_DISTANCE);
      _target.y = _camPos.y - Math.tan(HUD_DROP_RADIANS) * HUD_DISTANCE;
      const mesh = this.hud.mesh;
      mesh.scale.setScalar(HUD_SCALE);
      if (this.hudNeedsSnap) {
        mesh.position.copy(_target);
        this.hudNeedsSnap = false;
        this.hudFollowing = false;
      } else {
        const offBy = mesh.position.distanceTo(_target);
        // Never move the panel out from under a ray that is using it.
        if (offBy > HUD_FOLLOW_START && !this.isHudInUse()) {
          this.hudFollowing = true;
        }
        if (this.hudFollowing) {
          mesh.position.lerp(_target, 1 - Math.exp(-5 * delta));
          if (offBy < 0.03) this.hudFollowing = false;
        }
      }
    }
    this.hud.mesh.lookAt(_camPos);
  }

  private isHudInUse(): boolean {
    return this.hud.hoveredButton !== null || this.drawer.hoveredButton !== null;
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

    hud.drawButton('hide-hud', 'Hide panel', {icon: 'eyeOff'}, 610, 26, 84, 84);

    const y = 214;
    const h = 116;
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
    hud.drawButton('place-pin', 'Place pin', {icon: 'pin'}, next(), y, w, h, {
      active: s.mode === 'pin-add',
    });
    hud.drawButton('focus-zone', 'Set focus area', {icon: 'focusArea'}, next(), y, w, h, {
      active: s.mode === 'focus-drag',
    });
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
          c.textBaseline = 'alphabetic';
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
    this.drawer.mesh.visible = tab !== null;
    this.drawer.hoveredButton = null;
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
    const key = this.drawerTabKey(data);
    if (key === this.drawerKey) return;
    this.drawerKey = key;
    this.drawDrawer();
  }

  private drawerTabKey(data: XRDrawerData): string {
    const head = `${this.drawerTab}|${this.drawerPage}|${this.drawer.hoveredButton}`;
    switch (this.drawerTab) {
      case 'tasks':
        return `${head}|${data.tasks.map((t) => `${t.id}:${t.title}:${t.completed}`).join(',')}`;
      case 'pins':
        return `${head}|${data.pins
          .map((p) => `${p.pin.id}:${p.pin.title}:${p.pin.color}:${p.distance.toFixed(1)}`)
          .join(',')}`;
      case 'settings':
        return `${head}|${JSON.stringify(data.settings)}`;
      default:
        return head;
    }
  }

  private drawDrawer() {
    const data = this.drawerData;
    const tab = this.drawerTab;
    if (!data || !tab) return;
    const {drawer} = this;
    const {ctx} = drawer;
    drawer.clear();
    drawer.drawBackground();

    const title = tab === 'tasks' ? 'Tasks' : tab === 'pins' ? 'Pins' : 'Settings';
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `700 34px ${FONT_BODY}`;
    ctx.fillText(title, 36, 64);

    if (tab === 'settings') {
      this.drawSettings(data.settings);
      drawer.commit();
      return;
    }

    const rows =
      tab === 'tasks'
        ? [...data.tasks].sort((a, b) => Number(a.completed) - Number(b.completed))
        : data.pins;
    const pages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    this.drawerPage = Math.min(this.drawerPage, pages - 1);
    if (pages > 1) {
      ctx.fillStyle = TEXT_DIM;
      ctx.font = `500 26px ${FONT_BODY}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${this.drawerPage + 1} / ${pages}`, 520, 62);
      ctx.textAlign = 'left';
      drawer.drawButton('page-prev', 'Previous page', {icon: 'chevronLeft'}, 540, 22, 72, 64);
      drawer.drawButton('page-next', 'Next page', {icon: 'chevronRight'}, 624, 22, 72, 64);
    }

    if (rows.length === 0) {
      ctx.fillStyle = TEXT_DIM;
      ctx.font = `500 28px ${FONT_BODY}`;
      const empty =
        tab === 'tasks'
          ? 'No tasks yet. Add tasks on the 2D screen.'
          : 'No pins yet. Use the pin button to place one.';
      wrapLines(ctx, empty, 640, 3).forEach((line, i) =>
        ctx.fillText(line, 36, 150 + i * 40),
      );
      drawer.commit();
      return;
    }

    const start = this.drawerPage * ROWS_PER_PAGE;
    const visible = rows.slice(start, start + ROWS_PER_PAGE);
    visible.forEach((row, i) => {
      const y = 104 + i * 112;
      if (tab === 'tasks') {
        const task = row as LotusTask;
        drawer.drawButton(
          `task:${task.id}`,
          task.completed ? 'Mark as not done' : 'Mark as done',
          {
            paint: (c, x, by, w, h) => {
              drawIcon(c, task.completed ? 'check' : 'box', x + 48, by + h / 2, 40,
                task.completed ? ACCENT : TEXT_MAIN);
              c.fillStyle = task.completed ? TEXT_DIM : TEXT_MAIN;
              c.font = `600 30px ${FONT_BODY}`;
              c.fillText(fitText(c, task.title, w - 120), x + 92, by + (task.dueLabel ? 44 : 58));
              if (task.dueLabel) {
                c.fillStyle = TEXT_DIM;
                c.font = `500 24px ${FONT_BODY}`;
                c.fillText(fitText(c, task.dueLabel, w - 120), x + 92, by + 78);
              }
            },
          },
          28, y, 664, 100,
        );
      } else {
        const {pin, distance} = row as XRDrawerData['pins'][number];
        drawer.drawButton(
          `pin:${pin.id}`,
          `Open "${pin.title}"`,
          {
            paint: (c, x, by, w, h) => {
              c.beginPath();
              c.arc(x + 46, by + h / 2, 16, 0, Math.PI * 2);
              c.fillStyle = pin.color || ACCENT;
              c.fill();
              c.fillStyle = TEXT_MAIN;
              c.font = `600 30px ${FONT_BODY}`;
              c.fillText(fitText(c, pin.title || 'Untitled pin', w - 230), x + 84, by + 46);
              c.fillStyle = TEXT_DIM;
              c.font = `500 24px ${FONT_BODY}`;
              c.fillText(fitText(c, pin.surfaceLabel || 'Room', w - 230), x + 84, by + 80);
              c.font = `600 28px ${FONT_MONO}`;
              c.textAlign = 'right';
              c.fillText(formatDistance(distance), x + w - 28, by + h / 2 + 10);
              c.textAlign = 'left';
            },
          },
          28, y, 664, 100,
        );
      }
    });
    drawer.commit();
  }

  private drawSettings(s: XRDrawerData['settings']) {
    const {drawer} = this;
    const {ctx} = drawer;
    const rowLabel = (text: string, y: number) => {
      ctx.fillStyle = TEXT_MAIN;
      ctx.font = `600 30px ${FONT_BODY}`;
      ctx.fillText(text, 36, y + 60);
    };

    // 1. Focus length: − value +
    let y = 104;
    rowLabel('Focus length', y);
    drawer.drawButton('minutes-down', 'Shorter focus', {icon: 'minus'}, 380, y, 84, 100);
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `700 30px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(s.focusMinutes === null ? 'Watch' : `${s.focusMinutes}m`, 527, y + 60);
    ctx.textAlign = 'left';
    drawer.drawButton('minutes-up', 'Longer focus', {icon: 'plus'}, 592, y, 84, 100);

    // 2–4. Toggle / cycle rows: the whole value pill is the button.
    const cycle = (
      id: XRDrawerAction,
      label: string,
      name: string,
      content: ButtonContent,
      rowY: number,
    ) => {
      rowLabel(name, rowY);
      drawer.drawButton(id, label, content, 380, rowY, 296, 100);
    };
    y += 112;
    cycle('sound', s.sound ? 'Turn sound off' : 'Turn sound on', 'Sound', {
      paint: (c, x, by, _w, h) => {
        drawIcon(c, s.sound ? 'soundOn' : 'soundOff', x + 52, by + h / 2, 40, TEXT_MAIN);
        c.fillStyle = TEXT_MAIN;
        c.font = `600 28px ${FONT_BODY}`;
        c.fillText(s.sound ? 'On' : 'Off', x + 96, by + h / 2 + 10);
      },
    }, y);
    y += 112;
    cycle('labels', 'Change when pin titles show', 'Pin titles', {
      text: LABEL_MODE_TEXT[s.labels],
    }, y);
    y += 112;
    cycle('dim', 'Change how much the room dims', 'Focus dim', {
      text: `${s.dimPercent}%`,
    }, y);
  }

  // ---------------------------------------------------------------------------
  // Pin card
  // ---------------------------------------------------------------------------

  public openCard(pin: SpatialPin) {
    if (this.cardPin?.id !== pin.id) this.cardNeedsSnap = true;
    this.cardPin = pin;
    this.cardStatus = '';
    this.deleteArmedUntil = 0;
    this.card.mesh.visible = true;
    this.drawCard();
  }

  public closeCard() {
    this.cardPin = null;
    this.cardStatus = '';
    this.deleteArmedUntil = 0;
    this.card.mesh.visible = false;
    this.card.hoveredButton = null;
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

  public setCardStatus(text: string) {
    if (this.cardStatus === text) return;
    this.cardStatus = text;
    if (this.cardPin) this.drawCard();
  }

  /**
   * Delete needs two presses. The first arms the button for a few seconds and
   * returns false; the second, while armed, returns true.
   */
  public confirmDelete(): boolean {
    const now = performance.now();
    if (now < this.deleteArmedUntil) {
      this.deleteArmedUntil = 0;
      return true;
    }
    this.deleteArmedUntil = now + 4000;
    this.drawCard();
    return false;
  }

  /**
   * Holds the card between the user and the pin at a comfortable distance
   * (CARD_MIN_DISTANCE–CARD_MAX_DISTANCE), just above the line of sight to the
   * pin, at a constant angular size. A far pin's card is therefore as large
   * and sharp as a near one's; a thin leader line points to the pin.
   */
  public updateCard(camera: THREE.Camera, pinWorldPos: THREE.Vector3, delta: number) {
    if (!this.cardPin) return;
    if (this.deleteArmedUntil && performance.now() >= this.deleteArmedUntil) {
      this.deleteArmedUntil = 0;
      this.drawCard();
    }
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
      this.cardFollowing = false;
    } else {
      // Lazy follow, as for the control panel: leaning in to press a button
      // must not slide the card away from the ray.
      const offBy = mesh.position.distanceTo(_target);
      if (offBy > 0.18 && this.card.hoveredButton === null) this.cardFollowing = true;
      if (this.cardFollowing) {
        mesh.position.lerp(_target, 1 - Math.exp(-6 * delta));
        if (offBy < 0.02) this.cardFollowing = false;
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
    const {ctx} = card;
    card.clear();
    card.drawBackground();

    roundRectPath(ctx, 36, 40, 12, 100, 6);
    ctx.fillStyle = pin.color || ACCENT;
    ctx.fill();

    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `700 44px ${FONT_BODY}`;
    const titleLines = wrapLines(ctx, pin.title || 'Untitled pin', 620, 2);
    titleLines.forEach((line, i) => ctx.fillText(line, 66, 82 + i * 52));

    let y = 82 + titleLines.length * 52;
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `500 26px ${FONT_BODY}`;
    ctx.fillText(fitText(ctx, pin.surfaceLabel || 'Room', 620), 66, y - 6);
    y += 46;

    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `400 30px ${FONT_BODY}`;
    const maxBodyLines = Math.max(1, Math.floor((436 - y) / 40));
    const bodyLines = wrapLines(ctx, pin.body || '', 648, maxBodyLines);
    bodyLines.forEach((line, i) => ctx.fillText(line, 36, y + i * 40));

    const armed = performance.now() < this.deleteArmedUntil;
    const status =
      card.hoveredLabel() ?? (armed ? 'Press delete again to remove this pin' : this.cardStatus);
    if (status) {
      ctx.fillStyle = armed ? '#FB7185' : ACCENT;
      ctx.font = `600 26px ${FONT_BODY}`;
      ctx.fillText(fitText(ctx, status, 648), 36, 470);
    }

    const by = 496;
    const bh = 84;
    const verb = this.textInput === 'keyboard' ? 'Type' : 'Say';
    const buttons: {id: XRCardAction; label: string; content: ButtonContent; danger?: boolean}[] = [
      {id: 'close', label: 'Close', content: {icon: 'close'}},
    ];
    if (this.textInput !== 'none') {
      buttons.push(
        {id: 'edit-title', label: `${verb} title`, content: {icon: this.textInput === 'voice' ? 'mic' : 'title'}},
        {id: 'edit-note', label: `${verb} note`, content: {icon: this.textInput === 'voice' ? 'mic' : 'note'}},
      );
    }
    buttons.push(
      {
        id: 'color',
        label: 'Change colour',
        content: {
          paint: (c, x, bY, w, h) => {
            c.beginPath();
            c.arc(x + w / 2, bY + h / 2, 20, 0, Math.PI * 2);
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
      {id: 'delete', label: armed ? 'Confirm delete' : 'Delete pin', content: {icon: armed ? 'check' : 'trash'}, danger: true},
    );
    const gap = 14;
    const w = Math.min(130, (648 - gap * (buttons.length - 1)) / buttons.length);
    let x = 36;
    for (const b of buttons) {
      card.drawButton(b.id, b.label, b.content, x, by, w, bh, {
        danger: b.danger,
        armed: b.id === 'delete' && armed,
      });
      x += w + gap;
    }
    card.commit();
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
    return best;
  }

  /** Highlight the button a ray is resting on. Pass null to clear. */
  public setPanelHover(hit: XRPanelHit | null) {
    // The control panel, chip and drawer redraw from their update calls,
    // which key on the hover.
    this.hud.hoveredButton = hit?.panel === 'hud' ? hit.action : null;
    this.chip.hoveredButton = hit?.panel === 'chip' ? hit.action : null;
    const drawerHover = hit?.panel === 'drawer' ? hit.action : null;
    if (this.drawer.hoveredButton !== drawerHover) {
      this.drawer.hoveredButton = drawerHover;
      this.drawerKey = '';
    }
    const cardHover = hit?.panel === 'card' ? hit.action : null;
    if (this.card.hoveredButton !== cardHover) {
      this.card.hoveredButton = cardHover;
      if (this.cardPin) this.drawCard();
    }
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
    ctx.fillStyle = pin.color || ACCENT;
    ctx.fill();
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
