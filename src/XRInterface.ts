import * as THREE from 'three';
import {AppMode, PinScreenProjection, SpatialPin} from './types';

/**
 * In-headset interface. The DOM overlay (LotusUI) is not composited into an
 * immersive session, so everything the user needs while wearing the headset is
 * drawn here as canvas-textured panels in the 3D scene:
 *  - a control panel that lazily follows the head (timer, place pin, focus area, exit)
 *  - a card next to an opened pin (title, note, dictate, delete)
 *  - a title label above pins that are hovered or within proximity
 *  - a ray and cursor dot per controller / hand so the user can see where they aim
 *
 * Hit testing is done by the caller's raycaster against the panel meshes, so it
 * works the same for controllers and hand pinches.
 */

export type XRHudAction = 'toggle-timer' | 'place-pin' | 'focus-zone' | 'exit-xr';
export type XRCardAction = 'close' | 'delete' | 'dictate-title' | 'dictate-note';
export type XRPanelName = 'hud' | 'card';

export interface XRHudState {
  clock: string;
  timerRunning: boolean;
  mode: AppMode;
  status: string;
}

export interface XRPanelHit {
  panel: XRPanelName;
  distance: number;
  action: string | null;
}

export interface XRPointerRay {
  origin: THREE.Vector3;
  quaternion: THREE.Quaternion;
  distance: number;
  showDot: boolean;
}

interface PanelButton {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const FONT_BODY = '"Space Grotesk", system-ui, sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, monospace';
const ACCENT = '#E84D2B';
const PANEL_BG = 'rgba(22, 22, 20, 0.9)';
const BUTTON_BG = 'rgba(255, 255, 255, 0.1)';
const BUTTON_HOVER_BG = 'rgba(255, 255, 255, 0.26)';
const TEXT_MAIN = '#F5F4EF';
const TEXT_DIM = '#B9B8B0';

const _camPos = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _target = new THREE.Vector3();
const _tmp = new THREE.Vector3();

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
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
    if (line) lines.push(line);
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

/** A flat panel whose face is a 2D canvas with rectangular button regions. */
class CanvasPanel {
  public readonly mesh: THREE.Mesh;
  public readonly canvas: HTMLCanvasElement;
  public readonly ctx: CanvasRenderingContext2D;
  public buttons: PanelButton[] = [];
  public hoveredButton: string | null = null;
  private texture: THREE.CanvasTexture;
  private geometry: THREE.PlaneGeometry;
  private material: THREE.MeshBasicMaterial;

