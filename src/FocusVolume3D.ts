import * as THREE from 'three';
import {
  FocusZoneBounds,
  ProjectedRect,
  ShieldStyle,
  Vector3Data,
} from './types';

const _corner = new THREE.Vector3();

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
 * For each fragment the view ray is taken into focus-zone space and its closest
 * approach to the zone centre (normalised by the zone's half extents) decides
 * how much dim to apply: clear through the zone, ramping up around it.
 */
const DIM_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uFocusCenter;
  uniform vec3 uFocusHalfExtents;
  uniform vec3 uTintColor;
  uniform float uBaseOpacity;
  uniform mat4 uZoneFromWorld;

  varying vec3 vWorldPosition;

  void main() {
    vec3 rayOrigin = (uZoneFromWorld * vec4(cameraPosition, 1.0)).xyz;
    vec3 fragPos = (uZoneFromWorld * vec4(vWorldPosition, 1.0)).xyz;
    vec3 rayDir = normalize(fragPos - rayOrigin);

    vec3 safeExtents = max(uFocusHalfExtents, vec3(0.18));
    float along = max(dot(uFocusCenter - rayOrigin, rayDir), 0.0);
    vec3 miss = (rayOrigin + rayDir * along - uFocusCenter) / safeExtents;
    float dim = smoothstep(1.0, 2.4, length(miss));

    gl_FragColor = vec4(uTintColor, uBaseOpacity * dim);
  }
`;

/**
 * Manages the 3D drag-to-select Focus Zone bounding volume, its wireframe
 * frame (shown in immersive sessions), the peripheral dim shell that stands in
 * for the 2D blur shield inside a headset, and real-time 3D-to-screen bounding
 * box projection for the 2D optical aperture.
 */
export class FocusVolume3D {
  public readonly root = new THREE.Group();
  private wireframeBox: THREE.LineSegments;
  private volumeFillMesh: THREE.Mesh;
  private basePadMesh: THREE.Mesh;
  private cornerPillars: THREE.Mesh[] = [];
  private dimDome: THREE.Mesh;
  private dofShaderMat: THREE.ShaderMaterial;
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

    // 1. Translucent volume enclosure
    const boxGeo = this.trackGeo(new THREE.BoxGeometry(1, 1, 1));
    const fillMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xe84d2b,
        transparent: true,
        opacity: 0.04,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.volumeFillMesh = new THREE.Mesh(boxGeo, fillMat);
    this.root.add(this.volumeFillMesh);

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
    this.root.add(this.wireframeBox);

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
    this.root.add(this.basePadMesh);

    // 4. Four corner pillar markers
    const pillarGeo = this.trackGeo(
      new THREE.CylinderGeometry(0.012, 0.012, 1, 12),
    );
    const pillarMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xe84d2b,
        transparent: true,
        opacity: 0.92,
      }),
    );
    for (let i = 0; i < 4; i++) {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      this.cornerPillars.push(pillar);
      this.root.add(pillar);
    }

    // 5. Peripheral dim shell for immersive AR (see DIM_FRAGMENT_SHADER)
    this.dofShaderMat = this.trackMat(
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
    this.dimDome = new THREE.Mesh(domeGeo, this.dofShaderMat);
    this.dimDome.visible = false;
    this.dimDome.frustumCulled = false;
    // Drawn before other transparent content so panels and labels stay bright.
    this.dimDome.renderOrder = -1;
    this.root.add(this.dimDome);

    // 6. Dedicated Warm Study Spotlight focused on the active zone
    this.focusSpotlight = new THREE.SpotLight(
      0xfffbeb,
      0,
      5.0,
      Math.PI / 3.2,
      0.45,
      1.2,
    );
    this.focusSpotlight.position.set(0, 2.5, -1.4);
    this.root.add(this.focusSpotlight);
    this.root.add(this.focusSpotlight.target);

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
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minZ = Math.min(p1.z, p2.z);
    const maxZ = Math.max(p1.z, p2.z);
    const baseY = Math.min(p1.y, p2.y);

    const width = Math.max(0.35, maxX - minX);
    const depth = Math.max(0.35, maxZ - minZ);
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    const bounds: FocusZoneBounds = {
      defined: true,
      label: `${surfaceLabel} (${width.toFixed(2)}m × ${depth.toFixed(2)}m)`,
      min: {
        x: cx - width * 0.5,
        y: baseY - 0.02,
        z: cz - depth * 0.5,
      },
      max: {
        x: cx + width * 0.5,
        y: baseY + 0.72,
        z: cz + depth * 0.5,
      },
    };

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

  public getFocusCenter3D(): THREE.Vector3 {
    return this.dofShaderMat.uniforms.uFocusCenter.value;
  }

  public getFocusHalfExtents3D(): THREE.Vector3 {
    return this.dofShaderMat.uniforms.uFocusHalfExtents.value;
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

  /** Turns the peripheral dim shell on or off (immersive sessions only). */
  public setXRDim(active: boolean, strength: number, shieldStyle: ShieldStyle) {
    this.xrDimActive = active && this.currentBounds.defined;
    this.dimDome.visible = this.xrDimActive;
    const uniforms = this.dofShaderMat.uniforms;
    uniforms.uBaseOpacity.value = THREE.MathUtils.clamp(strength, 0, 1) * 0.92;
    const tint =
      shieldStyle === 'dark'
        ? 0x000000
        : shieldStyle === 'ambient'
          ? 0x1a1206
          : 0x0b111e;
    (uniforms.uTintColor.value as THREE.Color).setHex(tint);
  }

  /** Keeps the dim shell centred on the viewer. Call once per frame. */
  public updateDim(cameraWorldPosition: THREE.Vector3) {
    if (!this.xrDimActive) return;
    this.root.updateWorldMatrix(true, false);
    (this.dofShaderMat.uniforms.uZoneFromWorld.value as THREE.Matrix4)
      .copy(this.root.matrixWorld)
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
    if (!bounds.defined) {
      this.volumeFillMesh.visible = false;
      this.wireframeBox.visible = false;
      this.basePadMesh.visible = false;
      this.cornerPillars.forEach((p) => (p.visible = false));
      this.dimDome.visible = false;
      this.focusSpotlight.intensity = 0;
      return;
    }

    const sx = Math.max(0.2, bounds.max.x - bounds.min.x);
    const sy = Math.max(0.2, bounds.max.y - bounds.min.y);
    const sz = Math.max(0.2, bounds.max.z - bounds.min.z);

    const cx = (bounds.min.x + bounds.max.x) * 0.5;
    const cy = (bounds.min.y + bounds.max.y) * 0.5;
    const cz = (bounds.min.z + bounds.max.z) * 0.5;

    this.dofShaderMat.uniforms.uFocusCenter.value.set(cx, cy, cz);
    this.dofShaderMat.uniforms.uFocusHalfExtents.value.set(
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
    this.volumeFillMesh.visible = false;
    this.cornerPillars.forEach((pillar) => {
      pillar.visible = false;
    });
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
          _corner.set(x, y, z).project(camera);
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
