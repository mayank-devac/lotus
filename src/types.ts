export type TimerMode = 'preset' | 'custom' | 'stopwatch';
export type ShieldStyle = 'frosted' | 'dark' | 'ambient';
export type AppMode = 'explore' | 'pin-add' | 'focus-drag';
export type ProximityDisplayMode = 'proximity-2m' | 'always' | 'reticle-only';
export type PinShapeStyle = 'revolving' | 'dot';
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
  color: string;
  shapeStyle?: PinShapeStyle;
  completed?: boolean;
  position: Vector3Data;
  normal: Vector3Data;
  createdAt: number;
}

export interface FocusZoneBounds {
  defined: boolean;
  label: string;
  min: Vector3Data;
  max: Vector3Data;
  customScreenRect?: ProjectedRect | null;
}

export interface LotusSettings {
  timerMode: TimerMode;
  presetMinutes: number;
  customMinutes: number;
  customSeconds: number;
  shieldStyle: ShieldStyle;
  focusAreaVisibility: number;
  proximityMode: ProximityDisplayMode;
  proximityDistanceMeters: number;
  headerPopEnabled: boolean;
  defaultPinStyle: PinShapeStyle;
  defaultPinColor: string;
  showVirtualRoom: boolean;
  soundEnabled: boolean;
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
