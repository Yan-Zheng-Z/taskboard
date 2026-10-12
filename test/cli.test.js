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

// A task with the given steps; returns nothing, the first task gets id 1.
const add = (name, steps = ['s1', 's2'], extra = []) => task(['add', name, ...steps.flatMap((s) => ['--step', s]), ...extra]);

// ---- tasks ----

test('add creates a task with its steps and prints its id', (t) => {
  useTempHome(t);
  const result = task(['add', '写论文第二章', '--step', '收集文献', '--step', '写初稿', '--due', '2026-10-20']);
  assert.equal(result.code, 0);
  assert.match(result.out, /\b1\b/);
  const [created] = load().tasks;
  assert.deepEqual([created.id, created.name, created.due], [1, '写论文第二章', '2026-10-20']);
  assert.deepEqual(created.steps.map((s) => [s.id, s.name, s.done]), [[1, '收集文献', false], [2, '写初稿', false]]);
});

test('add without a step fails, says a step is needed and creates nothing', (t) => {
  useTempHome(t);
  const result = task(['add', '写论文第二章']);
  assert.notEqual(result.code, 0);
  assert.match(result.err, /--step/);
  assert.equal(load().tasks.length, 0);
});

test('add does not accept steps that are already done', (t) => {
  useTempHome(t);
  assert.notEqual(task(['add', 'x', '--done-step', 'a']).code, 0);
  assert.equal(load().tasks.length, 0);
});

test('add with a malformed due date fails, explains the format and creates nothing', (t) => {
  useTempHome(t);
  const result = task(['add', 'X', '--step', 'a', '--due', '明天']);
  assert.notEqual(result.code, 0);
  assert.match(result.err, /YYYY-MM-DD/);
  assert.equal(result.out, '');
  assert.equal(load().tasks.length, 0);
});

test('add without a name fails', (t) => {
  useTempHome(t);
  assert.notEqual(task(['add', '--step', 'a']).code, 0);
});

test('edit changes name and due date; --no-due clears it; nothing to change fails', (t) => {
  useTempHome(t);
  add('a', ['s'], ['--due', '2026-10-20']);
  assert.equal(task(['edit', '1', '--name', 'b', '--due', '2026-11-01']).code, 0);
  assert.deepEqual([load().tasks[0].name, load().tasks[0].due], ['b', '2026-11-01']);
  assert.equal(task(['edit', '1', '--no-due']).code, 0);
  assert.equal(load().tasks[0].due, null);
  assert.notEqual(task(['edit', '1']).code, 0);
});

test('rm deletes a task; a missing task or a non-numeric id fails with a reason', (t) => {
  useTempHome(t);
  add('a');
  assert.equal(task(['rm', '1']).code, 0);
  assert.equal(load().tasks.length, 0);
  assert.match(task(['rm', '7']).err, /task 7 does not exist/i);
  assert.match(task(['rm', 'abc']).err, /task id/i);
});

// ---- steps ----

test('step add prints the new step id', (t) => {
  useTempHome(t);
  add('a', ['收集文献']);
  const result = task(['step', 'add', '1', '写初稿']);
  assert.equal(result.code, 0);
  assert.match(result.out, /\b2\b/);
  assert.deepEqual(load().tasks[0].steps.map((s) => s.name), ['收集文献', '写初稿']);
});

test('step rename and step rm work; a missing step fails with a reason', (t) => {
  useTempHome(t);
  add('a', ['old', 'other']);
  assert.equal(task(['step', 'rename', '1', '1', 'new']).code, 0);
  assert.equal(load().tasks[0].steps[0].name, 'new');
  assert.match(task(['step', 'rm', '1', '9']).err, /step 9 does not exist in task 1/i);
  assert.equal(task(['step', 'rm', '1', '1']).code, 0);
  assert.deepEqual(load().tasks[0].steps.map((s) => s.name), ['other']);
});

test('the last step cannot be removed', (t) => {
  useTempHome(t);
  add('a', ['only']);
  const result = task(['step', 'rm', '1', '1']);
  assert.notEqual(result.code, 0);
  assert.match(result.err, /at least one step/i);
  assert.equal(load().tasks[0].steps.length, 1);
});

