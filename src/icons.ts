/**
 * Icons for the in-headset panels, as SVG path data on a 24×24 grid (stroked,
 * round caps and joins, like a 2px-stroke icon set). Canvas draws them through
 * `Path2D`, which takes SVG path syntax directly, so they stay crisp at every
 * panel scale and need no image loading inside the XR session.
 */
export const ICON_PATHS = {
  play: 'M8 5.5v13l10.5-6.5z',
  stop: 'M7 7h10v10H7z',
  pin:
    'M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z' +
    'M12 7.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z',
  focusArea:
    'M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4' +
    'M9 20H5a1 1 0 0 1-1-1v-4M12 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z',
  exit: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  eye:
    'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z' +
    'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z',
  eyeOff:
    'M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2' +
    'M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  title: 'M5 7V4h14v3M12 4v16M9 20h6',
  note: 'M4 6h16M4 12h16M4 18h10',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  mic:
    'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z' +
    'M5 11a7 7 0 0 0 14 0M12 18v3',
  tasks: 'M10 6h10M10 12h10M10 18h10M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5',
  list:
    'M10 6h10M10 12h10M10 18h10' +
    'M5 4.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z' +
    'M5 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z' +
    'M5 16.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3z',
  settings:
    'M4 7h9M17 7h3M4 17h3M11 17h9' +
    'M15 5a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM9 15a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  box: 'M5 5h14v14H5z',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  shapeRevolving: 'M12 3l7 9-7 9-7-9zM5 12h14',
  shapeDot: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10z',
  soundOn: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  soundOff: 'M4 9h4l5-4v14l-5-4H4zM17 9.5l5 5M22 9.5l-5 5',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Icons that read better filled than outlined. */
const FILLED = new Set<IconName>(['play', 'stop']);

const cache = new Map<IconName, Path2D>();

function path(name: IconName): Path2D {
  let p = cache.get(name);
  if (!p) {
    p = new Path2D(ICON_PATHS[name]);
    cache.set(name, p);
  }
  return p;
}

/** Draws `name` centred on (cx, cy), `size` pixels across. */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  cx: number,
  cy: number,
  size: number,
  color: string,
) {
  const s = size / 24;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  // ~2px stroke at 24px, never thinner than ~2.5 canvas px once scaled.
  ctx.lineWidth = Math.max(2, 2.5 / s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const p = path(name);
  if (FILLED.has(name)) ctx.fill(p);
  ctx.stroke(p);
  ctx.restore();
}
