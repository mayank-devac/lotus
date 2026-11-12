import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  advanceTaskTimers,
  createTask,
  dockTaskTimer,
  pinContentFromTask,
  selectTaskTimerForChip,
  taskClockText,
  toggleTaskDone,
  toggleTaskTimer,
} from './tasks';
import {LotusTask} from './types';

function task(overrides: Partial<LotusTask> = {}): LotusTask {
  return {
    id: 'task-a',
    title: 'Read chapter 4',
    note: '',
    dueLabel: '',
    type: 'task',
    timerSeconds: 600,
    remainingSeconds: 600,
    timerRunning: false,
    completed: false,
    createdAt: 0,
    ...overrides,
  };
}

describe('createTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it('trims text and sets a full, stopped timer', () => {
    const t = createTask({
      title: '  Essay  ',
      note: ' draft ',
      dueLabel: ' Fri ',
      type: 'task',
      timerMinutes: 45,
    });
    expect(t).toMatchObject({
      title: 'Essay',
      note: 'draft',
      dueLabel: 'Fri',
      timerSeconds: 2700,
      remainingSeconds: 2700,
      timerRunning: false,
      completed: false,
      createdAt: 1_700_000_000_000,
    });
    // Ids end up in DOM attributes; storage only accepts this shape.
    expect(t.id).toMatch(/^task-\d+-[a-z0-9]+$/);
  });

  it('labels an undated reminder and clamps the timer to a minute', () => {
    const t = createTask({title: 'Call', note: '', dueLabel: ' ', type: 'reminder', timerMinutes: 0});
    expect(t.dueLabel).toBe('Reminder');
    expect(t.timerSeconds).toBe(60);
  });
});

describe('toggleTaskDone', () => {
  it('ticks a task, stops its timer and stamps it', () => {
    const before = [task({timerRunning: true}), task({id: 'task-b'})];
    const after = toggleTaskDone(before, 'task-a');
    expect(after[0]).toMatchObject({completed: true, timerRunning: false});
    expect(after[0].completedAt).toBeTypeOf('number');
    expect(after[1]).toBe(before[1]);
    expect(before[0].completed).toBe(false);
  });

  it('unticks a done task and clears the stamp', () => {
    const [t] = toggleTaskDone([task({completed: true, completedAt: 5})], 'task-a');
    expect(t.completed).toBe(false);
    expect(t.completedAt).toBeUndefined();
  });
});

describe('toggleTaskTimer', () => {
  it('runs one timer at a time', () => {
    const tasks = [task({id: 'task-a', timerRunning: true}), task({id: 'task-b'})];
    const after = toggleTaskTimer(tasks, 'task-b');
    expect(after.map((t) => t.timerRunning)).toEqual([false, true]);
  });

  it('pauses a running timer without touching the others', () => {
    const tasks = [task({timerRunning: true}), task({id: 'task-b'})];
    const after = toggleTaskTimer(tasks, 'task-a');
    expect(after[0].timerRunning).toBe(false);
    expect(after[1]).toBe(tasks[1]);
  });

  it('restarts a timer that had run out from its full length', () => {
    const [t] = toggleTaskTimer([task({remainingSeconds: 0})], 'task-a');
    expect(t).toMatchObject({timerRunning: true, remainingSeconds: 600});
  });

  it('starts a task without a set length at the 25 minute default', () => {
    const [t] = toggleTaskTimer(
      [task({timerSeconds: undefined, remainingSeconds: undefined})],
      'task-a',
    );
    expect(t.remainingSeconds).toBe(25 * 60);
  });
});

describe('advanceTaskTimers', () => {
  it('returns the same list when nothing runs', () => {
    const tasks = [task()];
    const step = advanceTaskTimers(tasks, 5);
    expect(step).toEqual({tasks, changed: false, finished: false});
    expect(step.tasks).toBe(tasks);
  });

  it('counts down running timers only', () => {
    const tasks = [task({timerRunning: true}), task({id: 'task-b'})];
    const step = advanceTaskTimers(tasks, 30);
    expect(step.changed).toBe(true);
    expect(step.finished).toBe(false);
    expect(step.tasks[0].remainingSeconds).toBe(570);
    expect(step.tasks[1]).toBe(tasks[1]);
  });

  it('stops a timer at zero and reports it finished', () => {
    const step = advanceTaskTimers([task({timerRunning: true, remainingSeconds: 3})], 10);
    expect(step.finished).toBe(true);
    expect(step.tasks[0]).toMatchObject({remainingSeconds: 0, timerRunning: false});
  });

  it('ignores a done task whose timer was left running', () => {
    const tasks = [task({timerRunning: true, completed: true})];
    expect(advanceTaskTimers(tasks, 10).changed).toBe(false);
  });
});

