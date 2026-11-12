# Plan 003: Task timers count real time, not interval ticks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c64340b..HEAD -- src/LotusUI.ts src/tasks.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `c64340b`, 2026-11-12

## Why this matters

Each task in LOTUS can run its own countdown. The countdown subtracts one
second every time a 1-second `setInterval` fires. Browsers delay or skip
interval callbacks in background tabs and while an XR session keeps the
main thread busy, so the countdown runs slow: a 25-minute task timer can
take much longer than 25 minutes, most of all in the headset.

The main focus timer in the same file already counts from the wall clock for
exactly this reason (its comment says so). This plan makes task timers do
the same and moves the arithmetic into the shared, pure task helpers.

## Current state

- `src/LotusUI.ts` — the 2D DOM interface (about 3,800 lines). It owns the
  live task list `this.tasks` and the ticker below.
- `src/tasks.ts` — pure task-list helpers shared by the 2D screen and the
  headset. Its header comment: "Every function returns a new list; none
  mutates its input."

The ticker, `src/LotusUI.ts:206-243`:

```ts
  private startTaskTimersEngine() {
    if (this.taskTickerIntervalId !== null) {
      window.clearInterval(this.taskTickerIntervalId);
    }
    this.taskTickerIntervalId = window.setInterval(() => {
      let anyUpdated = false;
      let anyCompletedByTimer = false;
      this.tasks = this.tasks.map((t) => {
        if (!t.completed && t.timerRunning) {
          const cur =
            t.remainingSeconds ?? t.timerSeconds ?? this.settings.presetMinutes * 60;
          const next = Math.max(0, cur - 1);
          anyUpdated = true;
          if (next === 0) {
            anyCompletedByTimer = true;
            return {
              ...t,
              remainingSeconds: 0,
              timerRunning: false,
            };
          }
          return {
            ...t,
            remainingSeconds: next,
          };
        }
        return t;
      });

      if (anyCompletedByTimer) {
        lotusSound.playTimerComplete();
        this.callbacks.onSaveTasks(this.tasks);
        this.renderAllPanels();
      } else if (anyUpdated) {
        this.updateTaskTimerDOMReadouts();
      }
    }, 1000);
  }
```

The pattern to follow, from the focus timer in the same file
(`src/LotusUI.ts:1037-1043`):

```ts
    // Count from the wall clock, not from ticks: browsers throttle intervals
    // (background tabs, busy XR frames), and a tick-counted timer then runs slow.
    const startedAt = Date.now();
    ...
    this.timerIntervalId = window.setInterval(() => {
      const passedSec = Math.floor((Date.now() - startedAt) / 1000);
```

An existing helper in `src/tasks.ts` to model the new one on
(`src/tasks.ts:52-65`):

```ts
/**
 * Starts or pauses a task's timer. Only one task timer runs at a time, and a
 * timer that had run out starts again from its full length.
 */
export function toggleTaskTimer(tasks: LotusTask[], taskId: string): LotusTask[] {
  const target = tasks.find((t) => t.id === taskId);
  const willRun = target ? !target.timerRunning : false;
  return tasks.map((t) => {
    if (t.id !== taskId) return willRun ? {...t, timerRunning: false} : t;
    const full = t.timerSeconds ?? DEFAULT_TASK_TIMER_SEC;
    const left = t.remainingSeconds ?? full;
    return {...t, timerRunning: willRun, remainingSeconds: left <= 0 ? full : left};
  });
}
```

`src/tasks.ts` already defines `const DEFAULT_TASK_TIMER_SEC = 25 * 60;`.

Conventions: 2-space indent, single quotes, `{a, b}` without inner spaces,
doc comments in full sentences.

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
- `src/tasks.ts`
- `src/LotusUI.ts` — only the method `startTaskTimersEngine` and its import
  line from `./tasks`

**Out of scope** (do NOT touch):
- The focus timer (`startFocusTimer`, `stopFocusTimer`) in `src/LotusUI.ts`.
- `src/types.ts` and `src/storage.ts` — no new stored fields. Do not add a
  "timer ends at" timestamp to tasks; that would need a storage migration.
- `src/ImmersiveSession.ts` — it reads the live list through `getTasks()`
  and needs no change.

## Git workflow

- Branch: `advisor/003-task-timers-wall-clock`
- One commit, conventional-commit style, for example:
  `fix: count task timers from the wall clock so they do not run slow`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a pure helper to `src/tasks.ts`

Add after `toggleTaskTimer`:

```ts
/**
 * Takes `seconds` off every running task timer. A timer that reaches zero
 * stops. `changed` is false when no timer was running, and `finished` is
 * true when at least one timer ran out in this step.
 */
export function advanceTaskTimers(
  tasks: LotusTask[],
  seconds: number,
): {tasks: LotusTask[]; changed: boolean; finished: boolean} {
  let changed = false;
  let finished = false;
  const next = tasks.map((t) => {
    if (t.completed || !t.timerRunning) return t;
    changed = true;
    const left = Math.max(
      0,
      (t.remainingSeconds ?? t.timerSeconds ?? DEFAULT_TASK_TIMER_SEC) - seconds,
    );
    if (left === 0) finished = true;
    return {...t, remainingSeconds: left, timerRunning: left > 0};
  });
  return {tasks: changed ? next : tasks, changed, finished};
}
```

**Verify**: `bun run lint` → exit 0.

### Step 2: Use it from the ticker, driven by the wall clock

In `src/LotusUI.ts`:

1. Add `advanceTaskTimers` to the existing import from `./tasks`. Check the
   top of the file: if there is no import from `./tasks` yet, add
   `import {advanceTaskTimers} from './tasks';` next to the other local
   imports.
2. Replace the whole body of `startTaskTimersEngine` with:

```ts
  private startTaskTimersEngine() {
    if (this.taskTickerIntervalId !== null) {
      window.clearInterval(this.taskTickerIntervalId);
    }
    // Count from the wall clock, not from ticks: browsers throttle intervals
    // (background tabs, busy XR frames), and a tick-counted timer runs slow.
    let countedUntil = Date.now();
    this.taskTickerIntervalId = window.setInterval(() => {
      const wholeSeconds = Math.floor((Date.now() - countedUntil) / 1000);
      if (wholeSeconds < 1) return;
      countedUntil += wholeSeconds * 1000;
      const step = advanceTaskTimers(this.tasks, wholeSeconds);
      if (!step.changed) return;
      this.tasks = step.tasks;
      if (step.finished) {
        lotusSound.playTimerComplete();
        this.callbacks.onSaveTasks(this.tasks);
        this.renderAllPanels();
      } else {
        this.updateTaskTimerDOMReadouts();
      }
    }, 250);
  }
```

Notes on behaviour that must be preserved:
- `this.tasks` is replaced only when a timer was running (as before).
- On completion: sound, `onSaveTasks`, `renderAllPanels` (as before).
- Otherwise: `updateTaskTimerDOMReadouts()` (as before).

The old code fell back to `this.settings.presetMinutes * 60` for a task
with neither `remainingSeconds` nor `timerSeconds`; the helper uses the
shared 25-minute default that `toggleTaskTimer` and `taskClockText` already
use. `toggleTaskTimer` always writes `remainingSeconds` before a timer
runs, so that fallback is never reached in practice.

**Verify**: `grep -n "cur - 1" src/LotusUI.ts` → no matches.
**Verify**: `grep -n "advanceTaskTimers" src/LotusUI.ts` → two matches
(import and call).
**Verify**: `bun run lint` → exit 0, no errors.

### Step 3: Build

**Verify**: `bun run build` → exit 0.

## Test plan

No automated tests exist and none are added (the repo has no test runner;
adding one is outside this plan). Report this manual check as "not run"
unless you can run the app:

1. `bun run dev`, open `http://localhost:3000`, open Tasks, start a task's
   timer.
2. Switch to another browser tab for 60 seconds, then return: the task
   clock has dropped by about 60 seconds (before this change it dropped by
   far less in a throttled tab).

## Done criteria

ALL must hold:

- [ ] `bun run lint` exits 0
- [ ] `bun run build` exits 0
- [ ] `grep -c "export function advanceTaskTimers" src/tasks.ts` prints `1`
- [ ] `grep -n "cur - 1" src/LotusUI.ts` returns no matches
- [ ] `git status --porcelain` lists only `src/tasks.ts` and
      `src/LotusUI.ts` (and `plans/README.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `startTaskTimersEngine` does not match the excerpt above.
- `this.tasks`, `this.callbacks.onSaveTasks`, `this.renderAllPanels` or
  `this.updateTaskTimerDOMReadouts` does not exist on the class under that
  name.
- The typecheck fails twice after a reasonable fix attempt.
- You find you need to change `src/types.ts` or `src/storage.ts`.

## Maintenance notes

- Time that passes while the page is fully suspended (headset taken off,
  laptop asleep) is now counted when the page wakes, the same as the focus
  timer. A task timer can therefore finish "while away".
- A running task timer is still not saved on every tick: a page reload
  restores the last saved remaining time and stops the timer
  (`sanitizeTask` in `src/storage.ts` forces `timerRunning: false`).
  Persisting an end timestamp would fix that but needs a storage migration;
  it is deliberately left out here.
- A task timer running out inside the headset only plays a sound; the
  in-headset panel shows no message. A follow-up could call the panel's
  `flashStatus`.
