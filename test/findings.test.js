// Regression tests for problems found by a first-time-user walkthrough and in code review.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli/run.js';
import { load, update, dataDir, dataFile, CorruptDataError } from '../src/core/store.js';
import {
  emptyData, addTask, addStep, renameStep, editTask, addSuggestion, parseDue, TaskError, NAME_LIMIT,
} from '../src/core/model.js';
import { buildDigest } from '../src/core/digest/index.js';
import { useTempHome } from './helpers/tmp-home.js';
import { useTempAgents, claudeUser, writeClaudeSession, writeDshSession, dshUser } from './helpers/conversations.js';

const NOW = '2026-10-12T10:00:00.000Z';

function task(args, env = {}) {
  let out = '';
  let err = '';
  const code = run(args, { env, stdout: (text) => { out += `${text}\n`; }, stderr: (text) => { err += `${text}\n`; } });
  return { code, out, err };
}

function writeData(data) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(), typeof data === 'string' ? data : JSON.stringify(data));
}

const step = (extra = {}) => ({ id: 1, name: 's', done: false, updatedBy: null, updatedAt: null, ...extra });
const goodTask = (extra = {}) => ({
  id: 1, name: 'ok', due: null, createdAt: NOW, completedAt: null, nextStepId: 2, steps: [step()], ...extra,
});
const goodFile = (tasks, extra = {}) => ({ version: 2, nextTaskId: 10, tasks, ...extra });

// ---- data file validation ----

test('a data file whose fields are wrong is treated like a broken file', (t) => {
  useTempHome(t);
  const bad = [
    goodFile([goodTask({ steps: 'none' })]),
    goodFile([goodTask({ steps: [], nextStepId: 1 })]),
    goodFile([goodTask({ due: '明天' })]),
    goodFile([goodTask({ name: '' })]),
    goodFile([goodTask({ name: 42 })]),
    goodFile([goodTask({ id: 0 })]),
    goodFile([goodTask({ id: '1' })]),
    goodFile([goodTask(), goodTask()]),
    goodFile(['not a task']),
    goodFile([goodTask({ steps: [step({ done: 60 })] })]),
    goodFile([goodTask({ steps: [step({ done: 'yes' })] })]),
    goodFile([goodTask({ steps: [step({ name: '' })] })]),
    goodFile([goodTask({ nextStepId: 1 })]),
    goodFile([goodTask({ nextStepId: 3, steps: [step(), step()] })]),
    goodFile([goodTask({ steps: [step({ done: true })] })]),
    goodFile([goodTask({ completedAt: NOW })]),
    { version: 2, nextTaskId: 1, tasks: [goodTask({ id: 5 })] },
    goodFile([goodTask()], { suggestions: 'none' }),
    goodFile([goodTask()], { suggestions: [{ id: 1, name: '', steps: [] }] }),
    goodFile([goodTask()], { dismissed: [1, 2] }),
  ];
  for (const data of bad) {
    writeData(data);
    assert.throws(() => load(), (error) => error instanceof CorruptDataError && error.message.includes(dataFile()), JSON.stringify(data).slice(0, 140));
  }
});

test('the error names the task and field that are wrong', (t) => {
  useTempHome(t);
  writeData(goodFile([goodTask({ id: 3, steps: [step({ done: 60 })] })]));
  assert.throws(() => load(), /task 3 step 1.*done/is);
});

test('nothing is written to a data file with wrong fields', (t) => {
  useTempHome(t);
  const text = JSON.stringify(goodFile([goodTask({ steps: 'none' })]));
  writeData(text);
  const result = task(['add', '新任务', '--step', 's']);
  assert.notEqual(result.code, 0);
  assert.ok(result.err.includes(dataFile()));
  assert.equal(fs.readFileSync(dataFile(), 'utf8'), text);
});

test('a next-id counter that is behind the existing ids is rejected instead of producing duplicate ids', (t) => {
  useTempHome(t);
  writeData({ version: 2, nextTaskId: 1, tasks: [goodTask({ id: 5 })] });
  assert.notEqual(task(['add', 'x', '--step', 's']).code, 0);
});

test('a data file that starts with a byte order mark is read normally', (t) => {
  useTempHome(t);
  writeData(String.fromCharCode(0xfeff) + JSON.stringify(goodFile([goodTask()])));
  assert.deepEqual(load().tasks.map((x) => x.name), ['ok']);
  assert.equal(task(['add', 'second', '--step', 's']).code, 0);
});

test('names longer than the limit that are already stored do not make the file unreadable', (t) => {
  useTempHome(t);
  writeData(goodFile([goodTask({ name: '长'.repeat(NAME_LIMIT + 300) })]));
  assert.equal(load().tasks.length, 1);
});

