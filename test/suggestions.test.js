import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyData, addTask, addSuggestion, pendingSuggestions, acceptSuggestion, dismissSuggestion, taskProgress, TaskError,
} from '../src/core/model.js';
import { run } from '../src/cli/run.js';
import { load } from '../src/core/store.js';
import { useTempHome } from './helpers/tmp-home.js';

const NOW = '2026-10-12T10:00:00.000Z';

function task(args, env = {}) {
  let out = '';
  let err = '';
  const code = run(args, {
    env,
    stdout: (text) => { out += `${text}\n`; },
    stderr: (text) => { err += `${text}\n`; },
  });
  return { code, out, err };
}

const suggest = (data, name, extra = {}) => addSuggestion(data, { name, steps: ['s'], by: 'claude', ...extra }, NOW);

// ---- model ----

test('addSuggestion saves name, due date, steps, source and author', () => {
  const data = emptyData();
  const { saved } = addSuggestion(data, {
    name: '写论文第二章', due: '2026-10-20', steps: ['收集文献', '写初稿'], source: '10-11 论文项目的对话', by: 'claude',
  }, NOW);
  assert.deepEqual(saved, {
    id: 1, name: '写论文第二章', due: '2026-10-20', steps: [{ name: '收集文献', done: false }, { name: '写初稿', done: false }],
    source: '10-11 论文项目的对话', by: 'claude', createdAt: NOW,
  });
  assert.deepEqual(pendingSuggestions(data), [saved]);
  assert.equal(data.tasks.length, 0);
});

test('a suggestion can mark some steps as already done, keeping their order', () => {
  const { saved } = addSuggestion(emptyData(), {
    name: '搭建并发布 taskboard',
    steps: [{ name: '调研', done: true }, { name: '实现第一版', done: true }, '开源上传 GitHub'],
    by: 'claude',
  }, NOW);
  assert.deepEqual(saved.steps, [
    { name: '调研', done: true }, { name: '实现第一版', done: true }, { name: '开源上传 GitHub', done: false },
  ]);
});

test('a suggestion needs at least one step', () => {
  for (const steps of [[], undefined]) {
    assert.throws(() => addSuggestion(emptyData(), { name: 'x', steps, by: 'claude' }, NOW), /at least one step/i);
  }
});

test('addSuggestion validates name, due date, step names and author', () => {
  for (const bad of [
    { name: ' ', steps: ['s'], by: 'a' },
    { name: 'x', steps: ['s'], due: '明天', by: 'a' },
    { name: 'x', steps: ['ok', ' '], by: 'a' },
    { name: 'x', steps: ['s'], by: ' ' },
  ]) {
    assert.throws(() => addSuggestion(emptyData(), bad, NOW), TaskError, JSON.stringify(bad));
  }
});

test('data without suggestion fields has no suggestions and can take new ones', () => {
  const data = emptyData();
  addTask(data, { name: 'old', steps: ['s'] }, NOW);
  assert.deepEqual(pendingSuggestions(data), []);
  assert.equal(suggest(data, 'new').saved.id, 1);
  assert.equal(data.tasks.length, 1);
});

test('acceptSuggestion creates a task with unfinished steps and removes the suggestion', () => {
  const data = emptyData();
  const { saved } = suggest(data, '报销', { due: '2026-10-16', steps: ['填表', '找发票'] });
  const created = acceptSuggestion(data, saved.id, NOW);
  assert.deepEqual([created.name, created.due], ['报销', '2026-10-16']);
  assert.deepEqual(created.steps.map((s) => [s.id, s.name, s.done]), [[1, '填表', false], [2, '找发票', false]]);
  assert.deepEqual(pendingSuggestions(data), []);
  assert.deepEqual(data.tasks, [created]);
});

test('accepting creates done steps as done, signed by whoever suggested them', () => {
  const data = emptyData();
  const { saved } = suggest(data, 'p', { steps: [{ name: 'a', done: true }, { name: 'b', done: true }, { name: 'c', done: false }] });
  const created = acceptSuggestion(data, saved.id, NOW);
  assert.deepEqual(created.steps.map((s) => [s.name, s.done, s.updatedBy]), [['a', true, 'claude'], ['b', true, 'claude'], ['c', false, null]]);
  assert.equal(taskProgress(created), 67);
  assert.equal(created.completedAt, null);
});

