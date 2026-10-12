// Pure data model: every function takes the data object and mutates it in place.
// Nothing here touches the file system.
//
// A task is a list of steps, each either done or not. Task progress is the share of
// finished steps. A task whose steps are all done is archived: it has a completedAt time.

export class TaskError extends Error {}

export const DATA_VERSION = 2;

export function emptyData() {
  return { version: DATA_VERSION, nextTaskId: 1, tasks: [] };
}

export const NAME_LIMIT = 200;
const AUTHOR_LIMIT = 50;

const hasControlCharacter = (text) => [...text].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);

// Names and other labels are one line of limited length: they are shown in a small
// window and printed one per line in a terminal.
function singleLine(value, what, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') throw new TaskError(`${what} must not be empty`);
  if (text.length > limit || hasControlCharacter(text)) {
    throw new TaskError(`${what} must be a single line of at most ${limit} characters`);
  }
  return text;
}

function cleanName(name, what) {
  return singleLine(name, `${what} name`, NAME_LIMIT);
}

function cleanAuthor(by) {
  return singleLine(by, 'author (--by)', AUTHOR_LIMIT);
}

function cleanStepNames(steps, what) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new TaskError(`${what} needs at least one step`);
  }
  return steps.map((step) => cleanName(step, 'step'));
}

const DUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/;

// Accepts "YYYY-MM-DD" or "YYYY-MM-DD HH:mm" (local time). Returns the normalized string or null.
export function parseDue(due) {
  if (due === null || due === undefined || due === '') return null;
  const m = typeof due === 'string' ? DUE_RE.exec(due.trim()) : null;
  if (m) {
    const [y, mo, d, h, mi] = m.slice(1).map((v) => (v === undefined ? 0 : Number(v)));
    const date = new Date(y, mo - 1, d, h, mi);
    const real = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d
      && date.getHours() === h && date.getMinutes() === mi;
    if (real) return due.trim();
    // Right format, but no such day or time (for example 30 February, or an hour skipped by a clock change).
    throw new TaskError(`due date "${due}" does not exist: check the day and the time`);
  }
  throw new TaskError(`invalid due date "${due}": use YYYY-MM-DD or "YYYY-MM-DD HH:mm" (24-hour, two digits each)`);
}

export function findTask(data, taskId) {
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task) throw new TaskError(`task ${taskId} does not exist`);
  return task;
}

export function findStep(data, taskId, stepId) {
  const step = findTask(data, taskId).steps.find((s) => s.id === stepId);
  if (!step) throw new TaskError(`step ${stepId} does not exist in task ${taskId}`);
  return step;
}

const newStep = (id, name) => ({ id, name, done: false, updatedBy: null, updatedAt: null });

// Archives the task when every step is done, and un-archives it when one is not.
// The completion time is kept if the task was already archived.
function refreshCompletion(task, now) {
  const complete = task.steps.every((step) => step.done);
  if (!complete) task.completedAt = null;
  else if (!task.completedAt) task.completedAt = now;
}

export function addTask(data, { name, due, steps }, now) {
  const stepNames = cleanStepNames(steps, 'a task');
  const task = {
    id: data.nextTaskId,
    name: cleanName(name, 'task'),
    due: parseDue(due),
    createdAt: now,
    completedAt: null,
    nextStepId: stepNames.length + 1,
    steps: stepNames.map((stepName, index) => newStep(index + 1, stepName)),
  };
  data.nextTaskId += 1;
  data.tasks.push(task);
  return task;
}

// Only the fields present in `changes` are touched; `due: null` clears the due date.
export function editTask(data, taskId, changes) {
  const task = findTask(data, taskId);
  const name = 'name' in changes ? cleanName(changes.name, 'task') : task.name;
  const due = 'due' in changes ? parseDue(changes.due) : task.due;
  task.name = name;
  task.due = due;
  return task;
}

export function removeTask(data, taskId) {
  const task = findTask(data, taskId);
  data.tasks.splice(data.tasks.indexOf(task), 1);
  return task;
}

// A new step is unfinished, so adding one to an archived task brings the task back.
export function addStep(data, taskId, name) {
  const task = findTask(data, taskId);
  const step = newStep(task.nextStepId, cleanName(name, 'step'));
  task.nextStepId += 1;
  task.steps.push(step);
  task.completedAt = null;
  return step;
}

export function renameStep(data, taskId, stepId, name) {
  const step = findStep(data, taskId, stepId);
  step.name = cleanName(name, 'step');
  return step;
}

export function removeStep(data, taskId, stepId, now) {
  const task = findTask(data, taskId);
  const step = findStep(data, taskId, stepId);
  if (task.steps.length === 1) {
    throw new TaskError(`a task needs at least one step; to cancel task ${taskId}, remove the task itself`);
  }
  task.steps.splice(task.steps.indexOf(step), 1);
  refreshCompletion(task, now);
  return step;
}

// Marks a step finished (done: true) or reopens it (done: false).
export function setStepDone(data, taskId, stepId, done, by, now) {
  const task = findTask(data, taskId);
  const step = findStep(data, taskId, stepId);
  if (typeof done !== 'boolean') throw new TaskError('a step is either done or not done');
  const author = cleanAuthor(by);
  step.done = done;
  step.updatedBy = author;
  step.updatedAt = now;
  refreshCompletion(task, now);
  return step;
}

