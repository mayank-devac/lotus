import * as THREE from 'three';
import {
  ACCENT,
  CanvasPanel,
  FONT_BODY,
  RestingSpot,
  TEXT_DIM,
  TEXT_MAIN,
  restingPosition,
  roundRectPath,
} from './XRPanel';
import {drawIcon} from './icons';

/**
 * In-scene keyboard: the one way to enter text that works in every headset
 * and emulator. DOM inputs are not visible in an immersive session, Quest
 * Browser has no speech recognition, and its system keyboard needs Browser
 * 26.1+, so neither of those can be the only route. Both are offered as extra
 * keys where the device has them.
 *
 * The editor only holds the text being typed. Its owner opens it with a
 * request, forwards key presses, and reads the text back on Done.
 */

export type XRKeyAction =
  | `char:${string}`
  | 'shift'
  | 'backspace'
  | 'symbols'
  | 'clear'
  | 'voice'
  | 'system-keyboard'
  | 'cancel'
  | 'done'
  /** The grip: a drag on it moves the keyboard. */
  | 'move';

export interface XRTextRequest {
  /** Names the field being edited, e.g. "Pin title". */
  label: string;
  initial: string;
  /** Shown faintly while the text is empty. */
  placeholder?: string;
  maxLength?: number;
}

export interface XRTextInputOptions {
  /** Speech recognition exists: show the dictation key. */
  voice: boolean;
  /** The headset's system keyboard exists: show the key that opens it. */
  systemKeyboard: boolean;
}

type ShiftState = 'off' | 'once' | 'lock';

const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const SYMBOL_ROWS = ['1234567890', '-/:;()&@"', "?!'#%+="];
const DEFAULT_MAX_LENGTH = 400;

// Canvas layout, in pixels.
const PX_WIDTH = 1240;
const PX_HEIGHT = 660;
const MARGIN = 30;
const KEY_GAP = 10;
const KEY_H = 104;
const KEYS_TOP = 184;
const KEY_W = (PX_WIDTH - MARGIN * 2 - KEY_GAP * 9) / 10;
/** Shift and backspace: what is left of the third row beside its 7 letters. */
const WIDE_KEY_W = (PX_WIDTH - MARGIN * 2 - KEY_W * 7 - KEY_GAP * 8) / 2;

/**
 * Below the line of sight, like a desk keyboard, so it does not cover the
 * panel being edited. Closer than the other panels: the keys are small targets.
 */
const EDITOR_SPOT: RestingSpot = {distance: 0.8, drop: 0.5, yaw: 0};

const _target = new THREE.Vector3();
const _camPos = new THREE.Vector3();

export class XRTextEditor {
  public readonly panel = new CanvasPanel<XRKeyAction>(0.62, 0.33, PX_WIDTH, PX_HEIGHT);
  private request: XRTextRequest | null = null;
  private options: XRTextInputOptions = {voice: false, systemKeyboard: false};
  private text = '';
  private shift: ShiftState = 'off';
  private symbols = false;
  private status = '';
  private listening = false;
  private dirty = false;
  private needsSnap = true;

  public isOpen(): boolean {
    return this.request !== null;
  }

  /**
   * Opens the keyboard for `request`. Already open (the user moved on to
   * another field), it stays where it is.
   */
  public open(request: XRTextRequest, options: XRTextInputOptions) {
    if (!this.request) this.needsSnap = true;
    this.request = request;
    this.options = options;
    this.text = request.initial;
    this.shift = this.text ? 'off' : 'once';
    this.symbols = false;
    this.status = '';
    this.listening = false;
    this.dirty = true;
    this.panel.setVisible(true);
  }

  public close() {
    this.request = null;
    this.panel.setVisible(false);
  }

  public getText(): string {
    return this.text;
  }

  public setText(text: string) {
    this.text = text.slice(0, this.maxLength());
    this.dirty = true;
  }

  /** Adds dictated words after what is already there. */
  public insert(words: string) {
    const joiner = this.text && !/\s$/.test(this.text) ? ' ' : '';
    this.setText(this.text + joiner + words);
  }

  /** A message shown in place of the field name, e.g. "Listening…". */
  public setStatus(status: string, listening = false) {
    if (this.status === status && this.listening === listening) return;
    this.status = status;
    this.listening = listening;
    this.dirty = true;
  }

