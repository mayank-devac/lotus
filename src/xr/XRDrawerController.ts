import * as THREE from 'three';
import {lotusSound} from '../sound';
import {
  TASK_TIMER_PRESETS_MIN,
  TaskDraft,
  createTask,
  pinContentFromTask,
  taskClockText,
  toggleTaskDone,
  toggleTaskTimer,
} from '../tasks';
import {PinSortBy} from '../types';
import {ConfirmGuard} from './ConfirmGuard';
import {ImmersiveHost, PinContent} from './ImmersiveHost';
import {XRDrawerAction, XRDrawerData, XRTaskFilter} from './XRInterfaceTypes';
import {XRInterface} from './XRInterface';
import {XRPinCardController} from './XRPinCardController';
import {XRTextEntry} from './XRTextEntry';
import {XRTextRequest} from './XRTextEditor';
import {XR_SETTINGS, findXRSetting} from './xrSettings';

type TaskTextField = 'title' | 'dueLabel' | 'note';
/** The task being created (taskId null) or edited in the drawer. */
interface TaskFormState extends TaskDraft {
  taskId: string | null;
}

/** A drawer action without its arguments: what comes before the first ':'. */
type DrawerActionName = XRDrawerAction extends infer A
  ? A extends `${infer N}:${string}`
    ? N
    : A
  : never;
/** The drawer actions `runTaskAction` handles; the others are handled in `runDrawerAction`. */
type TaskActionName = Exclude<
  DrawerActionName,
  'move-drawer' | 'page-prev' | 'page-next' | 'pin' | 'pin-sort' | 'setting'
>;

const TASK_FILTERS: XRTaskFilter[] = ['all', 'ongoing', 'completed'];
const TASK_TEXT_FIELDS: Record<TaskTextField, Omit<XRTextRequest, 'initial'>> = {
  title: {label: 'Task title', maxLength: 120},
  dueLabel: {label: 'Due (optional), e.g. Today 5 PM', maxLength: 40},
  note: {label: 'Task note (optional)', maxLength: 200},
};

const _pinPos = new THREE.Vector3();

/**
 * The drawer's logic in a headset: the task list, one open task, the new /
 * edit task form, the pin list and settings. Builds what XRDrawer draws and
 * runs its buttons.
 */
export class XRDrawerController {
  private taskFilter: XRTaskFilter = 'all';
  private openTaskId: string | null = null;
  private taskForm: TaskFormState | null = null;
  private pinSort: PinSortBy = 'proximity';
  /** Where the user is; the pin list is sorted by distance from here. */
  private readonly viewer = new THREE.Vector3();
  /** Handed to the drawer every frame; one function, so that allocates nothing. */
  public readonly getData = () => this.data();

  constructor(
    private readonly host: ImmersiveHost,
    private readonly ui: XRInterface,
    private readonly text: XRTextEntry,
    private readonly confirm: ConfirmGuard,
    private readonly card: XRPinCardController,
    /** Switches to pin placement for a task's pin. */
    private readonly placePinForTask: (content: PinContent) => void,
  ) {}

  /** Forgets the open task and the task form (session start / end). */
  public reset() {
    this.openTaskId = null;
    this.taskForm = null;
  }

  public setViewerPosition(position: THREE.Vector3) {
    this.viewer.copy(position);
  }
  public runAction(action: XRDrawerAction) {
    if (action !== 'task-delete') this.confirm.clear();
    const [first, id, direction] = action.split(':');
    // Safe: `action` is an XRDrawerAction, and DrawerActionName is by
    // definition what those have before their first ':'.
    const name = first as DrawerActionName;
    switch (name) {
      case 'move-drawer':
        return; // A drag, handled in selectStart.
      case 'page-prev':
        this.ui.turnDrawerPage(-1);
        return;
      case 'page-next':
        this.ui.turnDrawerPage(1);
        return;
      case 'pin':
        this.card.open(id);
        return;
      case 'pin-sort':
        this.pinSort = this.pinSort === 'proximity' ? 'date' : 'proximity';
        return;
      case 'setting':
        this.changeSetting(id, direction === 'prev' ? -1 : 1);
        return;
      default:
        // `name` is narrowed to what is left: a case removed above, or a new
        // drawer action handled nowhere, fails to compile here or below.
        this.runTaskAction(name, id);
    }
  }

