import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyData, addTask, addStep, removeTask, removeStep, setStepDone, addSuggestion, dismissSuggestion,
  pendingSuggestions, restoreTask, restoreStep, restoreSuggestion, TaskError,
} from '../src/core/model.js';
import { call, readState } from '../src/widget/api.js';
import { load, update } from '../src/core/store.js';
import { useTempHome } from './helpers/tmp-home.js';

const NOW = '2026-10-12T10:00:00.000Z';
const LATER = '2026-10-12T11:00:00.000Z';
const add = (data, name, steps = ['s']) => addTask(data, { name, steps }, NOW);

// ---- model ----

test('restoreTask puts a removed task back where it was, with its steps and their state', () => {
  const data = emptyData();
  add(data, 'first');
  const middle = add(data, 'middle', ['a', 'b']);
  add(data, 'last');
  setStepDone(data, middle.id, 1, true, 'claude', NOW);
  const removed = removeTask(data, middle.id);
  restoreTask(data, removed, 1);
  assert.deepEqual(data.tasks.map((t) => t.name), ['first', 'middle', 'last']);
  assert.deepEqual([data.tasks[1].id, data.tasks[1].steps[0].done, data.tasks[1].steps[0].updatedBy], [middle.id, true, 'claude']);
});

test('restoreTask goes to the end when the list has become shorter, and refuses a duplicate id', () => {
  const data = emptyData();
  const a = add(data, 'a');
  const b = add(data, 'b');
  const removed = removeTask(data, b.id);
  removeTask(data, a.id);
  restoreTask(data, removed, 5);
  assert.deepEqual(data.tasks.map((t) => t.name), ['b']);
  assert.throws(() => restoreTask(data, removed, 0), TaskError);
});

test('restoreStep puts a removed step back in place; the task must still exist', () => {
  const data = emptyData();
  const task = add(data, 't', ['one', 'two', 'three']);
  setStepDone(data, task.id, 2, true, 'user', NOW);
  const removed = removeStep(data, task.id, 2, NOW);
  restoreStep(data, task.id, removed, 1, NOW);
  assert.deepEqual(task.steps.map((s) => [s.name, s.done]), [['one', false], ['two', true], ['three', false]]);
  assert.throws(() => restoreStep(data, task.id, removed, 1, NOW), TaskError);
  assert.throws(() => restoreStep(data, 99, removed, 1, NOW), /task 99 does not exist/i);
});

test('restoring an unfinished step into a task that became archived reopens the task', () => {
  const data = emptyData();
  const task = add(data, 't', ['done one', 'open one']);
  setStepDone(data, task.id, 1, true, 'user', NOW);
  const removed = removeStep(data, task.id, 2, NOW);
  assert.equal(task.completedAt, NOW);
  restoreStep(data, task.id, removed, 1, LATER);
  assert.equal(task.completedAt, null);
});

test('restoreSuggestion brings a dismissed suggestion back and forgets the dismissal', () => {
  const data = emptyData();
  addSuggestion(data, { name: 'keep', steps: ['s'], by: 'claude' }, NOW);
  const { saved } = addSuggestion(data, { name: 'Changed My Mind', steps: ['s'], by: 'claude' }, NOW);
  const dismissed = dismissSuggestion(data, saved.id);
  restoreSuggestion(data, dismissed, 1, { forget: true });
  assert.deepEqual(pendingSuggestions(data).map((s) => s.name), ['keep', 'Changed My Mind']);
  assert.deepEqual(data.dismissed, []);
  dismissSuggestion(data, saved.id);
  assert.deepEqual(addSuggestion(data, { name: 'changed my mind', steps: ['s'], by: 'claude' }, NOW), { skipped: 'dismissed' });
});

// ---- through the widget interface ----

test('deleting a task can be undone', (t) => {
  useTempHome(t);
  call('addTask', { name: 'first', steps: ['s', 'r'] });
  call('addTask', { name: 'second', steps: ['s'] });
  call('setStepDone', { taskId: 1, stepId: 1, done: true });
  assert.equal(call('removeTask', { taskId: 1 }).undoable, true);
  assert.equal(call('undo').ok, true);
  assert.deepEqual(load().tasks.map((task) => [task.id, task.name]), [[1, 'first'], [2, 'second']]);
  assert.equal(load().tasks[0].steps[0].done, true);
});

test('deleting a step can be undone', (t) => {
  useTempHome(t);
  call('addTask', { name: 't', steps: ['one', 'two'] });
  assert.equal(call('removeStep', { taskId: 1, stepId: 1 }).undoable, true);
  call('undo');
  assert.deepEqual(load().tasks[0].steps.map((s) => s.name), ['one', 'two']);
});

test('ticking the step that archives a task can be undone: the task returns, the step is open again', (t) => {
  useTempHome(t);
  call('addTask', { name: 't', steps: ['one', 'two'] });
  update((data) => setStepDone(data, 1, 1, true, 'claude', NOW));
  const archived = call('setStepDone', { taskId: 1, stepId: 2, done: true });
  assert.equal(archived.undoable, true);
  assert.equal(archived.state.archive.length, 1);
  const undone = call('undo');
  assert.equal(undone.ok, true);
  assert.deepEqual([undone.state.tasks.length, undone.state.archive.length], [1, 0]);
  const [task] = load().tasks;
  assert.deepEqual(task.steps.map((s) => [s.done, s.updatedBy]), [[true, 'claude'], [false, null]]);
  assert.equal(task.completedAt, null);
});