  constructor(
    widthMeters: number,
    heightMeters: number,
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

  public drawBackground() {
    const {ctx} = this;
    roundRectPath(ctx, 4, 4, this.pxWidth - 8, this.pxHeight - 8, 36);
    ctx.fillStyle = PANEL_BG;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.stroke();
  }

  public drawButton(
    id: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    opts: {active?: boolean; danger?: boolean; fontPx?: number} = {},
  ) {
    const {ctx} = this;
    const hovered = this.hoveredButton === id;
    roundRectPath(ctx, x, y, w, h, 22);
    if (opts.active) {
      ctx.fillStyle = ACCENT;
    } else if (opts.danger) {
      ctx.fillStyle = hovered ? 'rgba(244, 63, 94, 0.6)' : 'rgba(244, 63, 94, 0.3)';
    } else {
      ctx.fillStyle = hovered ? BUTTON_HOVER_BG : BUTTON_BG;
    }
    ctx.fill();
    if (hovered) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
    }
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `600 ${opts.fontPx ?? 30}px ${FONT_BODY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, label, w - 20), x + w / 2, y + h / 2 + 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    this.buttons.push({id, x, y, w, h});
  }

  public commit() {
    this.texture.needsUpdate = true;
  }

  /** Returns the hit distance and the button under the ray, if any. */
  public hit(
    raycaster: THREE.Raycaster,
  ): {distance: number; buttonId: string | null} | null {
    if (!this.mesh.visible) return null;
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.uv) return null;
    const px = hit.uv.x * this.pxWidth;
    const py = (1 - hit.uv.y) * this.pxHeight;
    const button = this.buttons.find(
      (b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h,
    );
    return {distance: hit.distance, buttonId: button?.id ?? null};
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
}

interface PointerVisual {
  line: THREE.Line;
  dot: THREE.Mesh;
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: {results: ArrayLike<ArrayLike<{transcript: string}>>}) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

/**
 * One-shot voice dictation through the Web Speech API. Returns a stop function,
 * or null when the browser has no speech recognition.
 */
export function dictateOnce(
  onText: (text: string) => void,
  onEnd: (failed: boolean) => void,
): (() => void) | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return null;
  try {
    const recognizer = new Ctor();
    let failed = false;
    recognizer.lang = navigator.language || 'en-US';
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;
    recognizer.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim();
      if (text) onText(text);
    };
    recognizer.onerror = () => {
      failed = true;
    };
    recognizer.onend = () => onEnd(failed);
    recognizer.start();
    return () => {
      try {
        recognizer.stop();
      } catch {
        // Already stopped
      }
    };
  } catch {
    return null;
  }
}

export class XRInterface {
  public readonly root = new THREE.Group();
  public readonly speechSupported = Boolean(getSpeechRecognitionCtor());

  private hud = new CanvasPanel(0.43, 0.2, 860, 400);
  private card = new CanvasPanel(0.36, 0.28, 720, 560);
  private hudState: XRHudState = {
    clock: '00:00',
    timerRunning: false,
    mode: 'explore',
    status: '',
  };
  private hudKey = '';
  private hudNeedsSnap = true;
  private hudFollowing = false;

  private cardPin: SpatialPin | null = null;
  private cardStatus = '';
  private deleteArmedUntil = 0;

  private labels = new Map<string, PinLabel>();
  private pointers: PointerVisual[] = [];
  private pointerLineGeo: THREE.BufferGeometry;
  private pointerLineMat: THREE.LineBasicMaterial;
  private pointerDotGeo: THREE.SphereGeometry;
  private pointerDotMat: THREE.MeshBasicMaterial;

  constructor() {
    this.root.name = 'LotusXRInterface';
    this.root.visible = false;
    // The app does its own ray tests against these panels.
    (this.root as unknown as {xb?: {pointerEvents: string}}).xb = {
      pointerEvents: 'none',
    };
    this.card.mesh.visible = false;
    this.root.add(this.hud.mesh, this.card.mesh);

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
  }

  public setActive(active: boolean) {
    this.root.visible = active;
    if (active) {
      this.hudNeedsSnap = true;
    } else {
      this.closeCard();
      this.updatePointers([]);
      for (const label of this.labels.values()) label.sprite.visible = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Control panel
  // ---------------------------------------------------------------------------

  public updateHud(state: XRHudState, camera: THREE.Camera, delta: number) {
    const key = `${state.clock}|${state.timerRunning}|${state.mode}|${state.status}|${this.hud.hoveredButton}`;
    if (key !== this.hudKey) {
      this.hudKey = key;
      this.hudState = state;
      this.drawHud();
    }

    // Lazy follow: stay put while the user works, catch up once they turn or
    // walk away, so the panel never chases every small head movement.
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_forward);
    _forward.y = 0;
    if (_forward.lengthSq() > 0.0001) {
      _forward.normalize();
      _target.copy(_camPos).addScaledVector(_forward, 0.55);
      _target.y = _camPos.y - 0.3;
      const mesh = this.hud.mesh;
      if (this.hudNeedsSnap) {
        mesh.position.copy(_target);
        this.hudNeedsSnap = false;
        this.hudFollowing = false;
      } else {
        const offBy = mesh.position.distanceTo(_target);
        if (offBy > 0.45) this.hudFollowing = true;
        if (this.hudFollowing) {
          mesh.position.lerp(_target, 1 - Math.exp(-6 * delta));
          if (offBy < 0.03) this.hudFollowing = false;
        }
      }
    }
    this.hud.mesh.lookAt(_camPos);
  }

  private drawHud() {
    const {hud, hudState: s} = this;
    const {ctx} = hud;
    hud.clear();
    hud.drawBackground();

    ctx.fillStyle = ACCENT;
    ctx.font = `700 26px ${FONT_BODY}`;
    ctx.fillText('LOTUS', 40, 58);

    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `700 88px ${FONT_MONO}`;
    ctx.fillText(s.clock, 40, 158);

    ctx.fillStyle = TEXT_DIM;
    ctx.font = `500 28px ${FONT_BODY}`;
    ctx.fillText(fitText(ctx, s.status, 780), 40, 208);

    const y = 244;
    const h = 116;
    hud.drawButton(
      'toggle-timer',
      s.timerRunning ? 'Stop focus' : 'Start focus',
      40,
      y,
      220,
      h,
      {active: s.timerRunning},
    );
    hud.drawButton('place-pin', 'Place pin', 280, y, 180, h, {
      active: s.mode === 'pin-add',
    });
    hud.drawButton('focus-zone', 'Focus area', 480, y, 200, h, {
      active: s.mode === 'focus-drag',
    });
    hud.drawButton('exit-xr', 'Exit', 700, y, 120, h);
    hud.commit();
  }

  // ---------------------------------------------------------------------------
  // Pin card
  // ---------------------------------------------------------------------------

  public openCard(pin: SpatialPin) {
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
  }

  public getCardPinId(): string | null {
    return this.cardPin?.id ?? null;
  }

  /** Redraw after the pin's text changed. */
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

  public updateCard(camera: THREE.Camera, pinWorldPos: THREE.Vector3 | null) {
    if (!this.cardPin || !pinWorldPos) return;
    if (this.deleteArmedUntil && performance.now() >= this.deleteArmedUntil) {
      this.deleteArmedUntil = 0;
      this.drawCard();
    }
    camera.getWorldPosition(_camPos);
    const dist = _camPos.distanceTo(pinWorldPos);
    // Grow with distance so the text stays readable for far pins.
    const scale = THREE.MathUtils.clamp(dist / 0.8, 1, 3.5);
    const mesh = this.card.mesh;
    mesh.scale.setScalar(scale);
    _tmp.copy(_camPos).sub(pinWorldPos);
    _tmp.y = 0;
    if (_tmp.lengthSq() > 0.0001) _tmp.normalize();
    mesh.position
      .copy(pinWorldPos)
      .addScaledVector(_tmp, 0.05 * scale);
    mesh.position.y += 0.08 + 0.14 * scale;
    mesh.lookAt(_camPos);
  }

  private drawCard() {
    const pin = this.cardPin;
    if (!pin) return;
    const {card} = this;
    const {ctx} = card;
    card.clear();
    card.drawBackground();

    roundRectPath(ctx, 36, 40, 12, 96, 6);
    ctx.fillStyle = pin.color || ACCENT;
    ctx.fill();

    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `700 42px ${FONT_BODY}`;
    const titleLines = wrapLines(ctx, pin.title || 'Untitled pin', 620, 2);
    titleLines.forEach((line, i) => ctx.fillText(line, 66, 80 + i * 50));

    let y = 80 + titleLines.length * 50;
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `500 24px ${FONT_BODY}`;
    ctx.fillText(fitText(ctx, pin.surfaceLabel || 'Room', 620), 66, y);
    y += 50;

    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `400 28px ${FONT_BODY}`;
    const bodyLines = wrapLines(ctx, pin.body || '', 650, 5);
    bodyLines.forEach((line, i) => ctx.fillText(line, 36, y + i * 38));

    if (this.cardStatus) {
      ctx.fillStyle = ACCENT;
      ctx.font = `600 24px ${FONT_BODY}`;
      ctx.fillText(fitText(ctx, this.cardStatus, 650), 36, 418);
    }

    const by = 440;
    const bh = 88;
    const armed = performance.now() < this.deleteArmedUntil;
    if (this.speechSupported) {
      card.drawButton('close', 'Close', 24, by, 130, bh, {fontPx: 26});
      card.drawButton('dictate-title', 'Say title', 164, by, 170, bh, {
        fontPx: 26,
      });
      card.drawButton('dictate-note', 'Say note', 344, by, 170, bh, {
        fontPx: 26,
      });
      card.drawButton('delete', armed ? 'Confirm?' : 'Delete', 524, by, 172, bh, {
        danger: true,
        fontPx: 26,
      });
    } else {
      card.drawButton('close', 'Close', 24, by, 330, bh);
      card.drawButton('delete', armed ? 'Confirm delete?' : 'Delete', 366, by, 330, bh, {
        danger: true,
      });
    }
    card.commit();
  }

  // ---------------------------------------------------------------------------
  // Ray hit testing and hover
  // ---------------------------------------------------------------------------

  /** Nearest panel under the ray, with the button it lands on (if any). */
  public hitTest(raycaster: THREE.Raycaster): XRPanelHit | null {
    const hudHit = this.hud.hit(raycaster);
    const cardHit = this.card.hit(raycaster);
    if (hudHit && (!cardHit || hudHit.distance <= cardHit.distance)) {
      return {panel: 'hud', distance: hudHit.distance, action: hudHit.buttonId};
    }
    if (cardHit) {
      return {panel: 'card', distance: cardHit.distance, action: cardHit.buttonId};
    }
    return null;
  }

  /** Highlight the button a ray is resting on. Pass null to clear. */
  public setPanelHover(hit: XRPanelHit | null) {
    const hudHover = hit?.panel === 'hud' ? hit.action : null;
    const cardHover = hit?.panel === 'card' ? hit.action : null;
    // The control panel redraws from updateHud(), which keys on the hover.
    this.hud.hoveredButton = hudHover;
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
  ) {
    const live = new Set<string>();
    for (const proj of projections) {
      const pin = pins.find((p) => p.id === proj.id);
      if (!pin) continue;
      live.add(pin.id);
      const wanted =
        (proj.isWithinProximity || proj.isReticleHovered) &&
        this.cardPin?.id !== pin.id;
      let label = this.labels.get(pin.id);
      if (!wanted) {
        if (label) label.sprite.visible = false;
        continue;
      }
      if (!label) {
        label = this.createLabel();
        this.labels.set(pin.id, label);
      }
      const key = `${pin.title}|${pin.color}`;
      if (label.key !== key) {
        label.key = key;
        this.drawLabel(label, pin);
      }
      if (!getWorldPosition(pin.id, _tmp)) {
        label.sprite.visible = false;
        continue;
      }
      const scale = THREE.MathUtils.clamp(proj.distanceMeters / 0.8, 1, 4);
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
    });
    const sprite = new THREE.Sprite(material);
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 4;
    this.root.add(sprite);
    return {sprite, canvas, texture, material, key: ''};
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
    this.hud.dispose();
    this.card.dispose();
    for (const label of this.labels.values()) {
      label.material.dispose();
      label.texture.dispose();
    }
    this.labels.clear();
    this.pointerLineGeo.dispose();
    this.pointerLineMat.dispose();
    this.pointerDotGeo.dispose();
    this.pointerDotMat.dispose();
  }
}
