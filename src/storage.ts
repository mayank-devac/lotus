import {
  FocusStartMode,
  FocusZoneBounds,
  LotusSettings,
  LotusTask,
  RoomWaypoint,
  SpatialPin,
  TimerMode,
  Vector3Data,
} from './types';

const PINS_STORAGE_KEY = 'lotus_ar_spatial_pins_v3';
const FOCUS_STORAGE_KEY = 'lotus_ar_focus_zone_v3';
const SETTINGS_STORAGE_KEY = 'lotus_ar_settings_v3';
const TASKS_STORAGE_KEY = 'lotus_ar_tasks_v3';

export function vec3(x: number, y: number, z: number): Vector3Data {
  return {x, y, z};
}

export const DEFAULT_TASKS: LotusTask[] = [
  {
    id: 'task-1',
    title: 'Complete practice problems #4–12',
    note: 'Focus on Chapter 4 derivations before seminar',
    dueLabel: 'Today · 5:00 PM',
    type: 'task',
    timerSeconds: 25 * 60,
    remainingSeconds: 25 * 60,
    timerRunning: false,
    completed: false,
    createdAt: Date.now() - 3600 * 1000 * 2,
  },
];

export const DEFAULT_PINS: SpatialPin[] = [
  {
    id: 'pin-desk-reminder',
    title: 'Review Study Notes & Chapter 4',
    body: 'Complete practice problems #4–12 before Friday seminar. Tap Edit to update or Delete to remove this sample pin.',
    surfaceLabel: 'Desk Surface',
    color: '#E84D2B',
    shapeStyle: 'revolving',
    completed: false,
    position: vec3(-0.08, 1.32, -1.45),
    normal: vec3(0, 1, 0),
    createdAt: Date.now() - 3600 * 1000 * 2,
  },
];

export const DEFAULT_FOCUS_ZONE: FocusZoneBounds = {
  defined: true,
  label: 'Study Desk Area',
  min: vec3(-0.65, 0.75, -1.75),
  max: vec3(0.65, 1.55, -1.1),
};

export const DEFAULT_SETTINGS: LotusSettings = {
  timerMode: 'stopwatch',
  focusStart: 'ask',
  presetMinutes: 25,
  customMinutes: 20,
  customSeconds: 0,
  shieldStyle: 'frosted',
  focusAreaVisibility: 25,
  proximityMode: 'proximity-2m',
  proximityDistanceMeters: 0.5,
  headerPopEnabled: false,
  ambientLightMode: 'timer',
  ambientLightDurationSec: 6,
  defaultPinStyle: 'revolving',
  defaultPinColor: '#E84D2B',
  showVirtualRoom: false, // Real-world live camera AR by default
  soundEnabled: true,
};

/**
 * The seeded sample pin, still exactly where the seed put it. Its made-up
 * "desk" coordinates are an arbitrary spot in a real room.
 */
export function isPristineSamplePin(pin: SpatialPin): boolean {
  return DEFAULT_PINS.some(
    (sample) =>
      pin.id === sample.id &&
      pin.title === sample.title &&
      pin.position.x === sample.position.x &&
      pin.position.y === sample.position.y &&
      pin.position.z === sample.position.z,
  );
}

/** The focus zone still holds the made-up default rather than a real spot. */
export function isDefaultFocusZone(zone: FocusZoneBounds): boolean {
  return !zone.defined || zone.label === DEFAULT_FOCUS_ZONE.label;
}

/** How strongly the surroundings are hidden while focusing, 0 (clear) to 1. */
export function getShieldStrength(settings: LotusSettings): number {
  const visibility = Math.max(
    0,
    Math.min(100, settings.focusAreaVisibility ?? DEFAULT_SETTINGS.focusAreaVisibility),
  );
  return 1 - visibility / 100;
}

export const ROOM_WAYPOINTS: RoomWaypoint[] = [
  {
    id: 'close',
    label: 'Close (1.2m)',
    subtitle: 'Within 2m — headers pop up automatically',
    position: vec3(0, 1.45, -0.25),
    lookAt: vec3(0, 1.15, -1.5),
  },
  {
    id: 'far',
    label: 'Step Back (2.7m)',
    subtitle: 'Beyond 2m — headers hide into compact dots',
    position: vec3(0, 1.45, 1.25),
    lookAt: vec3(0, 1.15, -1.5),
  },
];

