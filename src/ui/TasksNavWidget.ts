import {lotusSound} from '../sound';
import {taskClockText, toggleTaskTimer} from '../tasks';
import {escapeHtml} from './dom';
import {UIHost} from './UIHost';

/**
 * The TASKS button in the top bar (and in the focus corner bar while the
 * timer runs): shows the running task and its clock, and on hover a card of
 * ongoing tasks with tick and timer buttons.
 */
export class TasksNavWidget {
  /** `root` contains every copy of the widget (top bar and corner bar). */
  constructor(
    private readonly host: UIHost,
    private readonly root: HTMLElement,
  ) {}

  /** Updates the timer readouts and button labels in place (every second while a task timer runs). */
  public updateReadouts() {
    for (const task of this.host.tasks) {
      const formatted = taskClockText(task);
      this.root
        .querySelectorAll(`[data-task-timer-readout="${task.id}"]`)
        .forEach((el) => {
          el.textContent = `⏱ ${formatted}`;
        });
    }
    const navLabelHtml = this.buttonLabelHtml();
    const hasRunning = this.host.tasks.some((t) => !t.completed && t.timerRunning);
    this.root
      .querySelectorAll('[data-tasks-nav-btn="true"]')
      .forEach((btn) => {
        btn.innerHTML = navLabelHtml;
        btn.classList.toggle('is-task-timer-running', hasRunning);
      });
  }

  public html(isFocusCorner = false): string {
    const ongoingTasks = this.host.tasks.filter((t) => !t.completed);
    const ongoingTasksCount = ongoingTasks.length;
    const hasRunning = ongoingTasks.some((t) => t.timerRunning);
    const btnLabelHtml = this.buttonLabelHtml();
    const focusClock = this.host.timer.clockText();

    const hoverTaskRowsHtml =
      ongoingTasks.length === 0
        ? `<div class="lotus-tasks-hover-empty">No ongoing tasks — click to add one.</div>`
        : ongoingTasks
            .map((task) => {
              const timerStr = taskClockText(task);
              const isRunning = Boolean(task.timerRunning);
              return `
                <div class="lotus-hover-task-row">
                  <button
                    type="button"
                    data-hover-tick-task="${task.id}"
                    class="lotus-task-tick-btn lotus-hover-tick-btn"
                    title="Tick to mark completed"
                    aria-label="Mark ${escapeHtml(task.title)} completed"
                  >
                    <span class="lotus-task-tick-icon">✓</span>
                  </button>
                  <div class="lotus-hover-task-info" data-hover-open-tasks="true">
                    <div class="lotus-hover-task-title">${escapeHtml(task.title)}</div>
                    <div class="lotus-hover-task-sub">
                      <span>${task.type === 'reminder' ? '⏰ Reminder' : 'Task'}</span>
                      ${task.dueLabel ? `<span>· ${escapeHtml(task.dueLabel)}</span>` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-hover-toggle-timer="${task.id}"
                    class="lotus-hover-timer-pill ${isRunning ? 'is-running' : ''}"
                    title="${isRunning ? 'Pause task timer' : 'Start task timer'}"
                  >
                    <span>${isRunning ? '⏸' : '▶'}</span>
                    <span class="lotus-tabular" data-task-timer-readout="${task.id}">⏱ ${timerStr}</span>
                  </button>
                </div>
              `;
            })
            .join('');

    return `
      <div class="lotus-tasks-nav-wrapper ${isFocusCorner ? 'is-focus-corner' : ''}">
        <button
          type="button"
          data-nav="tasks"
          data-tasks-nav-btn="true"
          class="lotus-nav-link ${isFocusCorner ? 'lotus-focus-corner-task-btn' : ''} ${this.host.isModalOpen('tasks') ? 'is-active' : ''} ${hasRunning ? 'is-task-timer-running' : ''}"
        >${btnLabelHtml}</button>

        <div class="lotus-tasks-hover-card" role="region" aria-label="Ongoing task with timer">
          <div class="lotus-tasks-hover-header">
            <span>ONGOING TASK (${ongoingTasksCount})</span>
            <span class="lotus-tabular">FOCUS${focusClock ? ` ⏱ ${focusClock}` : ''}</span>
          </div>
          <div class="lotus-tasks-hover-list">
            ${hoverTaskRowsHtml}
          </div>
          <button type="button" data-hover-open-tasks="true" class="lotus-tasks-hover-footer-btn">
            + Add / Manage Tasks &amp; Reminders
          </button>
        </div>
      </div>
    `;
  }

  public bind(rootEl: HTMLElement) {
    rootEl.querySelectorAll('[data-nav="tasks"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.host.showOnlyModal('tasks', !this.host.isModalOpen('tasks'));
        this.host.renderAll();
      });
    });

    rootEl.querySelectorAll('[data-hover-open-tasks]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.host.showOnlyModal('tasks', true);
        this.host.renderAll();
      });
    });

    rootEl.querySelectorAll('[data-hover-tick-task]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = (btn as HTMLElement).dataset.hoverTickTask;
        if (!taskId) return;
        this.host.tasks = this.host.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                completed: true,
                timerRunning: false,
                completedAt: Date.now(),
              }
            : t,
        );
        lotusSound.playTaskTick(true);
        this.host.callbacks.onSaveTasks(this.host.tasks);
        this.host.renderAll();
      });
    });

    rootEl.querySelectorAll('[data-hover-toggle-timer]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = (btn as HTMLElement).dataset.hoverToggleTimer;
        if (!taskId) return;
        this.host.tasks = toggleTaskTimer(this.host.tasks, taskId);
        lotusSound.playKeyTap();
        this.host.callbacks.onSaveTasks(this.host.tasks);
        this.host.renderAll();
      });
    });
  }

  private buttonLabelHtml(): string {
    const ongoingTasks = this.host.tasks.filter((t) => !t.completed);
    const runningTask = ongoingTasks.find((t) => t.timerRunning);
    if (runningTask) {
      const rawTitle = runningTask.title.trim();
      const shortTitle =
        rawTitle.length > 18
          ? `${rawTitle.slice(0, 16).trimEnd()}..`
          : rawTitle;
      const timerStr = taskClockText(runningTask);
      return `${escapeHtml(shortTitle)}(${timerStr})`;
    }
    return `TASKS (${ongoingTasks.length})`;
  }
}
