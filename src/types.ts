export type TimerMode = 'preset' | 'custom' | 'stopwatch';
/** What starting focus does: ask each time, run only the timer, or also dim around the focus area. */
export type FocusStartMode = 'ask' | 'timer' | 'area';
export type ShieldStyle = 'frosted' | 'dark' | 'ambient';
export type AppMode = 'explore' | 'pin-add' | 'focus-drag';
export type ProximityDisplayMode = 'proximity-2m' | 'always' | 'reticle-only';
export type PinShapeStyle = 'revolving' | 'dot';
export type AmbientLightMode = 'none' | 'timer' | 'all';
export type PinSortBy = 'proximity' | 'date';
export type TaskItemType = 'task' | 'reminder';
export type TaskFilterTab = 'all' | 'ongoing' | 'completed' | 'insights';

export interface LotusTask {
  id: string;
  title: string;
  note: string;
  dueLabel: string;
  type: TaskItemType;
  timerSeconds?: number;
  remainingSeconds?: number;
  timerRunning?: boolean;
  completed: boolean;
  createdAt: number;
  completedAt?: number;
}

export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

export interface SpatialPin {
  id: string;
  title: string;
  body: string;
  surfaceLabel: string;
  /** The task this pin was placed for, if any; in a headset its label then shows that task's running timer. A task that no longer exists is fine: the label just shows no clock. */
  taskId?: string;
  color: string;
  shapeStyle?: PinShapeStyle;
  completed?: boolean;
  position: Vector3Data;
  normal: Vector3Data;
  createdAt: number;
}

/**
 * Where a focus zone's box came from: the built-in placeholder, a rectangle
 * dragged on a 2D screen (its box is only meaningful to that screen), or an
 * area marked out in the real room inside a headset.
 */
export type FocusZoneSource = 'default' | 'screen' | 'room';

export interface FocusZoneBounds {
  defined: boolean;
  label: string;
  source: FocusZoneSource;
  /**
   * Radians the box is turned about the vertical axis. `min` and `max` are
   * corners in that turned frame, so the box lines up with the desk or wall
   * it was dragged on rather than with the room's arbitrary axes.
   */
  yaw: number;
  min: Vector3Data;
  max: Vector3Data;
  customScreenRect?: ProjectedRect | null;
}

export interface LotusSettings {
  timerMode: TimerMode;
  focusStart: FocusStartMode;
  presetMinutes: number;
  customMinutes: number;
  customSeconds: number;
  shieldStyle: ShieldStyle;
  focusAreaVisibility: number;
  proximityMode: ProximityDisplayMode;
  proximityDistanceMeters: number;
  headerPopEnabled: boolean;
  ambientLightMode: AmbientLightMode;
  ambientLightDurationSec: number;
  defaultPinStyle: PinShapeStyle;
  defaultPinColor: string;
  showVirtualRoom: boolean;
  soundEnabled: boolean;
}

/** Result of casting a ray into the room (not persisted). */
export interface SpatialHit {
  /** Position in room space (the space pins and the focus zone are stored in). */
  point: Vector3Data;
  normal: Vector3Data;
  surfaceLabel: string;
  /** False when nothing was hit and the point is the fallback along the ray. */
  isSurface: boolean;
  /** Distance from the ray origin, in metres. */
  distance: number;
}

export interface RoomWaypoint {
  id: string;
  label: string;
  subtitle: string;
  position: Vector3Data;
  lookAt: Vector3Data;
}

export interface ProjectedRect {
  visible: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PinScreenProjection {
  id: string;
  visible: boolean;
  screenX: number;
  screenY: number;
  distanceMeters: number;
  isWithinProximity: boolean;
  isWithinRadius?: boolean;
  justEnteredProximity?: boolean;
  camLocalX?: number;
  camLocalY?: number;
  camLocalZ?: number;
  isReticleHovered: boolean;
}
