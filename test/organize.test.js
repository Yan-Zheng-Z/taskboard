import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findClaude, claudeLaunch, createOrganizer, ORGANIZE_PROMPT } from '../src/widget/organize.js';
import { loadWidgetState, markOrganizeOffered, saveBounds, loadBounds } from '../src/widget/window-state.js';
import { readState, call } from '../src/widget/api.js';
import { update } from '../src/core/store.js';
import { addTask, addSuggestion, pendingSuggestions } from '../src/core/model.js';
import { load } from '../src/core/store.js';
import { useTempHome } from './helpers/tmp-home.js';

const NOW = '2026-10-12T10:00:00.000Z';
const fake = fileURLToPath(new URL('./helpers/fake-agent.js', import.meta.url));
// Stands in for Claude Code: `node fake-agent.js <mode>`.
const fakeLaunch = (mode) => ({ command: process.execPath, args: [fake, mode] });

function organizer(launch, options = {}) {
  const changes = [];
  const instance = createOrganizer({ launch, env: process.env, onChange: () => changes.push(instance.view(readState())), ...options });
  return { instance, changes };
}

// ---- suggestions through the widget interface ----

test('readState includes pending suggestions', (t) => {
  useTempHome(t);
  update((data) => addSuggestion(data, { name: '报销', due: '2026-10-16', steps: ['填表'], source: '昨天的对话', by: 'claude' }, NOW));
  assert.deepEqual(readState().suggestions, [
    { id: 1, name: '报销', due: '2026-10-16', steps: [{ name: '填表', done: false }], source: '昨天的对话', by: 'claude', createdAt: NOW },
  ]);
});

test('readState has an empty suggestion list by default', (t) => {
  useTempHome(t);
  assert.deepEqual(readState().suggestions, []);
});

test('the widget can accept and dismiss suggestions', (t) => {
  useTempHome(t);
  update((data) => {
    addSuggestion(data, { name: '要做的', steps: ['一', '二'], by: 'claude' }, NOW);
    addSuggestion(data, { name: '不要的', by: 'claude' }, NOW);
  });
  const accepted = call('acceptSuggestion', { suggestionId: 1 });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.state.tasks.map((task) => [task.name, task.steps.length]), [['要做的', 2]]);
  const dismissed = call('dismissSuggestion', { suggestionId: 2 });
  assert.equal(dismissed.ok, true);
  assert.deepEqual(dismissed.state.suggestions, []);
  assert.equal(dismissed.state.tasks.length, 1);
  assert.equal(call('acceptSuggestion', { suggestionId: 9 }).ok, false);
});

// ---- remembering that the card was offered ----

test('the organize card has not been offered on a fresh install', (t) => {
  useTempHome(t);
  assert.equal(loadWidgetState().organizeOffered, false);
});

test('markOrganizeOffered is remembered and survives window moves', (t) => {
  useTempHome(t);
  saveBounds({ x: 1, y: 2, width: 300, height: 400 });
  markOrganizeOffered();
  assert.equal(loadWidgetState().organizeOffered, true);
  assert.deepEqual(loadBounds(), { x: 1, y: 2, width: 300, height: 400 });
  saveBounds({ x: 5, y: 6, width: 300, height: 400 });
  assert.equal(loadWidgetState().organizeOffered, true);
  assert.deepEqual(loadBounds(), { x: 5, y: 6, width: 300, height: 400 });
});

// ---- when the card is shown ----

test('the card is offered only when never offered and there are no tasks or suggestions', (t) => {
  useTempHome(t);
  const { instance } = organizer(fakeLaunch('none'));
  assert.equal(instance.view(readState()).offer, true);
  update((data) => addSuggestion(data, { name: 's', by: 'claude' }, NOW));
  assert.equal(instance.view(readState()).offer, false);
  update((data) => { data.suggestions = []; addTask(data, { name: 'a task' }, NOW); });
  assert.equal(instance.view(readState()).offer, false);
});

