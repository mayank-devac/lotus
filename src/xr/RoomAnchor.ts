import * as THREE from 'three';

const ROOM_ANCHOR_STORAGE_KEY = 'lotus_ar_room_anchor_v1';

type AnchorState = 'idle' | 'restoring' | 'creating' | 'ready' | 'unsupported';

/**
 * Keeps saved pins and the focus zone attached to the real room.
 *
 * Pin coordinates are stored relative to one "room origin". The `local-floor`
 * origin a headset hands out can move between sessions and on recenter, so the
 * room origin is pinned to the real world with a single persistent WebXR
 * anchor. Each frame the anchor's pose is applied to the group that holds all
 * room content, which puts every pin back where it was left.
 *
 * Where anchors (or persistent anchors) are unavailable this does nothing and
 * the content stays in raw `local-floor` coordinates, as before.
 */
export class RoomAnchor {
  private session: XRSession | null = null;
  private anchor: XRAnchor | null = null;
  private state: AnchorState = 'idle';

  /**
   * `onRoomLost` runs when the saved anchor could not be found again. Room
   * content then starts over from the current origin, so pins and the focus
   * area may be out of place and the user should be told.
   */
  constructor(private readonly onRoomLost: () => void = () => {}) {}

  public begin(session: XRSession) {
    this.session = session;
    this.anchor = null;
    this.state = 'idle';

    const uuid = this.readStoredHandle();
    if (!uuid || !session.restorePersistentAnchor) return;
    this.state = 'restoring';
    session
      .restorePersistentAnchor(uuid)
      .then((anchor) => {
        if (this.session !== session) return;
        this.anchor = anchor;
        this.state = 'ready';
      })
      .catch(() => {
        if (this.session !== session) return;
        // The stored anchor is gone (room data cleared, different space):
        // start a fresh one at the current origin.
        this.clearStoredHandle();
        this.state = 'idle';
        this.onRoomLost();
      });
  }

  public end() {
    this.session = null;
    this.anchor = null;
    this.state = 'idle';
  }

  /** Call once per XR frame; moves `target` to the room origin. */
  public update(
    frame: XRFrame,
    referenceSpace: XRReferenceSpace,
    target: THREE.Object3D,
  ) {
    const session = this.session;
    if (!session) return;

    if (this.state === 'idle') {
      this.createAnchor(frame, referenceSpace, session);
      return;
    }
    if (this.state !== 'ready' || !this.anchor) return;

    let pose: XRPose | undefined;
    try {
      pose = frame.getPose(this.anchor.anchorSpace, referenceSpace);
    } catch {
      return;
    }
    if (!pose) return; // Tracking lost this frame: keep the last pose.
    target.matrix.fromArray(pose.transform.matrix);
    target.matrix.decompose(target.position, target.quaternion, target.scale);
    target.updateMatrixWorld(true);
  }

  private createAnchor(
    frame: XRFrame,
    referenceSpace: XRReferenceSpace,
    session: XRSession,
  ) {
    if (!frame.createAnchor || typeof XRRigidTransform === 'undefined') {
      this.state = 'unsupported';
      return;
    }
    this.state = 'creating';
    let pending: Promise<XRAnchor> | undefined;
    try {
      // Identity pose: the room origin starts at the current local-floor
      // origin, so existing pin coordinates keep their meaning.
      pending = frame.createAnchor(new XRRigidTransform(), referenceSpace);
    } catch {
      this.state = 'unsupported';
      return;
    }
    if (!pending) {
      this.state = 'unsupported';
      return;
    }
    pending
      .then(async (anchor) => {
        if (this.session !== session) return;
        this.anchor = anchor;
        this.state = 'ready';
        try {
          const uuid = await anchor.requestPersistentHandle?.();
          if (uuid) localStorage.setItem(ROOM_ANCHOR_STORAGE_KEY, uuid);
        } catch {
          // Persistence unavailable: the anchor still holds for this session.
        }
      })
      .catch(() => {
        if (this.session === session) this.state = 'unsupported';
      });
  }

  private readStoredHandle(): string | null {
    try {
      return localStorage.getItem(ROOM_ANCHOR_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private clearStoredHandle() {
    try {
      localStorage.removeItem(ROOM_ANCHOR_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
}