test('accepting a suggestion whose steps are all done gives an archived task', () => {
  const data = emptyData();
  const { saved } = suggest(data, 'p', { steps: [{ name: 'a', done: true }] });
  assert.equal(acceptSuggestion(data, saved.id, NOW).completedAt, NOW);
});

test('suggestions saved by earlier versions (plain step names, or no steps) still accept', () => {
  const data = {
    version: 2, nextTaskId: 1, tasks: [], nextSuggestionId: 3,
    suggestions: [
      { id: 1, name: 'old', due: null, steps: ['x', 'y'], source: null, by: 'claude', createdAt: NOW },
      { id: 2, name: '整理读书笔记', due: null, steps: [], source: null, by: 'claude', createdAt: NOW },
    ],
  };
  assert.deepEqual(pendingSuggestions(data)[0].steps, [{ name: 'x', done: false }, { name: 'y', done: false }]);
  assert.deepEqual(acceptSuggestion(data, 1, NOW).steps.map((s) => [s.name, s.done]), [['x', false], ['y', false]]);
  assert.deepEqual(acceptSuggestion(data, 2, NOW).steps.map((s) => [s.name, s.done]), [['整理读书笔记', false]]);
});

test('accepting or dismissing a missing suggestion throws', () => {
  assert.throws(() => acceptSuggestion(emptyData(), 7, NOW), /suggestion 7 does not exist/i);
  assert.throws(() => dismissSuggestion(emptyData(), 7), /suggestion 7 does not exist/i);
});

test('dismissSuggestion removes it and leaves tasks alone', () => {
  const data = emptyData();
  addTask(data, { name: 'kept', steps: ['s'] }, NOW);
  dismissSuggestion(data, suggest(data, 'no thanks').saved.id);
  assert.deepEqual(pendingSuggestions(data), []);
  assert.deepEqual(data.tasks.map((t) => t.name), ['kept']);
});

test('a suggestion named like an existing task, a pending one or a dismissed one is skipped', () => {
  const data = emptyData();
  addTask(data, { name: '写论文第二章', steps: ['s'] }, NOW);
  assert.deepEqual(suggest(data, '  写论文第二章 '), { skipped: 'task' });
  suggest(data, 'Tidy Notes');
  assert.deepEqual(suggest(data, ' tidy notes', { by: 'deepseek' }), { skipped: 'pending' });
  dismissSuggestion(data, 1);
  assert.deepEqual(suggest(data, 'TIDY NOTES'), { skipped: 'dismissed' });
  assert.deepEqual(pendingSuggestions(data), []);
});

test('suggestion ids are not reused, and the dismissed list keeps only the most recent 500 names', () => {
  const data = emptyData();
  dismissSuggestion(data, suggest(data, 'a').saved.id);
  assert.equal(suggest(data, 'b').saved.id, 2);
  dismissSuggestion(data, 2);
  for (let i = 0; i < 503; i += 1) dismissSuggestion(data, suggest(data, `n${i}`).saved.id);
  assert.equal(data.dismissed.length, 500);
  assert.ok(suggest(data, 'a').saved, 'oldest dismissal was forgotten');
  assert.deepEqual(suggest(data, 'n502'), { skipped: 'dismissed' });
});

// ---- CLI ----

test('suggest saves a suggestion, prints its id, and does not create a task', (t) => {
  useTempHome(t);
  const result = task(['suggest', '写论文第二章', '--due', '2026-10-20', '--step', '收集文献', '--step', '写初稿', '--source', '10-11 论文项目的对话', '--by', 'claude']);
  assert.equal(result.code, 0);
  assert.match(result.out, /\b1\b/);
  const [saved] = pendingSuggestions(load());
  assert.deepEqual([saved.name, saved.due, saved.steps.map((s) => s.name), saved.source, saved.by], ['写论文第二章', '2026-10-20', ['收集文献', '写初稿'], '10-11 论文项目的对话', 'claude']);
  assert.match(task(['list']).out, /no open tasks/i);
});

