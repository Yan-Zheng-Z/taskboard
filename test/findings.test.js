// Regression tests for problems found by a first-time-user walkthrough.

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

const goodTask = (extra = {}) => ({
  id: 1, name: 'ok', due: null, createdAt: NOW, percent: 0, updatedBy: null, updatedAt: null, nextStepId: 1, steps: [], ...extra,
});
const goodFile = (tasks, extra = {}) => ({ version: 1, nextTaskId: 10, tasks, ...extra });

// ---- data file validation ----

test('a data file whose fields are wrong is treated like a broken file', (t) => {
  useTempHome(t);
  const bad = [
    goodFile([goodTask({ percent: 250 })]),
    goodFile([goodTask({ percent: '40' })]),
    goodFile([goodTask({ steps: 'none' })]),
    goodFile([goodTask({ due: '明天' })]),
    goodFile([goodTask({ name: '' })]),
    goodFile([goodTask({ name: 42 })]),
    goodFile([goodTask({ id: 0 })]),
    goodFile([goodTask({ id: '1' })]),
    goodFile([goodTask(), goodTask()]),
    goodFile(['not a task']),
    goodFile([goodTask({ nextStepId: 2, steps: [{ id: 1, name: 's', percent: 101, updatedBy: null, updatedAt: null }] })]),
    goodFile([goodTask({ nextStepId: 2, steps: [{ id: 1, name: '', percent: 0 }] })]),
    goodFile([goodTask({ nextStepId: 1, steps: [{ id: 1, name: 's', percent: 0 }] })]),
    goodFile([goodTask({ nextStepId: 3, steps: [{ id: 1, name: 'a', percent: 0 }, { id: 1, name: 'b', percent: 0 }] })]),
    { version: 1, nextTaskId: 1, tasks: [goodTask({ id: 5 })] },
    goodFile([goodTask()], { suggestions: 'none' }),
    goodFile([goodTask()], { suggestions: [{ id: 1, name: '', steps: [] }] }),
    goodFile([goodTask()], { dismissed: [1, 2] }),
  ];
  for (const data of bad) {
    writeData(data);
    assert.throws(() => load(), (error) => error instanceof CorruptDataError && error.message.includes(dataFile()), JSON.stringify(data).slice(0, 120));
  }
});

test('the error names the task and field that are wrong', (t) => {
  useTempHome(t);
  writeData(goodFile([goodTask({ id: 3, percent: 250 })]));
  assert.throws(() => load(), /task 3.*percent/is);
});

test('nothing is written to a data file with wrong fields', (t) => {
  useTempHome(t);
  const text = JSON.stringify(goodFile([goodTask({ steps: 'none' })]));
  writeData(text);
  const result = task(['add', '新任务']);
  assert.notEqual(result.code, 0);
  assert.ok(result.err.includes(dataFile()));
  assert.equal(fs.readFileSync(dataFile(), 'utf8'), text);
});

test('a next-id counter that is behind the existing ids is rejected instead of producing duplicate ids', (t) => {
  useTempHome(t);
  writeData({ version: 1, nextTaskId: 1, tasks: [goodTask({ id: 5 })] });
  assert.notEqual(task(['add', 'x']).code, 0);
});

test('a data file that starts with a byte order mark is read normally', (t) => {
  useTempHome(t);
  writeData(String.fromCharCode(0xfeff) + JSON.stringify(goodFile([goodTask()])));
  assert.deepEqual(load().tasks.map((x) => x.name), ['ok']);
  assert.equal(task(['add', 'second']).code, 0);
});

test('names longer than the limit that are already stored do not make the file unreadable', (t) => {
  useTempHome(t);
  writeData(goodFile([goodTask({ name: '长'.repeat(NAME_LIMIT + 300) })]));
  assert.equal(load().tasks.length, 1);
});

