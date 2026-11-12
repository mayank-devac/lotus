import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  DEFAULT_FOCUS_ZONE,
  DEFAULT_PINS,
  DEFAULT_SETTINGS,
  DEFAULT_TASKS,
  loadFocusZone,
  loadLotusSettings,
  loadSavedPins,
  loadSavedTasks,
} from './storage';

// The keys storage.ts writes; a change there must be a deliberate migration.
const PINS = 'lotus_ar_spatial_pins_v3';
const TASKS = 'lotus_ar_tasks_v3';
const FOCUS = 'lotus_ar_focus_zone_v3';
const SETTINGS = 'lotus_ar_settings_v3';

/** A Map-backed stand-in for `window.localStorage` (tests run in Node). */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

function store(key: string, value: unknown) {
  localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

const zoneCorners = {min: {x: 0, y: 0, z: 0}, max: {x: 1, y: 1, z: 1}};

describe('loadFocusZone', () => {
  it('returns the default when nothing is stored or the data is broken', () => {
    expect(loadFocusZone()).toEqual(DEFAULT_FOCUS_ZONE);
    store(FOCUS, '{not json');
    expect(loadFocusZone()).toEqual(DEFAULT_FOCUS_ZONE);
    store(FOCUS, {defined: true, label: 'x', min: {x: 0}, max: {x: 1}});
    expect(loadFocusZone()).toEqual(DEFAULT_FOCUS_ZONE);
  });

  it('keeps a stored source and yaw', () => {
    store(FOCUS, {defined: true, label: 'Desk', source: 'screen', yaw: 1.2, ...zoneCorners});
    expect(loadFocusZone()).toMatchObject({source: 'screen', yaw: 1.2});
  });

  describe('migrating zones saved before `source` and `yaw` existed', () => {
    it('reads the untouched default as the default', () => {
      store(FOCUS, {defined: true, label: DEFAULT_FOCUS_ZONE.label, ...zoneCorners});
      expect(loadFocusZone().source).toBe('default');
    });

    it('reads an undefined zone as the default', () => {
      store(FOCUS, {defined: false, label: 'Mine', ...zoneCorners});
      expect(loadFocusZone().source).toBe('default');
    });

    it('reads a zone with a visible screen rectangle as a 2D drag', () => {
      store(FOCUS, {
        defined: true,
        label: 'Focus Area',
        customScreenRect: {visible: true, x: 1, y: 2, width: 3, height: 4},
        ...zoneCorners,
      });
      const zone = loadFocusZone();
      expect(zone.source).toBe('screen');
      expect(zone.customScreenRect).toEqual({visible: true, x: 1, y: 2, width: 3, height: 4});
    });

    it('reads a zone whose screen rectangle was cleared as marked out in the room', () => {
      store(FOCUS, {defined: true, label: 'Focus Area', customScreenRect: null, ...zoneCorners});
      expect(loadFocusZone()).toMatchObject({source: 'room', yaw: 0});
    });

    it('treats an unknown source like a missing one', () => {
      store(FOCUS, {defined: true, label: 'Focus Area', source: 'moon', ...zoneCorners});
      expect(loadFocusZone().source).toBe('room');
    });
  });
});

describe('loadSavedTasks', () => {
  it('seeds the sample task on first run', () => {
    expect(loadSavedTasks()).toEqual(DEFAULT_TASKS);
  });

  it('strips the retired seed tasks task-2 … task-10 but keeps user tasks', () => {
    const t = (id: string) => ({id, title: id, completed: true, createdAt: 1});
    store(TASKS, [t('task-1'), t('task-2'), t('task-10'), t('task-11'), t('task-1700000-ab')]);
    expect(loadSavedTasks().map((x) => x.id)).toEqual(['task-1', 'task-11', 'task-1700000-ab']);
  });

  it('never restores a running timer and drops unsafe or duplicate ids', () => {
    store(TASKS, [
      {id: 'task-x', title: 'A', timerSeconds: 60, remainingSeconds: 30, timerRunning: true},
      {id: 'task-x', title: 'duplicate'},
      {id: '"><img src=x>', title: 'unsafe'},
      'not a task',
    ]);
    const tasks = loadSavedTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({id: 'task-x', timerRunning: false, remainingSeconds: 30});
  });

  it('keeps an empty list empty', () => {
    store(TASKS, []);
    expect(loadSavedTasks()).toEqual([]);
  });
});

describe('loadSavedPins', () => {
  it('seeds the sample pin on first run and on broken data', () => {
    expect(loadSavedPins()).toEqual(DEFAULT_PINS);
    store(PINS, '{');
    expect(loadSavedPins()).toEqual(DEFAULT_PINS);
  });

  it('drops pins without a valid position and cleans colours', () => {
    store(PINS, [
      {id: 'pin-1', title: '', position: {x: 1, y: 2, z: 3}, color: 'red;background:url(x)'},
      {id: 'pin-2', position: {x: 1, y: Number.NaN, z: 3}},
    ]);
    const pins = loadSavedPins();
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({id: 'pin-1', title: 'Untitled pin', color: '#E84D2B'});
    expect(pins[0].normal).toEqual({x: 0, y: 1, z: 0});
  });

  it('keeps a task pin link and drops an unsafe one', () => {
    store(PINS, [
      {
        id: 'pin-1',
        title: 'From a task',
        taskId: 'task-1',
        position: {x: 1, y: 2, z: 3},
      },
      {id: 'pin-2', taskId: 'not a safe id', position: {x: 1, y: 2, z: 3}},
    ]);
    const pins = loadSavedPins();
    expect(pins[0]?.taskId).toBe('task-1');
    expect(pins[1]?.taskId).toBeUndefined();
  });
});

describe('loadLotusSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadLotusSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('moves settings saved before `focusStart` existed to the stopwatch once', () => {
    store(SETTINGS, {timerMode: 'preset', presetMinutes: 45});
    expect(loadLotusSettings()).toMatchObject({
      timerMode: 'stopwatch',
      presetMinutes: 45,
      focusStart: DEFAULT_SETTINGS.focusStart,
    });
  });

  it('keeps a countdown chosen after the migration', () => {
    store(SETTINGS, {timerMode: 'preset', focusStart: 'timer'});
    expect(loadLotusSettings()).toMatchObject({timerMode: 'preset', focusStart: 'timer'});
  });

  it('replaces unknown enum values and mistyped or unknown keys', () => {
    store(SETTINGS, {
      timerMode: 'hourglass',
      focusStart: 'never',
      presetMinutes: '45',
      defaultPinColor: 'javascript:alert(1)',
      somethingElse: true,
    });
    const settings = loadLotusSettings();
    expect(settings).toMatchObject({
      timerMode: DEFAULT_SETTINGS.timerMode,
      focusStart: DEFAULT_SETTINGS.focusStart,
      presetMinutes: DEFAULT_SETTINGS.presetMinutes,
      defaultPinColor: DEFAULT_SETTINGS.defaultPinColor,
    });
    expect(settings).not.toHaveProperty('somethingElse');
  });
});
