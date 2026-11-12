import {LotusSettings} from './types';

/** What a FocusTimer tells its subscribers. */
export type FocusTimerEvent =
  | {type: 'start'; withArea: boolean}
  /** `completed`: a countdown ran out, rather than the user stopping it. */
  | {type: 'stop'; completed: boolean}
  /** The clock was held (`pause`) or continues (`resume`); the session stays. */
  | {type: 'pause'}
  | {type: 'resume'}
  /** The clock text may have changed (a few times a second while running). */
  | {type: 'tick'};

export type FocusTimerListener = (event: FocusTimerEvent) => void;

/** True when `b` gives the focus clock a different kind or length than `a`. */
export function clockSettingsChanged(
  a: Readonly<LotusSettings>,
  b: Readonly<LotusSettings>,
): boolean {
  return (
    a.timerMode !== b.timerMode ||
    a.presetMinutes !== b.presetMinutes ||
    a.customMinutes !== b.customMinutes ||
    a.customSeconds !== b.customSeconds
  );
}

/** Countdowns and the stopwatch are checked this often (ms). */
const TICK_MS = 250;

/**
 * The focus session clock: a countdown (preset or custom length) or a
 * stopwatch, per `settings.timerMode`. One instance is owned by the app
 * (index.ts); the 2D interface and the headset interface both start and stop
 * it and subscribe to what it does, so neither owns the session and both
 * always agree on it.
 */
export class FocusTimer {
  private _running = false;
  /** True while the session runs but its clock is held (`pause`). */
  private _paused = false;
  /** The running timer also dims everything outside the focus area (false: timer only). */
  private _withArea = true;
  private remainingSec = 25 * 60;
  private elapsedSec = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<FocusTimerListener>();

  constructor(private readonly getSettings: () => Readonly<LotusSettings>) {
    this.resetClock();
  }

  public get running(): boolean {
    return this._running;
  }

  /** A session is running but its clock is held; `resume` continues it. */
  public get paused(): boolean {
    return this._paused;
  }

  /** A session is running and dims around the focus area (false for timer-only). */
  public get dimsArea(): boolean {
    return this._running && this._withArea;
  }

  /** Calls `listener` on every start, pause, resume, stop and tick. Returns the unsubscribe function. */
  public subscribe(listener: FocusTimerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Puts the clock back to the full length from the settings (stopwatch: zero). */
  public resetClock() {
    const settings = this.getSettings();
    if (settings.timerMode === 'preset') {
      this.remainingSec = settings.presetMinutes * 60;
    } else if (settings.timerMode === 'custom') {
      this.remainingSec = settings.customMinutes * 60 + settings.customSeconds;
    } else {
      this.elapsedSec = 0;
    }
  }

  /**
   * Starts a session. A stopwatch always starts from zero, and so does a
   * countdown that ran out; a stopped countdown resumes where it was. Returns
   * false (and does nothing) when a session is already running.
   */
  public start(withArea: boolean): boolean {
    if (this._running) return false;
    this._withArea = withArea;
    if (this.getSettings().timerMode === 'stopwatch' || this.remainingSec <= 0) {
      this.resetClock();
    }
    this._running = true;
    this._paused = false;
    this.clearInterval();
    this.beginCounting();
    this.emit({type: 'start', withArea});
    return true;
  }

  /**
   * Holds the clock without ending the session: the focus visuals stay as they
   * are. `resume` continues from where it stopped. Returns false when nothing
   * runs or the clock is already held.
   */
  public pause(): boolean {
    if (!this._running || this._paused) return false;
    this._paused = true;
    this.clearInterval();
    this.emit({type: 'pause'});
    return true;
  }

  /** Continues a held clock from where it stopped. Returns false otherwise. */
  public resume(): boolean {
    if (!this._running || !this._paused) return false;
    this._paused = false;
    this.beginCounting();
    this.emit({type: 'resume'});
    return true;
  }

  /**
   * Ends the session; `completed` says a countdown ran out. Returns false when
   * nothing was running.
   */
  public stop(completed = false): boolean {
    if (!this._running) return false;
    this._running = false;
    this._paused = false;
    this.clearInterval();
    this.emit({type: 'stop', completed});
    return true;
  }

  /** MM:SS; empty for a stopwatch that has not started counting. */
  public clockText(): string {
    const settings = this.getSettings();
    if (settings.timerMode === 'stopwatch' && this.elapsedSec === 0) {
      return '';
    }
    const totalSec =
      settings.timerMode === 'stopwatch' ? this.elapsedSec : this.remainingSec;
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /** Stops counting without telling anyone (app teardown). */
  public dispose() {
    this._running = false;
    this._paused = false;
    this.clearInterval();
    this.listeners.clear();
  }

  /**
   * Counts from the wall clock, not from ticks: browsers throttle intervals
   * (background tabs, busy XR frames), and a tick-counted timer then runs slow.
   * Used by `start` and `resume`, always from the current remaining / elapsed.
   */
  private beginCounting() {
    const startedAt = Date.now();
    const startRemaining = this.remainingSec;
    const startElapsed = this.elapsedSec;
    this.intervalId = setInterval(() => {
      const passedSec = Math.floor((Date.now() - startedAt) / 1000);
      if (this.getSettings().timerMode === 'stopwatch') {
        this.elapsedSec = startElapsed + passedSec;
      } else {
        this.remainingSec = Math.max(0, startRemaining - passedSec);
        if (this.remainingSec === 0) {
          this.stop(true);
          return;
        }
      }
      this.emit({type: 'tick'});
    }, TICK_MS);
  }

  private clearInterval() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** One failing subscriber must not stop the others from hearing about the session. */
  private emit(event: FocusTimerEvent) {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('LOTUS: a focus timer listener failed.', error);
      }
    }
  }
}