test('files written by the tool itself pass validation', (t) => {
  useTempHome(t);
  task(['add', 'a', '--due', '2026-10-20 18:30']);
  task(['step', 'add', '1', 's1']);
  task(['progress', '1', '1', '40', '--by', 'claude']);
  task(['add', 'b']);
  task(['progress', '2', '30']);
  task(['suggest', 'p', '--done-step', 'x', '--step', 'y', '--source', 'chat']);
  task(['suggest', 'q']);
  task(['dismiss', '2']);
  task(['rm', '2']);
  assert.equal(task(['list']).code, 0);
  assert.equal(load().tasks.length, 1);
});

// ---- name rules ----

test('names are limited to one line of at most 200 characters', () => {
  const data = emptyData();
  const created = addTask(data, { name: '字'.repeat(NAME_LIMIT) }, NOW);
  assert.equal(created.name.length, NAME_LIMIT);
  const tooLong = '字'.repeat(NAME_LIMIT + 1);
  for (const bad of [tooLong, 'line1\nline2', 'tab\there', 'bell\u0007', 'esc\u001b[31mred', 'cr\rhere']) {
    assert.throws(() => addTask(data, { name: bad }, NOW), TaskError, JSON.stringify(bad).slice(0, 30));
    assert.throws(() => addStep(data, created.id, bad), TaskError);
    assert.throws(() => editTask(data, created.id, { name: bad }), TaskError);
    assert.throws(() => addSuggestion(data, { name: bad, by: 'claude' }, NOW), TaskError);
    assert.throws(() => addSuggestion(data, { name: 'ok', steps: [bad], by: 'claude' }, NOW), TaskError);
  }
  const step = addStep(data, created.id, 's');
  assert.throws(() => renameStep(data, created.id, step.id, tooLong), TaskError);
  assert.equal(data.tasks.length, 1);
});

test('the name error states the rule', () => {
  assert.throws(() => addTask(emptyData(), { name: 'x'.repeat(NAME_LIMIT + 1) }, NOW), /200/);
  assert.throws(() => addTask(emptyData(), { name: 'a\nb' }, NOW), /single line/i);
});

test('a suggestion source and an author are single-line too', () => {
  assert.throws(() => addSuggestion(emptyData(), { name: 'x', source: 'a\nb', by: 'claude' }, NOW), TaskError);
  assert.throws(() => addSuggestion(emptyData(), { name: 'x', by: 'cl\naude' }, NOW), TaskError);
});

// ---- failed writes ----

test('a failed write leaves no temp file behind and names the data file', (t) => {
  const dir = useTempHome(t);
  update((data) => addTask(data, { name: 'a' }, NOW));
  t.mock.method(fs, 'renameSync', () => { throw Object.assign(new Error('operation not permitted'), { code: 'EROFS' }); });
  assert.throws(
    () => update((data) => addTask(data, { name: 'b' }, NOW)),
    (error) => error instanceof TaskError && error.message.includes(dataFile()) && /operation not permitted/.test(error.message),
  );
  t.mock.restoreAll();
  assert.deepEqual(fs.readdirSync(dir), ['tasks.json']);
  assert.deepEqual(load().tasks.map((x) => x.name), ['a']);
});

// ---- CLI output and messages ----

test('progress commands say which step or task they changed', (t) => {
  useTempHome(t);
  task(['add', '搬家']);
  for (const step of ['找房子', '签合同', '打包', '搬运']) task(['step', 'add', '1', step]);
  task(['step', 'rm', '1', '2']);
  assert.match(task(['done', '1', '3']).out, /打包/);
  assert.match(task(['progress', '1', '4', '50']).out, /搬运/);
  task(['add', '交报销单']);
  assert.match(task(['progress', '2', '40']).out, /交报销单/);
});

