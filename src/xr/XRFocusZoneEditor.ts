import * as THREE from 'three';
import {focusZoneTopCentre} from '../FocusVolume3D';
import {lotusSound} from '../sound';
import {AppMode, FocusZoneBounds} from '../types';
import {ImmersiveHost} from './ImmersiveHost';
import {XRZoneAction} from './XRInterfaceTypes';
import {XRInterface} from './XRInterface';

const _zonePoint = new THREE.Vector3();

/** Focus-area mode: an area is being marked out. Nothing is saved until it is confirmed. */
interface ZoneDrawing {
  kind: 'drawing';
  /**
   * The saved area, kept from the moment a dragged preview replaced it so
   * that leaving without confirming can put it back. Null until the user
   * drags: then there is nothing new to save and nothing to put back.
   */
  previous: FocusZoneBounds | null;
  /** Play was pressed before there was an area: focus starts on confirm. */
  startTimerAfter: boolean;
}

/**
 * Where starting focus stands. One value, so impossible mixes (a drawn area
 * outside focus-area mode, a pending start with nothing being drawn) cannot
 * be represented.
 */
type FocusSetup =
  | {kind: 'idle'}
  /**
   * Play was pressed with "Start focus: Ask each time" and the panel shows
   * the choice. `resume` is the area being drawn underneath, if Play was
   * pressed during focus-area mode; closing the question returns to it.
   */
  | {kind: 'asking'; resume: ZoneDrawing | null}
  | ZoneDrawing;

const IDLE: FocusSetup = {kind: 'idle'};

/**
 * Starting focus in a headset, and setting the focus area for it. The area
 * is previewed while dragged and saved only on confirm; leaving the mode
 * without confirming puts the saved area back. The drag gesture itself is
 * ImmersiveSession's, as is the mode, which changes only through its
 * `setMode` (that calls `beginEdit` and `discard` here).
 */
export class XRFocusZoneEditor {
  private setup: FocusSetup = IDLE;

  constructor(
    private readonly host: ImmersiveHost,
    private readonly ui: XRInterface,
    /** ImmersiveSession.setMode, which calls `beginEdit` and `discard`. */
    private readonly setMode: (mode: AppMode) => void,
  ) {}

  public reset() {
    this.setup = IDLE;
  }

  /** The area being drawn, also while the "Start how?" question covers it. */
  private drawing(): ZoneDrawing | null {
    switch (this.setup.kind) {
      case 'drawing':
        return this.setup;
      case 'asking':
        return this.setup.resume;
      case 'idle':
        return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Starting focus
  // ---------------------------------------------------------------------------

  /** The panel shows the timer-only / focus-area choice. */
  public isAsking(): boolean {
    return this.setup.kind === 'asking';
  }

  /** Play: stop a running session, or start one the way the "Start focus" setting says. */
  public pressPlay() {
    const {timer} = this.host;
    if (timer.running) {
      timer.stop();
      return;
    }
    switch (this.host.ui.getSettings().focusStart) {
      case 'ask':
        this.setup = {kind: 'asking', resume: this.drawing()};
        return;
      case 'timer':
        this.startTimerOnly();
        return;
      case 'area':
        this.startWithArea();
        return;
    }
  }

  /** Closes the "Start how?" question without starting; an area being drawn stays. */
  public closeQuestion() {
    if (this.setup.kind === 'asking') this.setup = this.setup.resume ?? IDLE;
  }

  /** Runs just the clock: nothing in the room is dimmed. */
  public startTimerOnly() {
    this.closeQuestion();
    if (this.host.getMode() === 'focus-drag') this.setMode('explore');
    this.host.timer.start(false);
  }

  /** Starts focus with the room dimmed outside the focus area, setting the area first if needed. */
  public startWithArea() {
    this.closeQuestion();
    const drawing = this.drawing();
    if (drawing && this.canConfirm()) {
      // Starting focus while an area is on show uses that area.
      drawing.startTimerAfter = true;
      this.confirm();
    } else if (this.host.focusZoneNeedsDefining()) {
      // The timer starts once the area is confirmed; the hint says what to do.
      this.setMode('focus-drag');
      const entered = this.drawing();
      if (entered) entered.startTimerAfter = true;
    } else {
      this.host.timer.start(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Marking out the area
  // ---------------------------------------------------------------------------

  /** Focus-area mode was entered. */
  public beginEdit() {
    this.setup = {kind: 'drawing', previous: null, startTimerAfter: false};
  }

  /** Shows a dragged area without saving it. */
  public preview(zone: FocusZoneBounds) {
    const drawing = this.drawing();
    if (!drawing) return;
    drawing.previous ??= this.host.getFocusZone();
    this.host.previewFocusZone(zone);
  }

  /** The control panel's hint while in focus-area mode. */
  public hint(): string {
    const drawing = this.drawing();
    if (drawing?.previous) return 'Drag again to redo, or press "Use this area"';
    if (this.canConfirm()) return 'Pinch and drag to mark a new focus area';
    return drawing?.startTimerAfter
      ? 'First pinch and drag across your desk'
      : 'Pinch and drag across your desk';
  }

  /** There is an area to confirm: one just drawn, or the one saved earlier. */
  public canConfirm(): boolean {
    return Boolean(this.drawing()?.previous) || !this.host.focusZoneNeedsDefining();
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
    const drawing = this.drawing();
    if (drawing?.previous) this.host.commitFocusZone();
    // Nothing is left to put back when the mode is left below.
    this.setup = IDLE;
    this.setMode('explore');
    lotusSound.playPinCreated();
    if (drawing?.startTimerAfter && !this.host.timer.running) {
      this.host.timer.start(true);
    } else {
      this.ui.flashStatus('Focus area saved');
    }
  }

  /** Leaving focus-area mode without confirming: show the saved area again. */
  public discard() {
    const previous = this.drawing()?.previous;
    if (previous) this.host.previewFocusZone(previous);
    this.setup = IDLE;
  }
}
