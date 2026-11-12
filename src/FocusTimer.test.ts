import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {FocusTimer, FocusTimerEvent, clockSettingsChanged} from './FocusTimer';
import {DEFAULT_SETTINGS} from './storage';
import {LotusSettings} from './types';

let settings: LotusSettings;
let timer: FocusTimer;
let events: FocusTimerEvent['type'][];

beforeEach(() => {
  vi.useFakeTimers();
  settings = {...DEFAULT_SETTINGS};
  timer = new FocusTimer(() => settings);
  events = [];
  timer.subscribe((e) => events.push(e.type));
});

afterEach(() => {
  timer.dispose();
  vi.useRealTimers();
});

describe('FocusTimer', () => {
  it('runs a stopwatch from zero and tells subscribers', () => {
    expect(timer.clockText()).toBe('');
    expect(timer.start(true)).toBe(true);
    expect(timer.running).toBe(true);
    expect(timer.dimsArea).toBe(true);
    vi.advanceTimersByTime(61_000);
    expect(timer.clockText()).toBe('01:01');
    expect(events[0]).toBe('start');
    expect(events).toContain('tick');
  });

  it('does not start twice or stop when idle', () => {
    expect(timer.stop()).toBe(false);
    timer.start(false);
    expect(timer.start(true)).toBe(false);
    expect(events.filter((e) => e === 'start')).toHaveLength(1);
  });

  it('runs a timer-only session that dims nothing', () => {
    timer.start(false);
    expect(timer.running).toBe(true);
    expect(timer.dimsArea).toBe(false);
  });

  it('stops a countdown at zero as completed', () => {
    settings = {...settings, timerMode: 'custom', customMinutes: 0, customSeconds: 2};
    timer.resetClock();
    const stops: boolean[] = [];
    timer.subscribe((e) => e.type === 'stop' && stops.push(e.completed));
    timer.start(true);
    vi.advanceTimersByTime(2_250);
    expect(timer.running).toBe(false);
    expect(stops).toEqual([true]);
  });

  it('resumes a stopped countdown where it was', () => {
    settings = {...settings, timerMode: 'preset', presetMinutes: 25};
    timer.resetClock();
    timer.start(true);
    vi.advanceTimersByTime(60_000);
    timer.stop();
    timer.start(true);
    expect(timer.clockText()).toBe('24:00');
  });

  it('holds and continues a stopwatch without losing time', () => {
    timer.start(true);
    vi.advanceTimersByTime(30_000);
    expect(timer.clockText()).toBe('00:30');
    expect(timer.pause()).toBe(true);
    expect(timer.paused).toBe(true);
    // Held: the interval is cleared, so time passes without ticks.
    vi.advanceTimersByTime(60_000);
    expect(timer.clockText()).toBe('00:30');
    expect(timer.resume()).toBe(true);
    expect(timer.paused).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(timer.clockText()).toBe('00:32');
    expect(events).toContain('pause');
    expect(events).toContain('resume');
  });

  it('holds and continues a countdown where it was', () => {
    settings = {...settings, timerMode: 'preset', presetMinutes: 25};
    timer.resetClock();
    timer.start(true);
    vi.advanceTimersByTime(60_000);
    expect(timer.clockText()).toBe('24:00');
    timer.pause();
    vi.advanceTimersByTime(120_000);
    timer.resume();
    vi.advanceTimersByTime(1_000);
    expect(timer.clockText()).toBe('23:59');
  });

  it('completes a countdown that ran past zero while it was held', () => {
    settings = {...settings, timerMode: 'preset', presetMinutes: 1};
    timer.resetClock();
    const stops: boolean[] = [];
    timer.subscribe((e) => e.type === 'stop' && stops.push(e.completed));
    timer.start(true);
    vi.advanceTimersByTime(59_000);
    timer.pause();
    // Held past the end: nothing happens until the clock continues.
    vi.advanceTimersByTime(120_000);
    expect(timer.clockText()).toBe('00:01');
    timer.resume();
    vi.advanceTimersByTime(2_000);
    expect(timer.running).toBe(false);
    expect(stops).toEqual([true]);
  });

  it('refuses pausing when idle, a second pause, and resuming a stopped clock', () => {
    expect(timer.pause()).toBe(false);
    timer.start(true);
    timer.pause();
    expect(timer.pause()).toBe(false);
    timer.stop();
    expect(timer.paused).toBe(false);
    expect(timer.resume()).toBe(false);
  });

  it('keeps time from the wall clock when ticks are late', () => {
    timer.start(true);
    // A throttled tab: the clock jumps, the interval fires once.
    vi.setSystemTime(Date.now() + 90_000);
    vi.advanceTimersByTime(250);
    expect(timer.clockText()).toBe('01:30');
  });

  it('keeps notifying the others when one subscriber throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const quiet = new FocusTimer(() => settings);
    const heard: string[] = [];
    quiet.subscribe(() => {
      throw new Error('boom');
    });
    quiet.subscribe((e) => heard.push(e.type));
    quiet.start(true);
    expect(heard).toEqual(['start']);
    expect(error).toHaveBeenCalled();
    quiet.dispose();
    error.mockRestore();
  });

  it('stops listening after unsubscribe', () => {
    const heard: string[] = [];
    const off = timer.subscribe((e) => heard.push(e.type));
    off();
    timer.start(true);
    expect(heard).toEqual([]);
  });
});

describe('clockSettingsChanged', () => {
  it('only counts the settings that set the clock', () => {
    const base = {...DEFAULT_SETTINGS};
    expect(clockSettingsChanged(base, {...base, shieldStyle: 'dark'})).toBe(false);
    expect(clockSettingsChanged(base, {...base, presetMinutes: 50})).toBe(true);
    expect(clockSettingsChanged(base, {...base, timerMode: 'preset'})).toBe(true);
    expect(clockSettingsChanged(base, {...base, customSeconds: 5})).toBe(true);
  });
});
