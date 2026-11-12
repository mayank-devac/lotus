import * as THREE from 'three';

/** One flat surface from room setup, in world space. */
export interface RoomPlane {
  orientation: XRPlaneOrientation;
  /** World from plane space. The plane is plane space's y = 0, facing +Y. */
  worldFromPlane: THREE.Matrix4;
  planeFromWorld: THREE.Matrix4;
  /** The plane's outline in plane space (x, z). */
  outline: {x: number; z: number}[];
}

/** Where a ray meets a known plane. */
export interface RoomPlaneHit {
  orientation: XRPlaneOrientation;
  /** Along the ray, in metres. */
  distance: number;
  /** World space. */
  point: THREE.Vector3;
  /** The plane's normal in world space, turned to face where the ray came from. */
  normal: THREE.Vector3;
}

const _localRay = new THREE.Ray();
const _localHit = new THREE.Vector3();

/** Even-odd test: is (x, z) inside the outline? */
export function insideOutline(outline: readonly {x: number; z: number}[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** The nearest plane `ray` (world space) crosses inside its outline, or null. */
export function nearestPlaneHit(
  ray: THREE.Ray,
  planes: Iterable<RoomPlane>,
): RoomPlaneHit | null {
  let best: {plane: RoomPlane; t: number} | null = null;
  for (const plane of planes) {
    // Plane space is a rigid transform of world space, so distances along
    // the (re-normalised) local ray are world distances.
    _localRay.copy(ray).applyMatrix4(plane.planeFromWorld);
    const dy = _localRay.direction.y;
    if (Math.abs(dy) < 1e-6) continue;
    const t = -_localRay.origin.y / dy;
    if (t <= 0 || (best && t >= best.t)) continue;
    _localRay.at(t, _localHit);
    if (insideOutline(plane.outline, _localHit.x, _localHit.z)) best = {plane, t};
  }
  if (!best) return null;
  const normal = new THREE.Vector3(0, 1, 0).transformDirection(best.plane.worldFromPlane);
  if (normal.dot(ray.direction) > 0) normal.negate();
  return {
    orientation: best.plane.orientation,
    distance: best.t,
    point: ray.at(best.t, new THREE.Vector3()),
    normal,
  };
}

/**
 * The surfaces the headset knows from room setup (WebXR plane detection):
 * each desk, floor and wall as a horizontal or vertical plane. Empty when the
 * browser lacks the feature, the user declined it, or never set up the room.
 * https://developers.meta.com/horizon/documentation/web/webxr-mixed-reality
 */
export class RoomPlanes {
  private readonly planes = new Map<XRPlane, RoomPlane & {changedAt: number}>();

  /** Call once per XR frame, while `frame` is valid. */
  public update(frame: XRFrame, referenceSpace: XRReferenceSpace) {
    const detected = frame.detectedPlanes;
    if (!detected) return;
    for (const known of this.planes.keys()) {
      if (!detected.has(known)) this.planes.delete(known);
    }
    for (const plane of detected) {
      let pose: XRPose | undefined;
      try {
        pose = frame.getPose(plane.planeSpace, referenceSpace);
      } catch {
        pose = undefined;
      }
      if (!pose) {
        this.planes.delete(plane);
        continue;
      }
      let known = this.planes.get(plane);
      if (!known) {
        known = {
          orientation: plane.orientation,
          worldFromPlane: new THREE.Matrix4(),
          planeFromWorld: new THREE.Matrix4(),
          outline: [],
          changedAt: -1,
        };
        this.planes.set(plane, known);
      }
      // The pose is read every frame: the reference space moves when the
      // user recentres, even though the room does not.
      known.worldFromPlane.fromArray(pose.transform.matrix);
      known.planeFromWorld.copy(known.worldFromPlane).invert();
      if (known.changedAt !== plane.lastChangedTime) {
        known.changedAt = plane.lastChangedTime;
        known.orientation = plane.orientation;
        known.outline = plane.polygon.map((p) => ({x: p.x, z: p.z}));
      }
    }
  }

  /**
   * The known plane under `ray` (world space), or null. A plane further than
   * `nearestOther` (m), such as the depth mesh's hit, is behind something
   * else the ray reaches first, so it does not count.
   */
  public hit(ray: THREE.Ray, nearestOther = Infinity): RoomPlaneHit | null {
    const hit = nearestPlaneHit(ray, this.planes.values());
    // The depth mesh is coarse: a hit just in front of the plane is the plane.
    return hit && hit.distance <= nearestOther + PLANE_DEPTH_TOLERANCE ? hit : null;
  }

  public clear() {
    this.planes.clear();
  }
}

/** The depth mesh may land this far (m) in front of a real surface and still mean it. */
const PLANE_DEPTH_TOLERANCE = 0.25;
