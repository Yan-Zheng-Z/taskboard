// Everything the widget window is allowed to ask for. No Electron imports here,
// so this is tested with plain Node.

import {
  addTask, editTask, removeTask, addStep, renameStep, removeStep, setStepProgress, setTaskProgress,
} from '../core/model.js';
import { load, update, dataFile } from '../core/store.js';
import { describeTask, sortTasks } from '../core/view.js';

const AUTHOR = 'user';

function toView(task, now) {
  return {
    id: task.id,
    name: task.name,
    due: task.due,
    updatedBy: task.updatedBy,
    updatedAt: task.updatedAt,
    ...describeTask(task, now),
    steps: task.steps.map(({ id, name, percent, updatedBy, updatedAt }) => ({ id, name, percent, updatedBy, updatedAt })),
  };
}

export function readState(now = Date.now()) {
  try {
    const { tasks } = load();
    return { status: 'ok', file: dataFile(), tasks: sortTasks(tasks, now).map((task) => toView(task, now)) };
  } catch (error) {
    return { status: 'error', file: dataFile(), message: error.message };
  }
}

const stamp = () => new Date().toISOString();

const actions = new Map(Object.entries({
  addTask: (data, p) => addTask(data, { name: p.name, due: p.due }, stamp()),
  editTask: (data, p) => {
    const changes = {};
    if ('name' in p) changes.name = p.name;
    if ('due' in p) changes.due = p.due;
    return editTask(data, p.taskId, changes);
  },
  removeTask: (data, p) => removeTask(data, p.taskId),
  addStep: (data, p) => addStep(data, p.taskId, p.name),
  renameStep: (data, p) => renameStep(data, p.taskId, p.stepId, p.name),
  removeStep: (data, p) => removeStep(data, p.taskId, p.stepId),
  setStepProgress: (data, p) => setStepProgress(data, p.taskId, p.stepId, p.percent, AUTHOR, stamp()),
  setTaskProgress: (data, p) => setTaskProgress(data, p.taskId, p.percent, AUTHOR, stamp()),
}));

// Runs one named action. Always returns the current state so the window can redraw.
export function call(method, payload) {
  const action = actions.get(method);
  if (!action) return { ok: false, error: `unknown action "${method}"`, state: readState() };
  try {
    update((data) => action(data, payload ?? {}));
    return { ok: true, state: readState() };
  } catch (error) {
    return { ok: false, error: error.message, state: readState() };
  }
}
