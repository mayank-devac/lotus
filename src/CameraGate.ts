/**
 * Full-screen onboarding card that explains why LOTUS needs the camera and
 * only triggers the browser permission prompt from a user tap.
 *
 * On immersive-ar capable devices (headsets, XR emulators, ARCore phones) the
 * card also offers "Enter XR" as the main action, because the device then
 * provides the room view itself. xrblocks' own Enter XR button is hidden by
 * CSS, so this class is the only way into a session: the card is hidden and
 * re-shown rather than destroyed, and a small "Enter XR" chip stays on screen
 * whenever the card is dismissed.
 */
export type CameraGateResult = 'granted' | 'skipped';

const XR_WRAPPER_SELECTOR = '#XRButtonWrapper';

export class CameraGate {
  private el: HTMLDivElement;
  private chipEl: HTMLButtonElement;
  private statusEl!: HTMLParagraphElement;
  private enableBtn!: HTMLButtonElement;
  private headsetEl!: HTMLParagraphElement;
  private xrBtn!: HTMLButtonElement;
  private busy = false;
  private enteringXR = false;
  private xrSupported = false;
  private presenting = false;
  private disposed = false;
  private errorObserver?: MutationObserver;

  constructor(
    private startCamera: () => Promise<boolean>,
    private onDone: (result: CameraGateResult) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'lotus-camera-gate';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'lotus-camera-gate-title');
    this.el.innerHTML = `
      <div class="lotus-camera-gate-card">
        <div class="lotus-camera-gate-eyebrow">LOTUS</div>
        <h1 id="lotus-camera-gate-title">Pin notes to your real room</h1>
        <p class="lotus-camera-gate-copy">
          LOTUS needs your camera to show the room around you, so memory pins
          stay attached to real walls, desks and objects. Video never leaves
          your device.
        </p>
        <p class="lotus-camera-gate-headset" hidden>
          This device supports immersive AR. Tap <strong>Enter XR</strong> to
          see your room through the device itself, or enable the camera to
          stay in the browser.
        </p>
        <button type="button" class="lotus-camera-gate-primary lotus-camera-gate-xr" hidden>Enter XR</button>
        <button type="button" class="lotus-camera-gate-primary lotus-camera-gate-enable">Enable camera</button>
        <button type="button" class="lotus-camera-gate-secondary">Continue without camera</button>
        <p class="lotus-camera-gate-status" role="status" aria-live="polite"></p>
      </div>
    `;
    this.statusEl = this.el.querySelector('.lotus-camera-gate-status')!;
    this.enableBtn = this.el.querySelector('.lotus-camera-gate-enable')!;
    this.headsetEl = this.el.querySelector('.lotus-camera-gate-headset')!;
    this.xrBtn = this.el.querySelector('.lotus-camera-gate-xr')!;
    this.xrBtn.addEventListener('click', () => this.enterXR());
    const skipBtn = this.el.querySelector<HTMLButtonElement>(
      '.lotus-camera-gate-secondary',
    )!;

    this.enableBtn.addEventListener('click', () => void this.request());
    skipBtn.addEventListener('click', () => this.finish('skipped'));

    // Shown instead of the card once it is dismissed on an XR-capable device.
    this.chipEl = document.createElement('button');
    this.chipEl.type = 'button';
    this.chipEl.className = 'lotus-enter-xr-chip';
    this.chipEl.textContent = 'Enter XR';
    this.chipEl.hidden = true;
    this.chipEl.addEventListener('click', () => {
      this.show();
      this.enterXR();
    });

    document.body.append(this.el, this.chipEl);

