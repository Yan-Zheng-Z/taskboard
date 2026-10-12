import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTask, sortTasks } from '../src/core/view.js';
import { emptyData, addTask, addStep, setStepProgress, setTaskProgress } from '../src/core/model.js';

// Local time: Monday 12 October 2026, 10:00.
const NOW = new Date(2026, 9, 12, 10, 0).getTime();
const ISO = '2026-10-12T02:00:00.000Z';

function make(due, percent = 0) {
  const data = emptyData();
  const task = addTask(data, { name: 't', due }, ISO);
  if (percent) setTaskProgress(data, task.id, percent, 'user', ISO);
  return task;
}

test('a task without a due date has state "none"', () => {
  assert.deepEqual(describeTask(make(null), NOW), { progress: 0, state: 'none', days: null });
});

test('a date-only due date lasts until the end of that day', () => {
  assert.deepEqual(describeTask(make('2026-10-12'), NOW), { progress: 0, state: 'soon', days: 0 });
});

test('a due date before today is overdue, with the number of days', () => {
  assert.deepEqual(describeTask(make('2026-10-09'), NOW), { progress: 0, state: 'overdue', days: -3 });
});

test('a due time earlier today is overdue with zero days', () => {
  assert.deepEqual(describeTask(make('2026-10-12 09:00'), NOW), { progress: 0, state: 'overdue', days: 0 });
});

test('a due time later today is soon', () => {
  assert.equal(describeTask(make('2026-10-12 18:00'), NOW).state, 'soon');
});

test('due within three days is soon, beyond that is normal', () => {
  assert.deepEqual(describeTask(make('2026-10-15'), NOW), { progress: 0, state: 'soon', days: 3 });
  assert.deepEqual(describeTask(make('2026-10-16'), NOW), { progress: 0, state: 'normal', days: 4 });
});

test('a finished task is "done" even when its due date has passed', () => {
  assert.deepEqual(describeTask(make('2026-10-01', 100), NOW), { progress: 100, state: 'done', days: -11 });
});

test('progress comes from the steps when there are any', () => {
  const data = emptyData();
  const task = addTask(data, { name: 't' }, ISO);
  const a = addStep(data, task.id, 'a');
  addStep(data, task.id, 'b');
  setStepProgress(data, task.id, a.id, 100, 'user', ISO);
  assert.equal(describeTask(task, NOW).progress, 50);
});

test('sortTasks puts the nearest due date first, then no due date, then finished tasks', () => {
  const data = emptyData();
  addTask(data, { name: 'next week', due: '2026-10-19' }, ISO);
  addTask(data, { name: 'no due' }, ISO);
  const done = addTask(data, { name: 'done long ago', due: '2026-10-01' }, ISO);
  addTask(data, { name: 'tomorrow', due: '2026-10-13' }, ISO);
  addTask(data, { name: 'overdue', due: '2026-10-10' }, ISO);
  setTaskProgress(data, done.id, 100, 'user', ISO);
  assert.deepEqual(
    sortTasks(data.tasks, NOW).map((task) => task.name),
    ['overdue', 'tomorrow', 'next week', 'no due', 'done long ago'],
  );
});

test('sortTasks does not reorder the stored task list', () => {
  const data = emptyData();
  addTask(data, { name: 'later', due: '2026-10-19' }, ISO);
  addTask(data, { name: 'sooner', due: '2026-10-13' }, ISO);
  sortTasks(data.tasks, NOW);
  assert.deepEqual(data.tasks.map((task) => task.name), ['later', 'sooner']);
});
