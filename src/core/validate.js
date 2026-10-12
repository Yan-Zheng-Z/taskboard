// Checks a parsed data file field by field. The store treats any failure here like
// broken JSON: it refuses to write and tells the user which file and which field.
// Length limits on names are deliberately not checked, so data saved before the
// limits existed still loads.

import { parseDue } from './model.js';

function fail(message) {
  throw new Error(message);
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) => Number.isInteger(value) && value > 0;
const isPercent = (value) => Number.isInteger(value) && value >= 0 && value <= 100;
const isName = (value) => typeof value === 'string' && value.trim() !== '';

// Ids must be positive, unique, and below the counter that hands out the next one.
function checkIds(items, nextId, what, counterName) {
  const seen = new Set();
  for (const item of items) {
    if (!isObject(item)) fail(`${what}: not an object`);
    if (!isId(item.id)) fail(`${what}: id must be a positive whole number`);
    if (seen.has(item.id)) fail(`${what} ${item.id}: id is used twice`);
    seen.add(item.id);
  }
  if (items.length > 0 && !(Number.isInteger(nextId) && nextId > Math.max(...seen))) {
    fail(`${counterName} must be greater than every existing ${what} id`);
  }
}

function checkDue(due, what) {
  if (due === null || due === undefined) return;
  try {
    parseDue(due);
  } catch {
    fail(`${what}: due date "${due}" is not valid`);
  }
}

function checkTask(task) {
  const what = `task ${task.id}`;
  if (!isName(task.name)) fail(`${what}: name must be non-empty text`);
  if (!isPercent(task.percent)) fail(`${what}: percent must be a whole number from 0 to 100`);
  checkDue(task.due, what);
  if (!Array.isArray(task.steps)) fail(`${what}: steps must be a list`);
  checkIds(task.steps, task.nextStepId, `${what} step`, `${what}: nextStepId`);
  for (const step of task.steps) {
    if (!isName(step.name)) fail(`${what} step ${step.id}: name must be non-empty text`);
    if (!isPercent(step.percent)) fail(`${what} step ${step.id}: percent must be a whole number from 0 to 100`);
  }
}

function checkSuggestion(suggestion) {
  const what = `suggestion ${suggestion.id}`;
  if (!isName(suggestion.name)) fail(`${what}: name must be non-empty text`);
  checkDue(suggestion.due, what);
  if (!Array.isArray(suggestion.steps ?? [])) fail(`${what}: steps must be a list`);
  for (const step of suggestion.steps ?? []) {
    if (!isName(typeof step === 'string' ? step : step?.name)) fail(`${what}: every step needs a name`);
  }
}

export function validateData(data) {
  if (!isObject(data)) fail('the file must contain one object');
  if (data.version !== 1) fail(`unsupported version "${data.version}"`);
  if (!Number.isInteger(data.nextTaskId)) fail('nextTaskId must be a whole number');
  if (!Array.isArray(data.tasks)) fail('tasks must be a list');
  checkIds(data.tasks, data.nextTaskId, 'task', 'nextTaskId');
  data.tasks.forEach(checkTask);

  if (data.suggestions !== undefined) {
    if (!Array.isArray(data.suggestions)) fail('suggestions must be a list');
    checkIds(data.suggestions, data.nextSuggestionId, 'suggestion', 'nextSuggestionId');
    data.suggestions.forEach(checkSuggestion);
  }
  if (data.dismissed !== undefined
    && !(Array.isArray(data.dismissed) && data.dismissed.every((name) => typeof name === 'string'))) {
    fail('dismissed must be a list of names');
  }
}