test('ticking a step that does not finish the task is not undoable, nor is unticking', (t) => {
  useTempHome(t);
  call('addTask', { name: 't', steps: ['one', 'two'] });
  assert.equal(call('setStepDone', { taskId: 1, stepId: 1, done: true }).undoable, false);
  assert.equal(call('setStepDone', { taskId: 1, stepId: 1, done: false }).undoable, false);
});

test('dismissing a suggestion can be undone, and it is no longer remembered as dismissed', (t) => {
  useTempHome(t);
  update((data) => addSuggestion(data, { name: 'maybe', steps: ['s'], by: 'claude' }, NOW));
  assert.equal(call('dismissSuggestion', { suggestionId: 1 }).undoable, true);
  assert.deepEqual(call('undo').state.suggestions.map((s) => s.name), ['maybe']);
  assert.deepEqual(load().dismissed, []);
});

test('undoing a dismissal restores the remembered names exactly, even when the list was full', (t) => {
  useTempHome(t);
  const full = Array.from({ length: 500 }, (_, i) => `old-${i}`);
  update((data) => {
    data.dismissed = [...full];
    addSuggestion(data, { name: 'one more', steps: ['s'], by: 'claude' }, NOW);
  });
  call('dismissSuggestion', { suggestionId: 1 });
  assert.equal(load().dismissed.includes('old-0'), false, 'the oldest name was pushed out');
  call('undo');
  assert.deepEqual(load().dismissed, full);
});

test('accepting a suggestion can be undone: the task goes and the suggestion returns', (t) => {
  useTempHome(t);
  update((data) => addSuggestion(data, { name: 'project', steps: [{ name: 'a', done: true }, 'b'], by: 'claude' }, NOW));
  assert.equal(call('acceptSuggestion', { suggestionId: 1 }).undoable, true);
  const undone = call('undo');
  assert.deepEqual(undone.state.tasks, []);
  assert.deepEqual(undone.state.suggestions.map((s) => [s.id, s.name, s.steps.length]), [[1, 'project', 2]]);
});

test('adding and renaming are not undoable', (t) => {
  useTempHome(t);
  assert.equal(call('addTask', { name: 't', steps: ['s'] }).undoable, false);
  assert.equal(call('addStep', { taskId: 1, name: 's2' }).undoable, false);
  assert.equal(call('renameStep', { taskId: 1, stepId: 1, name: 'x' }).undoable, false);
});

test('only the most recent action can be undone, and only once', (t) => {
  useTempHome(t);
  call('addTask', { name: 'a', steps: ['s'] });
  call('addTask', { name: 'b', steps: ['s'] });
  call('removeTask', { taskId: 1 });
  call('removeTask', { taskId: 2 });
  assert.equal(call('undo').ok, true);
  assert.deepEqual(load().tasks.map((task) => task.name), ['b']);
  assert.equal(call('undo').ok, false);
  assert.deepEqual(load().tasks.map((task) => task.name), ['b']);
});

test('the chance to undo ends when the user changes something else; a rejected action does not use it up', (t) => {
  useTempHome(t);
  call('addTask', { name: 'a', steps: ['s'] });
  call('removeTask', { taskId: 1 });
  assert.equal(call('removeTask', { taskId: 42 }).ok, false);
  assert.equal(call('undo').ok, true);
  call('removeTask', { taskId: 1 });
  call('addTask', { name: 'b', steps: ['s'] });
  assert.equal(call('undo').ok, false);
  assert.deepEqual(load().tasks.map((task) => task.name), ['b']);
});

test('undo restores only what was removed and keeps changes made elsewhere meanwhile', (t) => {
  useTempHome(t);
  call('addTask', { name: 'deleted by user', steps: ['s'] });
  call('addTask', { name: 'worked on by agent', steps: ['s', 'r'] });
  call('removeTask', { taskId: 1 });
  // An agent finishes a step of another task through the CLI path before the user clicks undo.
  update((data) => setStepDone(data, 2, 1, true, 'claude', NOW));
  call('undo');
  const tasks = load().tasks;
  assert.deepEqual(tasks.map((task) => task.name), ['deleted by user', 'worked on by agent']);
  assert.deepEqual([tasks[1].steps[0].done, tasks[1].steps[0].updatedBy], [true, 'claude']);
});

test('undo reports a reason when what it would restore into is gone', (t) => {
  useTempHome(t);
  call('addTask', { name: 't', steps: ['s', 'r'] });
  call('removeStep', { taskId: 1, stepId: 1 });
  update((data) => removeTask(data, 1));
  const result = call('undo');
  assert.equal(result.ok, false);
  assert.match(result.error, /task 1 does not exist/i);
  assert.equal(readState().tasks.length, 0);
});

// keep addStep imported for readers of this file: steps added after an undo get fresh ids
test('step ids keep counting after a removed step is restored', () => {
  const data = emptyData();
  const task = add(data, 't', ['one', 'two']);
  const removed = removeStep(data, task.id, 2, NOW);
  restoreStep(data, task.id, removed, 1, NOW);
  assert.equal(addStep(data, task.id, 'three').id, 3);
});
