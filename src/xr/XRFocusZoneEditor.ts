import * as THREE from 'three';
import {focusZoneTopCentre} from '../FocusVolume3D';
import {lotusSound} from '../sound';
import {AppMode, FocusZoneBounds} from '../types';
import {ImmersiveHost} from './ImmersiveHost';
import {XRZoneAction} from './XRInterfaceTypes';
import {XRInterface} from './XRInterface';

const _zonePoint = new THREE.Vector3();

/**
 * Setting the focus area in a headset, and starting focus with it. The area
 * is previewed while dragged and saved only on confirm; leaving the mode
 * without confirming puts the saved area back. The drag gesture itself is
 * ImmersiveSession's.
 */
export class XRFocusZoneEditor {
  // Focus area being set: nothing is saved until the user confirms.
  private zoneBeforeEdit: FocusZoneBounds | null = null;
  private zoneDrawn = false;
  private startTimerAfterZone = false;

  constructor(
    private readonly host: ImmersiveHost,
    private readonly ui: XRInterface,
    /** ImmersiveSession.setMode, which calls `beginEdit` and `discard`. */
    private readonly setMode: (mode: AppMode) => void,
  ) {}

  /** Focus-area mode was entered: remember the area to put back on cancel. */
  public beginEdit() {
    this.zoneBeforeEdit = this.host.getFocusZone();
    this.zoneDrawn = false;
  }

  public reset() {
    this.zoneBeforeEdit = null;
    this.zoneDrawn = false;
    this.startTimerAfterZone = false;
  }

  /** Shows a dragged area without saving it. */
  public preview(zone: FocusZoneBounds) {
    this.host.previewFocusZone(zone);
    this.zoneDrawn = true;
  }

  /** The control panel's hint while in focus-area mode. */
  public hint(): string {
    if (this.zoneDrawn) return 'Drag again to redo, or press "Use this area"';
    if (this.canConfirm()) return 'Pinch and drag to mark a new focus area';
    return this.startTimerAfterZone
      ? 'First pinch and drag across your desk'
      : 'Pinch and drag across your desk';
  }
  /** Runs just the clock: nothing in the room is dimmed. */
  public startTimerOnly() {
    if (this.host.getMode() === 'focus-drag') this.setMode('explore');
    this.host.ui.startFocusTimer(false);
  }

  /** Starts focus with the room dimmed outside the focus area, setting the area first if needed. */
  public startWithArea() {
    if (this.host.getMode() === 'focus-drag' && this.canConfirm()) {
      // Starting focus while an area is on show uses that area.
      this.startTimerAfterZone = true;
      this.confirm();
    } else if (this.host.focusZoneNeedsDefining()) {
      // The timer starts once the area is confirmed; the hint says what to do.
      this.setMode('focus-drag');
      this.startTimerAfterZone = true;
    } else {
      this.host.ui.startFocusTimer(true);
    }
  }

  /** There is an area to confirm: one just drawn, or the one saved earlier. */
  public canConfirm(): boolean {
    return this.zoneDrawn || !this.host.focusZoneNeedsDefining();
  }

  /** Top centre of the area being set, in world space; null when there is none to confirm. */
  public barAnchor(mode: AppMode): THREE.Vector3 | null {
    if (mode !== 'focus-drag' || !this.canConfirm()) return null;
    return this.host.worldRoot.localToWorld(
      focusZoneTopCentre(this.host.getFocusZone(), _zonePoint),
    );
  }

  public runAction(action: XRZoneAction) {
    if (action === 'zone-confirm') this.confirm();
    else this.setMode('explore');
  }

  public confirm() {
    if (!this.canConfirm()) return;
    if (this.zoneDrawn) this.host.commitFocusZone();
    const startTimer = this.startTimerAfterZone;
    // Nothing left to put back when the mode is left below.
    this.zoneDrawn = false;
    this.zoneBeforeEdit = null;
    this.setMode('explore');
    lotusSound.playPinCreated();
    if (startTimer && !this.host.ui.getIsTimerRunning()) {
      this.host.ui.startFocusTimer(true);
    } else {
      this.ui.flashStatus('Focus area saved');
    }
  }

  /** Leaving focus-area mode without confirming: show the saved area again. */
  public discard() {
    if (this.zoneDrawn && this.zoneBeforeEdit) {
      this.host.previewFocusZone(this.zoneBeforeEdit);
    }
    this.zoneDrawn = false;
    this.zoneBeforeEdit = null;
    this.startTimerAfterZone = false;
  }
}
