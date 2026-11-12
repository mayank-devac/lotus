import {lotusSound} from '../sound';
import {dockTaskTimer, taskClockText, toggleTaskTimer} from '../tasks';
import {escapeHtml} from './dom';
import {UIHost} from './UIHost';

/** Inline icons for the dock's compact buttons (stroke follows the text colour). */
const PIN_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>`;
const FOCUS_AREA_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3.5" y="6" width="17" height="12" rx="2.5" stroke-dasharray="3 2.6"/>
  </svg>`;
const PLAY_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none" aria-hidden="true">
    <path d="M8 5.5v13l11-6.5z"/>
  </svg>`;
const PAUSE_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
    <path d="M8.5 5.5v13M15.5 5.5v13"/>
  </svg>`;

/**
 * The bottom dock: focus area and FOCUS (start timer) buttons, plus the
 * running/paused task timer's pill (pause it, or resume it after a pause).
 * In focus area mode it turns into the visibility slider with AGAIN and OKAY.
 * Hidden while the timer runs and while a pin is being placed.
 */
export class BottomDock {
  constructor(
    private readonly host: UIHost,
    private readonly el: HTMLElement,
  ) {}
  public render() {
    // When Focus Timer is running or user is placing a pin in surroundings, hide the bottom dock
    if (this.host.timer.running || (this.host.mode === 'pin-add' && !this.host.isModalOpen('composer'))) {
      this.el.style.display = 'none';
      this.el.innerHTML = '';
      return;
    }

    this.el.style.display = 'flex';
    this.el.className = 'lotus-bottom-dock';

    // When in Focus Area mode: show Visibility slider, Again button, and Okay button
    if (this.host.mode === 'focus-drag') {
      const visibilityVal = Math.round(
        this.host.settings.focusAreaVisibility ?? 25,
      );
      this.el.innerHTML = `
        <div class="lotus-dock-surface lotus-focus-area-controls">
          <label class="lotus-focus-vis-control" for="focus-visibility-slider">
            <span class="lotus-focus-vis-label">VISIBILITY</span>
            <input
              type="range"
              id="focus-visibility-slider"
              class="lotus-focus-vis-slider"
              min="0"
              max="100"
              step="1"
              value="${visibilityVal}"
            />
            <span id="focus-visibility-val" class="lotus-tabular lotus-focus-vis-val">${visibilityVal}%</span>
          </label>

          <button type="button" id="focus-area-again-btn" class="lotus-dock-btn">
            AGAIN
          </button>

          <button type="button" id="focus-area-okay-btn" class="lotus-dock-cta">
            OKAY
          </button>
        </div>
      `;

      const visSlider = this.el.querySelector(
        '#focus-visibility-slider',
      ) as HTMLInputElement | null;
      const visValEl = this.el.querySelector(
        '#focus-visibility-val',
      ) as HTMLElement | null;

      visSlider?.addEventListener('input', () => {
        const nextVal = Number(visSlider.value);
        this.host.settings.focusAreaVisibility = nextVal;
        if (visValEl) {
          visValEl.textContent = `${nextVal}%`;
        }
        // Higher VISIBILITY % -> more visibility of surroundings (lower shield strength)
        const shieldStrength = Math.max(0, Math.min(1, 1 - nextVal / 100));
        this.host.shield.setStrength(shieldStrength);
        this.host.callbacks.onSettingsChange(this.host.settings);
      });

      this.el
        .querySelector('#focus-area-again-btn')
        ?.addEventListener('click', () => {
          lotusSound.playKeyTap();
          this.host.redraggingFocusArea = true;
          this.host.updateDragBox2D(false);
          this.host.shield.hide();
          this.host.renderAll();
        });

      this.el
        .querySelector('#focus-area-okay-btn')
        ?.addEventListener('click', () => {
          lotusSound.playKeyTap();
          this.host.redraggingFocusArea = false;
          this.host.updateDragBox2D(false);
          this.host.mode = 'explore';
          this.host.callbacks.onFocusZoneChange(this.host.focusZone);
          this.host.callbacks.onModeChange('explore');
          this.host.renderAll();
        });

      return;
    }

    const clockStr = this.host.timer.clockText();

    this.el.innerHTML = `
      <div class="lotus-dock-surface">
        <button type="button" id="dock-mode-pin" class="lotus-dock-btn is-icon ${this.host.mode === 'pin-add' ? 'is-active' : ''}" aria-label="Add pin" title="Add Pin">
          ${PIN_ICON_SVG}
        </button>

        <button type="button" id="dock-mode-drag" class="lotus-dock-btn is-icon" aria-label="Focus area" title="Focus Area">
          ${FOCUS_AREA_ICON_SVG}
        </button>

        ${this.taskTimerPillHtml()}

        <button type="button" id="dock-timer-toggle" class="lotus-dock-cta">
          <span>FOCUS</span>
          <span id="lotus-dock-clock" class="lotus-tabular">${clockStr}</span>
        </button>
      </div>
    `;

    this.el
      .querySelector('#dock-mode-pin')
      ?.addEventListener('click', () => {
        if (this.host.mode === 'pin-add') {
          this.host.mode = 'explore';
          this.host.updatePinPlacementReticle(false);
          this.host.callbacks.onModeChange('explore');
          this.host.renderAll();
        } else {
          this.host.enterPinAddMode();
        }
      });

    this.el
      .querySelector('#dock-mode-drag')
      ?.addEventListener('click', () => {
        this.host.closeModal('tasks');
        this.host.enterFocusAreaMode();
      });

    this.el
      .querySelector('#dock-task-timer')
      ?.addEventListener('click', () => {
        const task = dockTaskTimer(this.host.tasks);
        if (!task) return;
        this.host.tasks = toggleTaskTimer(this.host.tasks, task.id);
        lotusSound.playKeyTap();
        this.host.callbacks.onSaveTasks(this.host.tasks);
        this.host.renderAll();
      });

    this.el
      .querySelector('#dock-timer-toggle')
      ?.addEventListener('click', () => {
        if (this.host.mode !== 'explore') {
          this.host.mode = 'explore';
          this.host.callbacks.onModeChange('explore');
        }
        this.host.startFocusTimer();
      });
  }