test('an unknown step subcommand fails', (t) => {
  useTempHome(t);
  assert.notEqual(task(['step', 'explode', '1']).code, 0);
});

// ---- done and reopen ----

test('done marks a step finished and names it; reopen undoes that', (t) => {
  useTempHome(t);
  add('搬家', ['找房子', '打包']);
  const done = task(['done', '1', '2']);
  assert.equal(done.code, 0);
  assert.match(done.out, /打包/);
  assert.equal(load().tasks[0].steps[1].done, true);
  const reopened = task(['reopen', '1', '2']);
  assert.equal(reopened.code, 0);
  assert.match(reopened.out, /打包/);
  assert.equal(load().tasks[0].steps[1].done, false);
});

test('done and reopen need a step number', (t) => {
  useTempHome(t);
  add('a');
  for (const command of ['done', 'reopen']) {
    const result = task([command, '1']);
    assert.notEqual(result.code, 0);
    assert.match(result.err, /step/i);
  }
  assert.ok(load().tasks[0].steps.every((s) => !s.done));
});

test('finishing the last step says the task is complete and archived', (t) => {
  useTempHome(t);
  add('a', ['one', 'two']);
  assert.doesNotMatch(task(['done', '1', '1']).out, /archived/i);
  assert.match(task(['done', '1', '2']).out, /complete.*archived/i);
  assert.ok(load().tasks[0].completedAt);
});

test('reopening a step of an archived task says the task is open again', (t) => {
  useTempHome(t);
  add('a', ['one']);
  task(['done', '1', '1']);
  assert.match(task(['reopen', '1', '1']).out, /open again/i);
  assert.equal(load().tasks[0].completedAt, null);
});

test('the removed progress command explains what to use instead and changes nothing', (t) => {
  useTempHome(t);
  add('a');
  for (const args of [['progress', '1', '2', '60'], ['progress', '1', '2', '150'], ['progress', '1', '40']]) {
    const result = task(args);
    assert.notEqual(result.code, 0);
    assert.match(result.err, /task done/);
    assert.match(result.err, /task reopen/);
  }
  assert.ok(load().tasks[0].steps.every((s) => !s.done));
});

test('--by records the author; without it TASKBOARD_ACTOR, then "user"', (t) => {
  useTempHome(t);
  add('a', ['s1', 's2', 's3']);
  task(['done', '1', '1']);
  task(['done', '1', '2'], { TASKBOARD_ACTOR: 'claude' });
  task(['done', '1', '3', '--by', 'deepseek'], { TASKBOARD_ACTOR: 'claude' });
  assert.deepEqual(load().tasks[0].steps.map((s) => s.updatedBy), ['user', 'claude', 'deepseek']);
});

test('an empty or blank TASKBOARD_ACTOR falls back to "user"; an explicitly empty --by is rejected', (t) => {
  useTempHome(t);
  add('a', ['s1', 's2', 's3']);
  assert.equal(task(['done', '1', '1'], { TASKBOARD_ACTOR: '' }).code, 0);
  assert.equal(task(['done', '1', '2'], { TASKBOARD_ACTOR: '   ' }).code, 0);
  assert.deepEqual(load().tasks[0].steps.slice(0, 2).map((s) => s.updatedBy), ['user', 'user']);
  assert.notEqual(task(['done', '1', '3', '--by', '']).code, 0);
});

