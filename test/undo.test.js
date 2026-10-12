import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyData, addTask, addStep, removeTask, removeStep, setStepProgress, addSuggestion, dismissSuggestion,
  pendingSuggestions, restoreTask, restoreStep, restoreSuggestion, TaskError,
} from '../src/core/model.js';
import { call, readState } from '../src/widget/api.js';
import { load, update } from '../src/core/store.js';
import { useTempHome } from './helpers/tmp-home.js';

const NOW = '2026-10-12T10:00:00.000Z';

// ---- model ----

test('restoreTask puts a removed task back where it was, with its steps and progress', () => {
  const data = emptyData();
  addTask(data, { name: 'first' }, NOW);
  const middle = addTask(data, { name: 'middle' }, NOW);
  addTask(data, { name: 'last' }, NOW);
  const step = addStep(data, middle.id, 's');
  setStepProgress(data, middle.id, step.id, 60, 'claude', NOW);
  const removed = removeTask(data, middle.id);
  restoreTask(data, removed, 1);
  assert.deepEqual(data.tasks.map((t) => t.name), ['first', 'middle', 'last']);
  assert.deepEqual([data.tasks[1].id, data.tasks[1].steps[0].percent, data.tasks[1].steps[0].updatedBy], [middle.id, 60, 'claude']);
});

test('restoreTask goes to the end when the list has become shorter, and refuses a duplicate id', () => {
  const data = emptyData();
  const a = addTask(data, { name: 'a' }, NOW);
  const b = addTask(data, { name: 'b' }, NOW);
  const removed = removeTask(data, b.id);
  removeTask(data, a.id);
  restoreTask(data, removed, 5);
  assert.deepEqual(data.tasks.map((t) => t.name), ['b']);
  assert.throws(() => restoreTask(data, removed, 0), TaskError);
});

test('restoreStep puts a removed step back in place; the task must still exist', () => {
  const data = emptyData();
  const task = addTask(data, { name: 't' }, NOW);
  addStep(data, task.id, 'one');
  const two = addStep(data, task.id, 'two');
  addStep(data, task.id, 'three');
  setStepProgress(data, task.id, two.id, 40, 'user', NOW);
  const removed = removeStep(data, task.id, two.id);
  restoreStep(data, task.id, removed, 1);
  assert.deepEqual(task.steps.map((s) => [s.name, s.percent]), [['one', 0], ['two', 40], ['three', 0]]);
  assert.throws(() => restoreStep(data, task.id, removed, 1), TaskError);
  assert.throws(() => restoreStep(data, 99, removed, 1), /task 99 does not exist/i);
});

test('restoreSuggestion brings a dismissed suggestion back and forgets the dismissal', () => {
  const data = emptyData();
  addSuggestion(data, { name: 'keep', by: 'claude' }, NOW);
  const { saved } = addSuggestion(data, { name: 'Changed My Mind', by: 'claude' }, NOW);
  const dismissed = dismissSuggestion(data, saved.id);
  restoreSuggestion(data, dismissed, 1, { forget: true });
  assert.deepEqual(pendingSuggestions(data).map((s) => s.name), ['keep', 'Changed My Mind']);
  assert.deepEqual(data.dismissed, []);
  dismissSuggestion(data, saved.id);
  assert.deepEqual(addSuggestion(data, { name: 'changed my mind', by: 'claude' }, NOW), { skipped: 'dismissed' });
});

// ---- through the widget interface ----

test('deleting a task can be undone', (t) => {
  useTempHome(t);
  call('addTask', { name: 'first' });
  call('addTask', { name: 'second' });
  call('addStep', { taskId: 1, name: 's' });
  call('setStepProgress', { taskId: 1, stepId: 1, percent: 70 });
  const removed = call('removeTask', { taskId: 1 });
  assert.equal(removed.undoable, true);
  const undone = call('undo');
  assert.equal(undone.ok, true);
  assert.deepEqual(load().tasks.map((task) => [task.id, task.name]), [[1, 'first'], [2, 'second']]);
  assert.equal(load().tasks[0].steps[0].percent, 70);
});

test('deleting a step can be undone', (t) => {
  useTempHome(t);
  call('addTask', { name: 't' });
  call('addStep', { taskId: 1, name: 'one' });
  call('addStep', { taskId: 1, name: 'two' });
  assert.equal(call('removeStep', { taskId: 1, stepId: 1 }).undoable, true);
  call('undo');
  assert.deepEqual(load().tasks[0].steps.map((s) => s.name), ['one', 'two']);
});

