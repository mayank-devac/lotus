import {
  ACCENT,
  CanvasPanel,
  DANGER_TEXT,
  FONT_BODY,
  FONT_MONO,
  TEXT_DIM,
  TEXT_MAIN,
  fitText,
  wrapLines,
} from './XRPanel';
import {drawIcon} from './icons';
import {drawTextField, fillPinColor} from './panelWidgets';
import {
  XRDrawerAction,
  XRDrawerData,
  XRDrawerTab,
  XRSettingRow,
  XRTaskFilter,
  XRTaskForm,
  drawerActionKey,
} from './XRInterfaceTypes';
const TASK_FILTER_TEXT: Record<XRTaskFilter, string> = {
  all: 'All',
  ongoing: 'To do',
  completed: 'Done',
};

// Drawer canvas layout (720 × 680 px).
const DRAWER_ROW_TOP = 104;
const DRAWER_ROW_STEP = 108;
const DRAWER_ROW_H = 96;
const DRAWER_FOOTER_Y = 572;
const DRAWER_FOOTER_H = 84;
const LIST_ROWS_PER_PAGE = 4;
const SETTING_ROWS_PER_PAGE = 5;
/**
 * How often (ms) the open drawer asks for its data when nothing told it to.
 * Clocks and distances change on their own, but only a few times a second:
 * asking every frame filled the headset's garbage collector for nothing.
 */
const DRAWER_REFRESH_MS = 120;

function formatDistance(meters: number): string {
  return meters < 10 ? `${meters.toFixed(1)} m` : `${Math.round(meters)} m`;
}

/**
 * The drawer above the control panel: the task list, one open task, the new /
 * edit task form, the pin list, or settings. Only draws; ImmersiveSession's
 * drawer controller supplies the data and handles the buttons.
 */
export class XRDrawer {
  public readonly panel = new CanvasPanel<XRDrawerAction>(
    0.36,
    0.34,
    720,
    680,
    drawerActionKey,
  );
  private tab: XRDrawerTab | null = null;
  private page = 0;
  private key = '';
  private data: XRDrawerData | null = null;
  /** The drawer's hover and the time when its data was last asked for. */
  private hoverKey = '';
  private refreshedAt = 0;
  public getTab(): XRDrawerTab | null {
    return this.tab;
  }

  public setTab(tab: XRDrawerTab | null) {
    if (this.tab !== tab) this.page = 0;
    this.tab = tab;
    this.panel.setVisible(tab !== null);
    this.key = '';
  }

  public turnPage(step: 1 | -1) {
    this.page = Math.max(0, this.page + step);
    this.key = '';
  }

  /** Makes the next `updateDrawer` ask for fresh data and redraw, e.g. after a press. */
  public invalidate() {
    this.key = '';
  }

  /**
   * Redraws the drawer when what it shows has changed. Called every frame,
   * but `getData` is only called when the drawer was invalidated, its hover
   * changed, or DRAWER_REFRESH_MS passed: building the data and its key
   * allocates, and at frame rate that kept the garbage collector busy.
   */
  public update(getData: () => XRDrawerData) {
    if (!this.tab) return;
    const hover = this.panel.hoverKey();
    const now = performance.now();
    if (
      this.key !== '' &&
      hover === this.hoverKey &&
      now - this.refreshedAt < DRAWER_REFRESH_MS
    ) {
      return;
    }
    this.hoverKey = hover;
    this.refreshedAt = now;
    const data = getData();
    this.data = data;
    const key = `${this.tab}|${this.page}|${hover}|${this.contentKey(data)}`;
    if (key === this.key) return;
    this.key = key;
    this.draw();
  }

