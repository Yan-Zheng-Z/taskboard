// Pure data model: every function takes the data object and mutates it in place.
// Nothing here touches the file system.

export class TaskError extends Error {}

export function emptyData() {
  return { version: 1, nextTaskId: 1, tasks: [] };
}

function cleanName(name, what) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TaskError(`${what} name must not be empty`);
  }
  return name.trim();
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
  }
  throw new TaskError(`invalid due date "${due}": use YYYY-MM-DD or "YYYY-MM-DD HH:mm"`);
}

function checkPercent(percent) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new TaskError(`progress must be an integer from 0 to 100, got "${percent}"`);
  }
}

function cleanAuthor(by) {
  if (typeof by !== 'string' || by.trim() === '') {
    throw new TaskError('author (--by) must not be empty');
  }
  return by.trim();
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

export function addTask(data, { name, due }, now) {
  const task = {
    id: data.nextTaskId,
    name: cleanName(name, 'task'),
    due: parseDue(due),
    createdAt: now,
    percent: 0,
    updatedBy: null,
    updatedAt: null,
    nextStepId: 1,
    steps: [],
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

export function addStep(data, taskId, name) {
  const task = findTask(data, taskId);
  const step = {
    id: task.nextStepId,
    name: cleanName(name, 'step'),
    percent: 0,
    updatedBy: null,
    updatedAt: null,
  };
  task.nextStepId += 1;
  task.steps.push(step);
  return step;
}

export function renameStep(data, taskId, stepId, name) {
  const step = findStep(data, taskId, stepId);
  step.name = cleanName(name, 'step');
  return step;
}

export function removeStep(data, taskId, stepId) {
  const task = findTask(data, taskId);
  const step = findStep(data, taskId, stepId);
  task.steps.splice(task.steps.indexOf(step), 1);
  return step;
}

export function setStepProgress(data, taskId, stepId, percent, by, now) {
  const step = findStep(data, taskId, stepId);
  checkPercent(percent);
  const author = cleanAuthor(by);
  step.percent = percent;
  step.updatedBy = author;
  step.updatedAt = now;
  return step;
}

// Task-level progress only exists for tasks without steps.
export function setTaskProgress(data, taskId, percent, by, now) {
  const task = findTask(data, taskId);
  if (task.steps.length > 0) {
    throw new TaskError(`task ${taskId} has steps; update a step instead`);
  }
  checkPercent(percent);
  const author = cleanAuthor(by);
  task.percent = percent;
  task.updatedBy = author;
  task.updatedAt = now;
  return task;
}

export function taskProgress(task) {
  if (task.steps.length === 0) return task.percent;
  const sum = task.steps.reduce((total, step) => total + step.percent, 0);
  return Math.round(sum / task.steps.length);
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
export function addSuggestion(data, { name, due, steps = [], source, by }, now) {
  const suggestion = {
    id: data.nextSuggestionId ?? 1,
    name: cleanName(name, 'suggestion'),
    due: parseDue(due),
    steps: steps.map(toStep).map((step) => ({ name: cleanName(step.name, 'step'), done: step.done })),
    source: typeof source === 'string' && source.trim() !== '' ? source.trim() : null,
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
  const task = addTask(data, { name: suggestion.name, due: suggestion.due }, now);
  for (const step of suggestion.steps) {
    const created = addStep(data, task.id, step.name);
    // Work the suggester reported as finished arrives finished, signed by them.
    if (step.done) setStepProgress(data, task.id, created.id, 100, suggestion.by, now);
  }
  return task;
}

// Remembers the name so the same suggestion is not offered again.
export function dismissSuggestion(data, suggestionId) {
  const suggestion = takeSuggestion(data, suggestionId);
  data.dismissed = [...(data.dismissed ?? []), sameName(suggestion.name)].slice(-DISMISSED_LIMIT);
  return suggestion;
}