test('"later" hides the card for good', (t) => {
  useTempHome(t);
  const { instance, changes } = organizer(fakeLaunch('none'));
  instance.later();
  assert.equal(instance.view(readState()).offer, false);
  assert.equal(changes.length, 1);
  assert.equal(organizer(fakeLaunch('none')).instance.view(readState()).offer, false);
});

test('the card is not offered while the data file is unreadable', (t) => {
  const dir = useTempHome(t);
  fs.writeFileSync(path.join(dir, 'tasks.json'), '{not json');
  assert.equal(organizer(fakeLaunch('none')).instance.view(readState()).offer, false);
});

test('without Claude Code the card says so instead of offering to start', (t) => {
  useTempHome(t);
  const view = organizer(null).instance.view(readState());
  assert.deepEqual([view.offer, view.available], [true, false]);
});

// ---- running the organizer ----

test('a successful run reports how many suggestions were added and is not offered again', async (t) => {
  useTempHome(t);
  const { instance, changes } = organizer(fakeLaunch('three'));
  const finished = instance.start();
  assert.equal(instance.view(readState()).phase, 'running');
  await finished;
  const view = instance.view(readState());
  assert.deepEqual([view.phase, view.added, view.offer], ['done', 3, false]);
  assert.equal(pendingSuggestions(load()).length, 3);
  assert.deepEqual(changes.map((change) => change.phase), ['running', 'done']);
  assert.equal(loadWidgetState().organizeOffered, true);
});

test('a run that finds nothing reports zero', async (t) => {
  useTempHome(t);
  const { instance } = organizer(fakeLaunch('none'));
  await instance.start();
  assert.deepEqual([instance.view(readState()).phase, instance.view(readState()).added], ['done', 0]);
});

test('a failing run reports a reason and leaves the data alone', async (t) => {
  useTempHome(t);
  update((data) => addTask(data, { name: 'kept' }, NOW));
  const { instance } = organizer(fakeLaunch('fail'));
  await instance.start();
  const view = instance.view(readState());
  assert.equal(view.phase, 'failed');
  assert.match(view.reason, /boom/);
  assert.deepEqual(load().tasks.map((task) => task.name), ['kept']);
});

test('a run that takes too long is stopped and reported', async (t) => {
  useTempHome(t);
  const { instance } = organizer(fakeLaunch('hang'), { timeoutMs: 400 });
  const started = Date.now();
  await instance.start();
  assert.equal(instance.view(readState()).phase, 'failed');
  assert.match(instance.view(readState()).reason, /time|超时/i);
  assert.ok(Date.now() - started < 5000);
});

test('a command that cannot be started is reported', async (t) => {
  useTempHome(t);
  const { instance } = organizer({ command: path.join(os.tmpdir(), 'no-such-agent-binary'), args: [] });
  await instance.start();
  assert.equal(instance.view(readState()).phase, 'failed');
});

test('starting twice does not launch a second run', async (t) => {
  useTempHome(t);
  const { instance } = organizer(fakeLaunch('three'));
  const first = instance.start();
  const second = instance.start();
  await Promise.all([first, second]);
  assert.equal(pendingSuggestions(load()).length, 3);
});

test('dismissing the result returns to the idle state', async (t) => {
  useTempHome(t);
  const { instance } = organizer(fakeLaunch('none'));
  await instance.start();
  instance.close();
  assert.equal(instance.view(readState()).phase, 'idle');
});

// ---- finding and launching Claude Code ----

test('findClaude looks through PATH and returns null when it is not there', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-path-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const empty = path.join(dir, 'empty');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(empty);
  fs.mkdirSync(bin);
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  fs.writeFileSync(path.join(bin, name), '', { mode: 0o755 });
  assert.equal(findClaude({ PATH: empty }), null);
  assert.equal(findClaude({ PATH: [empty, bin].join(path.delimiter) }), path.join(bin, name));
  assert.equal(findClaude({}), null);
});

