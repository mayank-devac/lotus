import {LotusSettings} from '../types';

/**
 * The focus session clock: a countdown (preset or custom length) or a
 * stopwatch, per `settings.timerMode`. Only keeps time; `LotusUI` decides
 * what starting and stopping focus does to the rest of the interface.
 */
export class FocusTimer {
  private _running = false;
  /** The running timer also dims everything outside the focus area (false: timer only). */
  private _usesArea = true;
  private remainingSec = 25 * 60;
  private elapsedSec = 0;
  private intervalId: number | null = null;

  /**
   * `onTick` runs a few times a second while counting; `onFinished` once a
   * countdown reaches zero (the timer is still running then: stop it there).
   */
  constructor(
    private readonly getSettings: () => LotusSettings,
    private readonly onTick: () => void,
    private readonly onFinished: () => void,
  ) {
    this.resetClock();
  }

  public get running(): boolean {
    return this._running;
  }

  public get usesArea(): boolean {
    return this._usesArea;
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
   * Starts counting. A stopwatch always starts from zero, and so does a
   * countdown that ran out; a stopped countdown resumes where it was. Returns
   * false (and does nothing) when the timer is already running.
   */
  public start(withArea: boolean): boolean {
    if (this._running) return false;
    this._usesArea = withArea;
    if (this.getSettings().timerMode === 'stopwatch' || this.remainingSec <= 0) {
      this.resetClock();
    }
    this._running = true;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
    }

    // Count from the wall clock, not from ticks: browsers throttle intervals
    // (background tabs, busy XR frames), and a tick-counted timer then runs slow.
    const startedAt = Date.now();
    const startRemaining = this.remainingSec;
    const startElapsed = this.elapsedSec;
    this.intervalId = window.setInterval(() => {
      const passedSec = Math.floor((Date.now() - startedAt) / 1000);
      if (this.getSettings().timerMode === 'stopwatch') {
        this.elapsedSec = startElapsed + passedSec;
      } else {
        this.remainingSec = Math.max(0, startRemaining - passedSec);
        if (this.remainingSec === 0) {
          this.onFinished();
          return;
        }
      }
      this.onTick();
    }, 250);
    return true;
  }

  /** Stops counting. Returns false when there was nothing to stop. */
  public stop(): boolean {
    if (!this._running && this.intervalId === null) return false;
    this._running = false;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
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
}
