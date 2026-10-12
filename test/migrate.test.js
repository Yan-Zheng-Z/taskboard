import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load, update, dataDir, dataFile, CorruptDataError } from '../src/core/store.js';
import { addStep, taskProgress, pendingSuggestions } from '../src/core/model.js';
import { useTempHome } from './helpers/tmp-home.js';

const T1 = '2026-10-10T08:00:00.000Z';
const T2 = '2026-10-11T09:00:00.000Z';

// A data file as version 1 of taskboard wrote it: steps and step-less tasks carry a percentage.
const v1 = () => ({
  version: 1,
  nextTaskId: 5,
  tasks: [
    {
      id: 1, name: '写论文', due: '2026-10-20', createdAt: T1, percent: 0, updatedBy: null, updatedAt: null, nextStepId: 4,
      steps: [
        { id: 1, name: '收集文献', percent: 100, updatedBy: 'claude', updatedAt: T1 },
        { id: 3, name: '写初稿', percent: 60, updatedBy: 'user', updatedAt: T2 },
      ],
    },
    { id: 2, name: '报销单', due: null, createdAt: T1, percent: 100, updatedBy: 'user', updatedAt: T2, nextStepId: 1, steps: [] },
    { id: 3, name: '买菜', due: null, createdAt: T1, percent: 40, updatedBy: 'user', updatedAt: T1, nextStepId: 1, steps: [] },
    {
      id: 4, name: '已全部完成', due: null, createdAt: T1, percent: 0, updatedBy: null, updatedAt: null, nextStepId: 3,
      steps: [
        { id: 1, name: 'x', percent: 100, updatedBy: 'user', updatedAt: T1 },
        { id: 2, name: 'y', percent: 100, updatedBy: 'claude', updatedAt: T2 },
      ],
    },
  ],
  nextSuggestionId: 3,
  suggestions: [
    { id: 1, name: '旧建议', due: null, steps: ['字符串步骤'], source: null, by: 'claude', createdAt: T1 },
    { id: 2, name: '没有步骤的旧建议', due: null, steps: [], source: null, by: 'claude', createdAt: T1 },
  ],
  dismissed: ['不要的'],
});

function writeV1(t) {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  const text = JSON.stringify(v1(), null, 2);
  fs.writeFileSync(dataFile(), text);
  return text;
}

test('steps at 100% become done and all others not done', (t) => {
  writeV1(t);
  const [task] = load().tasks;
  assert.deepEqual(task.steps, [
    { id: 1, name: '收集文献', done: true, updatedBy: 'claude', updatedAt: T1 },
    { id: 3, name: '写初稿', done: false, updatedBy: 'user', updatedAt: T2 },
  ]);
  assert.equal(taskProgress(task), 50);
  assert.equal(task.completedAt, null);
  assert.equal(task.nextStepId, 4);
  assert.equal('percent' in task, false);
});

test('a task without steps gets one step named after it, done if the task was at 100%', (t) => {
  writeV1(t);
  const [, finished, partial] = load().tasks;
  assert.deepEqual(finished.steps, [{ id: 1, name: '报销单', done: true, updatedBy: 'user', updatedAt: T2 }]);
  assert.equal(finished.completedAt, T2);
  assert.equal(finished.nextStepId, 2);
  assert.deepEqual(partial.steps, [{ id: 1, name: '买菜', done: false, updatedBy: 'user', updatedAt: T1 }]);
  assert.equal(partial.completedAt, null);
});

test('a task whose steps were all at 100% is archived at its latest step update', (t) => {
  writeV1(t);
  assert.equal(load().tasks[3].completedAt, T2);
});

test('ids, counters, suggestions and dismissed names carry over', (t) => {
  writeV1(t);
  const data = load();
  assert.equal(data.version, 2);
  assert.equal(data.nextTaskId, 5);
  assert.deepEqual(data.tasks.map((task) => task.id), [1, 2, 3, 4]);
  assert.deepEqual(pendingSuggestions(data).map((s) => [s.id, s.name, s.steps.length]), [[1, '旧建议', 1], [2, '没有步骤的旧建议', 0]]);
  assert.deepEqual(data.dismissed, ['不要的']);
  assert.equal(data.nextSuggestionId, 3);
});

test('reading an old file does not change it', (t) => {
  const text = writeV1(t);
  load();
  load();
  assert.equal(fs.readFileSync(dataFile(), 'utf8'), text);
  assert.deepEqual(fs.readdirSync(dataDir()), ['tasks.json']);
});

test('the first write saves the new format and keeps a backup of the old file', (t) => {
  const text = writeV1(t);
  update((data) => addStep(data, 1, '润色'));
  const backup = path.join(dataDir(), 'tasks.v1.backup.json');
  assert.equal(fs.readFileSync(backup, 'utf8'), text);
  const saved = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.tasks[0].steps.length, 3);
  assert.equal(saved.tasks[0].steps[0].done, true);
});

test('an existing backup is not overwritten by later writes', (t) => {
  const text = writeV1(t);
  update((data) => addStep(data, 1, 'one'));
  update((data) => addStep(data, 1, 'two'));
  assert.equal(fs.readFileSync(path.join(dataDir(), 'tasks.v1.backup.json'), 'utf8'), text);
});

test('an old file with wrong fields is still rejected, and no backup is made', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  const bad = v1();
  bad.tasks[0].steps[0].percent = 250;
  fs.writeFileSync(dataFile(), JSON.stringify(bad));
  assert.throws(() => load(), CorruptDataError);
  assert.throws(() => update((data) => addStep(data, 1, 'x')), CorruptDataError);
  assert.deepEqual(fs.readdirSync(dataDir()), ['tasks.json']);
});

test('a file from a newer, unknown version is rejected', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify({ version: 3, nextTaskId: 1, tasks: [] }));
  assert.throws(() => load(), /version/i);
});