// -----------------------------------------------------------------------------
// Validation. Stored data is untrusted: ids and colours end up in DOM
// attributes and styles, and a malformed position would break the 3D scene.
// -----------------------------------------------------------------------------

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const MAX_TEXT = 4000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.slice(0, MAX_TEXT) : fallback;
}

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function readVec3(v: unknown): Vector3Data | null {
  if (!isRecord(v)) return null;
  const {x, y, z} = v;
  if (![x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  return vec3(x as number, y as number, z as number);
}

/** Only `#rgb`, `#rrggbb` or `#rrggbbaa`; anything else falls back. */
export function safeColor(v: unknown, fallback = '#E84D2B'): string {
  return typeof v === 'string' && HEX_COLOR.test(v) ? v : fallback;
}

function sanitizePin(v: unknown): SpatialPin | null {
  if (!isRecord(v) || typeof v.id !== 'string' || !SAFE_ID.test(v.id)) {
    return null;
  }
  const position = readVec3(v.position);
  if (!position) return null;
  return {
    id: v.id,
    title: text(v.title, 'Untitled pin') || 'Untitled pin',
    body: text(v.body),
    surfaceLabel: text(v.surfaceLabel, 'Room') || 'Room',
    color: safeColor(v.color),
    shapeStyle:
      v.shapeStyle === 'dot' || v.shapeStyle === 'revolving'
        ? v.shapeStyle
        : undefined,
    completed: v.completed === true,
    position,
    normal: readVec3(v.normal) ?? vec3(0, 1, 0),
    createdAt: finite(v.createdAt, Date.now()),
  };
}

function sanitizeTask(v: unknown): LotusTask | null {
  if (!isRecord(v) || typeof v.id !== 'string' || !SAFE_ID.test(v.id)) {
    return null;
  }
  const timerSeconds =
    typeof v.timerSeconds === 'number' && v.timerSeconds > 0
      ? v.timerSeconds
      : undefined;
  return {
    id: v.id,
    title: text(v.title, 'Untitled task') || 'Untitled task',
    note: text(v.note),
    dueLabel: text(v.dueLabel),
    type: v.type === 'reminder' ? 'reminder' : 'task',
    timerSeconds,
    remainingSeconds:
      timerSeconds === undefined
        ? undefined
        : Math.max(0, finite(v.remainingSeconds, timerSeconds)),
    // A timer cannot still be running after a reload.
    timerRunning: false,
    completed: v.completed === true,
    createdAt: finite(v.createdAt, Date.now()),
    completedAt:
      typeof v.completedAt === 'number' ? v.completedAt : undefined,
  };
}

function sanitizeList<T>(raw: unknown, one: (v: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of raw) {
    const clean = one(item) as (T & {id: string}) | null;
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    out.push(clean);
  }
  return out;
}

export function loadSavedPins(): SpatialPin[] {
  try {
    const raw = localStorage.getItem(PINS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_PINS];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return sanitizeList(parsed, sanitizePin);
  } catch {
    // Fallback to defaults
  }
  return [...DEFAULT_PINS];
}

export function savePinsToStorage(pins: SpatialPin[]): void {
  try {
    localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadSavedTasks(): LotusTask[] {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Migration: seeded demo tasks (task-2…task-10, all fake completes) are
        // no longer shown. Strip them from previously saved data. User-created
        // ids always carry a timestamp suffix, so seed ids are unambiguous.
        const isSeedId = (id: string): boolean => /^task-(?:[2-9]|10)$/.test(id);
        return sanitizeList(parsed, sanitizeTask).filter((t) => !isSeedId(t.id));
      }
    }
  } catch {
    // Fallback to defaults
  }
  return [...DEFAULT_TASKS];
}

export function saveTasksToStorage(tasks: LotusTask[]): void {
  try {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadFocusZone(): FocusZoneBounds {
  try {
    const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
    if (!raw) return {...DEFAULT_FOCUS_ZONE};
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.defined === 'boolean') {
      const min = readVec3(parsed.min);
      const max = readVec3(parsed.max);
      if (min && max) {
        return {
          ...(parsed as unknown as FocusZoneBounds),
          label: text(parsed.label, DEFAULT_FOCUS_ZONE.label),
          min,
          max,
        };
      }
    }
  } catch {
    // Fallback
  }
  return {...DEFAULT_FOCUS_ZONE};
}

export function saveFocusZoneToStorage(zone: FocusZoneBounds): void {
  try {
    localStorage.setItem(FOCUS_STORAGE_KEY, JSON.stringify(zone));
  } catch {
    // Ignore storage errors
  }
}

const TIMER_MODES: TimerMode[] = ['preset', 'custom', 'stopwatch'];
const FOCUS_START_MODES: FocusStartMode[] = ['ask', 'timer', 'area'];

export function loadLotusSettings(): LotusSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {...DEFAULT_SETTINGS};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {...DEFAULT_SETTINGS};
    // Keep only known keys whose stored type matches the default's type.
    const merged: Record<string, unknown> = {...DEFAULT_SETTINGS};
    for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
      if (typeof parsed[key] === typeof fallback) merged[key] = parsed[key];
    }
    const settings = merged as unknown as LotusSettings;
    settings.defaultPinColor = safeColor(settings.defaultPinColor);
    // Settings saved before `focusStart` existed predate the stopwatch default:
    // move them to it once. Later saves carry `focusStart`, so a countdown
    // chosen after this is kept.
    if (!('focusStart' in parsed) || !TIMER_MODES.includes(settings.timerMode)) {
      settings.timerMode = DEFAULT_SETTINGS.timerMode;
    }
    if (!FOCUS_START_MODES.includes(settings.focusStart)) {
      settings.focusStart = DEFAULT_SETTINGS.focusStart;
    }
    return settings;
  } catch {
    return {...DEFAULT_SETTINGS};
  }
}

export function saveLotusSettings(settings: LotusSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}