  private runTaskAction(name: TaskActionName, taskId: string | undefined) {
    const tasks = this.host.getTasks();
    const openTask = tasks.find((t) => t.id === this.openTaskId);
    switch (name) {
      // Task list
      case 'task-toggle':
        if (taskId) this.toggleTaskDone(taskId);
        return;
      case 'task-open':
        this.openTaskId = taskId ?? null;
        return;
      case 'task-new':
        this.taskForm = {
          taskId: null,
          title: '',
          note: '',
          dueLabel: '',
          type: 'task',
          timerMinutes: 25,
        };
        this.editTaskText('title');
        return;
      case 'task-filter':
        this.taskFilter =
          TASK_FILTERS[(TASK_FILTERS.indexOf(this.taskFilter) + 1) % TASK_FILTERS.length];
        return;
      case 'task-clear-done': {
        const kept = tasks.filter((t) => !t.completed);
        if (kept.length === tasks.length) {
          this.ui.flashStatus('No done tasks to clear');
          return;
        }
        this.host.commitTasks(kept);
        this.ui.flashStatus('Done tasks cleared');
        return;
      }

      // One open task
      case 'task-back':
        this.openTaskId = null;
        return;
      case 'task-done':
        if (openTask) this.toggleTaskDone(openTask.id);
        return;
      case 'task-timer':
        if (!openTask) return;
        if (openTask.completed) {
          this.ui.flashStatus('Mark the task as not done to run its timer');
          return;
        }
        this.host.commitTasks(toggleTaskTimer(tasks, openTask.id));
        return;
      case 'task-pin':
        if (!openTask) return;
        this.placePinForTask(pinContentFromTask(openTask));
        return;
      case 'task-edit':
        if (!openTask) return;
        this.taskForm = {
          taskId: openTask.id,
          title: openTask.title,
          note: openTask.note,
          dueLabel: openTask.dueLabel,
          type: openTask.type,
          timerMinutes: Math.max(1, Math.round((openTask.timerSeconds ?? 25 * 60) / 60)),
        };
        return;
      case 'task-delete':
        if (!openTask || !this.confirm.confirm(`task:${openTask.id}`)) return;
        this.host.commitTasks(tasks.filter((t) => t.id !== openTask.id));
        this.openTaskId = null;
        this.ui.flashStatus('Task deleted');
        return;

      // New / edit task form
      case 'form-title':
        this.editTaskText('title');
        return;
      case 'form-due':
        this.editTaskText('dueLabel');
        return;
      case 'form-note':
        this.editTaskText('note');
        return;
      case 'form-type':
        if (this.taskForm) {
          this.taskForm.type = this.taskForm.type === 'task' ? 'reminder' : 'task';
        }
        return;
      case 'form-timer-down':
      case 'form-timer-up':
        if (this.taskForm) {
          this.taskForm.timerMinutes = this.nextTimerPreset(
            this.taskForm.timerMinutes,
            name === 'form-timer-up' ? 1 : -1,
          );
        }
        return;
      case 'form-cancel':
        this.taskForm = null;
        return;
      case 'form-save':
        this.text.commit();
        this.saveTaskForm();
        return;
      default:
        // Does not compile when a drawer action is handled nowhere.
        name satisfies never;
    }
  }

  private toggleTaskDone(taskId: string) {
    const tasks = toggleTaskDone(this.host.getTasks(), taskId);
    this.host.commitTasks(tasks);
    lotusSound.playTaskTick(Boolean(tasks.find((t) => t.id === taskId)?.completed));
  }

  /** The timer preset one step from `minutes`, staying within the presets. */
  private nextTimerPreset(minutes: number, direction: 1 | -1): number {
    const presets = TASK_TIMER_PRESETS_MIN;
    const next =
      direction === 1
        ? presets.find((m) => m > minutes)
        : [...presets].reverse().find((m) => m < minutes);
    return next ?? minutes;
  }