  /** Everything the current view draws, as text: the drawer redraws when it changes. */
  private contentKey(data: XRDrawerData): string {
    switch (this.tab) {
      case 'tasks':
        if (data.taskForm) return JSON.stringify(data.taskForm);
        if (data.openTask) return JSON.stringify(data.openTask);
        return JSON.stringify([
          data.taskFilter,
          data.hasCompletedTasks,
          data.tasks.map(({task, clock}) => [
            task.id,
            task.title,
            task.dueLabel,
            task.completed,
            task.timerRunning,
            clock,
          ]),
        ]);
      case 'pins':
        return JSON.stringify([
          data.pinSort,
          data.pins.map(({pin, distance}) => [
            pin.id,
            pin.title,
            pin.surfaceLabel,
            pin.color,
            pin.completed,
            distance.toFixed(1),
          ]),
        ]);
      case 'settings':
        return JSON.stringify(data.settings);
      default:
        return '';
    }
  }

  private draw() {
    const data = this.data;
    const tab = this.tab;
    if (!data || !tab) return;
    const drawer = this.panel;
    drawer.clear();
    drawer.drawBackground();
    drawer.drawButton({kind: 'move-drawer'}, 'Pinch and drag to move this panel', {icon: 'grip'}, 624, 22, 72, 64);
    if (tab === 'settings') {
      this.drawSettings(data.settings);
    } else if (tab === 'pins') {
      this.drawPinList(data);
    } else if (data.taskForm) {
      this.drawTaskForm(data.taskForm);
    } else if (data.openTask) {
      this.drawOpenTask(data.openTask);
    } else {
      this.drawTaskList(data);
    }
    drawer.commit();
  }

  private drawTitle(title: string, x = 36) {
    const {ctx} = this.panel;
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `700 34px ${FONT_BODY}`;
    ctx.fillText(title, x, 64);
  }

