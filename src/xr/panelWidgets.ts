import {SpatialPin} from '../types';
import {ACCENT, CanvasPanel, FONT_BODY, TEXT_DIM, TEXT_MAIN, wrapLines} from './XRPanel';
import {drawIcon} from './icons';

/** Canvas widgets shared by several in-headset panels (drawer, pin card, labels). */
/**
 * A text field: its name, its value (or a faint placeholder), and a pencil.
 * Pressing it opens the keyboard for that field.
 */
export function drawTextField<Action>(
  panel: CanvasPanel<Action>,
  action: Action,
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
    action,
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

/**
 * Fills the current path with the pin's colour. The faint outline keeps
 * dark colours visible against the dark panels.
 */
export function fillPinColor(ctx: CanvasRenderingContext2D, pin: SpatialPin) {
  ctx.fillStyle = pin.color || ACCENT;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.stroke();
}
