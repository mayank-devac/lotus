import * as THREE from 'three';
import {XRPointerRay} from './XRInterfaceTypes';

const _tmp = new THREE.Vector3();
interface PointerVisual {
  line: THREE.Line;
  dot: THREE.Mesh;
}

/** A ray and cursor dot per controller / hand, so the user can see where they aim. */
export class XRPointers {
  private pointers: PointerVisual[] = [];
  private pointerLineGeo: THREE.BufferGeometry;
  private pointerLineMat: THREE.LineBasicMaterial;
  private pointerDotGeo: THREE.SphereGeometry;
  private pointerDotMat: THREE.MeshBasicMaterial;

  /** `root` is the group the rays are added to. */
  constructor(private readonly root: THREE.Object3D) {
    this.pointerLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    this.pointerLineMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.45,
    });
    this.pointerDotGeo = new THREE.SphereGeometry(0.007, 12, 12);
    this.pointerDotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthTest: false,
      toneMapped: false,
    });
  }
  /**
   * Draws the first `count` rays of `rays` and hides every other pointer. The
   * count is separate so the caller can reuse one array without slicing it
   * each frame.
   */
  public update(rays: XRPointerRay[], count: number) {
    while (this.pointers.length < count) {
      const line = new THREE.Line(this.pointerLineGeo, this.pointerLineMat);
      line.frustumCulled = false;
      const dot = new THREE.Mesh(this.pointerDotGeo, this.pointerDotMat);
      dot.renderOrder = 10;
      this.root.add(line, dot);
      this.pointers.push({line, dot});
    }
    this.pointers.forEach((pointer, i) => {
      const ray = i < count ? rays[i] : undefined;
      if (!ray) {
        pointer.line.visible = false;
        pointer.dot.visible = false;
        return;
      }
      const length = Math.min(ray.distance, 3);
      pointer.line.visible = true;
      pointer.line.position.copy(ray.origin);
      pointer.line.quaternion.copy(ray.quaternion);
      pointer.line.scale.set(1, 1, length);
      pointer.dot.visible = ray.showDot;
      if (ray.showDot) {
        _tmp.set(0, 0, -1).applyQuaternion(ray.quaternion);
        pointer.dot.position.copy(ray.origin).addScaledVector(_tmp, ray.distance);
        pointer.dot.scale.setScalar(THREE.MathUtils.clamp(ray.distance, 0.4, 3));
      }
    });
  }

  public dispose() {
    this.pointerLineGeo.dispose();
    this.pointerLineMat.dispose();
    this.pointerDotGeo.dispose();
    this.pointerDotMat.dispose();
  }
}