  /**
   * Clamps the current page to `rowCount` rows, draws the pager when there is
   * more than one page, and returns the index of the first row to show.
   */
  private drawPager(rowCount: number, rowsPerPage: number): number {
    const drawer = this.panel;
    const {ctx} = drawer;
    const pages = Math.max(1, Math.ceil(rowCount / rowsPerPage));
    this.page = Math.min(this.page, pages - 1);
    if (pages > 1) {
      ctx.fillStyle = TEXT_DIM;
      ctx.font = `500 26px ${FONT_BODY}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${this.page + 1} / ${pages}`, 436, 62);
      ctx.textAlign = 'left';
      drawer.drawButton({kind: 'page', step: -1}, 'Previous page', {icon: 'chevronLeft'}, 456, 22, 72, 64, {
        disabled: this.page === 0,
      });
      drawer.drawButton({kind: 'page', step: 1}, 'Next page', {icon: 'chevronRight'}, 540, 22, 72, 64, {
        disabled: this.page === pages - 1,
      });
    }
    return this.page * rowsPerPage;
  }

  private drawMessage(text: string) {
    const {ctx} = this.panel;
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `500 28px ${FONT_BODY}`;
    wrapLines(ctx, text, 640, 3).forEach((line, i) => ctx.fillText(line, 36, 160 + i * 40));
  }

  private drawTaskList(data: XRDrawerData) {
    const drawer = this.panel;
    this.drawTitle('Tasks');
    const start = this.drawPager(data.tasks.length, LIST_ROWS_PER_PAGE);
    if (data.tasks.length === 0) {
      this.drawMessage(
        data.taskFilter === 'all'
          ? 'No tasks yet. Press "New task" to add one.'
          : `No tasks under "${TASK_FILTER_TEXT[data.taskFilter]}".`,
      );
    }

    data.tasks.slice(start, start + LIST_ROWS_PER_PAGE).forEach(({task, clock}, i) => {
      const y = DRAWER_ROW_TOP + i * DRAWER_ROW_STEP;
      drawer.drawButton(
        {kind: 'task-toggle', taskId: task.id},
        task.completed ? 'Mark as not done' : 'Mark as done',
        {
          paint: (c, x, by, w, h) =>
            drawIcon(c, task.completed ? 'check' : 'box', x + w / 2, by + h / 2, 44,
              task.completed ? ACCENT : TEXT_MAIN),
        },
        28, y, 96, DRAWER_ROW_H,
      );
      drawer.drawButton(
        {kind: 'task-open', taskId: task.id},
        `Open "${task.title}"`,
        {
          paint: (c, x, by, w, h) => {
            const showClock = !task.completed;
            const textWidth = w - (showClock ? 170 : 48);
            c.fillStyle = task.completed ? TEXT_DIM : TEXT_MAIN;
            c.font = `600 30px ${FONT_BODY}`;
            c.fillText(fitText(c, task.title, textWidth), x + 24, by + (task.dueLabel ? 42 : 58));
            if (task.dueLabel) {
              c.fillStyle = TEXT_DIM;
              c.font = `500 24px ${FONT_BODY}`;
              c.fillText(fitText(c, task.dueLabel, textWidth), x + 24, by + 76);
            }
            if (showClock) {
              c.fillStyle = task.timerRunning ? ACCENT : TEXT_DIM;
              c.font = `600 28px ${FONT_MONO}`;
              c.textAlign = 'right';
              c.fillText(clock, x + w - 24, by + h / 2 + 10);
            }
          },
        },
        136, y, 556, DRAWER_ROW_H,
      );
    });

    drawer.drawButton({kind: 'task-new'}, 'Add a task or reminder', {text: '+ New task'},
      28, DRAWER_FOOTER_Y, 236, DRAWER_FOOTER_H, {active: true});
    drawer.drawButton(
      {kind: 'task-filter'},
      'Change which tasks are listed',
      {text: `Show: ${TASK_FILTER_TEXT[data.taskFilter]}`},
      276, DRAWER_FOOTER_Y, 212, DRAWER_FOOTER_H,
    );
    drawer.drawButton({kind: 'task-clear-done'}, 'Remove all done tasks', {text: 'Clear done'},
      500, DRAWER_FOOTER_Y, 192, DRAWER_FOOTER_H, {disabled: !data.hasCompletedTasks});
  }

  private drawOpenTask({task, clock, deleteArmed}: NonNullable<XRDrawerData['openTask']>) {
    const drawer = this.panel;
    const {ctx} = drawer;
    drawer.drawButton({kind: 'task-back'}, 'Back to all tasks', {icon: 'chevronLeft'}, 28, 22, 72, 64);
    this.drawTitle(task.type === 'reminder' ? 'Reminder' : 'Task', 120);

    ctx.fillStyle = task.completed ? TEXT_DIM : TEXT_MAIN;
    ctx.font = `700 38px ${FONT_BODY}`;
    const titleLines = wrapLines(ctx, task.title, 648, 2);
    titleLines.forEach((line, i) => ctx.fillText(line, 36, 150 + i * 48));
    let y = 150 + titleLines.length * 48;

    const facts = [task.completed ? 'Done' : '', task.dueLabel].filter(Boolean).join(' · ');
    if (facts) {
      ctx.fillStyle = TEXT_DIM;
      ctx.font = `500 26px ${FONT_BODY}`;
      ctx.fillText(fitText(ctx, facts, 648), 36, y - 4);
      y += 40;
    }
    if (task.note) {
      ctx.fillStyle = TEXT_MAIN;
      ctx.font = `400 28px ${FONT_BODY}`;
      const noteLines = Math.max(1, Math.floor((440 - y) / 38));
      wrapLines(ctx, task.note, 648, noteLines).forEach((line, i) =>
        ctx.fillText(line, 36, y + i * 38),
      );
    }

    ctx.fillStyle = task.timerRunning ? ACCENT : TEXT_MAIN;
    ctx.font = `700 60px ${FONT_MONO}`;
    ctx.fillText(clock, 36, 532);
    const armed = deleteArmed;
    ctx.fillStyle = armed ? DANGER_TEXT : TEXT_DIM;
    ctx.font = `500 26px ${FONT_BODY}`;
    ctx.fillText(
      armed
        ? 'Press delete again to remove'
        : task.timerRunning ? 'Timer running' : 'Timer paused',
      250, 524,
    );

    const gap = 12;
    const w = (664 - gap * 4) / 5;
    let x = 28;
    const next = () => {
      const at = x;
      x += w + gap;
      return at;
    };
    drawer.drawButton({kind: 'task-done'}, task.completed ? 'Mark as not done' : 'Mark as done',
      {icon: 'check'}, next(), DRAWER_FOOTER_Y, w, DRAWER_FOOTER_H, {active: task.completed});
    drawer.drawButton(
      {kind: 'task-timer'},
      task.timerRunning ? 'Pause this task\'s timer' : 'Start this task\'s timer',
      {icon: task.timerRunning ? 'pause' : 'timer'},
      next(), DRAWER_FOOTER_Y, w, DRAWER_FOOTER_H,
      {active: Boolean(task.timerRunning), disabled: task.completed},
    );
    drawer.drawButton({kind: 'task-pin'}, 'Place a pin for this task', {icon: 'pin'},
      next(), DRAWER_FOOTER_Y, w, DRAWER_FOOTER_H);
    drawer.drawButton({kind: 'task-edit'}, 'Edit this task', {icon: 'edit'},
      next(), DRAWER_FOOTER_Y, w, DRAWER_FOOTER_H);
    drawer.drawButton(
      {kind: 'task-delete'},
      armed ? 'Confirm delete' : 'Delete this task',
      {icon: armed ? 'check' : 'trash'},
      next(), DRAWER_FOOTER_Y, w, DRAWER_FOOTER_H,
      {danger: true, armed},
    );
  }

  private drawTaskForm(form: XRTaskForm) {
    const drawer = this.panel;
    const {ctx} = drawer;
    const noun = form.type === 'reminder' ? 'reminder' : 'task';
    this.drawTitle(form.editing ? `Edit ${noun}` : `New ${noun}`);

    drawTextField(drawer, {kind: 'form-title'}, 'Title', form.title, 'What needs doing?', 28, 104, 664, 92);
    drawTextField(drawer, {kind: 'form-due'}, 'Due', form.dueLabel, 'Optional, e.g. Today 5 PM', 28, 208, 664, 92);
    drawTextField(drawer, {kind: 'form-note'}, 'Note', form.note, 'Optional details', 28, 312, 664, 92);

    const y = 428;
    drawer.drawButton(
      {kind: 'form-type'},
      'Switch between task and reminder',
      {text: form.type === 'reminder' ? 'Reminder' : 'Task'},
      28, y, 232, 92,
    );
    drawer.drawButton({kind: 'form-timer-down'}, 'Shorter timer', {icon: 'minus'}, 284, y, 84, 92);
    ctx.fillStyle = TEXT_MAIN;
    ctx.font = `600 28px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(`${form.timerMinutes} min timer`, 488, y + 56);
    ctx.textAlign = 'left';
    drawer.drawButton({kind: 'form-timer-up'}, 'Longer timer', {icon: 'plus'}, 608, y, 84, 92);

    drawer.drawButton({kind: 'form-cancel'}, 'Cancel', {text: 'Cancel'},
      28, DRAWER_FOOTER_Y, 200, DRAWER_FOOTER_H);
    const ready = form.title.trim().length > 0;
    drawer.drawButton(
      {kind: 'form-save'},
      ready ? (form.editing ? 'Save changes' : `Add this ${noun}`) : 'Add a title first',
      {text: form.editing ? 'Save' : `Add ${noun}`},
      240, DRAWER_FOOTER_Y, 452, DRAWER_FOOTER_H,
      {active: ready, disabled: !ready},
    );
  }

  private drawPinList(data: XRDrawerData) {
    const drawer = this.panel;
    const {ctx} = drawer;
    this.drawTitle('Pins');
    const start = this.drawPager(data.pins.length, LIST_ROWS_PER_PAGE);
    if (data.pins.length === 0) {
      this.drawMessage('No pins yet. Use the pin button to place one.');
    }

    data.pins.slice(start, start + LIST_ROWS_PER_PAGE).forEach(({pin, distance}, i) => {
      drawer.drawButton(
        {kind: 'pin', pinId: pin.id},
        `Open "${pin.title}"`,
        {
          paint: (c, x, by, w, h) => {
            c.beginPath();
            c.arc(x + 46, by + h / 2, 16, 0, Math.PI * 2);
            fillPinColor(c, pin);
            c.fillStyle = pin.completed ? TEXT_DIM : TEXT_MAIN;
            c.font = `600 30px ${FONT_BODY}`;
            c.fillText(fitText(c, pin.title || 'Untitled pin', w - 230), x + 84, by + 42);
            c.fillStyle = TEXT_DIM;
            c.font = `500 24px ${FONT_BODY}`;
            const place = pin.surfaceLabel || 'Room';
            c.fillText(fitText(c, pin.completed ? `Done · ${place}` : place, w - 230), x + 84, by + 76);
            c.font = `600 28px ${FONT_MONO}`;
            c.textAlign = 'right';
            c.fillText(formatDistance(distance), x + w - 28, by + h / 2 + 10);
          },
        },
        28, DRAWER_ROW_TOP + i * DRAWER_ROW_STEP, 664, DRAWER_ROW_H,
      );
    });

    drawer.drawButton(
      {kind: 'pin-sort'},
      'Change the order of the list',
      {text: data.pinSort === 'proximity' ? 'Sort: Nearest first' : 'Sort: Newest first'},
      28, DRAWER_FOOTER_Y, 340, DRAWER_FOOTER_H,
    );
    ctx.fillStyle = TEXT_DIM;
    ctx.font = `500 26px ${FONT_BODY}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${data.pins.length} ${data.pins.length === 1 ? 'pin' : 'pins'}`, 684, DRAWER_FOOTER_Y + 52);
    ctx.textAlign = 'left';
  }

  private drawSettings(rows: XRSettingRow[]) {
    const drawer = this.panel;
    const {ctx} = drawer;
    this.drawTitle('Settings');
    const start = this.drawPager(rows.length, SETTING_ROWS_PER_PAGE);

    rows.slice(start, start + SETTING_ROWS_PER_PAGE).forEach((row, i) => {
      const y = DRAWER_ROW_TOP + i * DRAWER_ROW_STEP;
      ctx.fillStyle = TEXT_MAIN;
      ctx.font = `600 30px ${FONT_BODY}`;
      ctx.fillText(row.name, 36, y + 58);

      if (row.kind === 'stepper') {
        drawer.drawButton({kind: 'setting', id: row.id, step: -1}, row.hint, {icon: 'minus'}, 340, y, 84, DRAWER_ROW_H);
        ctx.fillStyle = TEXT_MAIN;
        ctx.font = `700 30px ${FONT_MONO}`;
        ctx.textAlign = 'center';
        ctx.fillText(row.value, 516, y + 58);
        ctx.textAlign = 'left';
        drawer.drawButton({kind: 'setting', id: row.id, step: 1}, row.hint, {icon: 'plus'}, 608, y, 84, DRAWER_ROW_H);
        return;
      }
      // The whole value pill is the button; a press moves to the next value.
      drawer.drawButton(
        {kind: 'setting', id: row.id, step: 1},
        row.hint,
        {
          paint: (c, x, by, w, h) => {
            c.font = `600 28px ${FONT_BODY}`;
            c.textBaseline = 'middle';
            c.textAlign = 'center';
            const text = fitText(c, row.value, w - (row.swatch ? 90 : 30));
            const textX = x + w / 2 + (row.swatch ? 22 : 0);
            if (row.swatch) {
              c.beginPath();
              c.arc(textX - c.measureText(text).width / 2 - 30, by + h / 2, 15, 0, Math.PI * 2);
              c.fillStyle = row.swatch;
              c.fill();
              c.lineWidth = 2;
              c.strokeStyle = TEXT_MAIN;
              c.stroke();
            }
            c.fillStyle = TEXT_MAIN;
            c.fillText(text, textX, by + h / 2 + 2);
          },
        },
        340, y, 352, DRAWER_ROW_H,
      );
    });
  }
}
