import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyData, addTask, editTask, removeTask, addStep, renameStep, removeStep, setStepDone, taskProgress, TaskError,
} from '../src/core/model.js';

const NOW = '2026-10-12T10:00:00.000Z';
const LATER = '2026-10-13T09:00:00.000Z';

const newTask = (data, steps = ['a', 'b'], extra = {}) => addTask(data, { name: 't', steps, ...extra }, NOW);

test('addTask creates a task with id, name, due date and unfinished steps', () => {
  const data = emptyData();
  const task = addTask(data, { name: '写论文第二章', due: '2026-10-20', steps: ['收集文献', '写初稿'] }, NOW);
  assert.equal(task.id, 1);
  assert.equal(task.name, '写论文第二章');
  assert.equal(task.due, '2026-10-20');
  assert.equal(task.createdAt, NOW);
  assert.equal(task.completedAt, null);
  assert.deepEqual(task.steps, [
    { id: 1, name: '收集文献', done: false, updatedBy: null, updatedAt: null },
    { id: 2, name: '写初稿', done: false, updatedBy: null, updatedAt: null },
  ]);
  assert.equal(data.tasks.length, 1);
});

test('addTask without a due date stores null, and accepts a due date with time', () => {
  assert.equal(newTask(emptyData()).due, null);
  assert.equal(newTask(emptyData(), ['a'], { due: '2026-10-20 18:30' }).due, '2026-10-20 18:30');
});

test('a task needs at least one step', () => {
  for (const steps of [[], undefined, null]) {
    assert.throws(() => addTask(emptyData(), { name: 'x', steps }, NOW), /at least one step/i);
  }
});

test('addTask rejects bad names, step names and due dates and adds nothing', () => {
  const data = emptyData();
  assert.throws(() => addTask(data, { name: '   ', steps: ['a'] }, NOW), TaskError);
  assert.throws(() => addTask(data, { name: 'x', steps: ['ok', ' '] }, NOW), TaskError);
  for (const due of ['明天', '2026-13-01', '2026-02-30', '20261020', '2026-10-20 25:00']) {
    assert.throws(() => addTask(data, { name: 'x', steps: ['a'], due }, NOW), TaskError, due);
  }
  assert.equal(data.tasks.length, 0);
  assert.equal(data.nextTaskId, 1);
});

test('task ids are never reused after removal', () => {
  const data = emptyData();
  newTask(data);
  newTask(data);
  removeTask(data, newTask(data).id);
  assert.equal(newTask(data).id, 4);
  assert.throws(() => removeTask(data, 9), /task 9 does not exist/i);
});

test('editTask changes name and due date, and can clear the due date', () => {
  const data = emptyData();
  const task = newTask(data, ['a'], { due: '2026-10-20' });
  editTask(data, task.id, { name: 'b', due: '2026-11-01' });
  assert.deepEqual([task.name, task.due], ['b', '2026-11-01']);
  editTask(data, task.id, { due: null });
  assert.deepEqual([task.name, task.due], ['b', null]);
});

test('addStep appends an unfinished step with a new id', () => {
  const data = emptyData();
  const task = newTask(data, ['one']);
  const step = addStep(data, task.id, 'two');
  assert.deepEqual(step, { id: 2, name: 'two', done: false, updatedBy: null, updatedAt: null });
  removeStep(data, task.id, step.id, NOW);
  assert.equal(addStep(data, task.id, 'three').id, 3);
});

test('renameStep changes the name; a missing step throws', () => {
  const data = emptyData();
  const task = newTask(data, ['old']);
  renameStep(data, task.id, 1, 'new');
  assert.equal(task.steps[0].name, 'new');
  assert.throws(() => renameStep(data, task.id, 99, 'x'), /step 99 does not exist in task 1/i);
});

test('setStepDone records done, who and when; and can reopen', () => {
  const data = emptyData();
  const task = newTask(data);
  const step = setStepDone(data, task.id, 1, true, 'claude', NOW);
  assert.deepEqual([step.done, step.updatedBy, step.updatedAt], [true, 'claude', NOW]);
  setStepDone(data, task.id, 1, false, 'user', LATER);
  assert.deepEqual([step.done, step.updatedBy, step.updatedAt], [false, 'user', LATER]);
});

test('setStepDone accepts only true or false, and needs an author', () => {
  const data = emptyData();
  const task = newTask(data);
  for (const bad of [60, 1, 'true', null, undefined]) {
    assert.throws(() => setStepDone(data, task.id, 1, bad, 'user', NOW), TaskError, String(bad));
  }
  assert.throws(() => setStepDone(data, task.id, 1, true, '  ', NOW), TaskError);
  assert.equal(task.steps[0].done, false);
});

test('taskProgress is finished steps over all steps, rounded', () => {
  const data = emptyData();
  const task = newTask(data, ['a', 'b', 'c']);
  assert.equal(taskProgress(task), 0);
  setStepDone(data, task.id, 1, true, 'user', NOW);
  assert.equal(taskProgress(task), 33);
  setStepDone(data, task.id, 2, true, 'user', NOW);
  assert.equal(taskProgress(task), 67);
  setStepDone(data, task.id, 3, true, 'user', NOW);
  assert.equal(taskProgress(task), 100);
});

test('the last step of a task cannot be removed', () => {
  const data = emptyData();
  const task = newTask(data, ['only']);
  assert.throws(() => removeStep(data, task.id, 1, NOW), /at least one step/i);
  assert.equal(task.steps.length, 1);
});

// ---- archiving ----

test('finishing the last unfinished step archives the task with the time', () => {
  const data = emptyData();
  const task = newTask(data);
  setStepDone(data, task.id, 1, true, 'user', NOW);
  assert.equal(task.completedAt, null);
  setStepDone(data, task.id, 2, true, 'claude', LATER);
  assert.equal(task.completedAt, LATER);
});

test('marking a finished step done again does not change when the task was completed', () => {
  const data = emptyData();
  const task = newTask(data, ['a']);
  setStepDone(data, task.id, 1, true, 'user', NOW);
  setStepDone(data, task.id, 1, true, 'claude', LATER);
  assert.equal(task.completedAt, NOW);
});

test('reopening a step of an archived task brings the task back', () => {
  const data = emptyData();
  const task = newTask(data, ['a']);
  setStepDone(data, task.id, 1, true, 'user', NOW);
  setStepDone(data, task.id, 1, false, 'user', LATER);
  assert.equal(task.completedAt, null);
});

test('adding a step to an archived task brings the task back', () => {
  const data = emptyData();
  const task = newTask(data, ['a']);
  setStepDone(data, task.id, 1, true, 'user', NOW);
  addStep(data, task.id, 'more work');
  assert.equal(task.completedAt, null);
  assert.equal(taskProgress(task), 50);
});

test('removing the only unfinished step archives the task', () => {
  const data = emptyData();
  const task = newTask(data, ['a', 'b', 'c']);
  setStepDone(data, task.id, 1, true, 'user', NOW);
  setStepDone(data, task.id, 2, true, 'user', NOW);
  removeStep(data, task.id, 3, LATER);
  assert.equal(task.completedAt, LATER);
});
