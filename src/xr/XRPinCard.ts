import * as THREE from 'three';
import {SpatialPin} from '../types';
import {
  ACCENT,
  ButtonContent,
  CanvasPanel,
  DANGER_TEXT,
  FONT_BODY,
  TEXT_DIM,
  TEXT_MAIN,
  fitText,
  roundRectPath,
  wrapLines,
} from './XRPanel';
import {drawTextField, fillPinColor} from './panelWidgets';
import {XRCardAction} from './XRInterfaceTypes';
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

const _camPos = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _target = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * The card for an opened pin, in a view mode and an edit mode, held between
 * the user and the pin with a leader line to it. Only draws; the pin card
 * controller in ImmersiveSession handles its buttons.
 */
export class XRPinCard {
  public readonly panel = new CanvasPanel<XRCardAction>(0.36, 0.3, 720, 600);
  /** Line from the card to its pin; the owner adds it to the scene. */
  public readonly leader: THREE.Line;
  private pin: SpatialPin | null = null;
  private editing = false;
  private status = '';
  private deleteArmed = false;
  private needsSnap = true;
  /** The user moved the card by its grip: it stays exactly there. */
  private placed = false;
  private leaderGeo: THREE.BufferGeometry;
  private leaderMat: THREE.LineBasicMaterial;

  constructor() {
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
  }

  /** Puts the card where the user dragged it by its grip; it stays there. */
  public setPosition(position: THREE.Vector3) {
    this.panel.mesh.position.copy(position);
    this.needsSnap = false;
    this.placed = true;
  }

  /** Highlights the hovered buttons; redraws when that changed. */
  public setHovered(actions: XRCardAction[]) {
    if (this.panel.setHovered(actions) && this.pin) this.draw();
  }

  /** Redraws the open card, e.g. once web fonts have loaded. */
  public redraw() {
    if (this.pin) this.draw();
  }

  public dispose() {
    this.panel.dispose();
    this.leaderGeo.dispose();
    this.leaderMat.dispose();
  }
  public open(pin: SpatialPin) {
    if (this.pin?.id !== pin.id) {
      this.needsSnap = true;
      this.placed = false;
    }
    this.pin = pin;
    this.editing = false;
    this.status = '';
    this.deleteArmed = false;
    this.panel.setVisible(true);
    this.draw();
  }

  public close() {
    this.pin = null;
    this.editing = false;
    this.status = '';
    this.deleteArmed = false;
    this.panel.setVisible(false);
    this.leader.visible = false;
  }

  public getPinId(): string | null {
    return this.pin?.id ?? null;
  }

  /** Redraw after the pin changed. */
  public refresh(pin: SpatialPin) {
    if (this.pin?.id !== pin.id) return;
    this.pin = pin;
    this.draw();
  }

  /** Switches the card between reading the pin and its editable fields. */
  public setEditing(editing: boolean) {
    if (this.editing === editing) return;
    this.editing = editing;
    if (this.pin) this.draw();
  }

  public setStatus(text: string) {
    if (this.status === text) return;
    this.status = text;
    if (this.pin) this.draw();
  }

  /** Shows the delete button as waiting for its confirming second press. */
  public setDeleteArmed(armed: boolean) {
    if (this.deleteArmed === armed) return;
    this.deleteArmed = armed;
    if (this.pin) this.draw();
  }

  /**
   * Holds the card between the user and the pin at a comfortable distance
   * (CARD_MIN_DISTANCE–CARD_MAX_DISTANCE), just above the line of sight to the
   * pin, at a constant angular size. A far pin's card is therefore as large
   * and sharp as a near one's; a thin leader line points to the pin.
   * `held` keeps the card still while the user is typing into it.
   */
  public update(
    camera: THREE.Camera,
    pinWorldPos: THREE.Vector3,
    delta: number,
    held: boolean,
  ) {
    if (!this.pin) return;
    camera.getWorldPosition(_camPos);
    _forward.copy(pinWorldPos).sub(_camPos);
    const pinDist = _forward.length();
    if (pinDist < 1e-3) return;
    _forward.divideScalar(pinDist);

    const cardDist = THREE.MathUtils.clamp(pinDist, CARD_MIN_DISTANCE, CARD_MAX_DISTANCE);
    const scale = cardDist / CARD_REFERENCE_DISTANCE;
    const halfH = (this.panel.heightMeters * scale) / 2;
    _target
      .copy(_camPos)
      .addScaledVector(_forward, cardDist)
      .addScaledVector(_up, halfH + 0.05 * scale);

    const mesh = this.panel.mesh;
    mesh.scale.setScalar(scale);
    if (this.needsSnap) {
      mesh.position.copy(_target);
      this.needsSnap = false;
    }
    // The card stays where it opened; it never chases the head. A card the
    // user moved by its grip is left exactly where they put it.
    if (held && !this.placed) {
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

  private draw() {
    const pin = this.pin;
    if (!pin) return;
    const card = this.panel;
    card.clear();
    card.drawBackground();
    card.drawButton('move-card', 'Pinch and drag to move this card', {icon: 'grip'}, 612, 20, 72, 64);
    if (this.editing) {
      this.drawFields(pin);
    } else {
      this.drawView(pin);
    }
    card.commit();
  }

  /** The line above the card's buttons: the hovered button's name, or a message. */
  private drawStatus() {
    const card = this.panel;
    const {ctx} = card;
    const status =
      card.hoveredLabel() ??
      (this.deleteArmed ? 'Press delete again to remove this pin' : this.status);
    if (!status) return;
    ctx.fillStyle = this.deleteArmed ? DANGER_TEXT : ACCENT;
    ctx.font = `600 26px ${FONT_BODY}`;
    ctx.fillText(fitText(ctx, status, 648), 36, 470);
  }

  private drawView(pin: SpatialPin) {
    const card = this.panel;
    const {ctx} = card;
    roundRectPath(ctx, 36, 40, 12, 100, 6);
    fillPinColor(ctx, pin);

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
    this.drawStatus();

    const armed = this.deleteArmed;
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


  private drawFields(pin: SpatialPin) {
    const card = this.panel;
    const {ctx} = card;
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `700 34px ${FONT_BODY}`;
    ctx.fillText('Edit pin', 36, 64);

    drawTextField(card, 'field-title', 'Title', pin.title, 'Short header to remember', 36, 88, 648, 92);
    drawTextField(card, 'field-body', 'Note', pin.body, 'Full note details', 36, 192, 648, 130, 2);
    drawTextField(card, 'field-place', 'Place', pin.surfaceLabel, 'Where is this point?', 36, 334, 648, 92);
    this.drawStatus();
    card.drawButton('edit-done', 'Finish editing', {text: 'Done'}, 36, 496, 648, 84, {
      active: true,
      fontSize: 32,
    });
  }
}
