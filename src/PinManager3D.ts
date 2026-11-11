import * as THREE from 'three';
import {lotusSound} from './sound';
import {
  PinScreenProjection,
  PinShapeStyle,
  ProximityDisplayMode,
  SpatialPin,
  Vector3Data,
} from './types';

const _camWorldPos = new THREE.Vector3();
const _pinCenterPos = new THREE.Vector3();
const _projectedPos = new THREE.Vector3();
const _camLocalPos = new THREE.Vector3();
const _billboardQuat = new THREE.Quaternion();
const _camWorldQuat = new THREE.Quaternion();

/**
 * Pins keep their real size up to this distance; further away they grow with
 * distance so they never shrink on screen below how they look from here.
 * The ray hit sphere scales with them, so far pins stay easy to aim at.
 */
const PIN_FULL_SIZE_DISTANCE = 1.5;
const MAX_PIN_DISTANCE_SCALE = 10;

interface PinNode {
  pin: SpatialPin;
  group: THREE.Group;
  hitMesh: THREE.Mesh;
  revolvingGroup: THREE.Group;
  revolvingCoreMesh: THREE.Mesh;
  revolvingWireMesh: THREE.LineSegments;
  dotMesh: THREE.Mesh;
  hoverRingMesh: THREE.Mesh;
  clickRippleMesh: THREE.Mesh;
  wasWithinProximity: boolean;
  proximityLerp: number;
  hoverLerp: number;
  clickPulse: number;
  isHovered: boolean;
  isDragging: boolean;
}

/**
 * Manages 3D Spatial Memory Points:
 * - Supports two clean visual styles:
 *   1. 'revolving': Pure floating revolving 3D geometric shape (and nothing else when far)
 *   2. 'dot': Minimalistic 3D point dot
 * - Expressive 3D Hover Effect (scale boost, faster spin, emissive glow, hover halo ring)
 * - Expressive 3D Click Effect (elastic bounce + expanding 3D shockwave ripple ring)
 * - Per-frame 2-meter proximity evaluation with global Header Pop ON/OFF toggle support
 */
export class PinManager3D {
  public readonly root = new THREE.Group();
  public readonly previewMarker: THREE.Group;
  private pinNodes = new Map<string, PinNode>();
  private sharedGeos: THREE.BufferGeometry[] = [];
  private materials: THREE.Material[] = [];

  private octaGeo: THREE.OctahedronGeometry;
  private octaEdgesGeo: THREE.EdgesGeometry;
  private dotGeo: THREE.SphereGeometry;
  private hoverRingGeo: THREE.RingGeometry;
  private rippleRingGeo: THREE.RingGeometry;
  private hitGeo: THREE.SphereGeometry;

  private defaultPinStyle: PinShapeStyle = 'revolving';

  constructor() {
    this.root.name = 'LotusPinsRoot';

    this.octaGeo = this.trackGeo(new THREE.OctahedronGeometry(0.038, 0));
    this.octaEdgesGeo = this.trackGeo(new THREE.EdgesGeometry(this.octaGeo));
    this.dotGeo = this.trackGeo(new THREE.SphereGeometry(0.024, 24, 24));
    this.hoverRingGeo = this.trackGeo(new THREE.RingGeometry(0.052, 0.06, 32));
    this.rippleRingGeo = this.trackGeo(
      new THREE.RingGeometry(0.045, 0.056, 32),
    );
    this.hitGeo = this.trackGeo(new THREE.SphereGeometry(0.14, 16, 16));

    this.previewMarker = this.createPreviewMarker();
    this.root.add(this.previewMarker);
  }