  private saveTaskForm() {
    const form = this.taskForm;
    if (!form) return;
    if (!form.title.trim()) {
      this.ui.flashStatus('Add a title first');
      return;
    }
    const tasks = this.host.getTasks();
    if (form.taskId === null) {
      this.host.commitTasks([createTask(form), ...tasks]);
      this.ui.flashStatus(form.type === 'reminder' ? 'Reminder added' : 'Task added');
    } else {
      const timerSeconds = form.timerMinutes * 60;
      this.host.commitTasks(
        tasks.map((t) =>
          t.id === form.taskId
            ? {
                ...t,
                title: form.title.trim(),
                note: form.note.trim(),
                dueLabel: form.dueLabel.trim() || (form.type === 'reminder' ? 'Reminder' : ''),
                type: form.type,
                // A new length restarts the timer; otherwise it keeps its place.
                ...(timerSeconds === t.timerSeconds
                  ? {}
                  : {timerSeconds, remainingSeconds: timerSeconds, timerRunning: false}),
              }
            : t,
        ),
      );
    }
    this.taskForm = null;
    lotusSound.playPinCreated();
  }

  private changeSetting(id: string, direction: 1 | -1) {
    const def = findXRSetting(id);
    if (!def) return;
    const ui = this.host.ui;
    const timerSetting = def.id === 'timer-mode' || def.id === 'focus-length';
    if (timerSetting && ui.getIsTimerRunning()) {
      // Changing the clock under a running timer would make it jump.
      this.ui.flashStatus('Stop the focus timer to change this');
      return;
    }
    const patch = def.step(ui.getSettings(), direction);
    ui.applySettings(patch);
    if (patch.defaultPinStyle) {
      // As on the 2D screen, the pin shape applies to every pin.
      const style = patch.defaultPinStyle;
      this.host.commitPins(this.host.getPins().map((p) => ({...p, shapeStyle: style})));
      const cardPin = this.card.findPin(this.ui.getCardPinId());
      if (cardPin) this.ui.refreshCard(cardPin);
    }
  }

  private data(): XRDrawerData {
    const data: XRDrawerData = {
      tasks: [],
      taskFilter: this.taskFilter,
      hasCompletedTasks: false,
      openTask: null,
      taskForm: null,
      pins: [],
      pinSort: this.pinSort,
      settings: [],
    };
    switch (this.ui.getDrawerTab()) {
      case 'tasks':
        this.fillTaskData(data);
        break;
      case 'pins':
        this.fillPinData(data);
        break;
      case 'settings': {
        const s = this.host.ui.getSettings();
        data.settings = XR_SETTINGS.map((def) => ({
          id: def.id,
          name: def.name,
          kind: def.kind,
          hint: def.hint,
          value: def.value(s),
          swatch: def.swatch?.(s),
        }));
        break;
      }
    }
    return data;
  }

  private fillTaskData(data: XRDrawerData) {
    const tasks = this.host.getTasks();
    if (this.taskForm) {
      const {taskId, ...draft} = this.taskForm;
      data.taskForm = {editing: taskId !== null, ...draft};
      return;
    }
    const open = tasks.find((t) => t.id === this.openTaskId);
    if (open) {
      data.openTask = {
        task: open,
        clock: taskClockText(open),
        deleteArmed: this.confirm.isArmed(`task:${open.id}`),
      };
      return;
    }
    this.openTaskId = null;
    data.hasCompletedTasks = tasks.some((t) => t.completed);
    data.tasks = tasks
      .filter(
        (t) =>
          this.taskFilter === 'all' ||
          (this.taskFilter === 'completed') === t.completed,
      )
      // To-do first; the sort is stable, so each group keeps its order.
      .sort((a, b) => Number(a.completed) - Number(b.completed))
      .map((task) => ({task, clock: taskClockText(task)}));
  }

  private fillPinData(data: XRDrawerData) {
    const {pinManager} = this.host;
    for (const pin of this.host.getPins()) {
      const distance = pinManager.getPinWorldPosition(pin.id, _pinPos)
        ? _pinPos.distanceTo(this.viewer)
        : Infinity;
      data.pins.push({pin, distance});
    }
    data.pins.sort(
      this.pinSort === 'proximity'
        ? (a, b) => a.distance - b.distance
        : (a, b) => b.pin.createdAt - a.pin.createdAt,
    );
  }

  /** Opens the keyboard for one field of the task form. */
  private editTaskText(field: TaskTextField) {
    const form = this.taskForm;
    if (!form) return;
    this.text.request(
      {...TASK_TEXT_FIELDS[field], initial: form[field]},
      (text) => {
        if (this.taskForm === form) form[field] = text;
      },
      () =>
        this.taskForm === form &&
        this.ui.getDrawerTab() === 'tasks' &&
        !this.ui.isHudHidden(),
    );
  }
}