  /**
   * The running or paused task timer as a compact pill: pause it while it
   * runs, resume it after a pause, straight from the main panel. Empty when
   * no task timer is counting down or paused mid-count.
   */
  private taskTimerPillHtml(): string {
    const task = dockTaskTimer(this.host.tasks);
    if (!task) return '';
    const running = Boolean(task.timerRunning);
    const label = `${running ? 'Pause' : 'Resume'} ${task.title.trim() || 'task'}'s timer`;
    // `data-*` is what `updateReadouts` compares against, so the pill carries
    // the task it was rendered for and that task's run state.
    return `
      <button
        type="button"
        id="dock-task-timer"
        class="lotus-dock-task-pill ${running ? 'is-running' : ''}"
        data-task-id="${escapeHtml(task.id)}"
        data-running="${running ? '1' : '0'}"
        title="${escapeHtml(label)}"
        aria-label="${escapeHtml(label)}"
      >
        ${running ? PAUSE_ICON_SVG : PLAY_ICON_SVG}
        <span id="dock-task-timer-clock" class="lotus-tabular">${taskClockText(task)}</span>
      </button>
    `;
  }

  /**
   * Updates the pill's clock in place (every second while a task timer runs).
   * Re-renders when the pill would show a different task or run state: those
   * change the icon and the label, which only a render can redraw.
   */
  public updateReadouts() {
    const pill = this.el.querySelector<HTMLButtonElement>('#dock-task-timer');
    if (!pill) return;
    const task = dockTaskTimer(this.host.tasks);
    if (
      !task ||
      pill.dataset.taskId !== task.id ||
      pill.dataset.running !== (task.timerRunning ? '1' : '0')
    ) {
      // The pill's task is gone or changed; a re-render rebuilds the pill.
      this.render();
      return;
    }
    const clockEl = this.el.querySelector('#dock-task-timer-clock');
    if (clockEl) clockEl.textContent = taskClockText(task);
  }
}