test('dismissing a suggestion can be undone, and it is no longer remembered as dismissed', (t) => {
  useTempHome(t);
  update((data) => addSuggestion(data, { name: 'maybe', by: 'claude' }, NOW));
  assert.equal(call('dismissSuggestion', { suggestionId: 1 }).undoable, true);
  const undone = call('undo');
  assert.deepEqual(undone.state.suggestions.map((s) => s.name), ['maybe']);
  assert.deepEqual(load().dismissed, []);
});

test('accepting a suggestion can be undone: the task goes and the suggestion returns', (t) => {
  useTempHome(t);
  update((data) => addSuggestion(data, { name: 'project', steps: [{ name: 'a', done: true }, 'b'], by: 'claude' }, NOW));
  assert.equal(call('acceptSuggestion', { suggestionId: 1 }).undoable, true);
  const undone = call('undo');
  assert.deepEqual(undone.state.tasks, []);
  assert.deepEqual(undone.state.suggestions.map((s) => [s.id, s.name, s.steps.length]), [[1, 'project', 2]]);
});

test('other actions are not undoable', (t) => {
  useTempHome(t);
  assert.equal(call('addTask', { name: 't' }).undoable, false);
  assert.equal(call('addStep', { taskId: 1, name: 's' }).undoable, false);
  assert.equal(call('setStepProgress', { taskId: 1, stepId: 1, percent: 10 }).undoable, false);
});

test('only the most recent action can be undone, and only once', (t) => {
  useTempHome(t);
  call('addTask', { name: 'a' });
  call('addTask', { name: 'b' });
  call('removeTask', { taskId: 1 });
  call('removeTask', { taskId: 2 });
  assert.equal(call('undo').ok, true);
  assert.deepEqual(load().tasks.map((task) => task.name), ['b']);
  const again = call('undo');
  assert.equal(again.ok, false);
  assert.deepEqual(load().tasks.map((task) => task.name), ['b']);
});

test('the chance to undo ends when the user changes something else', (t) => {
  useTempHome(t);
  call('addTask', { name: 'a' });
  call('removeTask', { taskId: 1 });
  call('addTask', { name: 'b' });
  assert.equal(call('undo').ok, false);
  assert.deepEqual(load().tasks.map((task) => task.name), ['b']);
});

test('a rejected action does not use up the chance to undo', (t) => {
  useTempHome(t);
  call('addTask', { name: 'a' });
  call('removeTask', { taskId: 1 });
  assert.equal(call('removeTask', { taskId: 42 }).ok, false);
  assert.equal(call('undo').ok, true);
});

test('undo restores only what was removed and keeps changes made elsewhere meanwhile', (t) => {
  useTempHome(t);
  call('addTask', { name: 'deleted by user' });
  call('addTask', { name: 'worked on by agent' });
  call('addStep', { taskId: 2, name: 's' });
  call('removeTask', { taskId: 1 });
  // An agent updates another task through the CLI path before the user clicks undo.
  update((data) => setStepProgress(data, 2, 1, 80, 'claude', NOW));
  call('undo');
  const tasks = load().tasks;
  assert.deepEqual(tasks.map((task) => task.name), ['deleted by user', 'worked on by agent']);
  assert.deepEqual([tasks[1].steps[0].percent, tasks[1].steps[0].updatedBy], [80, 'claude']);
});

test('undo reports a reason when what it would restore into is gone', (t) => {
  useTempHome(t);
  call('addTask', { name: 't' });
  call('addStep', { taskId: 1, name: 's' });
  call('removeStep', { taskId: 1, stepId: 1 });
  update((data) => removeTask(data, 1));
  const result = call('undo');
  assert.equal(result.ok, false);
  assert.match(result.error, /task 1 does not exist/i);
  assert.equal(readState().tasks.length, 0);
});

test('undoing a dismissal restores the remembered names exactly, even when the list was full', (t) => {
  useTempHome(t);
  const full = Array.from({ length: 500 }, (_, i) => `old-${i}`);
  update((data) => {
    data.dismissed = [...full];
    addSuggestion(data, { name: 'one more', by: 'claude' }, NOW);
  });
  call('dismissSuggestion', { suggestionId: 1 });
  assert.equal(load().dismissed.includes('old-0'), false, 'the oldest name was pushed out');
  call('undo');
  assert.deepEqual(load().dismissed, full);
});
