import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDir, dataFile, load, update, breakStaleLock, CorruptDataError } from '../src/core/store.js';
import { addTask, TaskError } from '../src/core/model.js';
import { useTempHome } from './helpers/tmp-home.js';

const NOW = '2026-10-12T10:00:00.000Z';
const worker = fileURLToPath(new URL('./helpers/add-step-worker.js', import.meta.url));

test('data lives in ~/.taskboard by default and TASKBOARD_HOME overrides it', (t) => {
  const previous = process.env.TASKBOARD_HOME;
  delete process.env.TASKBOARD_HOME;
  t.after(() => { if (previous !== undefined) process.env.TASKBOARD_HOME = previous; });
  assert.equal(dataDir(), path.join(os.homedir(), '.taskboard'));
  process.env.TASKBOARD_HOME = path.join(os.tmpdir(), 'elsewhere');
  assert.equal(dataFile(), path.join(os.tmpdir(), 'elsewhere', 'tasks.json'));
});

test('load returns an empty task list when the file does not exist', (t) => {
  useTempHome(t);
  assert.deepEqual(load().tasks, []);
});

test('load does not create the data file', (t) => {
  useTempHome(t);
  load();
  assert.equal(fs.existsSync(dataFile()), false);
});

test('changes made in update are still there after reloading', (t) => {
  useTempHome(t);
  const created = update((data) => addTask(data, { name: '写论文', due: '2026-10-20' }, NOW));
  assert.equal(created.id, 1);
  assert.deepEqual(load().tasks.map((task) => [task.id, task.name, task.due]), [[1, '写论文', '2026-10-20']]);
});

test('update saves nothing when the callback throws', (t) => {
  useTempHome(t);
  update((data) => addTask(data, { name: 'kept' }, NOW));
  assert.throws(() => update((data) => {
    addTask(data, { name: 'discarded' }, NOW);
    throw new TaskError('boom');
  }), /boom/);
  assert.deepEqual(load().tasks.map((task) => task.name), ['kept']);
});

test('update leaves no lock or temp files behind', (t) => {
  const dir = useTempHome(t);
  update((data) => addTask(data, { name: 'a' }, NOW));
  assert.deepEqual(fs.readdirSync(dir), ['tasks.json']);
});

test('concurrent updates from several processes are all kept', async (t) => {
  useTempHome(t);
  update((data) => addTask(data, { name: 'shared' }, NOW));
  const names = Array.from({ length: 8 }, (_, i) => `writer-${i}`);
  const codes = await Promise.all(names.map((name) => new Promise((resolve) => {
    spawn(process.execPath, [worker, name], { env: process.env, stdio: 'inherit' }).on('exit', resolve);
  })));
  assert.deepEqual(codes, names.map(() => 0));
  const [task] = load().tasks;
  assert.deepEqual(task.steps.map((step) => step.name).sort(), names);
  assert.ok(task.steps.every((step) => step.percent === 100));
  assert.equal(new Set(task.steps.map((step) => step.id)).size, names.length);
});

test('update fails with a clear error while another process holds the lock', (t) => {
  useTempHome(t);
  update((data) => addTask(data, { name: 'a' }, NOW));
  fs.writeFileSync(`${dataFile()}.lock`, 'held');
  assert.throws(() => update((data) => addTask(data, { name: 'b' }, NOW), { timeoutMs: 200 }), /locked/i);
  assert.equal(load().tasks.length, 1);
});

test('a stale lock left by a crashed process is taken over', (t) => {
  useTempHome(t);
  update((data) => addTask(data, { name: 'a' }, NOW));
  const lock = `${dataFile()}.lock`;
  fs.writeFileSync(lock, 'dead');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  update((data) => addTask(data, { name: 'b' }, NOW), { timeoutMs: 200 });
  assert.equal(load().tasks.length, 2);
});

test('a leftover temp file from an interrupted write does not affect the data', (t) => {
  useTempHome(t);
  update((data) => addTask(data, { name: 'a' }, NOW));
  fs.writeFileSync(`${dataFile()}.tmp-999`, '{"version":1,"tasks":[{"na');
  assert.deepEqual(load().tasks.map((task) => task.name), ['a']);
});

test('load reports the file path when the data file is corrupt', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(), '{not json');
  assert.throws(() => load(), (error) => error instanceof CorruptDataError && error.message.includes(dataFile()));
});

test('load rejects data that parses but has the wrong shape', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  for (const bad of ['[]', '{"version":1}', '{"version":99,"nextTaskId":1,"tasks":[]}', 'null']) {
    fs.writeFileSync(dataFile(), bad);
    assert.throws(() => load(), CorruptDataError, bad);
  }
});

test('update refuses to write over a corrupt file and leaves it untouched', (t) => {
  const dir = useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(), '{not json');
  assert.throws(() => update((data) => addTask(data, { name: 'a' }, NOW)), CorruptDataError);
  assert.equal(fs.readFileSync(dataFile(), 'utf8'), '{not json');
  assert.deepEqual(fs.readdirSync(dir), ['tasks.json']);
});

test('update gives up with a clear error when the lock file cannot be created at all', (t) => {
  const dir = useTempHome(t);
  let calls = 0;
  t.mock.method(fs, 'openSync', () => {
    calls += 1;
    if (calls > 5000) throw new Error('spinning without waiting or giving up');
    throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
  });
  assert.throws(
    () => update((data) => addTask(data, { name: 'a' }, NOW), { timeoutMs: 150 }),
    (error) => error instanceof TaskError && error.message.includes(dir) && /operation not permitted/.test(error.message),
  );
});

test('breaking a stale lock removes the lock that was seen as stale', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  const lock = `${dataFile()}.lock`;
  fs.writeFileSync(lock, 'dead');
  breakStaleLock(lock, fs.statSync(lock).mtimeMs);
  assert.equal(fs.existsSync(lock), false);
});

test('breaking a stale lock leaves a lock that another process has re-created since', (t) => {
  const dir = useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  const lock = `${dataFile()}.lock`;
  fs.writeFileSync(lock, 'fresh, held by a live process');
  const staleMtimeSeenEarlier = fs.statSync(lock).mtimeMs - 60_000;
  breakStaleLock(lock, staleMtimeSeenEarlier);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'fresh, held by a live process');
  assert.deepEqual(fs.readdirSync(dir), ['tasks.json.lock']);
});

test('breaking a stale lock that is already gone does nothing', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  breakStaleLock(`${dataFile()}.lock`, 123);
});