test('list marks overdue, due today, due soon and finished tasks', (t) => {
  useTempHome(t);
  const day = (offset) => {
    const d = new Date(Date.now() + offset * 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  task(['add', 'late', '--due', day(-2)]);
  task(['add', 'today', '--due', day(0)]);
  task(['add', 'soon', '--due', day(2)]);
  task(['add', 'far', '--due', day(20)]);
  task(['add', 'finished', '--due', day(-5)]);
  task(['progress', '5', '100']);
  task(['add', 'no date']);
  const lines = task(['list']).out.trim().split('\n');
  assert.match(lines[0], /overdue.*2 day/i);
  assert.match(lines[1], /due today/i);
  assert.match(lines[2], /2 days left/i);
  assert.match(lines[3], /20 days left/i);
  assert.match(lines[4], /done/i);
  assert.doesNotMatch(lines[4], /overdue/i);
  assert.doesNotMatch(lines[5], /overdue|left|today/i);
  const json = JSON.parse(task(['list', '--json']).out).tasks;
  assert.deepEqual(json.map((x) => [x.state, x.days]), [['overdue', -2], ['soon', 0], ['soon', 2], ['normal', 20], ['done', -5], ['none', null]]);
  assert.equal(JSON.parse(task(['show', '1', '--json']).out).state, 'overdue');
});

test('a bad percentage is quoted back as the user typed it', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 's']);
  for (const typed of ['50%', '+10', '50.5', '1e1', 'half']) {
    const { code, err } = task(['progress', '1', '1', typed]);
    assert.notEqual(code, 0);
    assert.ok(err.includes(`"${typed}"`), `${typed}: ${err}`);
    assert.doesNotMatch(err, /NaN/);
    assert.match(err, /0 to 100/);
  }
});

test('a negative number gets a plain explanation, not the option parser\'s text', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 's']);
  for (const args of [['progress', '1', '1', '-1'], ['show', '-1']]) {
    const { code, err } = task(args);
    assert.notEqual(code, 0);
    assert.match(err, /negative/i);
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

test('a date in the right format that does not exist says so', () => {
  assert.throws(() => parseDue('2026-02-30'), /does not exist/i);
  assert.throws(() => parseDue('2026-10-14 25:00'), /does not exist/i);
});

test('a date in the wrong format shows the format, including two-digit hours', () => {
  assert.throws(() => parseDue('2026-10-14 9:00'), /YYYY-MM-DD HH:mm/);
  assert.throws(() => parseDue('明天'), /YYYY-MM-DD/);
});

test('a blank TASKBOARD_ACTOR counts as unset', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 's']);
  assert.equal(task(['done', '1', '1'], { TASKBOARD_ACTOR: '   ' }).code, 0);
  assert.equal(load().tasks[0].steps[0].updatedBy, 'user');
});

// ---- conflicting options ----

test('--due together with --no-due is refused and changes nothing', (t) => {
  useTempHome(t);
  task(['add', 'a', '--due', '2026-10-20']);
  const { code, err } = task(['edit', '1', '--no-due', '--due', '2026-10-30']);
  assert.notEqual(code, 0);
  assert.match(err, /--due.*--no-due|--no-due.*--due/);
  assert.equal(load().tasks[0].due, '2026-10-20');
});

test('an option that takes one value is refused when given twice', (t) => {
  useTempHome(t);
  const { code, err } = task(['add', 'x', '--due', '2026-10-20', '--due', '2026-10-21']);
  assert.notEqual(code, 0);
  assert.match(err, /--due.*once/i);
  assert.equal(load().tasks.length, 0);
  task(['add', 'a']);
  assert.notEqual(task(['edit', '1', '--name', 'b', '--name', 'c']).code, 0);
  assert.equal(task(['suggest', 'p', '--step', 'one', '--step', 'two']).code, 0, '--step may repeat');
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

// ---- found in code review ----

test('a multi-digit negative number is quoted back whole', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 's']);
  const { code, err } = task(['progress', '1', '1', '-15']);
  assert.notEqual(code, 0);
  assert.ok(err.includes('"-15"'), err);
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
