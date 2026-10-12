import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  emptyData, addTask, addSuggestion, pendingSuggestions, acceptSuggestion, dismissSuggestion, TaskError,
} from '../src/core/model.js';
import { run } from '../src/cli/run.js';
import { load, dataDir, dataFile } from '../src/core/store.js';
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

// ---- model ----

test('addSuggestion saves name, due date, steps, source and author', () => {
  const data = emptyData();
  const { saved } = addSuggestion(data, {
    name: '写论文第二章', due: '2026-10-20', steps: ['收集文献', '写初稿'], source: '10-11 论文项目的对话', by: 'claude',
  }, NOW);
  assert.deepEqual(saved, {
    id: 1, name: '写论文第二章', due: '2026-10-20', steps: ['收集文献', '写初稿'], source: '10-11 论文项目的对话', by: 'claude', createdAt: NOW,
  });
  assert.deepEqual(pendingSuggestions(data), [saved]);
  assert.equal(data.tasks.length, 0);
});

test('addSuggestion works with only a name', () => {
  const { saved } = addSuggestion(emptyData(), { name: 'x', by: 'user' }, NOW);
  assert.deepEqual([saved.due, saved.steps, saved.source], [null, [], null]);
});

test('addSuggestion validates name, due date, step names and author', () => {
  for (const bad of [
    { name: ' ', by: 'a' },
    { name: 'x', due: '明天', by: 'a' },
    { name: 'x', steps: ['ok', ' '], by: 'a' },
    { name: 'x', by: ' ' },
  ]) {
    assert.throws(() => addSuggestion(emptyData(), bad, NOW), TaskError, JSON.stringify(bad));
  }
});

test('old data without suggestion fields has no suggestions and can take new ones', () => {
  const data = { version: 1, nextTaskId: 2, tasks: [{ id: 1, name: 'old', due: null, steps: [], nextStepId: 1, percent: 0 }] };
  assert.deepEqual(pendingSuggestions(data), []);
  assert.equal(addSuggestion(data, { name: 'new', by: 'claude' }, NOW).saved.id, 1);
  assert.equal(data.tasks.length, 1);
});

test('acceptSuggestion creates a task with the steps and removes the suggestion', () => {
  const data = emptyData();
  const { saved } = addSuggestion(data, { name: '报销', due: '2026-10-16', steps: ['填表', '找发票'], by: 'claude' }, NOW);
  const created = acceptSuggestion(data, saved.id, NOW);
  assert.equal(created.name, '报销');
  assert.equal(created.due, '2026-10-16');
  assert.deepEqual(created.steps.map((s) => [s.id, s.name, s.percent]), [[1, '填表', 0], [2, '找发票', 0]]);
  assert.deepEqual(pendingSuggestions(data), []);
  assert.deepEqual(data.tasks, [created]);
});

test('accepting or dismissing a missing suggestion throws', () => {
  assert.throws(() => acceptSuggestion(emptyData(), 7, NOW), /suggestion 7 does not exist/i);
  assert.throws(() => dismissSuggestion(emptyData(), 7), /suggestion 7 does not exist/i);
});

test('dismissSuggestion removes it and leaves tasks alone', () => {
  const data = emptyData();
  addTask(data, { name: 'kept' }, NOW);
  const { saved } = addSuggestion(data, { name: 'no thanks', by: 'claude' }, NOW);
  dismissSuggestion(data, saved.id);
  assert.deepEqual(pendingSuggestions(data), []);
  assert.deepEqual(data.tasks.map((t) => t.name), ['kept']);
});

test('a suggestion named like an existing task is skipped', () => {
  const data = emptyData();
  addTask(data, { name: '写论文第二章' }, NOW);
  assert.deepEqual(addSuggestion(data, { name: '  写论文第二章 ', by: 'claude' }, NOW), { skipped: 'task' });
  assert.deepEqual(pendingSuggestions(data), []);
});

test('a suggestion named like a pending one is skipped, ignoring case and outer spaces', () => {
  const data = emptyData();
  addSuggestion(data, { name: 'Tidy Notes', by: 'claude' }, NOW);
  assert.deepEqual(addSuggestion(data, { name: ' tidy notes', by: 'deepseek' }, NOW), { skipped: 'pending' });
  assert.equal(pendingSuggestions(data).length, 1);
});

test('a dismissed suggestion is not saved again', () => {
  const data = emptyData();
  const { saved } = addSuggestion(data, { name: '整理读书笔记', by: 'claude' }, NOW);
  dismissSuggestion(data, saved.id);
  assert.deepEqual(addSuggestion(data, { name: '整理读书笔记', by: 'claude' }, NOW), { skipped: 'dismissed' });
  assert.deepEqual(pendingSuggestions(data), []);
});

