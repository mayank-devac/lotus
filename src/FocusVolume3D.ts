import * as THREE from 'three';
import {
  FocusZoneBounds,
  FocusZoneSource,
  ProjectedRect,
  ShieldStyle,
  Vector3Data,
} from './types';

const _corner = new THREE.Vector3();
const _dragA = new THREE.Vector3();
const _dragB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Colour of the in-headset peripheral dim for each shield style. */
const DIM_TINT: Record<ShieldStyle, number> = {
  frosted: 0x0b111e,
  dark: 0x000000,
  ambient: 0x1a1206,
};

const DIM_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

/**
 * Peripheral dim for immersive AR. WebXR gives no access to the passthrough
 * pixels, so the real room cannot be blurred; instead a shell around the head
 * darkens everything except the directions that look at the focus zone.
 * Each fragment's view ray is measured against the focus box in zone space:
 * the smallest box distance along the ray decides the dim, so rays through the
 * zone stay clear and the shadow fades out smoothly around the rectangle the
 * user dragged — no hard border, no rounded-off edges.
 */
const DIM_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uFocusCenter;
  uniform vec3 uFocusHalfExtents;
  uniform vec3 uTintColor;
  uniform float uBaseOpacity;
  uniform mat4 uZoneFromWorld;

  varying vec3 vWorldPosition;

  /** Chebyshev distance of a point from the zone box (normalised). */
  float boxDistanceAt(vec3 p, vec3 extents) {
    vec3 o = (p - uFocusCenter) / extents;
    return max(abs(o.x), max(abs(o.y), abs(o.z)));
  }

  /**
   * Smallest box distance along the forward ray (t >= 0). That function is
   * convex in t, so a short shrinking-step descent from the point closest to
   * the centre finds the minimum — exact enough for grazing rays too, which
   * is what keeps the window's corners from rounding off. Only the forward
   * half counts: the full line through the eye also passes through the box
   * behind the user, which would leave a clear window opposite the zone.
   */
  float rayBoxDistance(vec3 rayOrigin, vec3 rayDir) {
    vec3 extents = max(uFocusHalfExtents, vec3(0.18));
    float slope = max(
      max(abs(rayDir.x) / extents.x, abs(rayDir.y) / extents.y),
      abs(rayDir.z) / extents.z
    );
    float t = max(dot(uFocusCenter - rayOrigin, rayDir), 0.0);
    float s = 1.0 / max(slope, 1e-4);
    float d = boxDistanceAt(rayOrigin + rayDir * t, extents);
    for (int i = 0; i < 10; i++) {
      float tLeft = max(t - s, 0.0);
      float dLeft = boxDistanceAt(rayOrigin + rayDir * tLeft, extents);
      if (dLeft < d) {
        d = dLeft;
        t = tLeft;
      }
      float dRight = boxDistanceAt(rayOrigin + rayDir * (t + s), extents);
      if (dRight < d) {
        d = dRight;
        t += s;
      }
      s *= 0.6;
    }
    return d;
  }

  void main() {
    vec3 rayOrigin = (uZoneFromWorld * vec4(cameraPosition, 1.0)).xyz;
    vec3 fragPos = (uZoneFromWorld * vec4(vWorldPosition, 1.0)).xyz;
    vec3 rayDir = normalize(fragPos - rayOrigin);

    // 0 dim through the zone, fading to full one fade width outside its
    // faces. Measuring the whole ray (not a single sample point) keeps the
    // fade hugging the dragged rectangle from every viewing angle.
    float fadeWidth = 0.35;
    float dim = smoothstep(
      1.0,
      1.0 + fadeWidth,
      rayBoxDistance(rayOrigin, rayDir)
    );

    gl_FragColor = vec4(uTintColor, uBaseOpacity * dim);
  }
