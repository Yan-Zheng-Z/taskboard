import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyData, addTask, editTask, removeTask, addStep, renameStep, removeStep,
  setStepProgress, setTaskProgress, taskProgress, TaskError,
} from '../src/core/model.js';

const NOW = '2026-10-12T10:00:00.000Z';

test('addTask creates a task with id, name, due date and no steps', () => {
  const data = emptyData();
  const task = addTask(data, { name: '写论文第二章', due: '2026-10-20' }, NOW);
  assert.equal(task.id, 1);
  assert.equal(task.name, '写论文第二章');
  assert.equal(task.due, '2026-10-20');
  assert.deepEqual(task.steps, []);
  assert.equal(task.createdAt, NOW);
  assert.equal(data.tasks.length, 1);
});

test('addTask without a due date stores null', () => {
  const task = addTask(emptyData(), { name: 'X' }, NOW);
  assert.equal(task.due, null);
});

test('addTask accepts a due date with time', () => {
  const task = addTask(emptyData(), { name: 'X', due: '2026-10-20 18:30' }, NOW);
  assert.equal(task.due, '2026-10-20 18:30');
});

test('addTask rejects malformed and impossible due dates', () => {
  for (const due of ['明天', '2026-13-01', '2026-02-30', '20261020', '2026-10-20 25:00']) {
    assert.throws(() => addTask(emptyData(), { name: 'X', due }, NOW), TaskError, due);
  }
});

test('addTask rejects an empty name', () => {
  assert.throws(() => addTask(emptyData(), { name: '   ' }, NOW), TaskError);
});

test('task ids are never reused after removal', () => {
  const data = emptyData();
  addTask(data, { name: 'a' }, NOW);
  addTask(data, { name: 'b' }, NOW);
  const third = addTask(data, { name: 'c' }, NOW);
  removeTask(data, third.id);
  assert.equal(addTask(data, { name: 'd' }, NOW).id, 4);
});

test('removeTask on a missing id throws', () => {
  assert.throws(() => removeTask(emptyData(), 9), /task 9 does not exist/i);
});

test('editTask changes name and due date, and can clear the due date', () => {
  const data = emptyData();
  const task = addTask(data, { name: 'a', due: '2026-10-20' }, NOW);
  editTask(data, task.id, { name: 'b', due: '2026-11-01' });
  assert.equal(task.name, 'b');
  assert.equal(task.due, '2026-11-01');
  editTask(data, task.id, { due: null });
  assert.equal(task.due, null);
  assert.equal(task.name, 'b');
});

test('addStep appends a step with progress 0', () => {
  const data = emptyData();
  const task = addTask(data, { name: 'a' }, NOW);
  addStep(data, task.id, '收集文献');
  const step = addStep(data, task.id, '写初稿');
  assert.equal(step.id, 2);
  assert.equal(step.percent, 0);
  assert.equal(step.updatedBy, null);
  assert.deepEqual(task.steps.map((s) => s.name), ['收集文献', '写初稿']);
});

test('step ids are never reused within a task', () => {
  const data = emptyData();
  const task = addTask(data, { name: 'a' }, NOW);
  addStep(data, task.id, 's1');
  const second = addStep(data, task.id, 's2');
  removeStep(data, task.id, second.id);
  assert.equal(addStep(data, task.id, 's3').id, 3);
});

test('renameStep changes the name; missing step throws', () => {
  const data = emptyData();
  const task = addTask(data, { name: 'a' }, NOW);
  const step = addStep(data, task.id, 'old');
  renameStep(data, task.id, step.id, 'new');
  assert.equal(step.name, 'new');
  assert.throws(() => renameStep(data, task.id, 99, 'x'), /step 99 does not exist in task 1/i);
});

test('setStepProgress stores percent, who and when', () => {
  const data = emptyData();
  const task = addTask(data, { name: 'a' }, NOW);
  const step = addStep(data, task.id, 's');
  setStepProgress(data, task.id, step.id, 60, 'claude', NOW);
  assert.equal(step.percent, 60);
  assert.equal(step.updatedBy, 'claude');
  assert.equal(step.updatedAt, NOW);
});

test('setStepProgress rejects out-of-range and non-integer values and leaves data unchanged', () => {
  const data = emptyData();
  const task = addTask(data, { name: 'a' }, NOW);
  const step = addStep(data, task.id, 's');
  for (const bad of [120, -5, 12.5, NaN, '60', null]) {
    assert.throws(() => setStepProgress(data, task.id, step.id, bad, 'user', NOW), TaskError);
  }
  assert.equal(step.percent, 0);
  assert.equal(step.updatedBy, null);
});

test('setStepProgress rejects an empty author', () => {
  const data = emptyData();
  const task = addTask(data, { name: 'a' }, NOW);
  const step = addStep(data, task.id, 's');
  assert.throws(() => setStepProgress(data, task.id, step.id, 10, '  ', NOW), TaskError);
});

test('taskProgress averages step percentages and rounds', () => {
  const data = emptyData();
  const task = addTask(data, { name: 'a' }, NOW);
  const ids = ['x', 'y', 'z'].map((n) => addStep(data, task.id, n).id);
  setStepProgress(data, task.id, ids[0], 100, 'user', NOW);
  setStepProgress(data, task.id, ids[1], 50, 'user', NOW);
  assert.equal(taskProgress(task), 50);
  setStepProgress(data, task.id, ids[2], 1, 'user', NOW);
  assert.equal(taskProgress(task), 50); // 151 / 3 = 50.33
  setStepProgress(data, task.id, ids[2], 2, 'user', NOW);
  assert.equal(taskProgress(task), 51); // 152 / 3 = 50.67
});

test('a task without steps uses its own settable progress, default 0', () => {
  const data = emptyData();
  const task = addTask(data, { name: 'a' }, NOW);
  assert.equal(taskProgress(task), 0);
  setTaskProgress(data, task.id, 40, 'deepseek', NOW);
  assert.equal(taskProgress(task), 40);
  assert.equal(task.updatedBy, 'deepseek');
  assert.equal(task.updatedAt, NOW);
});

test('setTaskProgress is rejected when the task has steps', () => {
  const data = emptyData();
  const task = addTask(data, { name: 'a' }, NOW);
  addStep(data, task.id, 's');
  assert.throws(() => setTaskProgress(data, task.id, 40, 'user', NOW), /has steps/i);
});