    void this.detectHeadset();
  }

  /** Offer "Enter XR" when an immersive-ar capable device is present. */
  private async detectHeadset() {
    try {
      const supported = await navigator.xr?.isSessionSupported('immersive-ar');
      if (!supported || this.disposed) return;
      this.xrSupported = true;
      this.headsetEl.hidden = false;
      this.xrBtn.hidden = false;
      // Enter XR becomes the main action; the webcam is the fallback.
      this.enableBtn.classList.add('is-fallback');
      // A standalone headset has no useful webcam view: the browser camera is
      // not the room. Offer only Enter XR there.
      if (/OculusBrowser|Quest/i.test(navigator.userAgent)) {
        this.enableBtn.hidden = true;
        const copyEl = this.el.querySelector<HTMLElement>(
          '.lotus-camera-gate-copy',
        );
        if (copyEl) copyEl.hidden = true;
        this.headsetEl.innerHTML =
          'Tap <strong>Enter XR</strong> to see your room through the headset. ' +
          'Memory pins stay attached to real walls, desks and objects.';
        const skipBtn = this.el.querySelector<HTMLButtonElement>(
          '.lotus-camera-gate-secondary',
        );
        if (skipBtn) skipBtn.textContent = 'Not now';
      }
      this.syncVisibility(this.el.isConnected);
    } catch {
      // WebXR unavailable — nothing to offer.
    }
  }

  /**
   * xrblocks' own Enter XR button is hidden, so forward the tap to it. The
   * click runs inside this user gesture, which requestSession() requires.
   * The card stays up until the session really starts (`onSessionStart`) so a
   * failed request can be reported and retried.
   */
  private enterXR() {
    if (this.busy || this.enteringXR) return;
    const xrButton = document.querySelector<HTMLButtonElement>(
      `${XR_WRAPPER_SELECTOR} button.XRButton`,
    );
    if (!xrButton || xrButton.disabled) {
      this.setStatus('XR is still starting up — try again in a moment.', true);
      return;
    }
    this.watchXRErrors();
    this.setEnteringXR(true);
    this.setStatus('');
    xrButton.click();
  }

  /**
   * xrblocks reports both permission and requestSession failures by filling
   * its (hidden) error element, so mirror that text into the card.
   */
  private watchXRErrors() {
    if (this.errorObserver) return;
    const errorEl = document.querySelector<HTMLElement>(
      `${XR_WRAPPER_SELECTOR} .XRButtonError`,
    );
    if (!errorEl) return;
    this.errorObserver = new MutationObserver(() => {
      const text = errorEl.textContent?.trim();
      if (!text || !this.enteringXR) return;
      this.setEnteringXR(false);
      this.show();
      this.setStatus(`${text} Tap Enter XR to try again.`, true);
    });
    this.errorObserver.observe(errorEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  private setEnteringXR(entering: boolean) {
    this.enteringXR = entering;
    this.xrBtn.disabled = entering;
    this.xrBtn.textContent = entering ? 'Entering XR…' : 'Enter XR';
    this.enableBtn.disabled = entering || this.busy;
  }

  /** The immersive session is live: the device owns the view, hide everything. */
  public onSessionStart() {
    this.presenting = true;
    this.setEnteringXR(false);
    this.setStatus('');
    this.syncVisibility(false);
  }

  /**
   * The session ended. Bring the card back when nothing else would be visible
   * behind the canvas; otherwise just leave the "Enter XR" chip.
   */
  public onSessionEnd(showCard: boolean) {
    this.presenting = false;
    this.syncVisibility(showCard);
  }

  /** Silently reuse an existing grant; otherwise leave the card for a tap. */
  public async autoStartIfGranted(): Promise<void> {
    try {
      const status = await navigator.permissions.query({
        name: 'camera' as PermissionName,
      });
      if (status.state === 'granted') await this.request();
    } catch {
      // Permissions API missing for 'camera' (e.g. Safari) — wait for the tap.
    }
  }

  private async request() {
    if (this.busy || this.enteringXR) return;
    if (!window.isSecureContext) {
      this.setStatus(
        'Camera needs a secure (HTTPS) connection. Open this page over https:// or localhost.',
        true,
      );
      return;
    }
    this.busy = true;
    this.enableBtn.disabled = true;
    // Entering XR while the camera prompt is pending would start the webcam
    // inside the immersive session.
    this.xrBtn.disabled = true;
    this.enableBtn.textContent = 'Waiting for permission…';
    this.setStatus('');

    const ok = await this.startCamera();
    this.busy = false;
    if (this.disposed) return;
    this.enableBtn.disabled = this.enteringXR;
    this.xrBtn.disabled = this.enteringXR;

    if (ok) {
      this.enableBtn.textContent = 'Enable camera';
      this.finish('granted');
      return;
    }
    this.enableBtn.textContent = 'Try again';
    this.setStatus(
      'Camera is blocked or unavailable. Allow camera access in your browser’s site settings (the lock icon in the address bar), then tap Try again.',
      true,
    );
  }

  private setStatus(text: string, isError = false) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('is-error', isError);
  }

  private finish(result: CameraGateResult) {
    this.hide();
    this.onDone(result);
  }

  /** Card and chip are mutually exclusive; neither shows during a session. */
  private syncVisibility(showCard: boolean) {
    if (this.disposed) return;
    const card = showCard && !this.presenting;
    if (card && !this.el.isConnected) document.body.appendChild(this.el);
    if (!card) this.el.remove();
    this.chipEl.hidden = card || this.presenting || !this.xrSupported;
  }

  public show() {
    this.syncVisibility(true);
  }

  /** Dismiss the card. It can be shown again; use `dispose()` to tear down. */
  public hide() {
    this.syncVisibility(false);
  }

  public dispose() {
    this.disposed = true;
    this.errorObserver?.disconnect();
    this.el.remove();
    this.chipEl.remove();
  }
}