export function taskProgress(task) {
  const finished = task.steps.filter((step) => step.done).length;
  return Math.round((finished / task.steps.length) * 100);
}

// ---- suggestions ----
// Tasks proposed by an agent wait here until the user accepts or dismisses them.
// The three fields are optional in the data file; files written before they existed have none.

const DISMISSED_LIMIT = 500;

const sameName = (name) => name.trim().toLowerCase();

// A suggested step is { name, done }. Earlier versions stored just the name.
const toStep = (step) => (typeof step === 'string' ? { name: step, done: false } : { name: step?.name, done: step?.done === true });

export function pendingSuggestions(data) {
  return (data.suggestions ?? []).map((suggestion) => ({ ...suggestion, steps: (suggestion.steps ?? []).map(toStep) }));
}

function findSuggestion(data, suggestionId) {
  const suggestion = pendingSuggestions(data).find((s) => s.id === suggestionId);
  if (!suggestion) throw new TaskError(`suggestion ${suggestionId} does not exist`);
  return suggestion;
}

// Returns { saved } or { skipped: 'task' | 'pending' | 'dismissed' } when the name is already known.
export function addSuggestion(data, { name, due, steps, source, by }, now) {
  if (!Array.isArray(steps) || steps.length === 0) throw new TaskError('a suggestion needs at least one step');
  const suggestion = {
    id: data.nextSuggestionId ?? 1,
    name: cleanName(name, 'suggestion'),
    due: parseDue(due),
    steps: steps.map(toStep).map((step) => ({ name: cleanName(step.name, 'step'), done: step.done })),
    source: typeof source === 'string' && source.trim() !== '' ? singleLine(source, 'source', NAME_LIMIT) : null,
    by: cleanAuthor(by),
    createdAt: now,
  };
  const key = sameName(suggestion.name);
  if (data.tasks.some((task) => sameName(task.name) === key)) return { skipped: 'task' };
  if (pendingSuggestions(data).some((s) => sameName(s.name) === key)) return { skipped: 'pending' };
  if ((data.dismissed ?? []).includes(key)) return { skipped: 'dismissed' };
  data.nextSuggestionId = suggestion.id + 1;
  data.suggestions = [...pendingSuggestions(data), suggestion];
  return { saved: suggestion };
}

function takeSuggestion(data, suggestionId) {
  const suggestion = findSuggestion(data, suggestionId);
  data.suggestions = data.suggestions.filter((s) => s.id !== suggestion.id);
  return suggestion;
}

export function acceptSuggestion(data, suggestionId, now) {
  const suggestion = takeSuggestion(data, suggestionId);
  // Suggestions saved before steps were required may have none: the task then is its own single step.
  const steps = suggestion.steps.length > 0 ? suggestion.steps : [{ name: suggestion.name, done: false }];
  const task = addTask(data, { name: suggestion.name, due: suggestion.due, steps: steps.map((step) => step.name) }, now);
  steps.forEach((step, index) => {
    // Work the suggester reported as finished arrives finished, signed by them.
    if (step.done) setStepDone(data, task.id, index + 1, true, suggestion.by, now);
  });
  return task;
}

// Remembers the name so the same suggestion is not offered again.
export function dismissSuggestion(data, suggestionId) {
  const suggestion = takeSuggestion(data, suggestionId);
  data.dismissed = [...(data.dismissed ?? []), sameName(suggestion.name)].slice(-DISMISSED_LIMIT);
  return suggestion;
}

// ---- putting things back (undo) ----
// Each of these reverses one removal and touches nothing else, so an undo never
// overwrites what another writer changed in the meantime.

export function restoreTask(data, task, index) {
  if (data.tasks.some((existing) => existing.id === task.id)) throw new TaskError(`task ${task.id} already exists`);
  data.tasks.splice(Math.min(index, data.tasks.length), 0, task);
  return task;
}

export function restoreStep(data, taskId, step, index, now) {
  const task = findTask(data, taskId);
  if (task.steps.some((existing) => existing.id === step.id)) {
    throw new TaskError(`step ${step.id} already exists in task ${taskId}`);
  }
  task.steps.splice(Math.min(index, task.steps.length), 0, step);
  refreshCompletion(task, now);
  return step;
}

// Puts a step back to an earlier state without signing it again: for undoing the tick that archived a task.
export function restoreStepState(data, taskId, stepId, { done, updatedBy, updatedAt }, now) {
  const task = findTask(data, taskId);
  const step = findStep(data, taskId, stepId);
  Object.assign(step, { done, updatedBy, updatedAt });
  refreshCompletion(task, now);
  return step;
}

// forget: also drop the name from the dismissed list, for undoing a dismissal.
export function restoreSuggestion(data, suggestion, index, { forget = false } = {}) {
  const current = data.suggestions ?? [];
  if (current.some((existing) => existing.id === suggestion.id)) {
    throw new TaskError(`suggestion ${suggestion.id} already exists`);
  }
  data.suggestions = [...current.slice(0, index), suggestion, ...current.slice(index)];
  if (forget) {
    const dismissed = [...(data.dismissed ?? [])];
    const at = dismissed.lastIndexOf(sameName(suggestion.name));
    if (at !== -1) dismissed.splice(at, 1);
    data.dismissed = dismissed;
  }
  return suggestion;
}