test('files written by the tool itself pass validation', (t) => {
  useTempHome(t);
  task(['add', 'a', '--step', 's1', '--step', 's2', '--due', '2026-10-20 18:30']);
  task(['done', '1', '1', '--by', 'claude']);
  task(['add', 'b', '--step', 'only']);
  task(['done', '2', '1']);
  task(['reopen', '2', '1']);
  task(['done', '2', '1']);
  task(['suggest', 'p', '--done-step', 'x', '--step', 'y', '--source', 'chat']);
  task(['suggest', 'q', '--step', 'z']);
  task(['dismiss', '2']);
  task(['accept', '1']);
  task(['step', 'rm', '1', '2']);
  assert.equal(task(['list', '--all']).code, 0);
  assert.equal(load().tasks.length, 3);
});

test('a stored due time that the local clock skips does not make the data file unreadable', (t) => {
  useTempHome(t);
  // 02:30 does not exist on these days in zones that move their clocks forward then
  // (Sydney, Central Europe, US Eastern). A file saved before a time-zone change can hold one.
  for (const due of ['2026-10-04 02:30', '2026-03-29 02:30', '2026-03-08 02:30']) {
    writeData(goodFile([goodTask({ due })]));
    assert.equal(load().tasks[0].due, due);
    assert.equal(task(['list']).code, 0, due);
  }
});

test('a stored due date that is not a calendar date is still rejected', (t) => {
  useTempHome(t);
  for (const due of ['2026-02-30', '2026-13-01', '2026-10-20 24:00', '2026-10-20 12:60', 20261020]) {
    writeData(goodFile([goodTask({ due })]));
    assert.throws(() => load(), CorruptDataError, String(due));
  }
});

// ---- name rules ----

test('names are limited to one line of at most 200 characters', () => {
  const data = emptyData();
  const created = addTask(data, { name: '字'.repeat(NAME_LIMIT), steps: ['s'] }, NOW);
  assert.equal(created.name.length, NAME_LIMIT);
  const tooLong = '字'.repeat(NAME_LIMIT + 1);
  for (const bad of [tooLong, 'line1\nline2', 'tab\there', `bell${String.fromCharCode(7)}`, `esc${String.fromCharCode(27)}[31mred`, 'cr\rhere']) {
    const label = JSON.stringify(bad).slice(0, 30);
    assert.throws(() => addTask(data, { name: bad, steps: ['s'] }, NOW), TaskError, label);
    assert.throws(() => addTask(data, { name: 'ok', steps: [bad] }, NOW), TaskError, label);
    assert.throws(() => addStep(data, created.id, bad), TaskError, label);
    assert.throws(() => editTask(data, created.id, { name: bad }), TaskError, label);
    assert.throws(() => addSuggestion(data, { name: bad, steps: ['s'], by: 'claude' }, NOW), TaskError, label);
    assert.throws(() => addSuggestion(data, { name: 'ok', steps: [bad], by: 'claude' }, NOW), TaskError, label);
  }
  assert.throws(() => renameStep(data, created.id, 1, tooLong), TaskError);
  assert.equal(data.tasks.length, 1);
});

test('the name error states the rule', () => {
  assert.throws(() => addTask(emptyData(), { name: 'x'.repeat(NAME_LIMIT + 1), steps: ['s'] }, NOW), /200/);
  assert.throws(() => addTask(emptyData(), { name: 'a\nb', steps: ['s'] }, NOW), /single line/i);
});

test('a suggestion source and an author are single-line too', () => {
  assert.throws(() => addSuggestion(emptyData(), { name: 'x', steps: ['s'], source: 'a\nb', by: 'claude' }, NOW), TaskError);
  assert.throws(() => addSuggestion(emptyData(), { name: 'x', steps: ['s'], by: 'cl\naude' }, NOW), TaskError);
});

// ---- failed writes ----

test('a failed write leaves no temp file behind and names the data file', (t) => {
  const dir = useTempHome(t);
  update((data) => addTask(data, { name: 'a', steps: ['s'] }, NOW));
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('operation not permitted'), { code: 'EROFS' }); });
  assert.throws(
    () => update((data) => addTask(data, { name: 'b', steps: ['s'] }, NOW)),
    (error) => error instanceof TaskError && error.message.includes(dataFile()) && /operation not permitted/.test(error.message),
  );
  t.mock.restoreAll();
  assert.deepEqual(fs.readdirSync(dir), ['tasks.json']);
  assert.deepEqual(load().tasks.map((x) => x.name), ['a']);
});

// ---- CLI messages ----

test('a negative number gets a plain explanation, quoted whole, not the option parser\'s text', (t) => {
  useTempHome(t);
  task(['add', 'a', '--step', 's']);
  for (const [args, typed] of [[['done', '1', '-1'], '-1'], [['show', '-1'], '-1'], [['done', '1', '-15'], '-15']]) {
    const { code, err } = task(args);
    assert.notEqual(code, 0);
    assert.match(err, /negative/i);
    assert.ok(err.includes(`"${typed}"`), err);
    assert.doesNotMatch(err, /positional argument/i);
  }
});

