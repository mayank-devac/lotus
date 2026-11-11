/**
 * Standalone headsets (Meta Quest browser). They never composite the DOM into
 * an immersive session, and their browser camera is not a view of the room.
 */
export const IS_STANDALONE_HEADSET = /OculusBrowser|Quest/i.test(
  navigator.userAgent,
);
