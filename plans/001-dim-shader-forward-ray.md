# Plan 001: The headset focus dim has no clear hole behind the user

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c64340b..HEAD -- src/FocusVolume3D.ts`
> If the file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `c64340b`, 2026-11-12

## Why this matters

LOTUS is a WebXR app. During a focus session in a headset it darkens the
whole room except the directions that look at the user's "focus zone" (a box
in the room). The darkening is a sphere around the head whose fragment shader
decides, per pixel, how close that pixel's view ray passes to the box.

The shader searches the whole infinite **line** through the eye, not only the
half that goes forward. A pixel that looks directly **away** from the box
lies on a line that passes through the box behind the eye, so it is left
clear. Result: a second, undimmed window of the same size appears exactly
opposite the focus zone. When the user turns around during a focus session
they see a bright hole in the dim. This plan limits the search to the forward
ray, which removes the hole.

It also stops drawing the sphere when its strength is zero (the "focus area
visibility" setting at 100 %), where it currently costs a full-screen blended
pass on both eyes and changes nothing.

## Current state

- `src/FocusVolume3D.ts` — the focus zone's 3D visuals. The GLSL fragment
  shader is the template string `DIM_FRAGMENT_SHADER` (lines 37–100). The
  class `FocusVolume3D` owns the sphere mesh `dimDome` and its material
  `dimMaterial`.

The function to change, `src/FocusVolume3D.ts:52-81`:

```glsl
  /**
   * Smallest box distance along the ray. That function is convex in t, so a
   * short shrinking-step descent from the point closest to the centre finds
   * the global minimum — exact enough for grazing rays too, which is what
   * keeps the window's corners from rounding off.
   */
  float rayBoxDistance(vec3 rayOrigin, vec3 rayDir) {
    vec3 extents = max(uFocusHalfExtents, vec3(0.18));
    float slope = max(
      max(abs(rayDir.x) / extents.x, abs(rayDir.y) / extents.y),
      abs(rayDir.z) / extents.z
    );
    float t = dot(uFocusCenter - rayOrigin, rayDir);
    float s = 1.0 / max(slope, 1e-4);
    float d = boxDistanceAt(rayOrigin + rayDir * t, extents);
    for (int i = 0; i < 10; i++) {
      float dLeft = boxDistanceAt(rayOrigin + rayDir * (t - s), extents);
      if (dLeft < d) {
        d = dLeft;
        t -= s;
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
```

`t` is the distance along the ray. Nothing keeps it at or above zero: for a
ray that points away from the box the starting `t` is negative, and the
"left" step moves it further back. Negative `t` means "behind the eye".

The visibility rule, `src/FocusVolume3D.ts:303-306`:

```ts
  /** The single place that decides whether the dim shell is drawn. */
  private syncDimVisibility() {
    this.dimDome.visible = this.xrDimActive && this.currentBounds.defined;
  }
```

The strength is written in `setXRDim`, `src/FocusVolume3D.ts:295-301`:

```ts
  public setXRDim(active: boolean, strength: number, shieldStyle: ShieldStyle) {
    this.xrDimActive = active;
    const uniforms = this.dimMaterial.uniforms;
    uniforms.uBaseOpacity.value = THREE.MathUtils.clamp(strength, 0, 1) * 0.92;
    (uniforms.uTintColor.value as THREE.Color).setHex(DIM_TINT[shieldStyle]);
    this.syncDimVisibility();
  }
```

Conventions in this repo: 2-space indent, single quotes, no spaces inside
`{}` in imports, comments in full sentences that explain why. GLSL lives in
template strings tagged with `/* glsl */`.

## Commands you will need

| Purpose   | Command          | Expected on success              |
|-----------|------------------|----------------------------------|
| Install   | `bun install`    | exit 0                           |
| Typecheck | `bun run lint`   | exit 0, prints `$ tsc --noEmit` and no errors |
| Build     | `bun run build`  | exit 0                           |

The package manager is **bun**, not npm. `bun run lint` is a typecheck
(`tsc --noEmit`); there is no ESLint and no test suite in this repo.

## Scope

**In scope** (the only file you should modify):
- `src/FocusVolume3D.ts`

**Out of scope** (do NOT touch):
- `src/index.ts` — it calls `setXRDim`; its call must keep working unchanged.
- `boxDistanceAt`, the `main()` function of the shader, the fade width, the
  number of loop iterations. Do not "optimise" the loop.
- The case where the user's head is inside the focus box (the dim then
  disappears). That is a product decision and is left for the maintainer.

## Git workflow

- Branch: `advisor/001-dim-shader-forward-ray`
- One commit. This repo uses conventional commits, for example
  `feat: enhance focus volume functionality with improved ray distance calculations and keyboard input handling`.
  Use: `fix: keep the headset focus dim from opening a clear hole behind the user`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Limit the search to the forward ray

In `rayBoxDistance` in `src/FocusVolume3D.ts`, make exactly these changes:

1. Clamp the starting distance:
   `float t = max(dot(uFocusCenter - rayOrigin, rayDir), 0.0);`
2. Clamp the backward step. Replace the `dLeft` block with:

```glsl
      float tLeft = max(t - s, 0.0);
      float dLeft = boxDistanceAt(rayOrigin + rayDir * tLeft, extents);
      if (dLeft < d) {
        d = dLeft;
        t = tLeft;
      }
```

3. Leave the `dRight` block as it is.
4. Update the comment above the function so it says the search covers only
   the forward half of the ray (`t >= 0`), and why: a line through the eye
   also passes through the box behind the user, which used to leave a clear
   window opposite the focus zone.

The distance function stays convex on `t >= 0`, so the descent still finds
the minimum.

**Verify**: `grep -n "max(t - s, 0.0)" src/FocusVolume3D.ts` → one match.
**Verify**: `grep -n "max(dot(uFocusCenter - rayOrigin, rayDir), 0.0)" src/FocusVolume3D.ts` → one match.

### Step 2: Do not draw the dim sphere at zero strength

Change `syncDimVisibility` to:

```ts
  /** The single place that decides whether the dim shell is drawn. */
  private syncDimVisibility() {
    this.dimDome.visible =
      this.xrDimActive &&
      this.currentBounds.defined &&
      this.dimMaterial.uniforms.uBaseOpacity.value > 0;
  }
```

`setXRDim` already writes `uBaseOpacity` before it calls
`syncDimVisibility`, so no other change is needed.

**Verify**: `bun run lint` → exit 0, no errors.

### Step 3: Build

**Verify**: `bun run build` → exit 0.

## Test plan

There is no automated test suite and this plan does not add one (a GLSL
change cannot be unit-tested here). Report the following manual check as
"not run" unless you have a headset or the Immersive Web Emulator available:

1. Enter XR, set a focus area, start focus with "Focus area".
2. Look at the area: it is clear, the surroundings are dark.
3. Turn 180° away from the area: the view is evenly dark, with no clear
   rectangle.

## Done criteria

ALL must hold:

- [ ] `bun run lint` exits 0
- [ ] `bun run build` exits 0
- [ ] `grep -c "max(t - s, 0.0)" src/FocusVolume3D.ts` prints `1`
- [ ] `grep -c "uBaseOpacity.value > 0" src/FocusVolume3D.ts` prints `1`
- [ ] `git status --porcelain` lists only `src/FocusVolume3D.ts` (and
      `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `rayBoxDistance` or `syncDimVisibility` does not match the excerpts above.
- `bun run lint` fails twice after a reasonable fix attempt.
- You find you need to change `src/index.ts` or any other file.

## Maintenance notes

- A reviewer should check that only `t` handling changed in the shader and
  that the loop count and fade width are untouched.
- Deferred, for the maintainer to decide: when the user's head is inside the
  focus box (easy with a desk zone that rises 0.72 m above the desk),
  every ray starts inside the box and the dim vanishes completely. Options
  are to accept it, or to measure from the box's near face only.
- Deferred: the dim sphere has a 4 m radius and is depth-tested, so virtual
  content further than 4 m is dimmed while nearer content is not.
