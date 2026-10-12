// Checks a parsed data file field by field. The store treats any failure here like
// broken JSON: it refuses to write and tells the user which file and which field.
// Length limits on names are deliberately not checked, so data saved before the
// limits existed still loads.

function fail(message) {
  throw new Error(message);
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) => Number.isInteger(value) && value > 0;
const isPercent = (value) => Number.isInteger(value) && value >= 0 && value <= 100;
const isName = (value) => typeof value === 'string' && value.trim() !== '';
const isTime = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

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

const DUE_RE = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/;

// A stored due date only has to be a real calendar date and clock time. Whether that
// local time exists (clock changes) depends on the time zone, which may have changed
// since the file was written, so that is not checked here.
function checkDue(due, what) {
  if (due === null || due === undefined) return;
  const match = typeof due === 'string' ? DUE_RE.exec(due) : null;
  const [year, month, day, hour = 0, minute = 0] = match ? match.slice(1).filter((part) => part !== undefined).map(Number) : [];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = match !== null && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day && hour <= 23 && minute <= 59;
  if (!real) fail(`${what}: due date "${due}" is not valid`);
}

// What tasks have in common in every version: a name, a due date and a list of identified, named steps.
function checkTaskBasics(task) {
  const what = `task ${task.id}`;
  if (!isName(task.name)) fail(`${what}: name must be non-empty text`);
  checkDue(task.due, what);
  if (!Array.isArray(task.steps)) fail(`${what}: steps must be a list`);
  checkIds(task.steps, task.nextStepId, `${what} step`, `${what}: nextStepId`);
  for (const step of task.steps) {
    if (!isName(step.name)) fail(`${what} step ${step.id}: name must be non-empty text`);
  }
  return what;
}

// Version 1: steps, and tasks without steps, carry a percentage.
function checkTaskV1(task) {
  const what = checkTaskBasics(task);
  if (!isPercent(task.percent)) fail(`${what}: percent must be a whole number from 0 to 100`);
  for (const step of task.steps) {
    if (!isPercent(step.percent)) fail(`${what} step ${step.id}: percent must be a whole number from 0 to 100`);
  }
}

// Version 2: every task has steps, each done or not; a finished task records when.
function checkTaskV2(task) {
  const what = checkTaskBasics(task);
  if (task.steps.length === 0) fail(`${what}: a task needs at least one step`);
  for (const step of task.steps) {
    if (typeof step.done !== 'boolean') fail(`${what} step ${step.id}: done must be true or false`);
  }
  const complete = task.steps.every((step) => step.done);
  if (complete && !isTime(task.completedAt)) fail(`${what}: completedAt must be a time when every step is done`);
  if (!complete && task.completedAt !== null && task.completedAt !== undefined) {
    fail(`${what}: completedAt must be empty while a step is not done`);
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

const TASK_CHECKS = { 1: checkTaskV1, 2: checkTaskV2 };

// Accepts the current version and version 1 (which the store then converts).
export function validateData(data) {
  if (!isObject(data)) fail('the file must contain one object');
  const checkTask = TASK_CHECKS[data.version];
  if (!checkTask) fail(`unsupported version "${data.version}"`);
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
