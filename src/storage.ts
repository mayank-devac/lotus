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
const DAY_MS = 24 * 3600 * 1000;
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
  {
    id: 'task-2',
    title: 'Organize desk reference articles',
    note: 'Sorted key papers for literature review',
    dueLabel: 'Completed Today',
    type: 'task',
    timerSeconds: 15 * 60,
    remainingSeconds: 0,
    timerRunning: false,
    completed: true,
    createdAt: Date.now() - 3600 * 1000 * 6,
    completedAt: Date.now() - 3600 * 1000 * 2,
  },
  {
    id: 'task-3',
    title: 'Review spatial optics lecture slides',
    note: 'Summarized depth-of-field equations',
    dueLabel: 'Yesterday',
    type: 'task',
    timerSeconds: 25 * 60,
    remainingSeconds: 0,
    timerRunning: false,
    completed: true,
    createdAt: Date.now() - DAY_MS * 1 - 3600 * 1000 * 4,
    completedAt: Date.now() - DAY_MS * 1 - 3600 * 1000 * 1,
  },
  {
    id: 'task-4',
    title: 'Submit lab safety checklist',
    note: 'Confirmed XR headset calibration logs',
    dueLabel: 'Yesterday',
    type: 'reminder',
    timerSeconds: 15 * 60,
    remainingSeconds: 0,
    timerRunning: false,
    completed: true,
    createdAt: Date.now() - DAY_MS * 1 - 3600 * 1000 * 7,
    completedAt: Date.now() - DAY_MS * 1 - 3600 * 1000 * 3,
  },
  {
    id: 'task-5',
    title: 'Draft methodology section outline',
    note: '2 pages drafted for weekly advisor check-in',
    dueLabel: '2 days ago',
    type: 'task',
    timerSeconds: 45 * 60,
    remainingSeconds: 0,
    timerRunning: false,
    completed: true,
    createdAt: Date.now() - DAY_MS * 2 - 3600 * 1000 * 5,
    completedAt: Date.now() - DAY_MS * 2 - 3600 * 1000 * 2,
  },
  {
    id: 'task-6',
    title: 'Annotate bibliography sources #1–8',
    note: 'Added spatial memory citations',
    dueLabel: '3 days ago',
    type: 'task',
    timerSeconds: 25 * 60,
    remainingSeconds: 0,
    timerRunning: false,
    completed: true,
    createdAt: Date.now() - DAY_MS * 3 - 3600 * 1000 * 6,
    completedAt: Date.now() - DAY_MS * 3 - 3600 * 1000 * 2,
  },
  {
    id: 'task-7',
    title: 'Return reference textbook to library',
    note: 'Renewed digital copy',
    dueLabel: '3 days ago',
    type: 'reminder',
    timerSeconds: 15 * 60,
    remainingSeconds: 0,
    timerRunning: false,
    completed: true,
    createdAt: Date.now() - DAY_MS * 3 - 3600 * 1000 * 8,
    completedAt: Date.now() - DAY_MS * 3 - 3600 * 1000 * 4,
  },
  {
    id: 'task-8',
    title: 'Prepare seminar problem set #3',
    note: 'Completed all 6 proofs',
    dueLabel: '3 days ago',
    type: 'task',
    timerSeconds: 45 * 60,
    remainingSeconds: 0,
    timerRunning: false,
    completed: true,
    createdAt: Date.now() - DAY_MS * 3 - 3600 * 1000 * 9,
    completedAt: Date.now() - DAY_MS * 3 - 3600 * 1000 * 5,
  },
  {
    id: 'task-9',
    title: 'Clean up study desk & calibrate lighting',
    note: 'Set up warm paper focus environment',
    dueLabel: '5 days ago',
    type: 'task',
    timerSeconds: 15 * 60,
    remainingSeconds: 0,
    timerRunning: false,
    completed: true,
    createdAt: Date.now() - DAY_MS * 5 - 3600 * 1000 * 4,
    completedAt: Date.now() - DAY_MS * 5 - 3600 * 1000 * 2,
  },
  {
    id: 'task-10',
    title: 'Weekly reading group sync notes',
    note: 'Shared summary with study group',
    dueLabel: '6 days ago',
    type: 'reminder',
    timerSeconds: 25 * 60,
    remainingSeconds: 0,
    timerRunning: false,
    completed: true,
    createdAt: Date.now() - DAY_MS * 6 - 3600 * 1000 * 5,
    completedAt: Date.now() - DAY_MS * 6 - 3600 * 1000 * 2,
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
  proximityDistanceMeters: 2.0,
  headerPopEnabled: true,
  defaultPinStyle: 'revolving',
  defaultPinColor: '#E84D2B',
  showVirtualRoom: false, // Real-world live camera AR by default
  soundEnabled: true,
};

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
    if (!raw) return [...DEFAULT_TASKS];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
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
