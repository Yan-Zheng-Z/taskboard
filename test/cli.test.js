import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli/run.js';
import { load, dataDir, dataFile } from '../src/core/store.js';
import { useTempHome } from './helpers/tmp-home.js';

const mainScript = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));

// Runs the CLI in-process and captures what it prints.
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

test('add creates a task and prints its id', (t) => {
  useTempHome(t);
  const result = task(['add', '写论文第二章', '--due', '2026-10-20']);
  assert.equal(result.code, 0);
  assert.match(result.out, /\b1\b/);
  assert.deepEqual(load().tasks.map((x) => [x.id, x.name, x.due]), [[1, '写论文第二章', '2026-10-20']]);
});

test('add with a malformed due date fails, explains the format and creates nothing', (t) => {
  useTempHome(t);
  const result = task(['add', 'X', '--due', '明天']);
  assert.notEqual(result.code, 0);
  assert.match(result.err, /YYYY-MM-DD/);
  assert.equal(result.out, '');
  assert.equal(load().tasks.length, 0);
});

test('add without a name fails', (t) => {
  useTempHome(t);
  assert.notEqual(task(['add']).code, 0);
});

test('edit changes name and due date; --no-due clears it', (t) => {
  useTempHome(t);
  task(['add', 'a', '--due', '2026-10-20']);
  assert.equal(task(['edit', '1', '--name', 'b', '--due', '2026-11-01']).code, 0);
  assert.deepEqual([load().tasks[0].name, load().tasks[0].due], ['b', '2026-11-01']);
  assert.equal(task(['edit', '1', '--no-due']).code, 0);
  assert.equal(load().tasks[0].due, null);
});

test('edit with nothing to change fails', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  assert.notEqual(task(['edit', '1']).code, 0);
});

test('rm deletes a task; a missing task fails with a reason', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  assert.equal(task(['rm', '1']).code, 0);
  assert.equal(load().tasks.length, 0);
  const missing = task(['rm', '7']);
  assert.notEqual(missing.code, 0);
  assert.match(missing.err, /task 7 does not exist/i);
});

test('a non-numeric task id fails', (t) => {
  useTempHome(t);
  const result = task(['rm', 'abc']);
  assert.notEqual(result.code, 0);
  assert.match(result.err, /task id/i);
});

test('step add prints the new step id', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', '收集文献']);
  const result = task(['step', 'add', '1', '写初稿']);
  assert.equal(result.code, 0);
  assert.match(result.out, /\b2\b/);
  assert.deepEqual(load().tasks[0].steps.map((s) => s.name), ['收集文献', '写初稿']);
});

test('step rename and step rm work; a missing step fails with a reason', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 'old']);
  assert.equal(task(['step', 'rename', '1', '1', 'new']).code, 0);
  assert.equal(load().tasks[0].steps[0].name, 'new');
  const missing = task(['step', 'rm', '1', '9']);
  assert.notEqual(missing.code, 0);
  assert.match(missing.err, /step 9 does not exist in task 1/i);
  assert.equal(task(['step', 'rm', '1', '1']).code, 0);
  assert.equal(load().tasks[0].steps.length, 0);
});

test('an unknown step subcommand fails', (t) => {
  useTempHome(t);
  assert.notEqual(task(['step', 'explode', '1']).code, 0);
});

test('progress sets a step percentage', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 's1']);
  task(['step', 'add', '1', 's2']);
  assert.equal(task(['progress', '1', '2', '60']).code, 0);
  assert.equal(load().tasks[0].steps[1].percent, 60);
});

test('progress rejects out-of-range and non-numeric percentages and changes nothing', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 's1']);
  for (const bad of ['150', 'half', '12.5']) {
    const result = task(['progress', '1', '1', bad]);
    assert.notEqual(result.code, 0, bad);
    assert.match(result.err, /0 to 100/);
  }
  assert.equal(load().tasks[0].steps[0].percent, 0);
});

test('progress with two numbers sets task-level progress on a task without steps', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  assert.equal(task(['progress', '1', '40']).code, 0);
  assert.equal(load().tasks[0].percent, 40);
});

test('done marks a step as 100', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 's1']);
  assert.equal(task(['done', '1', '1']).code, 0);
  assert.equal(load().tasks[0].steps[0].percent, 100);
});

test('--by records the author', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 's1']);
  task(['done', '1', '1', '--by', 'deepseek']);
  assert.equal(load().tasks[0].steps[0].updatedBy, 'deepseek');
});