test('suggest without any step fails and saves nothing', (t) => {
  useTempHome(t);
  const result = task(['suggest', '写论文第二章']);
  assert.notEqual(result.code, 0);
  assert.match(result.err, /--step/);
  assert.equal(pendingSuggestions(load()).length, 0);
});

test('--done-step and --step keep the order they were given in', (t) => {
  useTempHome(t);
  task(['suggest', '搭建并发布 taskboard', '--done-step', '调研现成项目', '--step', '写文档', '--done-step', '实现第一版', '--step', '开源上传 GitHub', '--by', 'claude']);
  assert.deepEqual(pendingSuggestions(load())[0].steps, [
    { name: '调研现成项目', done: true }, { name: '写文档', done: false }, { name: '实现第一版', done: true }, { name: '开源上传 GitHub', done: false },
  ]);
});

test('suggest reports why a duplicate was skipped and still succeeds', (t) => {
  useTempHome(t);
  task(['add', '写论文第二章', '--step', 's']);
  const asTask = task(['suggest', '写论文第二章', '--step', 's', '--by', 'claude']);
  assert.equal(asTask.code, 0);
  assert.match(asTask.out, /skipped.*task/is);
  task(['suggest', '整理读书笔记', '--step', 's']);
  task(['dismiss', '1']);
  const dismissed = task(['suggest', '整理读书笔记', '--step', 's']);
  assert.equal(dismissed.code, 0);
  assert.match(dismissed.out, /dismissed/i);
  assert.equal(pendingSuggestions(load()).length, 0);
});

test('suggestions lists pending ones with steps and their state, in text and JSON', (t) => {
  useTempHome(t);
  task(['suggest', '报销', '--due', '2026-10-16', '--done-step', '填表', '--step', '找发票', '--source', '昨天的对话', '--by', 'claude']);
  const { code, out } = task(['suggestions']);
  assert.equal(code, 0);
  for (const piece of ['1', '报销', '2026-10-16', '[x] 填表', '[ ] 找发票', '昨天的对话', 'claude']) {
    assert.ok(out.includes(piece), piece);
  }
  assert.deepEqual(JSON.parse(task(['suggestions', '--json']).out).suggestions[0].steps, [{ name: '填表', done: true }, { name: '找发票', done: false }]);
});

test('suggestions with nothing pending says so', (t) => {
  useTempHome(t);
  assert.match(task(['suggestions']).out, /no suggestions/i);
  assert.deepEqual(JSON.parse(task(['suggestions', '--json']).out), { suggestions: [] });
});

test('accept turns a suggestion into a task, prints the task id, and carries the done steps', (t) => {
  useTempHome(t);
  task(['add', 'existing', '--step', 's']);
  task(['suggest', 'p', '--done-step', 'a', '--done-step', 'b', '--step', 'c', '--by', 'claude']);
  const result = task(['accept', '1']);
  assert.equal(result.code, 0);
  assert.match(result.out, /task 2/i);
  assert.match(task(['list']).out, /67%/);
  assert.deepEqual(load().tasks[1].steps.map((s) => [s.name, s.done, s.updatedBy]), [['a', true, 'claude'], ['b', true, 'claude'], ['c', false, null]]);
  assert.equal(pendingSuggestions(load()).length, 0);
});

test('dismiss removes a suggestion; unknown ids fail with a reason', (t) => {
  useTempHome(t);
  task(['suggest', 'x', '--step', 's']);
  assert.equal(task(['dismiss', '1']).code, 0);
  assert.equal(pendingSuggestions(load()).length, 0);
  for (const command of ['accept', 'dismiss']) {
    const result = task([command, '9']);
    assert.notEqual(result.code, 0);
    assert.match(result.err, /suggestion 9 does not exist/i);
  }
});

test('help mentions the suggestion commands and --done-step', (t) => {
  useTempHome(t);
  const { out } = task(['--help']);
  for (const word of ['suggest', 'suggestions', 'accept', 'dismiss', '--done-step']) assert.ok(out.includes(word), word);
});
