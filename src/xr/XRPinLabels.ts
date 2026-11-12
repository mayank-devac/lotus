import * as THREE from 'three';
import {PinScreenProjection, SpatialPin} from '../types';
import {FONT_BODY, PANEL_BG, TEXT_MAIN, fitText, roundRectPath} from './XRPanel';
import {fillPinColor} from './panelWidgets';
/** Pin labels keep their natural size up to here, then grow with distance. */
const LABEL_FULL_SIZE_DISTANCE = 0.8;
const MAX_LABEL_SCALE = 30;
const LABEL_FADE_RATE = 12;

const _tmp = new THREE.Vector3();
interface PinLabel {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  material: THREE.SpriteMaterial;
  key: string;
  /** Faded rather than toggled, so a brief hover change cannot flicker it. */
  opacity: number;
}

/**
 * Title labels above pins that are hovered or within proximity, faded in and
 * out, kept readable at any distance.
 */
export class XRPinLabels {
  private labels = new Map<string, PinLabel>();
  // Reused by update every frame, so it allocates nothing there.
  private labelPins = new Map<string, SpatialPin>();
  private liveLabelIds = new Set<string>();

  /** `root` is the group the label sprites are added to. */
  constructor(private readonly root: THREE.Object3D) {}

  /** Makes every label redraw its canvas (e.g. once web fonts have loaded). */
  public invalidate() {
    for (const label of this.labels.values()) label.key = '';
  }

  public hideAll() {
    for (const label of this.labels.values()) {
      label.opacity = 0;
      label.sprite.visible = false;
    }
  }

  public dispose() {
    for (const label of this.labels.values()) {
      label.material.dispose();
      label.texture.dispose();
    }
    this.labels.clear();
  }

  /** `cardPinId`: the pin whose card is open shows no label. */
  public update(
    pins: SpatialPin[],
    projections: PinScreenProjection[],
    getWorldPosition: (pinId: string, target: THREE.Vector3) => boolean,
    hoveredPinId: string | null,
    delta: number,
    cardPinId: string | null,
  ) {
    // One lookup table per call instead of a search through the pins for
    // every projection; both collections are reused between frames.
    const pinById = this.labelPins;
    pinById.clear();
    // Filled back to front so that, like a search from the start, the first
    // pin with an id wins.
    for (let i = pins.length - 1; i >= 0; i--) pinById.set(pins[i].id, pins[i]);
    const live = this.liveLabelIds;
    live.clear();
    const fade = 1 - Math.exp(-LABEL_FADE_RATE * delta);
    for (const proj of projections) {
      const pin = pinById.get(proj.id);
      if (!pin) continue;
      live.add(pin.id);
      const wanted =
        (proj.isWithinProximity || pin.id === hoveredPinId) &&
        cardPinId !== pin.id;
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
    // Do not hold on to pins that may be deleted before the next call.
    pinById.clear();
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
    fillPinColor(ctx, pin);
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `600 40px ${FONT_BODY}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, pin.title || 'Untitled pin', 380), 92, 66);
    ctx.textBaseline = 'alphabetic';
    label.texture.needsUpdate = true;
  }
}
