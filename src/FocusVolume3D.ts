import * as THREE from 'three';
import {
  FocusZoneBounds,
  ProjectedRect,
  ShieldStyle,
  Vector3Data,
} from './types';

const _corner = new THREE.Vector3();

const DOF_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

/**
 * Custom GLSL Depth-of-Field Fragment Shader:
 * Dynamically computes normalized 3D distance from the center of the selected focus area
 * (uFocusCenter, uFocusHalfExtents) and smoothly increases optical blur / depth-of-field
 * attenuation the further an object or surface is from the center of the focus zone.
 */
const DOF_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uFocusCenter;
  uniform vec3 uFocusHalfExtents;
  uniform vec3 uTintColor;
  uniform float uBaseOpacity;
  uniform float uTime;

  varying vec3 vWorldPosition;
  varying vec2 vUv;

  void main() {
    // Compute normalized distance from the exact 3D center of the selected focus area
    vec3 safeExtents = max(uFocusHalfExtents, vec3(0.18));
    vec3 delta = (vWorldPosition - uFocusCenter) / safeExtents;
    float distFromFocusCenter = length(delta);

    // Inside the core of the focus zone (dist < 0.65), keep completely clear (0.0).
    // As distance from the focus center increases (0.65 -> 3.2), smoothly ramp up
    // the depth-of-field blur veil and bokeh falloff.
    float innerEdge = smoothstep(0.62, 1.15, distFromFocusCenter);
    float outerFalloff = smoothstep(1.0, 3.2, distFromFocusCenter);

    // Subtle procedural bokeh-like spatial softness modulation with distance
    float bokehWave = 0.96 + 0.04 * sin(vWorldPosition.x * 8.0 + uTime * 0.8) * cos(vWorldPosition.y * 8.0);
    float dofStrength = clamp(innerEdge * 0.55 + outerFalloff * 0.45, 0.0, 1.0) * bokehWave;

    float alpha = uBaseOpacity * dofStrength;
    vec3 finalColor = mix(uTintColor * 1.18, uTintColor * 0.72, outerFalloff);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

/**
 * Manages the 3D drag-to-select Focus Zone bounding volume, corner pillars,
 * 3D GLSL Depth-of-Field shader shroud (which dynamically increases blurriness/attenuation
 * with distance from the center of the selected focus area), and real-time 3D-to-screen
 * bounding box projection for the optical depth-of-field aperture.
 */
export class FocusVolume3D {
  public readonly root = new THREE.Group();
  private wireframeBox: THREE.LineSegments;
  private volumeFillMesh: THREE.Mesh;
  private basePadMesh: THREE.Mesh;
  private cornerPillars: THREE.Mesh[] = [];
  private shroudGroup = new THREE.Group();
  private shroudMeshes: THREE.Mesh[] = [];
  private dofShaderMat: THREE.ShaderMaterial;
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
        color: 0x1b1b19,
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

    // 5. 3D Depth-of-Field Shader Shroud (dynamically increases blurriness with distance from focus center)
    this.dofShaderMat = this.trackMat(
      new THREE.ShaderMaterial({
        uniforms: {
          uFocusCenter: {value: new THREE.Vector3(0, 1.15, -1.42)},
          uFocusHalfExtents: {value: new THREE.Vector3(0.65, 0.4, 0.35)},
          uTintColor: {value: new THREE.Color(0x0b111e)},
          uBaseOpacity: {value: 0.0},
          uTime: {value: 0.0},
        },
        vertexShader: DOF_VERTEX_SHADER,
        fragmentShader: DOF_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    const wallGeo = this.trackGeo(new THREE.BoxGeometry(1, 1, 1, 8, 8, 8));
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(wallGeo, this.dofShaderMat);
      m.visible = false;
      this.shroudMeshes.push(m);
      this.shroudGroup.add(m);
    }
    this.root.add(this.shroudGroup);

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

  public updateShaderTime(elapsed: number) {
    this.dofShaderMat.uniforms.uTime.value = elapsed;
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
      this.shroudMeshes.forEach((m) => (m.visible = false));
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

    // Keep 3D wireframe box, orange pillars, and floor pad hidden so the UI uses only the clean 2D selection outline
    this.volumeFillMesh.visible = false;
    this.wireframeBox.visible = false;
    this.basePadMesh.visible = false;
    this.cornerPillars.forEach((pillar) => {
      pillar.visible = false;
    });

    // Configure warm focus spotlight when timer is active; optical shield is handled seamlessly by #lotus-surround-shield
    this.shroudMeshes.forEach((m) => (m.visible = false));
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
