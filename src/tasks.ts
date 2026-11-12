import {LotusTask, SpatialPin, TaskItemType} from './types';

/**
 * Task list operations shared by the 2D screen (LotusUI) and the in-headset
 * panels (ImmersiveSession), so both change tasks in exactly the same way.
 * Every function returns a new list; none mutates its input.
 */

/** Timer lengths offered when creating a task, in minutes. */
export const TASK_TIMER_PRESETS_MIN = [15, 25, 45, 60];
const DEFAULT_TASK_TIMER_SEC = 25 * 60;

export interface TaskDraft {
  title: string;
  note: string;
  dueLabel: string;
  type: TaskItemType;
  timerMinutes: number;
}

/** A task's configured timer length, in seconds. */
export function taskFullSeconds(task: LotusTask): number {
  return task.timerSeconds ?? DEFAULT_TASK_TIMER_SEC;
}

/** A task's time left on its timer, in seconds. */
export function taskRemainingSeconds(task: LotusTask): number {
  return task.remainingSeconds ?? taskFullSeconds(task);
}

export function createTask(draft: TaskDraft): LotusTask {
  const durationSec = Math.max(1, draft.timerMinutes) * 60;
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: draft.title.trim(),
    note: draft.note.trim(),
    dueLabel:
      draft.dueLabel.trim() || (draft.type === 'reminder' ? 'Reminder' : ''),
    type: draft.type,
    timerSeconds: durationSec,
    remainingSeconds: durationSec,
    timerRunning: false,
    completed: false,
    createdAt: Date.now(),
  };
}

/** Ticks or unticks a task. A ticked task's timer stops. */
export function toggleTaskDone(tasks: LotusTask[], taskId: string): LotusTask[] {
  return tasks.map((t) =>
    t.id === taskId
      ? {
          ...t,
          completed: !t.completed,
          timerRunning: false,
          completedAt: t.completed ? undefined : Date.now(),
        }
      : t,
  );
}

/**
 * Starts or pauses a task's timer. Only one task timer runs at a time, and a
 * timer that had run out starts again from its full length.
 */
export function toggleTaskTimer(tasks: LotusTask[], taskId: string): LotusTask[] {
  const target = tasks.find((t) => t.id === taskId);
  const willRun = target ? !target.timerRunning : false;
  return tasks.map((t) => {
    if (t.id !== taskId) return willRun ? {...t, timerRunning: false} : t;
    const left = taskRemainingSeconds(t);
    return {...t, timerRunning: willRun, remainingSeconds: left <= 0 ? taskFullSeconds(t) : left};
  });
}

/**
 * The task whose timer the main panel's pill shows: the running one, else the
 * first paused one that has already counted down (a timer still at its full
 * length has nothing to resume). null when no task timer needs the pill.
 */
export function dockTaskTimer(tasks: LotusTask[]): LotusTask | null {
  const ongoing = tasks.filter((t) => !t.completed);
  return (
    ongoing.find((t) => t.timerRunning) ??
    ongoing.find((t) => {
      const left = taskRemainingSeconds(t);
      return left > 0 && left < taskFullSeconds(t);
    }) ??
    null
  );
}

/** Picks the task timer for the headset chip, retaining a just-selected full timer after a pause. */
export function selectTaskTimerForChip(
  tasks: LotusTask[],
  selectedTaskId: string | null,
): {task: LotusTask | null; selectedTaskId: string | null} {
  const running = tasks.find((task) => !task.completed && task.timerRunning);
  if (running) return {task: running, selectedTaskId: running.id};

  const selected = tasks.find((task) => task.id === selectedTaskId);
  if (selected && !selected.completed && taskRemainingSeconds(selected) > 0) {
    return {task: selected, selectedTaskId};
  }

  return {task: dockTaskTimer(tasks), selectedTaskId: null};
}

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
    const left = Math.max(0, taskRemainingSeconds(t) - seconds);
    if (left === 0) finished = true;
    return {...t, remainingSeconds: left, timerRunning: left > 0};
  });
  return {tasks: changed ? next : tasks, changed, finished};
}

/** Remaining time on a task's timer as MM:SS. */
export function taskClockText(task: LotusTask): string {
  const totalSec = taskRemainingSeconds(task);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** What a pin dropped for a task says, including the link back to that task. */
export function pinContentFromTask(
  task: LotusTask,
): Pick<SpatialPin, 'title' | 'body' | 'surfaceLabel' | 'taskId'> {
  return {
    title: task.title,
    body:
      [task.dueLabel ? `Due: ${task.dueLabel}` : '', task.note]
        .filter(Boolean)
        .join(' — ') || task.title,
    surfaceLabel: task.type === 'reminder' ? 'Reminder Pin' : 'Task Pin',
    taskId: task.id,
  };
}
