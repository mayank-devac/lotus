import * as THREE from 'three';
import {describe, expect, it} from 'vitest';

import {focusZoneFromDrag, focusZoneTopCentre, focusZoneYawFacing} from './FocusVolume3D';

const UP = new THREE.Vector3(0, 1, 0);

describe('focusZoneFromDrag', () => {
  it('raises a zone dragged on a surface a fixed height above it', () => {
    const zone = focusZoneFromDrag({x: 0, y: 0.75, z: -1}, {x: 1, y: 0.8, z: -2}, true, 'room');
    expect(zone).toMatchObject({defined: true, source: 'room', yaw: 0});
    expect(zone.min).toEqual({x: 0, y: 0.75 - 0.02, z: -2});
    expect(zone.max.x).toBe(1);
    expect(zone.max.z).toBe(-1);
    expect(zone.max.y).toBeCloseTo(0.75 + 0.72);
    expect(zone.label).toBe('Focus Area (1.00m × 1.00m)');
  });

  it('lets a wall zone take its height from the corners', () => {
    const zone = focusZoneFromDrag({x: 0, y: 1, z: -2}, {x: 1, y: 2, z: -2}, false, 'room');
    expect(zone.min.y).toBe(1);
    expect(zone.max.y).toBe(2);
    // The two corners lie on the wall: the depth grows to the minimum around it.
    expect(zone.max.z - zone.min.z).toBeCloseTo(0.35);
    expect((zone.max.z + zone.min.z) / 2).toBeCloseTo(-2);
  });

  it('grows a tiny drag to the minimum size around its middle', () => {
    const zone = focusZoneFromDrag({x: 1, y: 0, z: 1}, {x: 1.1, y: 0, z: 1}, true, 'screen');
    expect(zone.max.x - zone.min.x).toBeCloseTo(0.35);
    expect((zone.max.x + zone.min.x) / 2).toBeCloseTo(1.05);
  });

  it('does not depend on which corner came first', () => {
    const a = {x: -0.4, y: 0.7, z: -1.2};
    const b = {x: 0.6, y: 0.75, z: -2};
    expect(focusZoneFromDrag(a, b, true, 'room')).toEqual(focusZoneFromDrag(b, a, true, 'room'));
  });

  it('stores the corners in the frame turned by yaw', () => {
    const yaw = Math.PI / 2;
    const p1 = new THREE.Vector3(0, 1, 0);
    const p2 = new THREE.Vector3(2, 1, 1);
    const zone = focusZoneFromDrag(p1, p2, true, 'room', yaw);
    expect(zone.yaw).toBe(yaw);
    // Turning the stored corners back by yaw gives the dragged footprint.
    const lo = new THREE.Vector3(zone.min.x, 1, zone.min.z).applyAxisAngle(UP, yaw);
    const hi = new THREE.Vector3(zone.max.x, 1, zone.max.z).applyAxisAngle(UP, yaw);
    const xs = [lo.x, hi.x].sort((m, n) => m - n);
    const zs = [lo.z, hi.z].sort((m, n) => m - n);
    expect(xs[0]).toBeCloseTo(0);
    expect(xs[1]).toBeCloseTo(2);
    expect(zs[0]).toBeCloseTo(0);
    expect(zs[1]).toBeCloseTo(1);
  });

  it('uses the given name in the label', () => {
    expect(focusZoneFromDrag({x: 0, y: 0, z: 0}, {x: 1, y: 0, z: 1}, true, 'screen', 0, 'Desk').label)
      .toMatch(/^Desk \(/);
  });
});

describe('focusZoneTopCentre', () => {
  it('is the middle of the top face, in room space', () => {
    const zone = focusZoneFromDrag({x: 0, y: 1, z: 0}, {x: 2, y: 1, z: 1}, true, 'room', Math.PI / 2);
    const top = focusZoneTopCentre(zone, new THREE.Vector3());
    expect(top.x).toBeCloseTo(1);
    expect(top.z).toBeCloseTo(0.5);
    expect(top.y).toBeCloseTo(zone.max.y);
  });
});

describe('focusZoneYawFacing', () => {
  it('turns the zone so its -Z axis points along the aim', () => {
    expect(focusZoneYawFacing(new THREE.Vector3(0, 0, -1))).toBeCloseTo(0);
    expect(focusZoneYawFacing(new THREE.Vector3(-1, -0.5, 0))).toBeCloseTo(Math.PI / 2);
  });

  it('falls back to 0 for a ray straight up or down', () => {
    expect(focusZoneYawFacing(new THREE.Vector3(0, -1, 0))).toBe(0);
  });
});
