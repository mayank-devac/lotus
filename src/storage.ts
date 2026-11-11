import {
  FocusZoneBounds,
  LotusSettings,
  LotusTask,
  RoomWaypoint,
  SpatialPin,
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
  timerMode: 'preset',
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

export function loadSavedPins(): SpatialPin[] {
  try {
    const raw = localStorage.getItem(PINS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_PINS];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
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
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Migration: seeded demo tasks (task-2…task-10, all fake completes) are
        // no longer shown. Strip them from previously saved data. User-created
        // ids always carry a timestamp suffix, so seed ids are unambiguous.
        const isSeedId = (id: string): boolean => /^task-(?:[2-9]|10)$/.test(id);
        return parsed.filter(
          (t) =>
            t &&
            typeof t === 'object' &&
            typeof (t as LotusTask).id === 'string' &&
            !isSeedId((t as LotusTask).id),
        );
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
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.defined === 'boolean') {
      return parsed;
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

export function loadLotusSettings(): LotusSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return {...DEFAULT_SETTINGS};
    const parsed = JSON.parse(raw);
    return {...DEFAULT_SETTINGS, ...parsed};
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
