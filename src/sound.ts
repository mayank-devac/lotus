/**
 * Zero-dependency Web Audio API procedural sound synthesizer for LOTUS.
 * Provides gentle spatial feedback tones for pin placement, proximity pop-ups,
 * focus timer activation, and session completion.
 */
class LotusSoundEngine {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private getContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as {webkitAudioContext: typeof AudioContext})
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public playPinCreated() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, 528, now, 0.14, 0.08, 'sine');
    this.playTone(ctx, 792, now + 0.07, 0.22, 0.07, 'triangle');
  }

  public playProximityPop() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, 660, now, 0.11, 0.035, 'sine');
  }

  public playPinOpen() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, 440, now, 0.09, 0.05, 'sine');
    this.playTone(ctx, 660, now + 0.05, 0.15, 0.05, 'sine');
  }

  public playFocusStart() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, 396, now, 0.2, 0.07, 'sine');
    this.playTone(ctx, 528, now + 0.09, 0.25, 0.07, 'sine');
    this.playTone(ctx, 660, now + 0.18, 0.35, 0.06, 'triangle');
  }

  public playFocusStop() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, 528, now, 0.14, 0.05, 'sine');
    this.playTone(ctx, 396, now + 0.08, 0.2, 0.05, 'sine');
  }

  public playTimerComplete() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, 528, now, 0.2, 0.09, 'sine');
    this.playTone(ctx, 660, now + 0.15, 0.2, 0.09, 'sine');
    this.playTone(ctx, 792, now + 0.3, 0.25, 0.09, 'sine');
    this.playTone(ctx, 1056, now + 0.45, 0.45, 0.08, 'triangle');
  }

  public playKeyTap() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, 880, now, 0.03, 0.025, 'sine');
  }

  public playHoverTick() {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playTone(ctx, 740, now, 0.035, 0.02, 'sine');
  }

  public playTaskTick(completed: boolean) {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    if (completed) {
      this.playTone(ctx, 587.33, now, 0.1, 0.06, 'sine');
      this.playTone(ctx, 880, now + 0.06, 0.18, 0.07, 'triangle');
    } else {
      this.playTone(ctx, 660, now, 0.09, 0.045, 'sine');
      this.playTone(ctx, 493.88, now + 0.05, 0.12, 0.04, 'sine');
    }
  }

  private playTone(
    ctx: AudioContext,
    freq: number,
    startTime: number,
    duration: number,
    peakGain: number,
    type: OscillatorType,
  ) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    } catch {
      // Ignore audio errors if blocked by browser autoplay policy
    }
  }
}

export const lotusSound = new LotusSoundEngine();