test('without --by the author comes from TASKBOARD_ACTOR, then falls back to "user"', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 's1']);
  task(['progress', '1', '1', '10']);
  assert.equal(load().tasks[0].steps[0].updatedBy, 'user');
  task(['progress', '1', '1', '20'], { TASKBOARD_ACTOR: 'claude' });
  assert.equal(load().tasks[0].steps[0].updatedBy, 'claude');
  task(['progress', '1', '1', '30', '--by', 'deepseek'], { TASKBOARD_ACTOR: 'claude' });
  assert.equal(load().tasks[0].steps[0].updatedBy, 'deepseek');
});

test('list shows one line per task with id, name, due date and progress', (t) => {
  useTempHome(t);
  task(['add', '写论文', '--due', '2026-10-20']);
  task(['add', '无截止']);
  task(['step', 'add', '1', 's1']);
  task(['step', 'add', '1', 's2']);
  task(['done', '1', '1']);
  const result = task(['list']);
  assert.equal(result.code, 0);
  const lines = result.out.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /1/);
  assert.match(lines[0], /写论文/);
  assert.match(lines[0], /2026-10-20/);
  assert.match(lines[0], /50%/);
  assert.match(lines[1], /无截止/);
  assert.match(lines[1], /0%/);
});

test('list with no tasks succeeds and says so', (t) => {
  useTempHome(t);
  const result = task(['list']);
  assert.equal(result.code, 0);
  assert.match(result.out, /no tasks/i);
});

test('show prints each step with id, name, progress, author and time', (t) => {
  useTempHome(t);
  task(['add', '写论文', '--due', '2026-10-20']);
  task(['step', 'add', '1', '收集文献']);
  task(['progress', '1', '1', '60', '--by', 'claude']);
  const result = task(['show', '1']);
  assert.equal(result.code, 0);
  assert.match(result.out, /写论文/);
  assert.match(result.out, /2026-10-20/);
  assert.match(result.out, /收集文献/);
  assert.match(result.out, /60%/);
  assert.match(result.out, /claude/);
  assert.match(result.out, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
});

test('show --json and list --json print valid JSON with progress and steps', (t) => {
  useTempHome(t);
  task(['add', 'a', '--due', '2026-10-20']);
  task(['step', 'add', '1', 's1']);
  task(['progress', '1', '1', '60', '--by', 'claude']);
  const shown = JSON.parse(task(['show', '1', '--json']).out);
  assert.equal(shown.id, 1);
  assert.equal(shown.progress, 60);
  assert.equal(shown.due, '2026-10-20');
  assert.deepEqual(
    shown.steps.map((s) => [s.id, s.name, s.percent, s.updatedBy]),
    [[1, 's1', 60, 'claude']],
  );
  assert.ok(shown.steps[0].updatedAt);
  const listed = JSON.parse(task(['list', '--json']).out);
  assert.deepEqual(listed.tasks.map((x) => [x.id, x.progress]), [[1, 60]]);
});

test('list --json with no tasks prints an empty list', (t) => {
  useTempHome(t);
  assert.deepEqual(JSON.parse(task(['list', '--json']).out), { tasks: [] });
});

test('an unknown subcommand fails and lists the available ones', (t) => {
  useTempHome(t);
  const result = task(['frobnicate']);
  assert.notEqual(result.code, 0);
  assert.match(result.err, /frobnicate/);
  assert.match(result.err, /add.*list/s);
});

test('an unknown option fails', (t) => {
  useTempHome(t);
  assert.notEqual(task(['list', '--bogus']).code, 0);
});

test('--help and no arguments print usage and succeed', (t) => {
  useTempHome(t);
  for (const args of [['--help'], ['-h'], []]) {
    const result = task(args);
    assert.equal(result.code, 0);
    for (const word of ['add', 'step', 'progress', 'done', 'list', 'show', '--by']) {
      assert.ok(result.out.includes(word), word);
    }
  }
});

test('a corrupt data file makes commands fail with the file path', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(dataFile(), '{not json');
  const result = task(['list']);
  assert.notEqual(result.code, 0);
  assert.ok(result.err.includes(dataFile()));
});

test('the task executable exits non-zero on failure and writes the reason to stderr', (t) => {
  useTempHome(t);
  const ok = spawnSync(process.execPath, [mainScript, 'add', 'from a real process'], { env: process.env, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /1/);
  const bad = spawnSync(process.execPath, [mainScript, 'rm', '42'], { env: process.env, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /task 42 does not exist/i);
  assert.equal(bad.stdout, '');
});

test('an empty TASKBOARD_ACTOR falls back to "user"', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 's1']);
  const result = task(['done', '1', '1'], { TASKBOARD_ACTOR: '' });
  assert.equal(result.code, 0);
  assert.equal(load().tasks[0].steps[0].updatedBy, 'user');
});

test('an explicitly empty --by is rejected', (t) => {
  useTempHome(t);
  task(['add', 'a']);
  task(['step', 'add', '1', 's1']);
  assert.notEqual(task(['done', '1', '1', '--by', '']).code, 0);
});
