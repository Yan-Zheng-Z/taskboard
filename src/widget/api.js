// Everything the widget window is allowed to ask for. No Electron imports here,
// so this is tested with plain Node.

import {
  addTask, editTask, removeTask, addStep, renameStep, removeStep, setStepProgress, setTaskProgress,
  pendingSuggestions, acceptSuggestion, dismissSuggestion, restoreTask, restoreStep, restoreSuggestion,
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
    const data = load();
    return {
      status: 'ok',
      file: dataFile(),
      tasks: sortTasks(data.tasks, now).map((task) => toView(task, now)),
      suggestions: pendingSuggestions(data),
    };
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
  acceptSuggestion: (data, p) => acceptSuggestion(data, p.suggestionId, stamp()),
  dismissSuggestion: (data, p) => dismissSuggestion(data, p.suggestionId),
}));

// How to reverse the actions that remove something. Each builder runs before its action,
// to note where the thing was, and gets the action's result to build the reversal.
const reversals = new Map(Object.entries({
  removeTask: (data, p) => {
    const index = data.tasks.findIndex((task) => task.id === p.taskId);
    return (removed) => (current) => restoreTask(current, removed, index);
  },
  removeStep: (data, p) => {
    const steps = data.tasks.find((task) => task.id === p.taskId)?.steps ?? [];
    const index = steps.findIndex((step) => step.id === p.stepId);
    return (removed) => (current) => restoreStep(current, p.taskId, removed, index);
  },
  dismissSuggestion: (data, p) => {
    const index = (data.suggestions ?? []).findIndex((suggestion) => suggestion.id === p.suggestionId);
    return (removed) => (current) => restoreSuggestion(current, removed, index, { forget: true });
  },
  acceptSuggestion: (data, p) => {
    const index = (data.suggestions ?? []).findIndex((suggestion) => suggestion.id === p.suggestionId);
    const original = (data.suggestions ?? [])[index];
    return (created) => (current) => {
      removeTask(current, created.id);
      restoreSuggestion(current, original, index);
    };
  },
}));

// The reversal of the most recent action, if it was one that can be undone. Kept only
// for this window's own actions and only until the next one.
let lastReversal = null;

const failure = (message) => ({ ok: false, error: message, undoable: false, state: readState() });

function undo() {
  if (!lastReversal) return failure('nothing to undo');
  const reversal = lastReversal;
  lastReversal = null;
  try {
    update(reversal);
    return { ok: true, undoable: false, state: readState() };
  } catch (error) {
    return failure(error.message);
  }
}

// Runs one named action. Always returns the current state so the window can redraw.
// `undoable` says whether call('undo') would now reverse it.
export function call(method, payload) {
  if (method === 'undo') return undo();
  const action = actions.get(method);
  if (!action) return failure(`unknown action "${method}"`);
  const input = payload ?? {};
  try {
    const reversal = update((data) => {
      const prepare = reversals.get(method)?.(data, input);
      const result = action(data, input);
      return prepare ? prepare(result) : null;
    });
    lastReversal = reversal;
    return { ok: true, undoable: reversal !== null, state: readState() };
  } catch (error) {
    return failure(error.message); // a rejected action leaves the earlier chance to undo in place
  }
}
