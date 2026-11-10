/**
 * Full-screen onboarding card that explains why LOTUS needs the camera and
 * only triggers the browser permission prompt from a user tap.
 *
 * On AR headsets (Meta Quest etc.) the camera view is provided by the system
 * passthrough once an `immersive-ar` session starts, so the card points the
 * user to the "Enter AR" button instead of opening a second camera stream.
 */
export type CameraGateResult = 'granted' | 'skipped';

export class CameraGate {
  private el: HTMLDivElement;
  private statusEl!: HTMLParagraphElement;
  private enableBtn!: HTMLButtonElement;
  private headsetEl!: HTMLParagraphElement;
  private busy = false;

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
          Using a headset like Meta Quest? Tap <strong>Enter AR</strong> instead
          &mdash; the headset provides the passthrough view and asks for
          permission itself.
        </p>
        <button type="button" class="lotus-camera-gate-primary">Enable camera</button>
        <button type="button" class="lotus-camera-gate-secondary">Continue without camera</button>
        <p class="lotus-camera-gate-status" role="status" aria-live="polite"></p>
      </div>
    `;
    this.statusEl = this.el.querySelector('.lotus-camera-gate-status')!;
    this.enableBtn = this.el.querySelector('.lotus-camera-gate-primary')!;
    this.headsetEl = this.el.querySelector('.lotus-camera-gate-headset')!;
    const skipBtn = this.el.querySelector<HTMLButtonElement>(
      '.lotus-camera-gate-secondary',
    )!;

    this.enableBtn.addEventListener('click', () => void this.request());
    skipBtn.addEventListener('click', () => this.finish('skipped'));
    document.body.appendChild(this.el);

    void this.detectHeadset();
  }

  /** Show the "Enter AR" hint when an immersive-ar capable device is present. */
  private async detectHeadset() {
    try {
      const supported = await navigator.xr?.isSessionSupported('immersive-ar');
      if (supported) this.headsetEl.hidden = false;
    } catch {
      // WebXR unavailable — nothing to hint at.
    }
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
    if (this.busy) return;
    if (!window.isSecureContext) {
      this.setStatus(
        'Camera needs a secure (HTTPS) connection. Open this page over https:// or localhost.',
        true,
      );
      return;
    }
    this.busy = true;
    this.enableBtn.disabled = true;
    this.enableBtn.textContent = 'Waiting for permission…';
    this.setStatus('');

    const ok = await this.startCamera();
    this.busy = false;
    this.enableBtn.disabled = false;

    if (ok) {
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

  public hide() {
    this.el.remove();
  }
}