`;

/** No side of a focus zone is smaller than this (m), however short the drag. */
const MIN_ZONE_SIZE = 0.35;
/** A zone dragged out on a surface reaches this far (m) above it. */
const SURFACE_ZONE_HEIGHT = 0.72;
/**
 * When a focus-drag ray hits no surface (beyond the depth mesh or the virtual
 * room), the dragged corner lands this far along the ray. The short pin-place
 * fallback would snap the corner back toward the user, so aiming far stopped
 * extending the area.
 */
export const FOCUS_RAY_FALLBACK_METERS = 8;

/**
 * The focus zone spanned by two dragged corners, given in room space. On a
 * surface (desk, floor) the corners mark out its footprint and the zone rises
 * a fixed height above it; otherwise (a wall, a screen) the corners also set
 * its height.
 *
 * `yaw` turns the box about the vertical axis, so its sides run along and
 * across the direction the user faced while dragging instead of along the
 * room's axes, which point wherever the first session happened to start.
 */
export function focusZoneFromDrag(
  p1: Vector3Data,
  p2: Vector3Data,
  onSurface: boolean,
  source: FocusZoneSource,
  yaw = 0,
  name = 'Focus Area',
): FocusZoneBounds {
  // The corners in the zone's own turned frame.
  const a = _dragA.set(p1.x, p1.y, p1.z).applyAxisAngle(UP, -yaw);
  const b = _dragB.set(p2.x, p2.y, p2.z).applyAxisAngle(UP, -yaw);
  const span = (u: number, v: number): [number, number] => {
    const size = Math.max(MIN_ZONE_SIZE, Math.abs(u - v));
    const mid = (u + v) * 0.5;
    return [mid - size * 0.5, mid + size * 0.5];
  };
  const [minX, maxX] = span(a.x, b.x);
  const [minZ, maxZ] = span(a.z, b.z);
  const baseY = Math.min(a.y, b.y);
  const [minY, maxY] = onSurface
    ? [baseY - 0.02, baseY + SURFACE_ZONE_HEIGHT]
    : span(a.y, b.y);
  const width = maxX - minX;
  const depth = maxZ - minZ;
  return {
    defined: true,
    label: `${name} (${width.toFixed(2)}m × ${depth.toFixed(2)}m)`,
    source,
    yaw,
    min: {x: minX, y: minY, z: minZ},
    max: {x: maxX, y: maxY, z: maxZ},
  };
}

/**
 * Top centre of a zone in room space: where its confirm bar sits. Writes
 * into `out` and returns it.
 */
export function focusZoneTopCentre(
  zone: FocusZoneBounds,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out
    .set(
      (zone.min.x + zone.max.x) / 2,
      zone.max.y,
      (zone.min.z + zone.max.z) / 2,
    )
    .applyAxisAngle(UP, zone.yaw);
}

/**
 * The yaw of a zone that faces back along `direction` (the user's aim, in
 * room space): its local -Z axis points the way the user looks.
 */
export function focusZoneYawFacing(direction: THREE.Vector3): number {
  if (direction.x * direction.x + direction.z * direction.z < 1e-6) return 0;
  return Math.atan2(-direction.x, -direction.z);
}

/**
 * Manages the 3D drag-to-select Focus Zone bounding volume, its wireframe
 * frame (shown in immersive sessions), the peripheral dim shell that stands in
 * for the 2D blur shield inside a headset, and real-time 3D-to-screen bounding
 * box projection for the 2D optical aperture.
 */
export class FocusVolume3D {
  public readonly root = new THREE.Group();
  /** The zone's own frame: room space turned by the zone's yaw. */
  private readonly zoneFrame = new THREE.Group();
  private wireframeBox: THREE.LineSegments;
  private basePadMesh: THREE.Mesh;
  private dimDome: THREE.Mesh;
  private dimMaterial: THREE.ShaderMaterial;
  private xrPresenting = false;
  private xrDimActive = false;
  private focusSpotlight: THREE.SpotLight;

  private geometries: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private currentBounds: FocusZoneBounds;
  private isTimerRunning = false;
  private shieldStyle: ShieldStyle = 'frosted';

  constructor(initialBounds: FocusZoneBounds) {
    this.currentBounds = initialBounds;
    this.root.name = 'LotusFocusVolume3D';
    (this.root as unknown as {xb?: {pointerEvents: string}}).xb = {
      pointerEvents: 'none',
    };
    this.root.add(this.zoneFrame);

    // 1. Unit box, shared by the wireframe border and (scaled) by the frame.
    const boxGeo = this.trackGeo(new THREE.BoxGeometry(1, 1, 1));

    // 2. Crisp architectural wireframe border
    const edgesGeo = this.trackGeo(new THREE.EdgesGeometry(boxGeo));
    const lineMat = this.trackMat(
      new THREE.LineBasicMaterial({
        color: 0xe84d2b,
        transparent: true,
        opacity: 0.9,
      }),
    );
    this.wireframeBox = new THREE.LineSegments(edgesGeo, lineMat);
    this.zoneFrame.add(this.wireframeBox);

    // 3. Base surface highlight pad
    const padGeo = this.trackGeo(new THREE.PlaneGeometry(1, 1));
    padGeo.rotateX(-Math.PI / 2);
    const padMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xe84d2b,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.basePadMesh = new THREE.Mesh(padGeo, padMat);
    this.zoneFrame.add(this.basePadMesh);

    // 4. Peripheral dim shell for immersive AR (see DIM_FRAGMENT_SHADER)
    this.dimMaterial = this.trackMat(
      new THREE.ShaderMaterial({
        uniforms: {
          uFocusCenter: {value: new THREE.Vector3(0, 1.15, -1.42)},
          uFocusHalfExtents: {value: new THREE.Vector3(0.65, 0.4, 0.35)},
          uTintColor: {value: new THREE.Color(0x0b111e)},
          uBaseOpacity: {value: 0.0},
          uZoneFromWorld: {value: new THREE.Matrix4()},
        },
        vertexShader: DIM_VERTEX_SHADER,
        fragmentShader: DIM_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
      }),
    );
    const domeGeo = this.trackGeo(new THREE.SphereGeometry(4, 32, 20));
    this.dimDome = new THREE.Mesh(domeGeo, this.dimMaterial);
    this.dimDome.visible = false;
    this.dimDome.frustumCulled = false;
    // Drawn before other transparent content so panels and labels stay bright.
    this.dimDome.renderOrder = -1;
    this.root.add(this.dimDome);

    // 5. Dedicated Warm Study Spotlight focused on the active zone
    this.focusSpotlight = new THREE.SpotLight(
      0xfffbeb,
      0,
      5.0,
      Math.PI / 3.2,
      0.45,
      1.2,
    );
    this.focusSpotlight.position.set(0, 2.5, -1.4);
    this.zoneFrame.add(this.focusSpotlight);
    this.zoneFrame.add(this.focusSpotlight.target);

    this.applyBoundsGeometry(initialBounds, false);
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  /**
   * Updates the 3D focus zone bounds from user drag start & end points.
   */
  public setBoundsFromDrag(
    p1: Vector3Data,
    p2: Vector3Data,
    surfaceLabel = 'Custom Focus Zone',
  ): FocusZoneBounds {
    // Dragged on a 2D screen: the box only means something to that screen.
    const bounds = focusZoneFromDrag(p1, p2, true, 'screen', 0, surfaceLabel);
    this.currentBounds = bounds;
    this.applyBoundsGeometry(bounds, true);
    return bounds;
  }

  public setBounds(bounds: FocusZoneBounds, showFrame = false) {
    this.currentBounds = bounds;
    this.applyBoundsGeometry(bounds, showFrame);
  }

  public getBounds(): FocusZoneBounds {
    return this.currentBounds;
  }

  /**
   * In an immersive session the 2D selection outline is not visible, so the
   * zone is shown with its 3D frame instead.
   */
  public setXRPresentation(presenting: boolean) {
    this.xrPresenting = presenting;
    if (!presenting) this.setXRDim(false, 0, this.shieldStyle);
    this.applyBoundsGeometry(this.currentBounds, false);
  }

  /**
   * Requests the peripheral dim shell on or off (immersive sessions only). It
   * shows only while the zone is also defined; see `syncDimVisibility`.
   */
  public setXRDim(active: boolean, strength: number, shieldStyle: ShieldStyle) {
    this.xrDimActive = active;
    const uniforms = this.dimMaterial.uniforms;
    uniforms.uBaseOpacity.value = THREE.MathUtils.clamp(strength, 0, 1) * 0.92;
    (uniforms.uTintColor.value as THREE.Color).setHex(DIM_TINT[shieldStyle]);
    this.syncDimVisibility();
  }

  /** The single place that decides whether the dim shell is drawn. */
  private syncDimVisibility() {
    // At zero strength the shell would cost a full-screen blended pass on
    // both eyes and change nothing.
    this.dimDome.visible =
      this.xrDimActive &&
      this.currentBounds.defined &&
      this.dimMaterial.uniforms.uBaseOpacity.value > 0;
  }

  /** Keeps the dim shell centred on the viewer. Call once per frame. */
  public updateDim(cameraWorldPosition: THREE.Vector3) {
    if (!this.dimDome.visible) return;
    this.zoneFrame.updateWorldMatrix(true, false);
    (this.dimMaterial.uniforms.uZoneFromWorld.value as THREE.Matrix4)
      .copy(this.zoneFrame.matrixWorld)
      .invert();
    this.dimDome.position.copy(cameraWorldPosition);
    this.root.worldToLocal(this.dimDome.position);
  }

  public setFocusTimerState(
    isRunning: boolean,
    shieldStyle: ShieldStyle,
    isDraggingMode: boolean,
  ) {
    this.isTimerRunning = isRunning;
    this.shieldStyle = shieldStyle;
    this.applyBoundsGeometry(
      this.currentBounds,
      isDraggingMode || isRunning,
    );
  }

  private applyBoundsGeometry(bounds: FocusZoneBounds, showFrame: boolean) {
    this.zoneFrame.rotation.set(0, bounds.yaw, 0);
    this.syncDimVisibility();
    if (!bounds.defined) {
      this.wireframeBox.visible = false;
      this.basePadMesh.visible = false;
      this.focusSpotlight.intensity = 0;
      return;
    }

    const sx = Math.max(0.2, bounds.max.x - bounds.min.x);
    const sy = Math.max(0.2, bounds.max.y - bounds.min.y);
    const sz = Math.max(0.2, bounds.max.z - bounds.min.z);

    const cx = (bounds.min.x + bounds.max.x) * 0.5;
    const cy = (bounds.min.y + bounds.max.y) * 0.5;
    const cz = (bounds.min.z + bounds.max.z) * 0.5;

    this.dimMaterial.uniforms.uFocusCenter.value.set(cx, cy, cz);
    this.dimMaterial.uniforms.uFocusHalfExtents.value.set(
      sx * 0.5,
      sy * 0.5,
      sz * 0.5,
    );

    // On a 2D screen the UI draws its own clean selection outline, so the 3D
    // frame stays hidden there. In a headset that outline does not exist, so
    // the wireframe box and base pad show the zone while it is being set.
    const show3DFrame = this.xrPresenting && showFrame;
    this.wireframeBox.visible = show3DFrame;
    this.basePadMesh.visible = show3DFrame;
    if (show3DFrame) {
      this.wireframeBox.position.set(cx, cy, cz);
      this.wireframeBox.scale.set(sx, sy, sz);
      this.basePadMesh.position.set(cx, bounds.min.y + 0.005, cz);
      this.basePadMesh.scale.set(sx, 1, sz);
    }

    // Warm focus spotlight when the timer is active (virtual room only).
    if (this.isTimerRunning) {
      this.focusSpotlight.position.set(cx, bounds.max.y + 1.15, cz + 0.25);
      this.focusSpotlight.target.position.set(cx, bounds.min.y, cz);
      this.focusSpotlight.intensity = 3.5;
    } else {
      this.focusSpotlight.intensity = 0;
    }
  }

  /**
   * Projects the 8 corners of the 3D Focus Zone bounding box onto the 2D
   * viewport so the optical depth-of-field shield centers on the exact 3D focus volume.
   */
  public projectFocusWindow(
    camera: THREE.Camera,
    viewportWidth: number,
    viewportHeight: number,
  ): ProjectedRect {
    if (!this.currentBounds.defined) {
      return {
        visible: false,
        x: viewportWidth * 0.2,
        y: viewportHeight * 0.2,
        width: viewportWidth * 0.6,
        height: viewportHeight * 0.6,
      };
    }

    const {min, max} = this.currentBounds;
    this.zoneFrame.updateWorldMatrix(true, false);
    const worldFromZone = this.zoneFrame.matrixWorld;
    const xs = [min.x, max.x];
    const ys = [min.y, max.y];
    const zs = [min.z, max.z];

    let minScreenX = Infinity;
    let maxScreenX = -Infinity;
    let minScreenY = Infinity;
    let maxScreenY = -Infinity;
    let anyInFront = false;

    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) {
          _corner.set(x, y, z).applyMatrix4(worldFromZone).project(camera);
          if (_corner.z <= 1.0) {
            anyInFront = true;
          }
          const sx = ((_corner.x + 1) * 0.5) * viewportWidth;
          const sy = ((-_corner.y + 1) * 0.5) * viewportHeight;
          if (sx < minScreenX) minScreenX = sx;
          if (sx > maxScreenX) maxScreenX = sx;
          if (sy < minScreenY) minScreenY = sy;
          if (sy > maxScreenY) maxScreenY = sy;
        }
      }
    }

    if (!anyInFront) {
      return {
        visible: false,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };
    }

    const pad = 12;
    const clampedX = Math.max(0, Math.min(viewportWidth - 40, minScreenX - pad));
    const clampedY = Math.max(
      0,
      Math.min(viewportHeight - 40, minScreenY - pad),
    );
    const clampedMaxX = Math.max(
      clampedX + 60,
      Math.min(viewportWidth, maxScreenX + pad),
    );
    const clampedMaxY = Math.max(
      clampedY + 60,
      Math.min(viewportHeight, maxScreenY + pad),
    );

    return {
      visible: true,
      x: clampedX,
      y: clampedY,
      width: clampedMaxX - clampedX,
      height: clampedMaxY - clampedY,
    };
  }

  public dispose() {
    for (const geo of this.geometries) geo.dispose();
    for (const mat of this.materials) mat.dispose();
  }
}
