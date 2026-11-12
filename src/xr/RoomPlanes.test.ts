import * as THREE from 'three';
import {describe, expect, it} from 'vitest';

import {RoomPlane, insideOutline, nearestPlaneHit} from './RoomPlanes';

const SQUARE = [
  {x: -1, z: -1},
  {x: 1, z: -1},
  {x: 1, z: 1},
  {x: -1, z: 1},
];

function plane(orientation: XRPlaneOrientation, worldFromPlane: THREE.Matrix4): RoomPlane {
  return {
    orientation,
    worldFromPlane,
    planeFromWorld: worldFromPlane.clone().invert(),
    outline: SQUARE,
  };
}

/** A 2 m desk top at 0.75 m, 1.5 m ahead. */
const desk = plane('horizontal', new THREE.Matrix4().makeTranslation(0, 0.75, -1.5));
/** A wall 3 m ahead, its +Y pointing back at the user. */
const wall = plane(
  'vertical',
  new THREE.Matrix4()
    .makeTranslation(0, 1.5, -3)
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)),
);

const eye = new THREE.Vector3(0, 1.5, 0);
function rayTowards(x: number, y: number, z: number): THREE.Ray {
  return new THREE.Ray(eye.clone(), new THREE.Vector3(x, y, z).sub(eye).normalize());
}

describe('insideOutline', () => {
  it('tells inside from outside', () => {
    expect(insideOutline(SQUARE, 0, 0)).toBe(true);
    expect(insideOutline(SQUARE, 0.99, -0.99)).toBe(true);
    expect(insideOutline(SQUARE, 1.2, 0)).toBe(false);
    expect(insideOutline([], 0, 0)).toBe(false);
  });
});

describe('nearestPlaneHit', () => {
  it('finds the desk when aiming down at it', () => {
    const hit = nearestPlaneHit(rayTowards(0.2, 0.75, -1.4), [desk, wall]);
    expect(hit?.orientation).toBe('horizontal');
    expect(hit?.point.y).toBeCloseTo(0.75);
    expect(hit?.normal.y).toBeCloseTo(1);
  });

  it('finds the wall when aiming level', () => {
    const hit = nearestPlaneHit(rayTowards(0, 1.6, -3), [desk, wall]);
    expect(hit?.orientation).toBe('vertical');
    expect(hit?.distance).toBeCloseTo(3, 1);
  });

  it('turns the normal to face the user whichever way the plane points', () => {
    const flipped = plane(
      'vertical',
      new THREE.Matrix4()
        .makeTranslation(0, 1.5, -3)
        .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)),
    );
    const hit = nearestPlaneHit(rayTowards(0, 1.5, -3), [flipped]);
    expect(hit?.normal.z).toBeCloseTo(1);
  });

  it('ignores a ray that passes beside the outline or points away', () => {
    expect(nearestPlaneHit(rayTowards(3, 0.75, -1.5), [desk])).toBeNull();
    expect(nearestPlaneHit(rayTowards(0, 1.5, 3), [wall])).toBeNull();
  });

  it('prefers the nearer of two planes on the ray', () => {
    // The desk sits in front of the wall, low down.
    const hit = nearestPlaneHit(rayTowards(0, 0.75, -1.5), [wall, desk]);
    expect(hit?.orientation).toBe('horizontal');
  });
});
