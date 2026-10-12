import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readState, call } from '../src/widget/api.js';
import { load, update, dataDir, dataFile } from '../src/core/store.js';
import { addTask, setStepDone } from '../src/core/model.js';
import { useTempHome } from './helpers/tmp-home.js';

const ISO = new Date().toISOString();
const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();

test('readState with no data file is an empty, healthy state', (t) => {
  useTempHome(t);
  const state = readState();
  assert.equal(state.status, 'ok');
  assert.deepEqual([state.tasks, state.archive, state.suggestions], [[], [], []]);
});

test('readState returns open tasks sorted, with progress, urgency and step details', (t) => {
  useTempHome(t);
  update((data) => {
    addTask(data, { name: 'later', due: '2999-01-01', steps: ['x'] }, ISO);
    const soon = addTask(data, { name: 'sooner', due: '2998-01-01', steps: ['s1', 's2'] }, ISO);
    setStepDone(data, soon.id, 1, true, 'claude', ISO);
  });
  const state = readState();
  assert.deepEqual(state.tasks.map((task) => task.name), ['sooner', 'later']);
  const [first] = state.tasks;
  assert.deepEqual([first.progress, first.state, first.completedAt], [50, 'normal', null]);
  assert.deepEqual(first.steps[0], { id: 1, name: 's1', done: true, updatedBy: 'claude', updatedAt: ISO });
});

test('finished tasks are in the archive, not the task list, and only for a week', (t) => {
  useTempHome(t);
  update((data) => {
    addTask(data, { name: 'open', steps: ['a'] }, ISO);
    for (const [name, when] of [['yesterday', daysAgo(1)], ['today', daysAgo(0)], ['last month', daysAgo(30)]]) {
      const task = addTask(data, { name, steps: ['a'] }, ISO);
      setStepDone(data, task.id, 1, true, 'user', when);
    }
  });
  const state = readState();
  assert.deepEqual(state.tasks.map((task) => task.name), ['open']);
  assert.deepEqual(state.archive.map((task) => task.name), ['today', 'yesterday']);
  assert.equal(state.archive[0].state, 'done');
  assert.ok(state.archive[0].completedAt);
  assert.equal(load().tasks.length, 4, 'older finished tasks stay in the file');
});

test('readState reports a corrupt data file instead of an empty list', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(), '{not json');
  const state = readState();
  assert.equal(state.status, 'error');
  assert.equal(state.file, dataFile());
  assert.ok(state.message.length > 0);
  assert.equal(state.tasks, undefined);
});

test('call runs each widget action against the store and returns the new state', (t) => {
  useTempHome(t);
  assert.equal(call('addTask', { name: '写论文', due: '2026-10-20', steps: ['收集文献'] }).ok, true);
  call('addStep', { taskId: 1, name: '写初稿' });
  call('renameStep', { taskId: 1, stepId: 2, name: '写第一稿' });
  call('editTask', { taskId: 1, name: '写论文第二章', due: null });
  const result = call('setStepDone', { taskId: 1, stepId: 1, done: true });
  assert.equal(result.ok, true);
  assert.equal(result.state.tasks[0].progress, 50);
  const [task] = load().tasks;
  assert.deepEqual([task.name, task.due], ['写论文第二章', null]);
  assert.deepEqual(task.steps.map((step) => [step.name, step.done, step.updatedBy]), [['收集文献', true, 'user'], ['写第一稿', false, null]]);
  call('setStepDone', { taskId: 1, stepId: 1, done: false });
  assert.equal(load().tasks[0].steps[0].done, false);
  call('removeStep', { taskId: 1, stepId: 2 });
  assert.equal(load().tasks[0].steps.length, 1);
  call('removeTask', { taskId: 1 });
  assert.equal(load().tasks.length, 0);
});

test('adding a task needs a first step', (t) => {
  useTempHome(t);
  const result = call('addTask', { name: 'no steps' });
  assert.equal(result.ok, false);
  assert.match(result.error, /at least one step/i);
});

test('ticking the last step moves the task to the archive; unticking brings it back', (t) => {
  useTempHome(t);
  call('addTask', { name: 't', steps: ['only'] });
  const done = call('setStepDone', { taskId: 1, stepId: 1, done: true });
  assert.deepEqual([done.state.tasks.length, done.state.archive.map((task) => task.name)], [0, ['t']]);
  const back = call('setStepDone', { taskId: 1, stepId: 1, done: false });
  assert.deepEqual([back.state.tasks.map((task) => task.name), back.state.archive.length], [['t'], 0]);
});

test('a rejected action returns the reason and the unchanged state', (t) => {
  useTempHome(t);
  call('addTask', { name: 'a', steps: ['s'] });
  const result = call('setStepDone', { taskId: 1, stepId: 9, done: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /step 9 does not exist/i);
  assert.equal(result.state.tasks.length, 1);
});

test('call rejects methods that are not widget actions, and tolerates a missing payload', (t) => {
  useTempHome(t);
  for (const method of ['constructor', 'toString', 'load', '__proto__', 'setStepProgress', undefined]) {
    assert.equal(call(method, {}).ok, false, String(method));
  }
  assert.equal(call('addTask').ok, false);
});

test('actions fail and change nothing while the data file is corrupt', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(), '{not json');
  const result = call('addTask', { name: 'a', steps: ['s'] });
  assert.equal(result.ok, false);
  assert.equal(result.state.status, 'error');
  assert.equal(fs.readFileSync(dataFile(), 'utf8'), '{not json');
});
