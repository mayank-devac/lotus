import {PIN_COLOR_OPTIONS} from './LotusUI';
import {getShieldStrength} from './storage';
import {LotusSettings, ShieldStyle} from './types';

/**
 * The settings offered in the headset's Settings drawer. Each entry reads its
 * value from the settings and returns the change for one step, so adding a
 * setting to the headset is one entry here.
 */

export type XRSettingId =
  | 'timer-mode'
  | 'focus-length'
  | 'dim'
  | 'dim-style'
  | 'sound'
  | 'labels'
  | 'nearby'
  | 'pin-shape'
  | 'pin-color';

export interface XRSettingDef {
  id: XRSettingId;
  name: string;
  /** 'stepper' shows − value +; 'cycle' is one button that moves to the next value. */
  kind: 'stepper' | 'cycle';
  /** Names what a press does, for the status line. */
  hint: string;
  value(s: Readonly<LotusSettings>): string;
  /** Colour dot shown beside the value, if any. */
  swatch?(s: Readonly<LotusSettings>): string;
  /** The settings change for one step up (1) or down (−1). */
  step(s: Readonly<LotusSettings>, direction: 1 | -1): Partial<LotusSettings>;
}

type LabelMode = 'hover' | 'nearby' | 'always';

const FOCUS_MINUTES = {step: 5, min: 5, max: 120};
const DIM_PERCENT = {step: 10, min: 10, max: 100};
const NEARBY_METERS = {step: 0.5, min: 0.5, max: 4};
const SHIELD_STYLES: {value: ShieldStyle; text: string}[] = [
  {value: 'frosted', text: 'Frosted'},
  {value: 'dark', text: 'Dark'},
  {value: 'ambient', text: 'Warm tint'},
];
const LABEL_MODES: {value: LabelMode; text: string; patch: Partial<LotusSettings>}[] = [
  {value: 'hover', text: 'When pointed at', patch: {headerPopEnabled: false}},
  {
    value: 'nearby',
    text: 'When nearby',
    patch: {headerPopEnabled: true, proximityMode: 'proximity-2m'},
  },
  {value: 'always', text: 'Always', patch: {headerPopEnabled: true, proximityMode: 'always'}},
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The next entry of `list` after index `i`, wrapping around in either direction. */
function cycled<T>(list: T[], i: number, direction: 1 | -1): T {
  return list[(Math.max(0, i) + direction + list.length) % list.length];
}

/**
 * The next grid value above (1) or below (−1) `current`. A value between two
 * grid lines moves onto the nearer line in that direction.
 */
function stepped(
  current: number,
  direction: 1 | -1,
  grid: {step: number; min: number; max: number},
): number {
  const steps = current / grid.step;
  const next =
    direction === 1 ? Math.floor(steps + 1e-6) + 1 : Math.ceil(steps - 1e-6) - 1;
  // Rounded so repeated 0.5 m steps cannot drift (0.1 + 0.2 ≠ 0.3).
  return clamp(Math.round(next * grid.step * 1000) / 1000, grid.min, grid.max);
}

function focusMinutes(s: Readonly<LotusSettings>): number {
  return s.timerMode === 'custom'
    ? Math.max(1, Math.round(s.customMinutes + s.customSeconds / 60))
    : s.presetMinutes;
}

function labelMode(s: Readonly<LotusSettings>): LabelMode {
  if (!s.headerPopEnabled) return 'hover';
  return s.proximityMode === 'always' ? 'always' : 'nearby';
}

export const XR_SETTINGS: XRSettingDef[] = [
  {
    id: 'timer-mode',
    name: 'Timer',
    kind: 'cycle',
    hint: 'Switch between countdown and stopwatch',
    value: (s) => (s.timerMode === 'stopwatch' ? 'Stopwatch' : 'Countdown'),
    step: (s) => ({timerMode: s.timerMode === 'stopwatch' ? 'preset' : 'stopwatch'}),
  },
  {
    id: 'focus-length',
    name: 'Focus length',
    kind: 'stepper',
    hint: 'Change the countdown length',
    value: (s) => (s.timerMode === 'stopwatch' ? '—' : `${focusMinutes(s)} min`),
    step: (s, direction) => ({
      timerMode: 'preset',
      presetMinutes: stepped(focusMinutes(s), direction, FOCUS_MINUTES),
    }),
  },
  {
    id: 'dim',
    name: 'Focus dim',
    kind: 'stepper',
    hint: 'Change how much the room dims while focusing',
    value: (s) => `${Math.round(getShieldStrength(s) * 100)}%`,
    step: (s, direction) => {
      const percent = Math.round(getShieldStrength(s) * 100);
      return {focusAreaVisibility: 100 - stepped(percent, direction, DIM_PERCENT)};
    },
  },
  {
    id: 'dim-style',
    name: 'Dim style',
    kind: 'cycle',
    hint: 'Change the colour of the dimmed room',
    value: (s) => SHIELD_STYLES.find((o) => o.value === s.shieldStyle)?.text ?? 'Frosted',
    step: (s, direction) => ({
      shieldStyle: cycled(
        SHIELD_STYLES,
        SHIELD_STYLES.findIndex((o) => o.value === s.shieldStyle),
        direction,
      ).value,
    }),
  },
  {
    id: 'sound',
    name: 'Sound',
    kind: 'cycle',
    hint: 'Turn sound on or off',
    value: (s) => (s.soundEnabled ? 'On' : 'Off'),
    step: (s) => ({soundEnabled: !s.soundEnabled}),
  },
  {
    id: 'labels',
    name: 'Pin titles',
    kind: 'cycle',
    hint: 'Change when pin titles show',
    value: (s) => LABEL_MODES.find((o) => o.value === labelMode(s))!.text,
    step: (s, direction) =>
      cycled(
        LABEL_MODES,
        LABEL_MODES.findIndex((o) => o.value === labelMode(s)),
        direction,
      ).patch,
  },
  {
    id: 'nearby',
    name: 'Nearby means',
    kind: 'stepper',
    hint: 'Change how close counts as nearby',
    value: (s) => `${s.proximityDistanceMeters.toFixed(1)} m`,
    step: (s, direction) => ({
      proximityDistanceMeters: stepped(s.proximityDistanceMeters, direction, NEARBY_METERS),
    }),
  },
  {
    id: 'pin-shape',
    name: 'Pin shape',
    kind: 'cycle',
    hint: 'Change the shape of every pin',
    value: (s) => (s.defaultPinStyle === 'dot' ? 'Dot' : 'Shape'),
    step: (s) => ({defaultPinStyle: s.defaultPinStyle === 'dot' ? 'revolving' : 'dot'}),
  },
  {
    id: 'pin-color',
    name: 'New pin colour',
    kind: 'cycle',
    hint: 'Change the colour of new pins',
    value: (s) =>
      PIN_COLOR_OPTIONS.find((c) => c.value.toLowerCase() === s.defaultPinColor.toLowerCase())
        ?.label ?? 'Custom',
    swatch: (s) => s.defaultPinColor,
    step: (s, direction) => ({
      defaultPinColor: cycled(
        PIN_COLOR_OPTIONS,
        PIN_COLOR_OPTIONS.findIndex(
          (c) => c.value.toLowerCase() === s.defaultPinColor.toLowerCase(),
        ),
        direction,
      ).value,
    }),
  },
];

export function findXRSetting(id: string): XRSettingDef | undefined {
  return XR_SETTINGS.find((def) => def.id === id);
}
