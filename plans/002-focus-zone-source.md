# Plan 002: A focus area drawn on a 2D screen is never used as a room area in the headset

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat c64340b..HEAD -- src/types.ts src/storage.ts src/FocusVolume3D.ts src/index.ts src/ImmersiveSession.ts`
> If any of these files changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches a stored data shape; needs a loader migration)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `c64340b`, 2026-11-12

## Why this matters

LOTUS runs in two places: on a 2D screen (phone, desktop, with a webcam
behind the page) and inside a headset (WebXR). Both store one "focus zone"
in `localStorage`: a box with `min` and `max` corners.

On a 2D screen the user drags a rectangle over the camera picture. The 3D
box saved with it comes from rays cast from a made-up camera position, 8 m
into empty space. It means nothing in a real room. In a headset the box is
drawn on real surfaces and is anchored to the room.

Today the headset decides "has the user set a real area?" by comparing the
zone's **label text** to the default label (`'Study Desk Area'`). A zone
drawn on the 2D screen gets the label `'Focus Area (…)'`, so the headset
treats it as a real room area. "Start focus → Focus area" then skips the
"mark out your desk" step and dims the room around an arbitrary box several
metres away.

This plan records where a zone came from in an explicit `source` field and
makes the headset use only zones that were drawn in the headset.

## Current state

Files and their roles:

- `src/types.ts` — data shapes. Must stay JSON-serializable.
- `src/storage.ts` — `localStorage` load / save, defaults, and the
  label-based check.
- `src/FocusVolume3D.ts` — `focusZoneFromDrag` builds a zone from two
  dragged corners; `setBoundsFromDrag` is the 2D-screen caller.
- `src/index.ts` — the app. Owns `this.focusZone`; the three uses of the
  label-based check are all headset-only paths.
- `src/ImmersiveSession.ts` — the headset session; calls
  `focusZoneFromDrag` for headset drags.

`src/types.ts:46-52`:

```ts
export interface FocusZoneBounds {
  defined: boolean;
  label: string;
  min: Vector3Data;
  max: Vector3Data;
  customScreenRect?: ProjectedRect | null;
}
```

`src/storage.ts:51-56` and `src/storage.ts:92-95`:

```ts
export const DEFAULT_FOCUS_ZONE: FocusZoneBounds = {
  defined: true,
  label: 'Study Desk Area',
  min: vec3(-0.65, 0.75, -1.75),
  max: vec3(0.65, 1.55, -1.1),
};
```

```ts
/** The focus zone still holds the made-up default rather than a real spot. */
export function isDefaultFocusZone(zone: FocusZoneBounds): boolean {
  return !zone.defined || zone.label === DEFAULT_FOCUS_ZONE.label;
}
```

`src/storage.ts:269-290` (the loader):

```ts
export function loadFocusZone(): FocusZoneBounds {
  try {
    const raw = localStorage.getItem(FOCUS_STORAGE_KEY);
    if (!raw) return {...DEFAULT_FOCUS_ZONE};
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.defined === 'boolean') {
      const min = readVec3(parsed.min);
      const max = readVec3(parsed.max);
      if (min && max) {
        return {
          ...(parsed as unknown as FocusZoneBounds),
          label: text(parsed.label, DEFAULT_FOCUS_ZONE.label),
          min,
          max,
        };
      }
    }
  } catch {
    // Fallback
  }
  return {...DEFAULT_FOCUS_ZONE};
}
```

`src/FocusVolume3D.ts:120-145` (signature and return of the builder):

```ts
export function focusZoneFromDrag(
  p1: Vector3Data,
  p2: Vector3Data,
  onSurface: boolean,
  name = 'Focus Area',
): FocusZoneBounds {
  ...
  return {
    defined: true,
    label: `${name} (${width.toFixed(2)}m × ${depth.toFixed(2)}m)`,
    min: {x: minX, y: minY, z: minZ},
    max: {x: maxX, y: maxY, z: maxZ},
  };
}
```

`src/FocusVolume3D.ts:261-270` (the 2D-screen caller):

```ts
  public setBoundsFromDrag(
    p1: Vector3Data,
    p2: Vector3Data,
    surfaceLabel = 'Custom Focus Zone',
  ): FocusZoneBounds {
    const bounds = focusZoneFromDrag(p1, p2, true, surfaceLabel);
```

`src/ImmersiveSession.ts:700` (the headset caller):

```ts
      this.host.previewFocusZone(focusZoneFromDrag(g.start, corner, g.onSurface));
```

The three uses of the check in `src/index.ts` (lines 216, 372, 380):

```ts
      focusZoneNeedsDefining: () => isDefaultFocusZone(this.focusZone),
```

```ts
    const showFrame = presenting
      ? !isDefaultFocusZone(this.focusZone)
      : this.settings.showVirtualRoom;
```

```ts
    this.focusVolume.setXRDim(
      presenting && running && !isDefaultFocusZone(this.focusZone),
```

How stored zones look today (needed for the migration):

- The default zone has `label === 'Study Desk Area'`.
- A zone drawn on a 2D screen always has `customScreenRect` set to an object
  with `visible: true` (`LotusUI.completeFocusAreaDrag`).
- A zone confirmed in the headset always has `customScreenRect: null`
  (`commitFocusZone` in `src/index.ts:222-228`).

Repo rule (from `AGENTS.md`): "Changing a schema requires a migration in
`storage.ts` loaders, not just type edits."

Conventions: 2-space indent, single quotes, `{a, b}` without inner spaces,
doc comments in full sentences. Match the surrounding code.

## Commands you will need

| Purpose   | Command          | Expected on success              |
|-----------|------------------|----------------------------------|
| Install   | `bun install`    | exit 0                           |
| Typecheck | `bun run lint`   | exit 0, no errors                |
| Build     | `bun run build`  | exit 0                           |

The package manager is **bun**. `bun run lint` is `tsc --noEmit`. There is
no ESLint and no test suite.

## Scope

**In scope** (the only files you should modify):
- `src/types.ts`
- `src/storage.ts`
- `src/FocusVolume3D.ts`
- `src/index.ts`
- `src/ImmersiveSession.ts` (one call site only)

**Out of scope** (do NOT touch):
- `src/LotusUI.ts` — it spreads the zone it is given (`{...updatedZone,
  customScreenRect: rect}`), so the new field passes through untouched. If
  the typecheck reports an error in this file, that is a STOP condition.
- The storage key `lotus_ar_focus_zone_v3` — do not rename it; the loader
  migrates old data in place.
- The `label` field and its text — keep writing it; the 2D UI shows it.
- `customScreenRect` handling.

## Git workflow

- Branch: `advisor/002-focus-zone-source`
- One commit, conventional-commit style, for example:
  `fix: only use a focus area drawn in the headset as a room area`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the `source` field to the type

In `src/types.ts`, add above `FocusZoneBounds`:

```ts
/**
 * Where a focus zone's box came from: the built-in placeholder, a rectangle
 * dragged on a 2D screen (its box is only meaningful to that screen), or an
 * area marked out in the real room inside a headset.
 */
export type FocusZoneSource = 'default' | 'screen' | 'room';
```

and add `source: FocusZoneSource;` to `FocusZoneBounds` (required, after
`label`).

**Verify**: `bun run lint` → fails with errors in `src/storage.ts` and
`src/FocusVolume3D.ts` about the missing `source` property. That is
expected at this step; errors anywhere else are a STOP condition.

### Step 2: Defaults, the check and the migration in `src/storage.ts`

1. Add `source: 'default'` to `DEFAULT_FOCUS_ZONE`.
2. Replace `isDefaultFocusZone` with:

```ts
/** The zone was marked out in the real room, so a headset can use it. */
export function isRoomFocusZone(zone: FocusZoneBounds): boolean {
  return zone.defined && zone.source === 'room';
}
```

3. In `loadFocusZone`, compute `source` and put it in the returned object
   (after the spread, next to `label`, `min`, `max`). Import
   `FocusZoneSource` from `./types`. Add this helper above `loadFocusZone`:

```ts
const FOCUS_ZONE_SOURCES: FocusZoneSource[] = ['default', 'screen', 'room'];

/**
 * Zones saved before `source` existed are told apart by what each writer
 * left behind: the default kept its label, a 2D drag always stored a
 * visible screen rectangle, and a headset confirm cleared that rectangle.
 */
function readFocusZoneSource(parsed: Record<string, unknown>): FocusZoneSource {
  const stored = parsed.source;
  if (typeof stored === 'string') {
    const known = FOCUS_ZONE_SOURCES.find((s) => s === stored);
    if (known) return known;
  }
  if (parsed.defined !== true || parsed.label === DEFAULT_FOCUS_ZONE.label) {
    return 'default';
  }
  const rect = parsed.customScreenRect;
  return isRecord(rect) && rect.visible === true ? 'screen' : 'room';
}
```

**Verify**: `grep -n "isDefaultFocusZone" src/storage.ts` → no matches.

### Step 3: Make the builder state its source

In `src/FocusVolume3D.ts`:

1. Import `FocusZoneSource` from `./types`.
2. Change `focusZoneFromDrag` to take the source as a required parameter
   placed before `name`:
   `(p1, p2, onSurface: boolean, source: FocusZoneSource, name = 'Focus Area')`
   and add `source,` to the returned object.
3. In `setBoundsFromDrag`, call
   `focusZoneFromDrag(p1, p2, true, 'screen', surfaceLabel)`.

In `src/ImmersiveSession.ts` line 700, change the call to
`focusZoneFromDrag(g.start, corner, g.onSurface, 'room')`. Change nothing
else in that file.

**Verify**: `grep -n "focusZoneFromDrag(" src/*.ts` → three matches: the
definition, one call with `'screen'`, one call with `'room'`.

### Step 4: Switch the three headset checks in `src/index.ts`

1. In the import from `./storage`, replace `isDefaultFocusZone` with
   `isRoomFocusZone`.
2. Line 216: `focusZoneNeedsDefining: () => !isRoomFocusZone(this.focusZone),`
3. Line 372: `? isRoomFocusZone(this.focusZone)`
4. Line 380: `presenting && running && isRoomFocusZone(this.focusZone),`
5. Update the two comments next to these lines that speak of "the made-up
   default zone" so they say "a zone that was not marked out in the room".

**Verify**: `grep -rn "isDefaultFocusZone" src/` → no matches.
**Verify**: `bun run lint` → exit 0, no errors.

### Step 5: Build

**Verify**: `bun run build` → exit 0.

## Test plan

No automated tests exist and none are added. Report these manual checks as
"not run" unless you can run the app (`bun run dev`, then
`http://localhost:3000`):

1. Desktop, fresh storage: draw a focus area on the 2D screen. In devtools,
   `JSON.parse(localStorage.lotus_ar_focus_zone_v3).source` is `"screen"`.
2. With that zone stored, enter XR (headset or Immersive Web Emulator) and
   press Play → "Focus area": the panel asks to drag across the desk first.
3. Draw and confirm an area in XR: stored `source` is `"room"`; pressing
   Play → "Focus area" in a later session starts at once.
4. Old data: store a zone without `source` and with
   `customScreenRect: null` and a non-default label, reload: the app treats
   it as a room zone.

## Done criteria

ALL must hold:

- [ ] `bun run lint` exits 0
- [ ] `bun run build` exits 0
- [ ] `grep -rn "isDefaultFocusZone" src/` returns no matches
- [ ] `grep -c "source" src/types.ts` prints at least `1` and
      `FocusZoneBounds` has a required `source` field
- [ ] `git status --porcelain` lists only the five in-scope files (and
      `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any excerpt in "Current state" does not match the live code.
- After Step 4, `bun run lint` reports an error in a file that is out of
  scope (most likely `src/LotusUI.ts` building a `FocusZoneBounds` object
  literal without `source`). Report the file and line.
- `isDefaultFocusZone` is used anywhere other than the three lines of
  `src/index.ts` listed above.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Any new code that creates a `FocusZoneBounds` must say where it came
  from; the required field makes the compiler enforce that.
- The reverse direction is still open: a zone confirmed in the headset is
  also shown on the 2D screen, projected through the 2D view's made-up
  camera. A follow-up could hide the 2D shield window for `source: 'room'`
  zones until the user drags a rectangle there.
- A reviewer should check the migration order in `readFocusZoneSource`:
  a stored valid `source` wins; otherwise default label → `'default'`,
  visible screen rectangle → `'screen'`, else `'room'`.
