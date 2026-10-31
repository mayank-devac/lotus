/**
 * Manages the live real-world camera video stream behind the transparent 3D AR canvas
 * so LOTUS works directly in the user's real house on phones, tablets, laptops, and AR headsets.
 */
export class CameraPassthrough {
  private videoEl: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private currentFacingMode: 'environment' | 'user' = 'environment';
  public isStreaming = false;
  private onStatusChange?: (streaming: boolean, label: string) => void;

  constructor(onStatusChange?: (streaming: boolean, label: string) => void) {
    this.onStatusChange = onStatusChange;
    this.videoEl = document.createElement('video');
    this.videoEl.id = 'lotus-camera-feed';
    this.videoEl.autoplay = true;
    this.videoEl.playsInline = true;
    this.videoEl.muted = true;
    this.videoEl.setAttribute('playsinline', 'true');
    this.videoEl.setAttribute('webkit-playsinline', 'true');
    document.body.prepend(this.videoEl);
  }

  public async startCamera(
    facingMode: 'environment' | 'user' = this.currentFacingMode,
  ): Promise<boolean> {
    this.currentFacingMode = facingMode;
    this.stopCamera();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.isStreaming = false;
      this.onStatusChange?.(false, 'Camera API unavailable');
      return false;
    }

    try {
      // First try preferred facingMode (rear camera on mobile/tablet)
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: {ideal: facingMode},
          width: {ideal: 1920},
          height: {ideal: 1080},
        },
      });
    } catch {
      try {
        // Fallback to any available video camera (e.g. desktop/laptop webcam)
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      } catch {
        this.isStreaming = false;
        this.onStatusChange?.(false, 'Camera permission needed');
        return false;
      }
    }

    if (this.stream) {
      this.videoEl.srcObject = this.stream;
      try {
        await this.videoEl.play();
      } catch {
        // Autoplay handled on next interaction
      }
      this.isStreaming = true;
      const track = this.stream.getVideoTracks()[0];
      const label = track?.label || 'Live Camera';
      this.onStatusChange?.(true, label);
      return true;
    }

    return false;
  }

  public async flipCamera(): Promise<boolean> {
    const next =
      this.currentFacingMode === 'environment' ? 'user' : 'environment';
    return this.startCamera(next);
  }

  public setVisible(visible: boolean) {
    this.videoEl.style.display = visible ? 'block' : 'none';
  }

  public stopCamera() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    this.isStreaming = false;
  }
}
