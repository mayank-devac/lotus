import * as THREE from 'three';
import {
  AppMode,
  LotusTask,
  PinSortBy,
  SpatialPin,
  TaskItemType,
} from '../types';
import {XRKeyAction} from './XRTextEditor';
import {XRSettingId} from './xrSettings';

/**
 * The vocabulary between the in-headset interface (XRInterface and its
 * panels) and ImmersiveSession: the button ids each panel reports, the state
 * the control panel shows and the data the drawer draws.
 */
export type XRHudAction =
  | 'toggle-timer'
  | 'toggle-task-timer'
  | 'place-pin'
  | 'focus-zone'
  | 'tab-tasks'
  | 'tab-pins'
  | 'tab-settings'
  | 'hide-hud'
  | 'move-hud'
  | 'exit-xr'
  // The "Start how?" choice that replaces the buttons after Play.
  | 'start-timer-only'
  | 'start-with-area'
  | 'start-cancel';
export type XRChipAction = 'show-hud' | 'timer-pause';
export type XRZoneAction = 'zone-confirm' | 'zone-cancel';
export type XRDrawerTab = 'tasks' | 'pins' | 'settings';
/**
 * Drawer buttons. Buttons that act on one row carry its id as a field, so a
 * handler never parses text and a new action that is handled nowhere fails
 * to compile (see XRDrawerController).
 */
export type XRDrawerAction =
  | {kind: 'move-drawer' | 'pin-sort'}
  | {kind: 'page'; step: 1 | -1}
  | {kind: 'pin'; pinId: string}
  | {kind: 'setting'; id: XRSettingId; step: 1 | -1}
  | XRTaskAction;

/** The drawer buttons of the tasks tab: the list, one open task, and the task form. */
export type XRTaskAction =
  | {kind: 'task-toggle' | 'task-open'; taskId: string}
  | {
      kind:
        // Task list
        | 'task-new'
        | 'task-filter'
        | 'task-clear-done'
        // One open task
        | 'task-back'
        | 'task-done'
        | 'task-timer'
        | 'task-pin'
        | 'task-edit'
        | 'task-delete'
        // New / edit task form
        | 'form-title'
        | 'form-due'
        | 'form-note'
        | 'form-type'
        | 'form-timer-down'
        | 'form-timer-up'
        | 'form-cancel'
        | 'form-save';
    };

/** A drawer action as text, for hover and redraw keys. Distinct actions give distinct keys. */
export function drawerActionKey(action: XRDrawerAction): string {
  switch (action.kind) {
    case 'page':
      return `page:${action.step}`;
    case 'pin':
      return `pin:${action.pinId}`;
    case 'setting':
      return `setting:${action.id}:${action.step}`;
    case 'task-toggle':
    case 'task-open':
      return `${action.kind}:${action.taskId}`;
    default:
      return action.kind;
  }
}
export type XRCardAction =
  | 'move-card'
  | 'close'
  | 'edit'
  | 'edit-done'
  | 'field-title'
  | 'field-body'
  | 'field-place'
  | 'toggle-done'
  | 'color'
  | 'shape'
  | 'delete';

export interface XRHudState {
  clock: string;
  timerRunning: boolean;
  /** True while the session clock is held (running, but paused). */
  timerPaused: boolean;
  /** The running or paused task timer, with its MM:SS clock; null hides its button. */
  taskTimer: {clock: string; running: boolean} | null;
  mode: AppMode;
  /** What to do next, shown when no button is hovered and nothing was flashed. */
  hint: string;
  /** Play was pressed: show the timer-only / focus-area choice instead of the buttons. */
  askingStart: boolean;
  /** Exit XR was pressed once and is waiting for its confirming second press. */
  exitArmed: boolean;
}

/** The panels a grip can move. The drawer moves with the control panel. */
export type XRMovablePanel = 'hud' | 'card' | 'editor';

export type XRTaskFilter = 'all' | 'ongoing' | 'completed';

export interface XRTaskRow {
  task: LotusTask;
  /** Time left on the task's timer, MM:SS. */
  clock: string;
}

/** The task being created or edited in the drawer. */
export interface XRTaskForm {
  /** True when an existing task is being edited, false for a new one. */
  editing: boolean;
  title: string;
  dueLabel: string;
  note: string;
  type: TaskItemType;
  timerMinutes: number;
}

export interface XRSettingRow {
  id: XRSettingId;
  name: string;
  kind: 'stepper' | 'cycle';
  hint: string;
  value: string;
  swatch?: string;
}

/** What the drawer shows; asked for a few times a second while it is open. */
export interface XRDrawerData {
  /** Already filtered and ordered for display. */
  tasks: XRTaskRow[];
  taskFilter: XRTaskFilter;
  hasCompletedTasks: boolean;
  /** Set while one task is open; the drawer then shows it instead of the list. */
  openTask: (XRTaskRow & {deleteArmed: boolean}) | null;
  /** Set while a task is being created or edited; takes over the tasks tab. */
  taskForm: XRTaskForm | null;
  /** Already ordered for display. */
  pins: {pin: SpatialPin; distance: number}[];
  pinSort: PinSortBy;
  settings: XRSettingRow[];
}

/** A ray resting on a panel; `action` is null over the panel body. */
export type XRPanelHit =
  | {panel: 'hud'; distance: number; action: XRHudAction | null}
  | {panel: 'chip'; distance: number; action: XRChipAction | null}
  | {panel: 'drawer'; distance: number; action: XRDrawerAction | null}
  | {panel: 'card'; distance: number; action: XRCardAction | null}
  | {panel: 'zone'; distance: number; action: XRZoneAction | null}
  | {panel: 'editor'; distance: number; action: XRKeyAction | null};

export interface XRPointerRay {
  origin: THREE.Vector3;
  quaternion: THREE.Quaternion;
  distance: number;
  showDot: boolean;
}
