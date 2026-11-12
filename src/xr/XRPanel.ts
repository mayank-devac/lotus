import * as THREE from 'three';
import {IconName, drawIcon} from './icons';

/**
 * Building blocks for the in-headset panels: a canvas-textured plane with
 * rectangular button regions, the shared palette and text helpers, and the
 * placement helpers that decide where a panel rests in front of the user.
 */

export const FONT_BODY = '"Space Grotesk", system-ui, sans-serif';
export const FONT_MONO = '"JetBrains Mono", ui-monospace, monospace';
export const ACCENT = '#E84D2B';
export const PANEL_BG = 'rgba(22, 22, 20, 0.92)';
export const TEXT_MAIN = '#F5F4EF';
export const TEXT_DIM = '#B9B8B0';
export const DANGER_TEXT = '#FB7185';
const BUTTON_BG = 'rgba(255, 255, 255, 0.1)';
const BUTTON_HOVER_BG = 'rgba(255, 255, 255, 0.26)';
const DANGER_BG = 'rgba(244, 63, 94, 0.3)';
const DANGER_HOVER_BG = 'rgba(244, 63, 94, 0.6)';
const ARMED_BG = '#E11D48';

/** Rays that just miss a panel's edge still count, up to this many metres. */
const PANEL_EDGE_MARGIN = 0.015;
/** Gaps between buttons resolve to the nearest button within this (px). */
const BUTTON_HIT_PAD_PX = 12;
/** A hovered button keeps hover a bit further out, so jitter can't flicker it. */
const BUTTON_HOVER_KEEP_PX = 24;

