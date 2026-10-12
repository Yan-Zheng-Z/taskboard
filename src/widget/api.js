// Everything the widget window is allowed to ask for. No Electron imports here,
// so this is tested with plain Node.

import {
  addTask, editTask, removeTask, addStep, renameStep, removeStep, setStepDone,
  pendingSuggestions, acceptSuggestion, dismissSuggestion,
  restoreTask, restoreStep, restoreStepState, restoreSuggestion,
} from '../core/model.js';
import { load, update, dataFile } from '../core/store.js';
import { describeTask, activeTasks, recentArchive } from '../core/view.js';

const AUTHOR = 'user';

function toView(task, now) {
  return {
    id: task.id,
    name: task.name,
    due: task.due,
    completedAt: task.completedAt ?? null,
    ...describeTask(task, now),
    steps: task.steps.map(({ id, name, done, updatedBy, updatedAt }) => ({ id, name, done, updatedBy, updatedAt })),
  };
}

// tasks: the open ones, most urgent first. archive: finished in the last week, latest first.
export function readState(now = Date.now()) {
  try {
    const data = load();
    return {
      status: 'ok',
      file: dataFile(),
      tasks: activeTasks(data.tasks).map((task) => toView(task, now)),
      archive: recentArchive(data.tasks, now).map((task) => toView(task, now)),
      suggestions: pendingSuggestions(data),
    };
  } catch (error) {
    return { status: 'error', file: dataFile(), message: error.message };
  }
}

const stamp = () => new Date().toISOString();

const actions = new Map(Object.entries({
  addTask: (data, p) => addTask(data, { name: p.name, due: p.due, steps: p.steps }, stamp()),
  editTask: (data, p) => {
    const changes = {};
    if ('name' in p) changes.name = p.name;
    if ('due' in p) changes.due = p.due;
    return editTask(data, p.taskId, changes);
  },
  removeTask: (data, p) => removeTask(data, p.taskId),
  addStep: (data, p) => addStep(data, p.taskId, p.name),
  renameStep: (data, p) => renameStep(data, p.taskId, p.stepId, p.name),
  removeStep: (data, p) => removeStep(data, p.taskId, p.stepId, stamp()),
  setStepDone: (data, p) => setStepDone(data, p.taskId, p.stepId, p.done, AUTHOR, stamp()),
  acceptSuggestion: (data, p) => acceptSuggestion(data, p.suggestionId, stamp()),
  dismissSuggestion: (data, p) => dismissSuggestion(data, p.suggestionId),
}));

const taskOf = (data, taskId) => data.tasks.find((task) => task.id === taskId);

// How to reverse the actions that take something out of the user's sight. Each builder runs
// before its action, to note how things were, and gets the action's result to build the
// reversal. It returns null when there is nothing worth undoing.
const reversals = new Map(Object.entries({
  removeTask: (data, p) => {
    const index = data.tasks.findIndex((task) => task.id === p.taskId);
    return (removed) => (current) => restoreTask(current, removed, index);
  },
  removeStep: (data, p) => {
    const index = (taskOf(data, p.taskId)?.steps ?? []).findIndex((step) => step.id === p.stepId);
    return (removed) => (current) => restoreStep(current, p.taskId, removed, index, stamp());
  },
  // Only the tick that finishes a task is undoable: it sends the task to the archive.
  setStepDone: (data, p) => {
    const task = taskOf(data, p.taskId);
    const step = task?.steps.find((candidate) => candidate.id === p.stepId);
    const before = step && { done: step.done, updatedBy: step.updatedBy, updatedAt: step.updatedAt };
    const wasOpen = task && !task.completedAt;
    return () => {
      if (!(wasOpen && task.completedAt)) return null;
      return (current) => restoreStepState(current, p.taskId, p.stepId, before, stamp());
    };
  },
  dismissSuggestion: (data, p) => {
    const index = (data.suggestions ?? []).findIndex((suggestion) => suggestion.id === p.suggestionId);
    const oldest = data.dismissed?.[0];
    return (removed) => {
      // A full list drops its oldest name to make room; undo has to bring that one back too.
      const pushedOut = oldest !== undefined && !data.dismissed.includes(oldest);
      return (current) => {
        restoreSuggestion(current, removed, index, { forget: true });
        if (pushedOut && !current.dismissed.includes(oldest)) current.dismissed = [oldest, ...current.dismissed];
      };
    };
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