test('suggestion ids are not reused', () => {
  const data = emptyData();
  const first = addSuggestion(data, { name: 'a', by: 'u' }, NOW).saved;
  dismissSuggestion(data, first.id);
  assert.equal(addSuggestion(data, { name: 'b', by: 'u' }, NOW).saved.id, 2);
});

test('the dismissed list keeps only the most recent 500 names', () => {
  const data = emptyData();
  for (let i = 0; i < 505; i += 1) {
    dismissSuggestion(data, addSuggestion(data, { name: `n${i}`, by: 'u' }, NOW).saved.id);
  }
  assert.equal(data.dismissed.length, 500);
  assert.ok(addSuggestion(data, { name: 'n0', by: 'u' }, NOW).saved, 'oldest dismissal was forgotten');
  assert.deepEqual(addSuggestion(data, { name: 'n504', by: 'u' }, NOW), { skipped: 'dismissed' });
});

// ---- CLI ----

test('suggest saves a suggestion, prints its id, and does not create a task', (t) => {
  useTempHome(t);
  const result = task(['suggest', '写论文第二章', '--due', '2026-10-20', '--step', '收集文献', '--step', '写初稿', '--source', '10-11 论文项目的对话', '--by', 'claude']);
  assert.equal(result.code, 0);
  assert.match(result.out, /\b1\b/);
  const [saved] = pendingSuggestions(load());
  assert.deepEqual([saved.name, saved.due, saved.steps, saved.source, saved.by], ['写论文第二章', '2026-10-20', ['收集文献', '写初稿'], '10-11 论文项目的对话', 'claude']);
  assert.match(task(['list']).out, /no tasks/i);
});

test('suggest reports why a duplicate was skipped and still succeeds', (t) => {
  useTempHome(t);
  task(['add', '写论文第二章']);
  const asTask = task(['suggest', '写论文第二章', '--by', 'claude']);
  assert.equal(asTask.code, 0);
  assert.match(asTask.out, /skipped/i);
  assert.match(asTask.out, /task/i);
  task(['suggest', '整理读书笔记']);
  task(['dismiss', '1']);
  const dismissed = task(['suggest', '整理读书笔记']);
  assert.equal(dismissed.code, 0);
  assert.match(dismissed.out, /dismissed/i);
  assert.equal(pendingSuggestions(load()).length, 0);
});

test('suggestions lists pending ones with id, name, due date, steps and source', (t) => {
  useTempHome(t);
  task(['suggest', '报销', '--due', '2026-10-16', '--step', '填表', '--step', '找发票', '--source', '昨天的对话', '--by', 'claude']);
  const result = task(['suggestions']);
  assert.equal(result.code, 0);
  for (const piece of ['1', '报销', '2026-10-16', '填表', '找发票', '昨天的对话', 'claude']) {
    assert.ok(result.out.includes(piece), piece);
  }
  const json = JSON.parse(task(['suggestions', '--json']).out);
  assert.equal(json.suggestions[0].name, '报销');
});

test('suggestions with nothing pending says so, including on old data files', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify({ version: 1, nextTaskId: 2, tasks: [{ id: 1, name: 'old', due: null, createdAt: NOW, percent: 0, updatedBy: null, updatedAt: null, nextStepId: 1, steps: [] }] }));
  const result = task(['suggestions']);
  assert.equal(result.code, 0);
  assert.match(result.out, /no suggestions/i);
  assert.match(task(['list']).out, /old/);
  assert.deepEqual(JSON.parse(task(['suggestions', '--json']).out), { suggestions: [] });
});

test('accept turns a suggestion into a task and prints the task id', (t) => {
  useTempHome(t);
  task(['add', 'existing']);
  task(['suggest', '报销', '--step', '填表', '--step', '找发票']);
  const result = task(['accept', '1']);
  assert.equal(result.code, 0);
  assert.match(result.out, /task 2/i);
  assert.deepEqual(load().tasks[1].steps.map((s) => s.name), ['填表', '找发票']);
  assert.equal(pendingSuggestions(load()).length, 0);
});

test('dismiss removes a suggestion; unknown ids fail with a reason', (t) => {
  useTempHome(t);
  task(['suggest', 'x']);
  assert.equal(task(['dismiss', '1']).code, 0);
  assert.equal(pendingSuggestions(load()).length, 0);
  for (const command of ['accept', 'dismiss']) {
    const result = task([command, '9']);
    assert.notEqual(result.code, 0);
    assert.match(result.err, /suggestion 9 does not exist/i);
  }
});

test('help mentions the suggestion commands', (t) => {
  useTempHome(t);
  const { out } = task(['--help']);
  for (const word of ['suggest', 'suggestions', 'accept', 'dismiss']) assert.ok(out.includes(word), word);
});