const _hitInverse = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _hitLocal = new THREE.Vector3();
const _hitWorld = new THREE.Vector3();
const _hitScale = new THREE.Vector3();
const _heading = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _toPanel = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export interface PanelButton<Action> {
  action: Action;
  /** `action` as text: what hover and redraw keys compare. */
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ButtonContent {
  icon?: IconName;
  text?: string;
  /** Custom painter for the button face (drawn after the background). */
  paint?: (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
}

export interface ButtonStyle {
  /** Filled with the accent colour: the current mode, tab or main action. */
  active?: boolean;
  danger?: boolean;
  /** A destructive button waiting for its confirming second press. */
  armed?: boolean;
  /** Drawn faint. The button still reports presses so the caller can explain why. */
  disabled?: boolean;
  fontSize?: number;
}

export function roundRectPath(
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

/** Shortens `text` with an ellipsis at the end until it fits `maxWidth`. */
export function fitText(
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

/** Word-wraps `text` to `maxWidth`. Returns every line; see `wrapLines` to cap them. */
export function wrapAllLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
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
  return lines;
}

/** Word-wraps `text`, keeping the first `maxLines` lines and marking a cut with an ellipsis. */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines = wrapAllLines(ctx, text, maxWidth);
  if (lines.length <= maxLines) return lines;
  const cut = lines.slice(0, maxLines);
  cut[maxLines - 1] = fitText(ctx, `${cut[maxLines - 1]}…`, maxWidth);
  return cut;
}

/**
 * A flat panel whose face is a 2D canvas with rectangular button regions.
 * Each button carries an `Action`: a string id, or a typed object for buttons
 * that carry data (see the drawer). `keyOf` turns an action into the text
 * that hover and redraw keys compare; plain string ids are their own key.
 */
export class CanvasPanel<Action> {
  public readonly mesh: THREE.Mesh;
  public readonly ctx: CanvasRenderingContext2D;
  public buttons: PanelButton<Action>[] = [];
  /** Keys of the buttons a ray rests on right now: one per hand at most. */
  private hovered: string[] = [];
  private readonly canvas: HTMLCanvasElement;
  private texture: THREE.CanvasTexture;
  private geometry: THREE.PlaneGeometry;
  private material: THREE.MeshBasicMaterial;

  constructor(
    public readonly widthMeters: number,
    public readonly heightMeters: number,
    public readonly pxWidth: number,
    public readonly pxHeight: number,
    private readonly keyOf: (action: Action) => string = String,
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
    this.mesh.visible = false;
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
   * shows while a ray rests on it.
   */
  public drawButton(
    action: Action,
    label: string,
    content: ButtonContent,
    x: number,
    y: number,
    w: number,
    h: number,
    style: ButtonStyle = {},
  ) {
    const {ctx} = this;
    const key = this.keyOf(action);
    const hovered = this.hovered.includes(key);
    roundRectPath(ctx, x, y, w, h, 22);
    if (style.armed) {
      ctx.fillStyle = ARMED_BG;
    } else if (style.active) {
      ctx.fillStyle = ACCENT;
    } else if (style.danger) {
      ctx.fillStyle = hovered ? DANGER_HOVER_BG : DANGER_BG;
    } else {
      ctx.fillStyle = hovered ? BUTTON_HOVER_BG : BUTTON_BG;
    }
    ctx.save();
    if (style.disabled) ctx.globalAlpha = 0.45;
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
      ctx.font = `600 ${style.fontSize ?? 28}px ${FONT_BODY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, content.text, w - 20), x + w / 2, y + h / 2 + 2);
    }
    ctx.restore();
    this.buttons.push({action, key, label, x, y, w, h});
  }

  /**
   * Sets which buttons the rays rest on. Returns true when that changed, so
   * the owner knows to redraw.
   */
  public setHovered(actions: readonly Action[]): boolean {
    const keys = [...new Set(actions.map(this.keyOf))];
    const same =
      keys.length === this.hovered.length &&
      keys.every((key, i) => key === this.hovered[i]);
    if (!same) this.hovered = keys;
    return !same;
  }

  public isHovered(): boolean {
    return this.hovered.length > 0;
  }

  /** Stable text for redraw keys. */
  public hoverKey(): string {
    return this.hovered.join(',');
  }

  /** Name of a button under a ray, if any. */
  public hoveredLabel(): string | null {
    for (const key of this.hovered) {
      const button = this.buttons.find((b) => b.key === key);
      if (button) return button.label;
    }
    return null;
  }

  public commit() {
    this.texture.needsUpdate = true;
  }

  public setVisible(visible: boolean) {
    this.mesh.visible = visible;
    if (!visible) this.hovered = [];
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
  ): {distance: number; action: Action | null} | null {
    if (!this.isShown()) return null;
    const mesh = this.mesh;
    mesh.updateWorldMatrix(true, false);
    _hitInverse.copy(mesh.matrixWorld).invert();
    _localRay.copy(raycaster.ray).applyMatrix4(_hitInverse);
    // The panel is the local z = 0 plane and faces +z; a ray coming from
    // behind would press mirrored buttons, so it does not count.
    if (_localRay.direction.z > -1e-6) return null;
    const t = -_localRay.origin.z / _localRay.direction.z;
    if (t < 0) return null;
    _localRay.at(t, _hitLocal);
    const scale = mesh.getWorldScale(_hitScale).x || 1;
    const margin = PANEL_EDGE_MARGIN / scale;
    if (Math.abs(_hitLocal.x) > this.widthMeters / 2 + margin) return null;
    if (Math.abs(_hitLocal.y) > this.heightMeters / 2 + margin) return null;
    _hitWorld.copy(_hitLocal).applyMatrix4(mesh.matrixWorld);
    const distance = _hitWorld.distanceTo(raycaster.ray.origin);
    if (distance < raycaster.near || distance > raycaster.far) return null;

    const px = (_hitLocal.x / this.widthMeters + 0.5) * this.pxWidth;
    const py = (0.5 - _hitLocal.y / this.heightMeters) * this.pxHeight;
    let best: PanelButton<Action> | null = null;
    let bestGap = Infinity;
    for (const b of this.buttons) {
      const dx = Math.max(b.x - px, 0, px - (b.x + b.w));
      const dy = Math.max(b.y - py, 0, py - (b.y + b.h));
      const gap = Math.hypot(dx, dy);
      const pad = this.hovered.includes(b.key)
        ? BUTTON_HOVER_KEEP_PX
        : BUTTON_HIT_PAD_PX;
      if (gap <= pad && gap < bestGap) {
        best = b;
        bestGap = gap;
      }
    }
    return {distance, action: best?.action ?? null};
  }

  public dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

/** Where a panel rests relative to the user's head. */
export interface RestingSpot {
  /** Metres from the head, measured along the floor. */
  distance: number;
  /** Radians below eye level. */
  drop: number;
  /** Radians to the left (+) or right (−) of where the user faces. */
  yaw: number;
}

/**
 * Writes the world position of `spot` for the camera's current pose into
 * `out`. Returns false when the user looks straight up or down, where "in
 * front" has no direction.
 */
export function restingPosition(
  camera: THREE.Camera,
  spot: RestingSpot,
  out: THREE.Vector3,
): boolean {
  camera.getWorldDirection(_heading);
  _heading.y = 0;
  if (_heading.lengthSq() < 1e-4) return false;
  _heading.normalize().applyAxisAngle(UP, spot.yaw);
  camera.getWorldPosition(_camPos);
  out.copy(_camPos).addScaledVector(_heading, spot.distance);
  out.y = _camPos.y - Math.tan(spot.drop) * spot.distance;
  return true;
}

/**
 * How far `position` is from where the user faces, in radians around the
 * vertical axis: positive to the user's left, negative to the right.
 */
export function bearingFromGaze(camera: THREE.Camera, position: THREE.Vector3): number {
  camera.getWorldDirection(_heading);
  camera.getWorldPosition(_camPos);
  _toPanel.copy(position).sub(_camPos);
  // Angle from heading to the panel, counter-clockwise seen from above.
  const cross = _heading.z * _toPanel.x - _heading.x * _toPanel.z;
  const dot = _heading.x * _toPanel.x + _heading.z * _toPanel.z;
  return Math.atan2(cross, dot);
}