  private trackGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.sharedGeos.push(geo);
    return geo;
  }

  private trackMat<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  private createPreviewMarker(): THREE.Group {
    const group = new THREE.Group();
    group.visible = false;
    (group as unknown as {xb?: {pointerEvents: string}}).xb = {
      pointerEvents: 'none',
    };

    const coreGeo = this.trackGeo(new THREE.OctahedronGeometry(0.032, 0));
    const coreMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xe84d2b,
        wireframe: true,
      }),
    );
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);
    return group;
  }

  public syncPins(
    pins: SpatialPin[],
    defaultPinStyle: PinShapeStyle = this.defaultPinStyle,
  ) {
    this.defaultPinStyle = defaultPinStyle;
    const incomingIds = new Set(pins.map((p) => p.id));

    // Remove deleted pins
    for (const [id, node] of this.pinNodes.entries()) {
      if (!incomingIds.has(id)) {
        this.root.remove(node.group);
        this.pinNodes.delete(id);
      }
    }

    // Add or update existing pins
    for (const pin of pins) {
      const existing = this.pinNodes.get(pin.id);
      const effectiveStyle = pin.shapeStyle ?? this.defaultPinStyle;
      if (existing) {
        existing.pin = pin;
        existing.group.position.set(
          pin.position.x,
          pin.position.y,
          pin.position.z,
        );
        const col = new THREE.Color(pin.color || '#E84D2B');
        (
          existing.revolvingCoreMesh.material as THREE.MeshStandardMaterial
        ).color.copy(col);
        (
          existing.revolvingCoreMesh.material as THREE.MeshStandardMaterial
        ).emissive.copy(col);
        (
          existing.dotMesh.material as THREE.MeshStandardMaterial
        ).color.copy(col);
        (
          existing.dotMesh.material as THREE.MeshStandardMaterial
        ).emissive.copy(col);
        (
          existing.hoverRingMesh.material as THREE.MeshBasicMaterial
        ).color.copy(col);
        (
          existing.clickRippleMesh.material as THREE.MeshBasicMaterial
        ).color.copy(col);

        existing.revolvingGroup.visible = effectiveStyle === 'revolving';
        existing.dotMesh.visible = effectiveStyle === 'dot';
      } else {
        const node = this.createPinNode(pin, effectiveStyle);
        this.pinNodes.set(pin.id, node);
        this.root.add(node.group);
      }
    }
  }

  private createPinNode(
    pin: SpatialPin,
    effectiveStyle: PinShapeStyle,
  ): PinNode {
    const group = new THREE.Group();
    group.name = `LotusPin_${pin.id}`;
    group.position.set(pin.position.x, pin.position.y, pin.position.z);
    // No xrblocks manipulation here: the app moves pins itself (mouse/touch
    // drag on screens, ray drag in a headset). Two systems writing the pin
    // position in the same frame fought each other.

    const accentColor = new THREE.Color(pin.color || '#E84D2B');

    // 1. Revolving 3D Shape (Octahedron + crisp facet edge lines, no floor base or pole)
    const revolvingGroup = new THREE.Group();
    const coreMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: accentColor,
        emissive: accentColor,
        emissiveIntensity: 0.45,
        roughness: 0.22,
        metalness: 0.25,
        flatShading: true,
      }),
    );
    const revolvingCoreMesh = new THREE.Mesh(this.octaGeo, coreMat);

    const wireMat = this.trackMat(
      new THREE.LineBasicMaterial({
        color: 0x1b1b19,
        transparent: true,
        opacity: 0.55,
      }),
    );
    const revolvingWireMesh = new THREE.LineSegments(
      this.octaEdgesGeo,
      wireMat,
    );
    revolvingGroup.add(revolvingCoreMesh, revolvingWireMesh);
    revolvingGroup.visible = effectiveStyle === 'revolving';

    // 2. Minimalistic 3D Dot (Just a clean floating sphere point)
    const dotMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: accentColor,
        emissive: accentColor,
        emissiveIntensity: 0.6,
        roughness: 0.18,
        metalness: 0.15,
      }),
    );
    const dotMesh = new THREE.Mesh(this.dotGeo, dotMat);
    dotMesh.visible = effectiveStyle === 'dot';

    // 3. Hover Halo Ring (Invisible when far/idle; fades in only on hover)
    const hoverRingMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: accentColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    const hoverRingMesh = new THREE.Mesh(this.hoverRingGeo, hoverRingMat);

    // 4. Click Shockwave Ripple Ring (Bursts outward on click)
    const rippleMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: accentColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    const clickRippleMesh = new THREE.Mesh(this.rippleRingGeo, rippleMat);

    // 5. Generous invisible hit sphere centered directly on the 3D point
    const hitMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    const hitMesh = new THREE.Mesh(this.hitGeo, hitMat);
    hitMesh.userData.pinId = pin.id;

    group.add(
      revolvingGroup,
      dotMesh,
      hoverRingMesh,
      clickRippleMesh,
      hitMesh,
    );
    group.traverse((child) => {
      child.userData.pinId = pin.id;
    });

    return {
      pin,
      group,
      hitMesh,
      revolvingGroup,
      revolvingCoreMesh,
      revolvingWireMesh,
      dotMesh,
      hoverRingMesh,
      clickRippleMesh,
      wasWithinProximity: false,
      proximityLerp: 0,
      hoverLerp: 0,
      clickPulse: 0,
      isHovered: false,
      isDragging: false,
    };
  }

  public getHitMeshes(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [];
    for (const node of this.pinNodes.values()) {
      list.push(node.hitMesh);
    }
    return list;
  }

  /** World-space centre of a pin (the root may be moved by the room anchor). */
  public getPinWorldPosition(pinId: string, target: THREE.Vector3): boolean {
    const node = this.pinNodes.get(pinId);
    if (!node) return false;
    node.group.getWorldPosition(target);
    return true;
  }

  public setHoveredPin(pinId: string | null) {
    for (const [id, node] of this.pinNodes.entries()) {
      const nextHovered = id === pinId;
      if (nextHovered && !node.isHovered) {
        lotusSound.playHoverTick();
      }
      node.isHovered = nextHovered;
    }
  }

  public setDraggingPin(pinId: string | null) {
    for (const [id, node] of this.pinNodes.entries()) {
      node.isDragging = id === pinId;
      if (node.isDragging) {
        node.isHovered = true;
      }
    }
  }

  public updatePinPositionLive(
    pinId: string,
    point: Vector3Data,
    surfaceLabel?: string,
  ): SpatialPin | null {
    const node = this.pinNodes.get(pinId);
    if (!node) return null;
    node.group.position.set(point.x, point.y, point.z);
    node.pin.position = {x: point.x, y: point.y, z: point.z};
    if (surfaceLabel) {
      node.pin.surfaceLabel = surfaceLabel;
    }
    return node.pin;
  }

  public triggerClickEffect(pinId: string) {
    const node = this.pinNodes.get(pinId);
    if (node) {
      node.clickPulse = 1.0;
    }
  }

  public updatePreview(
    visible: boolean,
    point?: Vector3Data,
    elapsed = 0,
  ): void {
    this.previewMarker.visible = visible && Boolean(point);
    if (visible && point) {
      this.previewMarker.position.set(point.x, point.y, point.z);
      this.previewMarker.rotation.y = elapsed * 2.2;
      this.previewMarker.rotation.x = Math.sin(elapsed * 1.5) * 0.35;
    }
  }

  /**
   * Updates all pins per frame, evaluates Euclidean distance from user's camera
   * against proximityDistanceMeters (default 2.0m), animates the revolving shape
   * or minimalistic dot, applies 3D hover & click animations, and projects exact
   * 2D screen coordinates.
   */
  public updateAndProject(
    camera: THREE.Camera,
    delta: number,
    elapsed: number,
    proximityDistanceMeters: number,
    proximityMode: ProximityDisplayMode,
    headerPopEnabled: boolean,
    defaultPinStyle: PinShapeStyle,
    viewportWidth: number,
    viewportHeight: number,
  ): PinScreenProjection[] {
    camera.getWorldPosition(_camWorldPos);
    const projections: PinScreenProjection[] = [];

    // The pins root can be rotated by the room anchor, so billboards need the
    // camera orientation expressed in the root's space.
    this.root.updateWorldMatrix(true, false);
    this.root.getWorldQuaternion(_billboardQuat).invert();
    camera.getWorldQuaternion(_camWorldQuat);
    _billboardQuat.multiply(_camWorldQuat);

    for (const node of this.pinNodes.values()) {
      const effectiveStyle = node.pin.shapeStyle ?? defaultPinStyle;
      node.revolvingGroup.visible = effectiveStyle === 'revolving';
      node.dotMesh.visible = effectiveStyle === 'dot';

      _pinCenterPos.copy(node.group.position).applyMatrix4(this.root.matrixWorld);
      const dist = _camWorldPos.distanceTo(_pinCenterPos);
      const withinRadius = dist <= proximityDistanceMeters;

      // Minimum on-screen size (room-space scale: the root carries no scale).
      node.group.scale.setScalar(
        THREE.MathUtils.clamp(
          dist / PIN_FULL_SIZE_DISTANCE,
          1,
          MAX_PIN_DISTANCE_SCALE,
        ),
      );

      let shouldShowHeader = false;
      if (headerPopEnabled) {
        if (proximityMode === 'always') {
          shouldShowHeader = true;
        } else if (proximityMode === 'reticle-only') {
          shouldShowHeader = node.isHovered;
        } else {
          // 'proximity-2m'
          shouldShowHeader = withinRadius || node.isHovered;
        }
      }

      const justEnteredProximity = withinRadius && !node.wasWithinProximity;
      if (headerPopEnabled && justEnteredProximity) {
        lotusSound.playProximityPop();
      }
      node.wasWithinProximity = withinRadius;

      node.proximityLerp = THREE.MathUtils.damp(
        node.proximityLerp,
        shouldShowHeader ? 1 : 0,
        8,
        delta,
      );

      // Sync pin position if manipulated directly in 3D XR space
      node.pin.position.x = node.group.position.x;
      node.pin.position.y = node.group.position.y;
      node.pin.position.z = node.group.position.z;

      node.hoverLerp = THREE.MathUtils.damp(
        node.hoverLerp,
        node.isHovered || node.isDragging ? 1 : 0,
        14,
        delta,
      );

      if (node.clickPulse > 0) {
        node.clickPulse = Math.max(0, node.clickPulse - delta * 2.4);
      }

      // 1. Animate Revolving Shape & Minimalistic Dot
      const spinSpeed =
        1.4 + node.hoverLerp * 2.8 + (node.isDragging ? 3.2 : 0);
      node.revolvingGroup.rotation.y += delta * spinSpeed;
      node.revolvingGroup.rotation.x = Math.sin(elapsed * 1.6) * 0.28;

      const clickBounce =
        node.clickPulse > 0 ? Math.sin(node.clickPulse * Math.PI) * 0.55 : 0;
      const dragBoost = node.isDragging ? 0.28 : 0;
      const activeScale =
        1.0 + node.hoverLerp * 0.42 + clickBounce + dragBoost;

      node.revolvingGroup.scale.setScalar(activeScale);
      node.dotMesh.scale.setScalar(activeScale);

      const activeEmissive =
        0.48 + node.hoverLerp * 0.65 + (node.clickPulse > 0 ? 0.5 : 0);
      (
        node.revolvingCoreMesh.material as THREE.MeshStandardMaterial
      ).emissiveIntensity = activeEmissive;
      (node.dotMesh.material as THREE.MeshStandardMaterial).emissiveIntensity =
        activeEmissive + 0.15;

      // 2. Hover Halo Ring (Billboards toward camera, visible ONLY when hovered)
      node.hoverRingMesh.quaternion.copy(_billboardQuat);
      node.hoverRingMesh.scale.setScalar(0.85 + node.hoverLerp * 0.45);
      (node.hoverRingMesh.material as THREE.MeshBasicMaterial).opacity =
        node.hoverLerp * 0.85;

      // 3. Click Shockwave Ripple Ring (Billboards toward camera, bursts on click)
      node.clickRippleMesh.quaternion.copy(_billboardQuat);
      if (node.clickPulse > 0) {
        const progress = 1.0 - node.clickPulse;
        node.clickRippleMesh.scale.setScalar(1.0 + progress * 2.4);
        (node.clickRippleMesh.material as THREE.MeshBasicMaterial).opacity =
          node.clickPulse * 0.9;
      } else {
        (node.clickRippleMesh.material as THREE.MeshBasicMaterial).opacity = 0;
      }

      // 4. Project exact 3D point center to 2D viewport coordinates and camera-local space
      _camLocalPos.copy(_pinCenterPos).applyMatrix4(camera.matrixWorldInverse);
      _projectedPos.copy(_pinCenterPos).project(camera);

      const inFront = _projectedPos.z >= -1 && _projectedPos.z <= 1;
      const screenX = ((_projectedPos.x + 1) * 0.5) * viewportWidth;
      const screenY = ((-_projectedPos.y + 1) * 0.5) * viewportHeight;

      projections.push({
        id: node.pin.id,
        visible: inFront,
        screenX,
        screenY,
        distanceMeters: dist,
        isWithinProximity: shouldShowHeader,
        isWithinRadius: withinRadius,
        justEnteredProximity,
        camLocalX: _camLocalPos.x,
        camLocalY: _camLocalPos.y,
        camLocalZ: _camLocalPos.z,
        isReticleHovered: node.isHovered,
      });
    }

    return projections;
  }

  public dispose() {
    for (const geo of this.sharedGeos) geo.dispose();
    for (const mat of this.materials) mat.dispose();
  }
}
