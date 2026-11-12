import * as THREE from 'three';
import type {FocusVolume3D} from '../FocusVolume3D';
import type {PinManager3D} from '../PinManager3D';
import {AppMode, FocusZoneBounds, LotusTask, SpatialHit, SpatialPin} from '../types';
import type {LotusUI} from '../ui/LotusUI';

/** The text a pin is created with. */
export type PinContent = Pick<SpatialPin, 'title' | 'body' | 'surfaceLabel'>;
/** What the immersive session needs from the app that owns the data. */
export interface ImmersiveHost {
  readonly pinManager: PinManager3D;
  readonly focusVolume: FocusVolume3D;
  /** Group holding everything stored in room space; moved by the room anchor. */
  readonly worldRoot: THREE.Object3D;
  readonly ui: Pick<
    LotusUI,
    | 'getIsTimerRunning'
    | 'startFocusTimer'
    | 'stopFocusTimer'
    | 'getTimerClockText'
    | 'getSettings'
    | 'applySettings'
  >;
  getMode(): AppMode;
  setMode(mode: AppMode): void;
  getPins(): SpatialPin[];
  /** Replaces the pin list everywhere (storage, 3D pins, DOM UI). */
  commitPins(pins: SpatialPin[]): void;
  /** The live task list, including timers that are counting down. */
  getTasks(): LotusTask[];
  /** Replaces the task list everywhere (storage, DOM UI). */
  commitTasks(tasks: LotusTask[]): void;
  /** Creates and commits a pin at a ray hit; `content` replaces the default text. */
  createPinAt(hit: SpatialHit, content?: PinContent): SpatialPin;
  /** Casts `raycaster` into the room; a miss lands `fallbackDistance` along the ray. */
  raycastSpatialPoint(
    raycaster: THREE.Raycaster,
    fallbackDistance?: number,
  ): SpatialHit;
  getFocusZone(): FocusZoneBounds;
  /** True while the focus zone is still the made-up default. */
  focusZoneNeedsDefining(): boolean;
  /** Shows `zone` as the focus zone without saving it. */
  previewFocusZone(zone: FocusZoneBounds): void;
  /** Saves the focus zone that is currently shown. */
  commitFocusZone(): void;
}