describe('taskClockText', () => {
  it('formats MM:SS', () => {
    expect(taskClockText(task({remainingSeconds: 65}))).toBe('01:05');
    expect(taskClockText(task({remainingSeconds: 0}))).toBe('00:00');
  });

  it('falls back to the full length, then to 25 minutes', () => {
    expect(taskClockText(task({remainingSeconds: undefined, timerSeconds: 90}))).toBe('01:30');
    expect(
      taskClockText(task({remainingSeconds: undefined, timerSeconds: undefined})),
    ).toBe('25:00');
  });
});

describe('dockTaskTimer', () => {
  it('picks the running timer over a paused one', () => {
    const tasks = [task({id: 'task-a', remainingSeconds: 300}), task({id: 'task-b', timerRunning: true})];
    expect(dockTaskTimer(tasks)?.id).toBe('task-b');
  });

  it('picks the first paused timer that has counted down', () => {
    const tasks = [
      task({id: 'task-a'}),
      task({id: 'task-b', remainingSeconds: 300}),
      task({id: 'task-c', remainingSeconds: 120}),
    ];
    expect(dockTaskTimer(tasks)?.id).toBe('task-b');
  });

  it('skips fresh, ran-out and done timers', () => {
    const tasks = [
      task({id: 'task-fresh', remainingSeconds: 600}),
      task({id: 'task-out', remainingSeconds: 0}),
      task({id: 'task-done', remainingSeconds: 300, completed: true}),
    ];
    expect(dockTaskTimer(tasks)).toBeNull();
    expect(dockTaskTimer([])).toBeNull();
  });
});

describe('selectTaskTimerForChip', () => {
  it('prefers the running timer and remembers its task', () => {
    const running = task({id: 'task-running', timerRunning: true});
    const paused = task({id: 'task-paused', remainingSeconds: 300});
    expect(selectTaskTimerForChip([paused, running], paused.id)).toEqual({
      task: running,
      selectedTaskId: running.id,
    });
  });

  it('keeps a selected timer visible when it is paused at full length', () => {
    const selected = task();
    expect(selectTaskTimerForChip([selected], selected.id)).toEqual({
      task: selected,
      selectedTaskId: selected.id,
    });
  });

  it('drops a missing, completed, or expired selection and falls back to a partial timer', () => {
    const fallback = task({id: 'task-fallback', remainingSeconds: 300});
    const invalidSelections = [
      {tasks: [fallback], selectedTaskId: 'missing'},
      {tasks: [fallback, task({completed: true})], selectedTaskId: 'task-a'},
      {tasks: [fallback, task({remainingSeconds: 0})], selectedTaskId: 'task-a'},
    ];

    for (const selection of invalidSelections) {
      expect(selectTaskTimerForChip(selection.tasks, selection.selectedTaskId)).toEqual({
        task: fallback,
        selectedTaskId: null,
      });
    }
  });
});

describe('pinContentFromTask', () => {
  it('joins the due label and note', () => {
    expect(
      pinContentFromTask(task({dueLabel: 'Fri', note: 'pages 4-12'})),
    ).toEqual({
      title: 'Read chapter 4',
      body: 'Due: Fri — pages 4-12',
      surfaceLabel: 'Task Pin',
      taskId: 'task-a',
    });
  });

  it('uses the title as the body when there is nothing else', () => {
    expect(pinContentFromTask(task({type: 'reminder'}))).toEqual({
      title: 'Read chapter 4',
      body: 'Read chapter 4',
      surfaceLabel: 'Reminder Pin',
      taskId: 'task-a',
    });
  });
});