  public setHovered(ids: XRKeyAction[]) {
    if (this.panel.setHovered(ids)) this.dirty = true;
  }

  /** Puts the keyboard where the user dragged it by its grip; it stays there. */
  public setPosition(position: THREE.Vector3) {
    this.panel.mesh.position.copy(position);
    this.needsSnap = false;
  }

  /**
   * Applies a typing key. Returns false for the keys the owner handles
   * (voice, system keyboard, cancel, done, move).
   */
  public press(action: XRKeyAction): boolean {
    if (action.startsWith('char:')) {
      this.type(action.slice('char:'.length));
    } else if (action === 'backspace') {
      this.text = this.text.slice(0, -1);
      if (!this.text && this.shift === 'off') this.shift = 'once';
    } else if (action === 'clear') {
      this.text = '';
      if (this.shift === 'off') this.shift = 'once';
    } else if (action === 'shift') {
      this.shift = this.shift === 'off' ? 'once' : this.shift === 'once' ? 'lock' : 'off';
    } else if (action === 'symbols') {
      this.symbols = !this.symbols;
    } else {
      return false;
    }
    this.dirty = true;
    return true;
  }

  private type(char: string) {
    if (this.text.length >= this.maxLength()) return;
    const isLetter = /^[a-z]$/.test(char);
    this.text += isLetter && this.shift !== 'off' ? char.toUpperCase() : char;
    if (isLetter && this.shift === 'once') this.shift = 'off';
    // A new sentence starts with a capital.
    if (char === ' ' && this.shift === 'off' && /[.!?] $/.test(this.text)) {
      this.shift = 'once';
    }
  }

  private maxLength(): number {
    return this.request?.maxLength ?? DEFAULT_MAX_LENGTH;
  }