test('an unknown option is named without parser jargon', (t) => {
  useTempHome(t);
  const { code, err } = task(['list', '--bogus']);
  assert.notEqual(code, 0);
  assert.match(err, /--bogus/);
  assert.doesNotMatch(err, /positional argument/i);
});

test('an id too large to be a real id is rejected as typed', (t) => {
  useTempHome(t);
  const { code, err } = task(['show', '9007199254740993']);
  assert.notEqual(code, 0);
  assert.ok(err.includes('9007199254740993'));
});

test('a date in the right format that does not exist says so; a wrong format shows the format', () => {
  assert.throws(() => parseDue('2026-02-30'), /does not exist/i);
  assert.throws(() => parseDue('2026-10-14 25:00'), /does not exist/i);
  assert.throws(() => parseDue('2026-10-14 9:00'), /YYYY-MM-DD HH:mm/);
  assert.throws(() => parseDue('明天'), /YYYY-MM-DD/);
});

// ---- conflicting options ----

test('--due together with --no-due is refused and changes nothing', (t) => {
  useTempHome(t);
  task(['add', 'a', '--step', 's', '--due', '2026-10-20']);
  const { code, err } = task(['edit', '1', '--no-due', '--due', '2026-10-30']);
  assert.notEqual(code, 0);
  assert.match(err, /--due.*--no-due|--no-due.*--due/);
  assert.equal(load().tasks[0].due, '2026-10-20');
});

test('an option that takes one value is refused when given twice', (t) => {
  useTempHome(t);
  const { code, err } = task(['add', 'x', '--step', 's', '--due', '2026-10-20', '--due', '2026-10-21']);
  assert.notEqual(code, 0);
  assert.match(err, /--due.*once/i);
  assert.equal(load().tasks.length, 0);
  task(['add', 'a', '--step', 's']);
  assert.notEqual(task(['edit', '1', '--name', 'b', '--name', 'c']).code, 0);
  assert.equal(task(['add', 'p', '--step', 'one', '--step', 'two']).code, 0, '--step may repeat');
});

// ---- digest: records that cannot be understood ----

const digestOf = (homes) => buildDigest({ ...homes, now: Date.now(), days: 7, agents: ['claude', 'deepseek'] });

test('a Claude Code file that is not a record at all is counted as skipped', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'good', [claudeUser('还在')]);
  writeClaudeSession(homes.claudeHome, 'garbage', ['garbage, not a record at all']);
  writeClaudeSession(homes.claudeHome, 'other-json', ['{"some":"other format"}', '{"another":1}']);
  const result = digestOf(homes);
  assert.deepEqual(result.conversations.map((c) => c.messages[0].text), ['还在']);
  assert.deepEqual(result.skipped, [{ agent: 'claude', records: 2, lines: 0 }]);
});

test('an unreadable line inside a Claude Code record is counted, and the rest is kept', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'a', [claudeUser('前一条'), '{"type":"user","message":{"content":"cut off', claudeUser('后一条')]);
  const result = digestOf(homes);
  assert.deepEqual(result.conversations[0].messages.map((m) => m.text), ['前一条', '后一条']);
  assert.deepEqual(result.skipped, [{ agent: 'claude', records: 0, lines: 1 }]);
});

test('an empty Claude Code file is neither a conversation nor a problem', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'empty', []);
  assert.deepEqual(digestOf(homes), { days: 7, conversations: [], omittedConversations: 0, skipped: [] });
});

test('a DeepSeek Harness file that decompresses but is not a session record is counted as skipped', (t) => {
  const homes = useTempAgents(t);
  writeDshSession(homes.dshHome, 'odd', [{ some: 'other format' }, dshUser('x', Date.now())]);
  assert.deepEqual(digestOf(homes).skipped, [{ agent: 'deepseek', records: 1, lines: 0 }]);
});

test('task digest says how many records and lines it could not read', (t) => {
  useTempHome(t);
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'garbage', ['garbage, not a record at all']);
  writeClaudeSession(homes.claudeHome, 'a', [claudeUser('一条'), '{"type":"user","message":{"content":"cut off']);
  const { code, out } = task(['digest'], { TASKBOARD_CLAUDE_HOME: homes.claudeHome, TASKBOARD_DSH_HOME: path.join(homes.dshHome, 'none') });
  assert.equal(code, 0);
  assert.match(out, /skipped.*claude.*1 record.*1 line/is);
  assert.doesNotMatch(out, /No conversations found/);
});

test('the digest leaves out the organize runs that taskboard itself started', async (t) => {
  const { ORGANIZE_PROMPT } = await import('../src/widget/organize.js');
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'organize-run', [claudeUser(ORGANIZE_PROMPT)]);
  writeClaudeSession(homes.claudeHome, 'real', [claudeUser('帮我看看 taskboard 的 task digest 命令为什么慢')]);
  assert.deepEqual(digestOf(homes).conversations.map((c) => c.messages[0].text), ['帮我看看 taskboard 的 task digest 命令为什么慢']);
});
