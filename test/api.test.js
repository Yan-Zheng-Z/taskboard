import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readState, call } from '../src/widget/api.js';
import { load, update, dataDir, dataFile } from '../src/core/store.js';
import { addTask, addStep, setStepProgress } from '../src/core/model.js';
import { useTempHome } from './helpers/tmp-home.js';

const ISO = '2026-10-12T02:00:00.000Z';

test('readState with no data file is an empty, healthy state', (t) => {
  useTempHome(t);
  const state = readState();
  assert.equal(state.status, 'ok');
  assert.deepEqual(state.tasks, []);
});

test('readState returns sorted tasks with progress, urgency and step details', (t) => {
  useTempHome(t);
  update((data) => {
    addTask(data, { name: 'later', due: '2999-01-01' }, ISO);
    const soon = addTask(data, { name: 'sooner', due: '2998-01-01' }, ISO);
    const step = addStep(data, soon.id, 's1');
    addStep(data, soon.id, 's2');
    setStepProgress(data, soon.id, step.id, 100, 'claude', ISO);
  });
  const state = readState();
  assert.deepEqual(state.tasks.map((task) => task.name), ['sooner', 'later']);
  const [first] = state.tasks;
  assert.equal(first.progress, 50);
  assert.equal(first.state, 'normal');
  assert.deepEqual(first.steps[0], { id: 1, name: 's1', percent: 100, updatedBy: 'claude', updatedAt: ISO });
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
  assert.equal(call('addTask', { name: '写论文', due: '2026-10-20' }).ok, true);
  call('addStep', { taskId: 1, name: '收集文献' });
  call('addStep', { taskId: 1, name: '写初稿' });
  call('renameStep', { taskId: 1, stepId: 2, name: '写第一稿' });
  call('editTask', { taskId: 1, name: '写论文第二章', due: null });
  const result = call('setStepProgress', { taskId: 1, stepId: 1, percent: 80 });
  assert.equal(result.ok, true);
  assert.equal(result.state.tasks[0].progress, 40);
  const [task] = load().tasks;
  assert.equal(task.name, '写论文第二章');
  assert.equal(task.due, null);
  assert.deepEqual(task.steps.map((step) => step.name), ['收集文献', '写第一稿']);
  call('removeStep', { taskId: 1, stepId: 2 });
  assert.equal(load().tasks[0].steps.length, 1);
  call('removeTask', { taskId: 1 });
  assert.equal(load().tasks.length, 0);
});

test('progress changed through the widget is signed "user"', (t) => {
  useTempHome(t);
  call('addTask', { name: 'a' });
  call('addStep', { taskId: 1, name: 's' });
  call('setStepProgress', { taskId: 1, stepId: 1, percent: 80 });
  assert.equal(load().tasks[0].steps[0].updatedBy, 'user');
  call('addTask', { name: 'no steps' });
  call('setTaskProgress', { taskId: 2, percent: 30 });
  assert.equal(load().tasks[1].updatedBy, 'user');
});

test('a rejected action returns the reason and the unchanged state', (t) => {
  useTempHome(t);
  call('addTask', { name: 'a' });
  const result = call('setStepProgress', { taskId: 1, stepId: 9, percent: 50 });
  assert.equal(result.ok, false);
  assert.match(result.error, /step 9 does not exist/i);
  assert.equal(result.state.tasks.length, 1);
});

test('call rejects methods that are not widget actions', (t) => {
  useTempHome(t);
  for (const method of ['constructor', 'toString', 'load', '__proto__', undefined]) {
    assert.equal(call(method, {}).ok, false, String(method));
  }
});

test('call tolerates a missing payload', (t) => {
  useTempHome(t);
  assert.equal(call('addTask').ok, false);
});

test('actions fail and change nothing while the data file is corrupt', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(), '{not json');
  const result = call('addTask', { name: 'a' });
  assert.equal(result.ok, false);
  assert.equal(result.state.status, 'error');
  assert.equal(fs.readFileSync(dataFile(), 'utf8'), '{not json');
});
