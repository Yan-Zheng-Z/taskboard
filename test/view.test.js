import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTask, activeTasks, recentArchive, ARCHIVE_DAYS } from '../src/core/view.js';
import { emptyData, addTask, setStepDone } from '../src/core/model.js';

// Local time: Monday 12 October 2026, 10:00.
const NOW = new Date(2026, 9, 12, 10, 0).getTime();
const ISO = new Date(NOW).toISOString();
const daysAgo = (days) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

function make(data, name, due, { doneAt } = {}) {
  const task = addTask(data, { name, due, steps: ['a', 'b'] }, ISO);
  if (doneAt) {
    setStepDone(data, task.id, 1, true, 'user', doneAt);
    setStepDone(data, task.id, 2, true, 'user', doneAt);
  }
  return task;
}

const one = (due, options) => make(emptyData(), 't', due, options);

test('a task without a due date has state "none"', () => {
  assert.deepEqual(describeTask(one(null), NOW), { progress: 0, state: 'none', days: null });
});

test('a date-only due date lasts until the end of that day', () => {
  assert.deepEqual(describeTask(one('2026-10-12'), NOW), { progress: 0, state: 'soon', days: 0 });
});

test('a due date before today is overdue, with the number of days', () => {
  assert.deepEqual(describeTask(one('2026-10-09'), NOW), { progress: 0, state: 'overdue', days: -3 });
});

test('a due time earlier today is overdue with zero days; later today is soon', () => {
  assert.deepEqual(describeTask(one('2026-10-12 09:00'), NOW), { progress: 0, state: 'overdue', days: 0 });
  assert.equal(describeTask(one('2026-10-12 18:00'), NOW).state, 'soon');
});

test('due within three days is soon, beyond that is normal', () => {
  assert.deepEqual(describeTask(one('2026-10-15'), NOW), { progress: 0, state: 'soon', days: 3 });
  assert.deepEqual(describeTask(one('2026-10-16'), NOW), { progress: 0, state: 'normal', days: 4 });
});

test('a finished task is "done" even when its due date has passed', () => {
  assert.deepEqual(describeTask(one('2026-10-01', { doneAt: ISO }), NOW), { progress: 100, state: 'done', days: -11 });
});

test('progress comes from the finished steps', () => {
  const data = emptyData();
  const task = make(data, 't', null);
  setStepDone(data, task.id, 1, true, 'user', ISO);
  assert.equal(describeTask(task, NOW).progress, 50);
});

test('activeTasks lists unfinished tasks by nearest due date, then those without one', () => {
  const data = emptyData();
  make(data, 'next week', '2026-10-19');
  make(data, 'no due', null);
  make(data, 'finished', '2026-10-01', { doneAt: ISO });
  make(data, 'tomorrow', '2026-10-13');
  make(data, 'overdue', '2026-10-10');
  assert.deepEqual(activeTasks(data.tasks).map((task) => task.name), ['overdue', 'tomorrow', 'next week', 'no due']);
  assert.deepEqual(data.tasks.map((task) => task.name), ['next week', 'no due', 'finished', 'tomorrow', 'overdue']);
});

test('recentArchive lists tasks finished in the last week, most recent first', () => {
  const data = emptyData();
  make(data, 'unfinished', null);
  make(data, 'three days ago', null, { doneAt: daysAgo(3) });
  make(data, 'today', null, { doneAt: daysAgo(0) });
  make(data, 'just inside', null, { doneAt: daysAgo(ARCHIVE_DAYS - 0.01) });
  make(data, 'just outside', null, { doneAt: daysAgo(ARCHIVE_DAYS + 0.01) });
  make(data, 'long ago', null, { doneAt: daysAgo(40) });
  assert.equal(ARCHIVE_DAYS, 7);
  assert.deepEqual(recentArchive(data.tasks, NOW).map((task) => task.name), ['today', 'three days ago', 'just inside']);
});
