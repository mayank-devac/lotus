import {dictateOnce} from '../speech';
import {
  AppMode,
  FocusZoneBounds,
  LotusSettings,
  LotusTask,
  PinShapeStyle,
  RoomWaypoint,
  SpatialPin,
} from '../types';
import type {FocusShield} from './FocusShield';
import type {FocusTimer} from '../FocusTimer';
import type {PinMarkers} from './PinMarkers';

/** How the 2D UI tells the app (index.ts) what the user did. */
export interface LotusUICallbacks {
  onModeChange: (mode: AppMode) => void;
  onSavePin: (pin: SpatialPin) => void;
  onDeletePin: (pinId: string) => void;
  onClearAllPins: () => void;
  onApplyStyleToAllPins: (style: PinShapeStyle) => void;
  onSaveTasks: (tasks: LotusTask[]) => void;
  onHoverPin: (pinId: string | null) => void;
  onClickPinEffect: (pinId: string) => void;
  onWalkToWaypoint: (waypoint: RoomWaypoint) => void;
  onWalkToPin: (pin: SpatialPin) => void;
  onSettingsChange: (settings: LotusSettings) => void;
  onFocusZoneChange: (zone: FocusZoneBounds) => void;
  onFlipCamera: () => void;
}

/** Text a pin is created with when it is placed for a task. */
export type PendingPinContent = Pick<SpatialPin, 'title' | 'body' | 'surfaceLabel' | 'taskId'>;

export type ModalId = 'welcome' | 'tasks' | 'composer' | 'directory' | 'inspector';
/** The modals the top bar opens; opening one closes every other. */
export type NavModalId = 'welcome' | 'tasks' | 'directory';

/**
 * What the views in `src/ui/` (modals, dock, nav widget) may read and do. The
 * one implementation is in `LotusUI`, which owns the state; a view keeps only
 * its own draft state (form fields, sort order, active tab).
 *
 * Plain fields are assignments with no side effects: as before the split, a
 * view changes state, tells the app through `callbacks`, then calls
 * `renderAll()`.
 */
export interface UIHost {
  readonly callbacks: LotusUICallbacks;
  /** The live settings object; views edit it in place, then call `callbacks.onSettingsChange`. */
  readonly settings: LotusSettings;
  /** The UI's copy of the pin list (the app sends the saved list back through `setPins`). */
  pins: SpatialPin[];
  /** The live task list, including timers that are counting down. */
  tasks: LotusTask[];
  mode: AppMode;
  readonly focusZone: FocusZoneBounds;
  /** Focus-area mode is waiting for a new box to be dragged (the old one is hidden). */
  redraggingFocusArea: boolean;

  readonly timer: FocusTimer;
  readonly markers: PinMarkers;
  readonly shield: FocusShield;
  readonly dictation: SharedDictation;

  isModalOpen(id: ModalId): boolean;
  /** Marks one modal closed. Does not re-render. */
  closeModal(id: ModalId): void;
  /** Opens one top-bar modal and closes every other modal (`open` false closes them all). Does not re-render. */
  showOnlyModal(id: NavModalId, open: boolean): void;
  renderAll(): void;
  /** Rebuilds the pin markers after pins changed (content, colour, deletion). */
  refreshPinMarkers(): void;
  /** Updates the focus clock readouts in place, without a re-render. */
  updateTimerReadouts(): void;

  // Flows that change several parts of the UI; see the LotusUI methods of the same name.
  enterPinAddMode(pendingFromTask?: PendingPinContent): void;
  enterPinRepositionMode(pinId: string): void;
  enterFocusAreaMode(): void;
  openComposerForEditPin(pin: SpatialPin): void;
  inspectPin(pinId: string): void;
  startFocusTimer(): void;
  updateDragBox2D(visible: boolean): void;
  updatePinPlacementReticle(visible: boolean): void;
}

/**
 * One voice dictation at a time, shared by the pin composer and the pin
 * inspector: stopping it (closing either modal) clears both listening flags.
 */
export class SharedDictation {
  /** The composer's Voice button is listening. */
  public composerListening = false;
  /** The inspector's microphone button is listening. */
  public inspectorListening = false;
  private stopFn: (() => void) | null = null;

  /**
   * Starts listening (see `dictateOnce`). Returns false when speech
   * recognition is unavailable or could not start.
   */
  public start(onText: (text: string) => void, onEnd: (failed: boolean) => void): boolean {
    this.stopFn = dictateOnce(onText, onEnd);
    return this.stopFn !== null;
  }

  public stop() {
    this.composerListening = false;
    this.inspectorListening = false;
    this.stopFn?.();
    this.stopFn = null;
  }
}
