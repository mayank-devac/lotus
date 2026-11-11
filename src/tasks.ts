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
    const full = t.timerSeconds ?? DEFAULT_TASK_TIMER_SEC;
    const left = t.remainingSeconds ?? full;
    return {...t, timerRunning: willRun, remainingSeconds: left <= 0 ? full : left};
  });
}

/** Remaining time on a task's timer as MM:SS. */
export function taskClockText(task: LotusTask): string {
  const sec = task.remainingSeconds ?? task.timerSeconds ?? DEFAULT_TASK_TIMER_SEC;
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** What a pin dropped for a task says. */
export function pinContentFromTask(
  task: LotusTask,
): Pick<SpatialPin, 'title' | 'body' | 'surfaceLabel'> {
  return {
    title: task.title,
    body:
      [task.dueLabel ? `Due: ${task.dueLabel}` : '', task.note]
        .filter(Boolean)
        .join(' — ') || task.title,
    surfaceLabel: task.type === 'reminder' ? 'Reminder Pin' : 'Task Pin',
  };
}
