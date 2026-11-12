/** A destructive button must be pressed again within this long to act. */
const CONFIRM_WINDOW_MS = 4000;

/**
 * Two-press confirmation for destructive buttons in a headset (delete pin,
 * delete task, Exit XR). The first press arms the button's key for a few
 * seconds; a second press of the same key while armed confirms. Only one
 * key is armed at a time.
 */
export class ConfirmGuard {
  private armed: {key: string; until: number} | null = null;

  /** False on the first press (which arms `key`), true on the confirming second one. */
  public confirm(key: string): boolean {
    const now = performance.now();
    if (this.armed?.key === key && now < this.armed.until) {
      this.armed = null;
      return true;
    }
    this.armed = {key, until: now + CONFIRM_WINDOW_MS};
    return false;
  }

  /** `key` is waiting for its confirming press (the button shows as armed). */
  public isArmed(key: string): boolean {
    return this.armed?.key === key;
  }

  /** Withdraws a first press, e.g. because another button was pressed. */
  public clear() {
    this.armed = null;
  }

  /** Disarms once the confirm window has passed; called every frame. */
  public expire() {
    if (this.armed && performance.now() >= this.armed.until) this.armed = null;
  }
}
