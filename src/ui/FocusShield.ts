import {ShieldStyle} from '../types';

/** Screen-space edges of the focus window, in CSS pixels. */
export interface ShieldWindow {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The 2D peripheral shield: one continuous blur / dim layer over the whole
 * screen with the focus window cut out of it, plus the window's frame and
 * badge. 2D screens only; in a headset the dim shell in FocusVolume3D does
 * this job (passthrough cannot be blurred in WebXR).
 */
export class FocusShield {
  private readonly rootEl: HTMLElement;
  private readonly surroundEl: HTMLElement;
  private readonly frameEl: HTMLElement;
  private readonly badgeEl: HTMLElement;

  /** `container` holds the markup from `buildLayout`. */
  constructor(container: HTMLElement) {
    this.rootEl = container.querySelector('#lotus-aperture-root')!;
    this.surroundEl = container.querySelector('#lotus-surround-shield')!;
    this.frameEl = container.querySelector('#lotus-focus-window-frame')!;
    this.badgeEl = container.querySelector('#lotus-focus-window-badge')!;
  }

  public hide() {
    this.rootEl.style.display = 'none';
  }

  /** `strength` 0–1: how much the surroundings are hidden (1 − visibility). */
  public show(win: ShieldWindow, strength: number, style: ShieldStyle, label: string) {
    const {left, top, right, bottom} = win;
    this.rootEl.style.display = 'block';
    this.rootEl.className = `lotus-aperture-root shield-${style}`;

    this.setStrength(strength);
    this.surroundEl.style.clipPath = `polygon(0px 0px, 100% 0px, 100% 100%, 0px 100%, 0px 0px, ${left}px ${top}px, ${left}px ${bottom}px, ${right}px ${bottom}px, ${right}px ${top}px, ${left}px ${top}px)`;

    this.frameEl.style.left = `${left}px`;
    this.frameEl.style.top = `${top}px`;
    this.frameEl.style.width = `${Math.max(0, right - left)}px`;
    this.frameEl.style.height = `${Math.max(0, bottom - top)}px`;
    this.frameEl.style.opacity = '1';

    this.setLabel(label);
  }

  /** Changes how strongly the surroundings are hidden without moving the window. */
  public setStrength(strength: number) {
    this.surroundEl.style.opacity = `${strength.toFixed(3)}`;
    this.surroundEl.style.setProperty('--shield-blur', `${(strength * 16).toFixed(1)}px`);
  }

  /** The text on the window's badge, e.g. "FOCUS · 24:59". */
  public setLabel(text: string) {
    const labelSpan = this.badgeEl.querySelector('#lotus-focus-window-label');
    if (labelSpan) labelSpan.textContent = text;
  }
}