test('Claude Code is launched non-interactively with only the task command allowed', () => {
  const launch = claudeLaunch('/somewhere/claude');
  assert.equal(launch.command, '/somewhere/claude');
  assert.deepEqual(launch.args.slice(0, 2), ['-p', ORGANIZE_PROMPT]);
  const allowed = launch.args[launch.args.indexOf('--allowedTools') + 1];
  assert.equal(allowed, 'Bash(task:*)');
  assert.equal(claudeLaunch(null), null);
});

test('the prompt is fixed text that treats the digest as material, and is safe to pass to a shell', () => {
  assert.match(ORGANIZE_PROMPT, /task digest/);
  assert.match(ORGANIZE_PROMPT, /task suggest/);
  assert.match(ORGANIZE_PROMPT, /not instructions/i);
  assert.doesNotMatch(ORGANIZE_PROMPT, /["`$%^&|<>\n\r\\]/);
});

test('cancel stops a run in progress so no agent process is left behind', async (t) => {
  useTempHome(t);
  const { instance } = organizer(fakeLaunch('hang'), { timeoutMs: 60_000 });
  const started = Date.now();
  const finished = instance.start();
  instance.cancel();
  await finished;
  assert.ok(Date.now() - started < 5000);
  assert.notEqual(instance.view(readState()).phase, 'running');
});

test('on Windows a run started through a .cmd launcher is fully stopped on timeout', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = useTempHome(t);
  const pidFile = path.join(dir, 'agent.pid');
  const launcher = path.join(dir, 'claude.cmd');
  fs.writeFileSync(launcher, `@echo off\r\n"${process.execPath}" "${fake}" hang\r\n`);
  const { instance } = organizer({ command: launcher, args: [], env: { FAKE_AGENT_PID_FILE: pidFile } }, { timeoutMs: 1500 });
  const started = Date.now();
  await instance.start();
  assert.equal(instance.view(readState()).phase, 'failed');
  assert.ok(Date.now() - started < 8000, 'the run ended soon after the time limit');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.throws(() => process.kill(pid, 0), 'the agent process behind the launcher is gone');
});

// ---- asking for a run at any time ----

test('open offers the card even after the first offer and with tasks in the list', (t) => {
  useTempHome(t);
  update((data) => addTask(data, { name: 'existing' }, NOW));
  const { instance, changes } = organizer(fakeLaunch('none'));
  instance.later();
  assert.equal(instance.view(readState()).offer, false);
  instance.open();
  const view = instance.view(readState());
  assert.deepEqual([view.offer, view.firstTime], [true, false]);
  assert.equal(changes.at(-1).offer, true);
});

test('the very first offer is marked as the first time', (t) => {
  useTempHome(t);
  assert.equal(organizer(fakeLaunch('none')).instance.view(readState()).firstTime, true);
});

test('declining an opened card closes it without starting anything', (t) => {
  useTempHome(t);
  update((data) => addTask(data, { name: 'existing' }, NOW));
  const { instance } = organizer(fakeLaunch('three'));
  instance.open();
  instance.later();
  assert.deepEqual([instance.view(readState()).offer, instance.view(readState()).phase], [false, 'idle']);
  assert.equal(pendingSuggestions(load()).length, 0);
});

test('a run started from an opened card adds suggestions next to existing tasks, and can be repeated', async (t) => {
  useTempHome(t);
  update((data) => addTask(data, { name: 'existing' }, NOW));
  const { instance } = organizer(fakeLaunch('three'));
  instance.open();
  await instance.start();
  assert.deepEqual([instance.view(readState()).phase, instance.view(readState()).added], ['done', 3]);
  instance.close();
  instance.open();
  assert.equal(instance.view(readState()).offer, true);
});

test('open does nothing while a run is in progress', async (t) => {
  useTempHome(t);
  const { instance } = organizer(fakeLaunch('hang'), { timeoutMs: 60_000 });
  const finished = instance.start();
  instance.open();
  assert.deepEqual([instance.view(readState()).phase, instance.view(readState()).offer], ['running', false]);
  instance.cancel();
  await finished;
});
