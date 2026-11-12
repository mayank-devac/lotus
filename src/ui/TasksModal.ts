import {lotusSound} from '../sound';
import {
  TASK_TIMER_PRESETS_MIN,
  createTask,
  pinContentFromTask,
  taskClockText,
  toggleTaskDone,
  toggleTaskTimer,
} from '../tasks';
import {LotusTask, TaskFilterTab, TaskItemType} from '../types';
import {escapeHtml, formatCreatedAgo} from './dom';
import {last7DaysCompletedStats, renderTaskInsightsChart} from './taskInsights';
import {UIHost} from './UIHost';

/**
 * Tasks & Reminders: the add form (with timer presets), the ongoing and
 * completed lists with tick, timer, "+ 3D Pin" and delete, and the 7-day
 * insights chart. List changes use the pure helpers in `src/tasks.ts`.
 */
export class TasksModal {
  private taskFilterTab: TaskFilterTab = 'all';
  private draftTaskTitle = '';
  private draftTaskNote = '';
  private draftTaskDueLabel = '';
  private draftTaskTimerMin = 25;
  private draftTaskType: TaskItemType = 'task';

  constructor(
    private readonly host: UIHost,
    private readonly layer: HTMLElement,
  ) {}
  public render() {
    this.layer.style.pointerEvents = 'auto';

    const ongoingTasks = this.host.tasks.filter((t) => !t.completed);
    const completedTasks = this.host.tasks.filter((t) => t.completed);

    const renderTaskRow = (task: LotusTask) => {
      const isDone = task.completed;
      const typeBadgeLabel = task.type === 'reminder' ? '⏰ REMINDER' : '✓ TASK';
      const createdAgo = formatCreatedAgo(task.createdAt);
      const timerStr = taskClockText(task);
      const isRunning = Boolean(task.timerRunning);

      return `
        <div class="lotus-task-item ${isDone ? 'is-completed' : 'is-ongoing'}">
          <button
            type="button"
            data-tick-task="${task.id}"
            class="lotus-task-tick-btn ${isDone ? 'is-checked' : ''}"
            aria-label="${isDone ? 'Mark as ongoing' : 'Tick to mark completed'}: ${escapeHtml(task.title)}"
            title="${isDone ? 'Click to move back to Ongoing' : 'Click to mark as Completed'}"
          >
            <span class="lotus-task-tick-icon">✓</span>
          </button>

          <div class="lotus-task-content" data-tick-task="${task.id}">
            <div class="lotus-task-meta-row">
              <span class="lotus-task-type-badge ${task.type === 'reminder' ? 'is-reminder' : 'is-task'}">${typeBadgeLabel}</span>
              ${
                task.dueLabel
                  ? `<span class="lotus-task-due-badge">${escapeHtml(task.dueLabel)}</span>`
                  : ''
              }
              <span class="lotus-task-time-label">${escapeHtml(createdAgo)}</span>
            </div>
            <div class="lotus-task-title">${escapeHtml(task.title)}</div>
            ${
              task.note
                ? `<div class="lotus-task-note">${escapeHtml(task.note)}</div>`
                : ''
            }
          </div>

          <div class="lotus-task-actions">
            ${
              !isDone
                ? `
              <button
                type="button"
                data-toggle-task-timer="${task.id}"
                class="lotus-hover-timer-pill ${isRunning ? 'is-running' : ''}"
                title="${isRunning ? 'Pause task timer' : 'Start task timer'}"
              >
                <span>${isRunning ? '⏸' : '▶'}</span>
                <span class="lotus-tabular" data-task-timer-readout="${task.id}">⏱ ${timerStr}</span>
              </button>
            `
                : ''
            }
            <button
              type="button"
              data-pin-from-task="${task.id}"
              class="lotus-chip-btn"
              title="Tap surroundings to place this task as a 3D Spatial Pin"
            >
              + 3D Pin
            </button>
            <button
              type="button"
              data-delete-task="${task.id}"
              class="lotus-task-delete-btn"
              aria-label="Delete ${escapeHtml(task.title)}"
              title="Delete"
            >
              ✕
            </button>
          </div>
        </div>
      `;
    };

    const showOngoingSection =
      this.taskFilterTab === 'all' || this.taskFilterTab === 'ongoing';
    const showCompletedSection =
      this.taskFilterTab === 'all' || this.taskFilterTab === 'completed';
    const showInsightsSection = this.taskFilterTab === 'insights';

    const last7DaysData = last7DaysCompletedStats(this.host.tasks);
    const total7DayCompleted = last7DaysData.reduce(
      (acc, d) => acc + d.count,
      0,
    );
    const avgDailyCompleted = (total7DayCompleted / 7).toFixed(1);
    const completionRate =
      this.host.tasks.length > 0
        ? Math.round((completedTasks.length / this.host.tasks.length) * 100)
        : 0;
    const peakDayObj = last7DaysData.reduce(
      (best, cur) => (cur.count >= best.count ? cur : best),
      last7DaysData[0],
    );

    this.layer.innerHTML = `
      <div class="lotus-modal-backdrop">
        <section class="lotus-modal-card lotus-tasks-modal" role="dialog" aria-labelledby="tasks-modal-title">
          <div class="lotus-modal-header">
            <div>
              <h2 id="tasks-modal-title" class="lotus-modal-title">Tasks &amp; Reminders</h2>
              <p class="lotus-modal-subtitle">Add new tasks or reminders with timers, and use tick buttons to separate ongoing from completed items.</p>
            </div>
            <button type="button" id="tasks-close-btn" class="lotus-icon-close-btn" aria-label="Close">✕</button>
          </div>

          <div class="lotus-modal-body" data-modal-id="tasks">
            <!-- Add New Task / Reminder Form -->
            <div class="lotus-task-composer-box">
              <div class="lotus-task-composer-top">
                <div class="lotus-task-type-toggle" role="group" aria-label="Entry type">
                  <button
                    type="button"
                    data-new-task-type="task"
                    class="lotus-chip-btn ${this.draftTaskType === 'task' ? 'is-active' : ''}"
                  >
                    ✓ Task
                  </button>
                  <button
                    type="button"
                    data-new-task-type="reminder"
                    class="lotus-chip-btn ${this.draftTaskType === 'reminder' ? 'is-active' : ''}"
                  >
                    ⏰ Reminder
                  </button>
                </div>

                <div class="lotus-task-due-presets">
                  <span class="lotus-field-label" style="font-size: 0.66rem;">Timer:</span>
                  ${TASK_TIMER_PRESETS_MIN
                    .map(
                      (min) => `
                    <button
                      type="button"
                      data-timer-preset="${min}"
                      class="lotus-due-preset-chip ${this.draftTaskTimerMin === min ? 'is-selected' : ''}"
                    >
                      ⏱ ${min}m
                    </button>
                  `,
                    )
                    .join('')}
                </div>
              </div>

              <div class="lotus-task-input-row">
                <input
                  type="text"
                  id="new-task-title-input"
                  value="${escapeHtml(this.draftTaskTitle)}"
                  placeholder="${this.draftTaskType === 'reminder' ? 'Add a new reminder (e.g. Call study group at 4pm)…' : 'Add a new task (e.g. Finish problem set #5)…'}"
                  class="lotus-text-input"
                />
                <button type="button" id="add-task-submit-btn" class="lotus-primary-cta">
                  + Add ${this.draftTaskType === 'reminder' ? 'Reminder' : 'Task'}
                </button>
              </div>

              <div class="lotus-task-Optional-row">
                <input
                  type="text"
                  id="new-task-due-input"
                  value="${escapeHtml(this.draftTaskDueLabel)}"
                  placeholder="Reminder time / due label (optional, e.g. Today 5:00 PM)"
                  class="lotus-text-input lotus-input-compact"
                />
                <input
                  type="text"
                  id="new-task-note-input"
                  value="${escapeHtml(this.draftTaskNote)}"
                  placeholder="Additional note or details (optional)"
                  class="lotus-text-input lotus-input-compact"
                />
              </div>
            </div>

            <!-- Filter Bar to view All (Separated), Ongoing, Completed, or Insights -->
            <div class="lotus-dir-sort-bar" role="group" aria-label="Filter tasks">
              <div class="lotus-dir-sort-options">
                <button
                  type="button"
                  data-task-filter="all"
                  class="lotus-chip-btn ${this.taskFilterTab === 'all' ? 'is-active' : ''}"
                >
                  All Separated (${this.host.tasks.length})
                </button>
                <button
                  type="button"
                  data-task-filter="ongoing"
                  class="lotus-chip-btn ${this.taskFilterTab === 'ongoing' ? 'is-active' : ''}"
                >
                  Ongoing (${ongoingTasks.length})
                </button>
                <button
                  type="button"
                  data-task-filter="completed"
                  class="lotus-chip-btn ${this.taskFilterTab === 'completed' ? 'is-active' : ''}"
                >
                  Completed (${completedTasks.length})
                </button>
                <button
                  type="button"
                  data-task-filter="insights"
                  class="lotus-chip-btn ${this.taskFilterTab === 'insights' ? 'is-active' : ''}"
                >
                  📊 Insights
                </button>
              </div>

              ${
                completedTasks.length > 0 && !showInsightsSection
                  ? `<button type="button" id="clear-completed-tasks-btn" class="lotus-danger-btn" style="padding: 5px 10px; font-size: 0.68rem;">Clear Completed (${completedTasks.length})</button>`
                  : ''
              }
            </div>

            <!-- D3 7-Day Completed Tasks Insights Section -->
            ${
              showInsightsSection
                ? `
              <div class="lotus-task-insights-section">
                <div class="lotus-task-section-header">
                  <span class="lotus-task-section-title">COMPLETED TASKS · LAST 7 DAYS (D3 VISUALIZATION)</span>
                  <span class="lotus-task-count-pill is-done">${total7DayCompleted} COMPLETED (7D)</span>
                </div>

                <div class="lotus-insights-kpi-grid">
                  <div class="lotus-insights-kpi-card">
                    <span class="lotus-insights-kpi-label">7-DAY COMPLETED</span>
                    <span class="lotus-insights-kpi-value lotus-tabular">${total7DayCompleted}</span>
                  </div>
                  <div class="lotus-insights-kpi-card">
                    <span class="lotus-insights-kpi-label">DAILY AVERAGE</span>
                    <span class="lotus-insights-kpi-value lotus-tabular">${avgDailyCompleted}/day</span>
                  </div>
                  <div class="lotus-insights-kpi-card">
                    <span class="lotus-insights-kpi-label">COMPLETION RATE</span>
                    <span class="lotus-insights-kpi-value lotus-tabular">${completionRate}%</span>
                  </div>
                  <div class="lotus-insights-kpi-card">
                    <span class="lotus-insights-kpi-label">PEAK DAY</span>
                    <span class="lotus-insights-kpi-value lotus-tabular">${escapeHtml(peakDayObj.dayShort)} (${peakDayObj.count})</span>
                  </div>
                </div>

                <div class="lotus-d3-chart-card">
                  <div id="lotus-d3-insights-chart" class="lotus-d3-insights-chart" aria-label="D3 bar chart of completed tasks over the last 7 days"></div>
                  <div id="lotus-d3-tooltip" class="lotus-d3-tooltip" style="display: none;"></div>
                </div>
              </div>
            `
                : ''
            }

            <!-- Separated Ongoing Tasks & Reminders Section -->
            ${
              showOngoingSection
                ? `
              <div class="lotus-task-section">
                <div class="lotus-task-section-header">
                  <span class="lotus-task-section-title">ONGOING TASKS &amp; REMINDERS</span>
                  <span class="lotus-task-count-pill">${ongoingTasks.length} ONGOING</span>
                </div>
                ${
                  ongoingTasks.length === 0
                    ? `<div class="lotus-empty-state">All caught up! Add a new task or reminder above.</div>`
                    : `<div class="lotus-task-list">${ongoingTasks.map(renderTaskRow).join('')}</div>`
                }
              </div>
            `
                : ''
            }

            <!-- Separated Completed Tasks & Reminders Section -->
            ${
              showCompletedSection
                ? `
              <div class="lotus-task-section is-completed-section">
                <div class="lotus-task-section-header">
                  <span class="lotus-task-section-title">COMPLETED TASKS &amp; REMINDERS</span>
                  <span class="lotus-task-count-pill is-done">${completedTasks.length} COMPLETED</span>
                </div>
                ${
                  completedTasks.length === 0
                    ? `<div class="lotus-empty-state">No completed tasks yet. Click the tick button (✓) next to any ongoing task to mark it complete.</div>`
                    : `<div class="lotus-task-list">${completedTasks.map(renderTaskRow).join('')}</div>`
                }
              </div>
            `
                : ''
            }
          </div>

          <div class="lotus-modal-footer">
            <span class="lotus-tabular" style="font-size: 0.76rem; color: var(--ink-muted);">
              ${ongoingTasks.length} ongoing · ${completedTasks.length} completed
            </span>
            <div style="flex: 1;"></div>
            <button type="button" id="tasks-done-btn" class="lotus-primary-cta">Done</button>
          </div>
        </section>
      </div>
    `;

    if (showInsightsSection) {
      renderTaskInsightsChart(this.layer, last7DaysData);
    }

    const titleInput = this.layer.querySelector(
      '#new-task-title-input',
    ) as HTMLInputElement | null;
    const dueInput = this.layer.querySelector(
      '#new-task-due-input',
    ) as HTMLInputElement | null;
    const noteInput = this.layer.querySelector(
      '#new-task-note-input',
    ) as HTMLInputElement | null;

    const syncDraftTaskFields = () => {
      if (titleInput) this.draftTaskTitle = titleInput.value;
      if (dueInput) this.draftTaskDueLabel = dueInput.value;
      if (noteInput) this.draftTaskNote = noteInput.value;
    };

    titleInput?.addEventListener('input', syncDraftTaskFields);
    dueInput?.addEventListener('input', syncDraftTaskFields);
    noteInput?.addEventListener('input', syncDraftTaskFields);

    const handleAddTask = () => {
      syncDraftTaskFields();
      const trimmedTitle = this.draftTaskTitle.trim();
      if (!trimmedTitle) {
        titleInput?.focus();
        return;
      }

      const newTask = createTask({
        title: trimmedTitle,
        note: this.draftTaskNote,
        dueLabel: this.draftTaskDueLabel,
        type: this.draftTaskType,
        timerMinutes: this.draftTaskTimerMin,
      });

      this.host.tasks = [newTask, ...this.host.tasks];
      this.draftTaskTitle = '';
      this.draftTaskNote = '';
      this.draftTaskDueLabel = '';
      lotusSound.playPinCreated();
      this.host.callbacks.onSaveTasks(this.host.tasks);
      this.host.renderAll();
    };

    this.layer
      .querySelector('#add-task-submit-btn')
      ?.addEventListener('click', handleAddTask);

    titleInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTask();
      }
    });
    dueInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTask();
      }
    });
    noteInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTask();
      }
    });

    this.layer
      .querySelectorAll('[data-new-task-type]')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          syncDraftTaskFields();
          this.draftTaskType = (btn as HTMLElement).dataset
            .newTaskType as TaskItemType;
          lotusSound.playKeyTap();
          this.render();
        });
      });

    this.layer.querySelectorAll('[data-timer-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncDraftTaskFields();
        this.draftTaskTimerMin = Number(
          (btn as HTMLElement).dataset.timerPreset || 25,
        );
        lotusSound.playKeyTap();
        this.render();
      });
    });

    this.layer.querySelectorAll('[data-task-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncDraftTaskFields();
        this.taskFilterTab = (btn as HTMLElement).dataset
          .taskFilter as TaskFilterTab;
        lotusSound.playKeyTap();
        this.render();
      });
    });

    this.layer
      .querySelectorAll('[data-toggle-task-timer]')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          syncDraftTaskFields();
          const taskId = (btn as HTMLElement).dataset.toggleTaskTimer;
          if (!taskId) return;
          this.host.tasks = toggleTaskTimer(this.host.tasks, taskId);
          lotusSound.playKeyTap();
          this.host.callbacks.onSaveTasks(this.host.tasks);
          this.host.renderAll();
        });
      });

    this.layer.querySelectorAll('[data-tick-task]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        syncDraftTaskFields();
        const taskId = (el as HTMLElement).dataset.tickTask;
        if (!taskId) return;
        this.host.tasks = toggleTaskDone(this.host.tasks, taskId);
        lotusSound.playTaskTick(
          Boolean(this.host.tasks.find((t) => t.id === taskId)?.completed),
        );
        this.host.callbacks.onSaveTasks(this.host.tasks);
        this.host.renderAll();
      });
    });

    this.layer.querySelectorAll('[data-delete-task]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        syncDraftTaskFields();
        const taskId = (btn as HTMLElement).dataset.deleteTask;
        if (!taskId) return;
        this.host.tasks = this.host.tasks.filter((t) => t.id !== taskId);
        lotusSound.playKeyTap();
        this.host.callbacks.onSaveTasks(this.host.tasks);
        this.host.renderAll();
      });
    });

    this.layer
      .querySelectorAll('[data-pin-from-task]')
      .forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const taskId = (btn as HTMLElement).dataset.pinFromTask;
          const task = this.host.tasks.find((t) => t.id === taskId);
          if (!task) return;
          // Show surroundings first so user taps where to place the pin, then open Save UI!
          this.host.enterPinAddMode(pinContentFromTask(task));
        });
      });

    this.layer
      .querySelector('#clear-completed-tasks-btn')
      ?.addEventListener('click', () => {
        syncDraftTaskFields();
        this.host.tasks = this.host.tasks.filter((t) => !t.completed);
        lotusSound.playKeyTap();
        this.host.callbacks.onSaveTasks(this.host.tasks);
        this.host.renderAll();
      });

    const closeTasks = () => {
      syncDraftTaskFields();
      this.host.closeModal('tasks');
      this.host.renderAll();
    };
    this.layer
      .querySelector('#tasks-close-btn')
      ?.addEventListener('click', closeTasks);
    this.layer
      .querySelector('#tasks-done-btn')
      ?.addEventListener('click', closeTasks);
  }
}