// ---- viewing ----

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('list shows open tasks with id, progress, due date, urgency and name', (t) => {
  useTempHome(t);
  add('late', ['a', 'b'], ['--due', day(-2)]);
  add('today', ['a'], ['--due', day(0)]);
  add('soon', ['a'], ['--due', day(2)]);
  add('far', ['a'], ['--due', day(20)]);
  add('no date', ['a']);
  task(['done', '1', '1']);
  const lines = task(['list']).out.trim().split('\n');
  assert.equal(lines.length, 5);
  assert.match(lines[0], /#1\s+50%.*overdue by 2 days.*late/i);
  assert.match(lines[1], /due today/i);
  assert.match(lines[2], /2 days left/i);
  assert.match(lines[3], /20 days left/i);
  assert.doesNotMatch(lines[4], /overdue|left|today/i);
});

test('list leaves out archived tasks; --archived shows them with the completion date; --all shows both', (t) => {
  useTempHome(t);
  add('open one', ['a']);
  add('finished one', ['a']);
  task(['done', '2', '1']);
  const open = task(['list']).out;
  assert.match(open, /open one/);
  assert.doesNotMatch(open, /finished one/);
  const archived = task(['list', '--archived']).out;
  assert.match(archived, /finished one/);
  assert.match(archived, new RegExp(`done ${day(0)}`));
  assert.doesNotMatch(archived, /open one/);
  const all = task(['list', '--all']).out;
  assert.match(all, /open one/);
  assert.match(all, /finished one/);
});

test('list with no open tasks succeeds and says so; the archive likewise', (t) => {
  useTempHome(t);
  assert.match(task(['list']).out, /no open tasks/i);
  assert.match(task(['list', '--archived']).out, /no archived tasks/i);
  assert.deepEqual(JSON.parse(task(['list', '--json']).out), { tasks: [] });
});

test('--archived and --all cannot be combined', (t) => {
  useTempHome(t);
  assert.notEqual(task(['list', '--archived', '--all']).code, 0);
});

test('show prints each step with id, state, name, author and time', (t) => {
  useTempHome(t);
  add('写论文', ['收集文献', '写初稿'], ['--due', '2026-10-20']);
  task(['done', '1', '1', '--by', 'claude']);
  const { code, out } = task(['show', '1']);
  assert.equal(code, 0);
  for (const piece of ['写论文', '2026-10-20', '50%', '1 of 2', '[x] 收集文献', '[ ] 写初稿', 'claude']) {
    assert.ok(out.includes(piece), `${piece}\n${out}`);
  }
  assert.match(out, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
});

test('show says when an archived task was completed', (t) => {
  useTempHome(t);
  add('a', ['one']);
  task(['done', '1', '1']);
  assert.match(task(['show', '1']).out, new RegExp(`Completed: ${day(0)}`));
});

test('--json output carries progress, state, days, completion time and step state', (t) => {
  useTempHome(t);
  add('late', ['a', 'b'], ['--due', day(-2)]);
  add('finished', ['a'], ['--due', day(-5)]);
  add('no date', ['a']);
  task(['done', '1', '1', '--by', 'claude']);
  task(['done', '2', '1']);
  const shown = JSON.parse(task(['show', '1', '--json']).out);
  assert.deepEqual([shown.id, shown.progress, shown.state, shown.days, shown.completedAt], [1, 50, 'overdue', -2, null]);
  assert.deepEqual(shown.steps.map((s) => [s.id, s.name, s.done, s.updatedBy]), [[1, 'a', true, 'claude'], [2, 'b', false, null]]);
  const open = JSON.parse(task(['list', '--json']).out).tasks;
  assert.deepEqual(open.map((x) => [x.id, x.state]), [[1, 'overdue'], [3, 'none']]);
  const all = JSON.parse(task(['list', '--all', '--json']).out).tasks;
  assert.deepEqual(all.map((x) => [x.id, x.state]), [[1, 'overdue'], [3, 'none'], [2, 'done']]);
  assert.ok(all[2].completedAt);
});

// ---- errors and help ----

test('an unknown subcommand fails and lists the available ones', (t) => {
  useTempHome(t);
  const result = task(['frobnicate']);
  assert.notEqual(result.code, 0);
  assert.match(result.err, /frobnicate/);
  assert.match(result.err, /add.*list/s);
});

test('--help and no arguments print usage and succeed', (t) => {
  useTempHome(t);
  for (const args of [['--help'], ['-h'], []]) {
    const result = task(args);
    assert.equal(result.code, 0);
    for (const word of ['add', 'step', 'done', 'reopen', 'list', '--archived', 'show', '--by', '--step']) {
      assert.ok(result.out.includes(word), word);
    }
    assert.doesNotMatch(result.out, /task progress/);
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
  const ok = spawnSync(process.execPath, [mainScript, 'add', 'from a real process', '--step', 'a'], { env: process.env, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /1/);
  const bad = spawnSync(process.execPath, [mainScript, 'rm', '42'], { env: process.env, encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /task 42 does not exist/i);
  assert.equal(bad.stdout, '');
});