  /**
   * Places the keyboard in reach when it opens and redraws it after a change.
   * After that it stays where it is; it never chases the head.
   */
  public update(camera: THREE.Camera) {
    if (!this.request) return;
    const mesh = this.panel.mesh;
    if (this.needsSnap && restingPosition(camera, EDITOR_SPOT, _target)) {
      mesh.position.copy(_target);
      this.needsSnap = false;
    }
    mesh.lookAt(camera.getWorldPosition(_camPos));
    if (this.dirty) {
      this.dirty = false;
      this.draw();
    }
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  private draw() {
    const request = this.request;
    if (!request) return;
    const {panel} = this;
    const {ctx} = panel;
    panel.clear();
    panel.drawBackground();

    ctx.fillStyle = this.status ? ACCENT : TEXT_DIM;
    ctx.font = `600 26px ${FONT_BODY}`;
    ctx.fillText(this.status || request.label, MARGIN + 14, 58);
    panel.drawButton('move', 'Pinch and drag to move the keyboard', {icon: 'grip'},
      PX_WIDTH - MARGIN - 106, 10, 106, 58);

    this.drawTextField(request);
    panel.drawButton('clear', 'Clear text', {icon: 'close'}, PX_WIDTH - MARGIN - 106, 76, 106, 84);

    const rows = this.symbols ? SYMBOL_ROWS : LETTER_ROWS;
    const upper = !this.symbols && this.shift !== 'off';
    const rowY = (row: number) => KEYS_TOP + row * (KEY_H + KEY_GAP);
    const charKey = (char: string, x: number, y: number, w = KEY_W) => {
      panel.drawButton(
        `char:${char}`,
        char,
        {text: upper ? char.toUpperCase() : char},
        x, y, w, KEY_H,
        {fontSize: 44},
      );
    };
    const drawRow = (chars: string, x: number, y: number) => {
      for (const char of chars) {
        charKey(char, x, y);
        x += KEY_W + KEY_GAP;
      }
    };

    drawRow(rows[0], MARGIN, rowY(0));
    drawRow(rows[1], MARGIN + (KEY_W + KEY_GAP) / 2, rowY(1));

    // Third row: shift (or a symbol), seven keys, backspace.
    let x = MARGIN;
    if (this.symbols) {
      charKey('*', x, rowY(2), WIDE_KEY_W);
    } else {
      panel.drawButton(
        'shift',
        this.shift === 'lock' ? 'Caps lock is on' : 'Shift',
        {
          paint: (c, bx, by, w, h) => {
            drawIcon(c, 'shift', bx + w / 2, by + h / 2 - 4, 46, TEXT_MAIN);
            if (this.shift === 'lock') {
              c.fillStyle = TEXT_MAIN;
              c.fillRect(bx + w / 2 - 20, by + h - 20, 40, 5);
            }
          },
        },
        x, rowY(2), WIDE_KEY_W, KEY_H,
        {active: this.shift !== 'off'},
      );
    }
    x += WIDE_KEY_W + KEY_GAP;
    drawRow(rows[2], x, rowY(2));
    x += (KEY_W + KEY_GAP) * 7;
    panel.drawButton('backspace', 'Delete', {icon: 'backspace'}, x, rowY(2), WIDE_KEY_W, KEY_H);

    this.drawBottomRow(rowY(3));
    panel.commit();
  }

  /** The text being typed: its tail when it is too long to fit, then the caret. */
  private drawTextField(request: XRTextRequest) {
    const {ctx} = this.panel;
    const x = MARGIN;
    const y = 76;
    const w = PX_WIDTH - MARGIN * 2 - 106 - KEY_GAP;
    const h = 84;
    roundRectPath(ctx, x, y, w, h, 18);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.fill();

    ctx.font = `500 38px ${FONT_BODY}`;
    const maxWidth = w - 48;
    let caretX = x + 22;
    if (this.text) {
      let shown = this.text;
      while (shown.length > 1 && ctx.measureText(`…${shown}`).width > maxWidth) {
        shown = shown.slice(1);
      }
      if (shown !== this.text) shown = `…${shown}`;
      ctx.fillStyle = TEXT_MAIN;
      ctx.fillText(shown, x + 22, y + 56);
      caretX += ctx.measureText(shown).width + 3;
    } else if (request.placeholder) {
      ctx.fillStyle = 'rgba(245, 244, 239, 0.35)';
      ctx.fillText(request.placeholder, x + 30, y + 56);
    }
    ctx.fillStyle = ACCENT;
    ctx.fillRect(caretX, y + 20, 4, 46);
  }

  private drawBottomRow(y: number) {
    const {panel, options} = this;
    const cancelW = 170;
    const doneW = 200;
    const extras = Number(options.voice) + Number(options.systemKeyboard);
    // Keys: symbols, comma, space, full stop, extras, cancel, done.
    const gaps = 5 + extras;
    const spaceW =
      PX_WIDTH - MARGIN * 2 -
      WIDE_KEY_W - KEY_W * (2 + extras) - cancelW - doneW -
      KEY_GAP * gaps;

    let x = MARGIN;
    const place = (w: number) => {
      const at = x;
      x += w + KEY_GAP;
      return at;
    };
    panel.drawButton(
      'symbols',
      this.symbols ? 'Letters' : 'Numbers and symbols',
      {text: this.symbols ? 'ABC' : '123'},
      place(WIDE_KEY_W), y, WIDE_KEY_W, KEY_H,
      {fontSize: 34},
    );
    panel.drawButton('char:,', ',', {text: ','}, place(KEY_W), y, KEY_W, KEY_H, {fontSize: 44});
    panel.drawButton('char: ', 'Space', {text: 'space'}, place(spaceW), y, spaceW, KEY_H, {fontSize: 30});
    panel.drawButton('char:.', '.', {text: '.'}, place(KEY_W), y, KEY_W, KEY_H, {fontSize: 44});
    if (options.voice) {
      panel.drawButton(
        'voice',
        this.listening ? 'Stop listening' : 'Dictate',
        {icon: 'mic'},
        place(KEY_W), y, KEY_W, KEY_H,
        {active: this.listening},
      );
    }
    if (options.systemKeyboard) {
      panel.drawButton(
        'system-keyboard',
        'Headset keyboard',
        {icon: 'keyboard'},
        place(KEY_W), y, KEY_W, KEY_H,
      );
    }
    panel.drawButton('cancel', 'Cancel', {text: 'Cancel'}, place(cancelW), y, cancelW, KEY_H, {fontSize: 32});
    panel.drawButton('done', 'Done', {text: 'Done'}, place(doneW), y, doneW, KEY_H, {
      active: true,
      fontSize: 34,
    });
  }

  public dispose() {
    this.panel.dispose();
  }
}
