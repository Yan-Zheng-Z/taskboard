import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, loadSettings, saveSetting } from '../src/core/settings.js';
import { TaskError, addTask, setStepDone } from '../src/core/model.js';
import { update, dataDir } from '../src/core/store.js';
import { saveBounds, loadBounds, setCompact, loadWidgetState, markOrganizeOffered } from '../src/widget/window-state.js';
import { readState } from '../src/widget/api.js';
import { agentStatuses, installAgentSkill } from '../src/widget/agents.js';
import { run } from '../src/cli/run.js';
import { useTempHome } from './helpers/tmp-home.js';
import { useTempAgents, claudeUser, writeClaudeSession, dshSession, dshUser, writeDshSession } from './helpers/conversations.js';

function task(args, env = {}) {
  let out = '';
  let err = '';
  const code = run(args, { env, stdout: (text) => { out += `${text}\n`; }, stderr: (text) => { err += `${text}\n`; } });
  return { code, out, err };
}

// ---- reading and saving ----

test('settings have sensible defaults before anything is saved', (t) => {
  useTempHome(t);
  assert.deepEqual(loadSettings(), {
    theme: 'system', alwaysOnTop: true, archiveDays: 7, digestAgents: ['claude', 'deepseek'], digestDays: 7,
  });
  assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
});

test('a saved setting is returned, kept after reloading, and leaves the others alone', (t) => {
  useTempHome(t);
  assert.equal(saveSetting('theme', 'dark').theme, 'dark');
  saveSetting('archiveDays', 30);
  saveSetting('alwaysOnTop', false);
  saveSetting('digestDays', 3);
  saveSetting('digestAgents', ['claude']);
  assert.deepEqual(loadSettings(), { theme: 'dark', alwaysOnTop: false, archiveDays: 30, digestAgents: ['claude'], digestDays: 3 });
});

test('values outside the allowed choices are refused and change nothing', (t) => {
  useTempHome(t);
  saveSetting('theme', 'light');
  const bad = [
    ['theme', 'purple'], ['theme', undefined], ['alwaysOnTop', 'yes'], ['archiveDays', 8], ['archiveDays', '7'],
    ['digestDays', 0], ['digestAgents', []], ['digestAgents', ['claude', 'gpt']], ['digestAgents', 'claude'],
    ['notASetting', 1], ['__proto__', {}],
  ];
  for (const [key, value] of bad) {
    assert.throws(() => saveSetting(key, value), TaskError, `${key}=${JSON.stringify(value)}`);
  }
  assert.deepEqual(loadSettings(), { ...DEFAULT_SETTINGS, theme: 'light' });
});

test('the agent list is stored without duplicates, in a fixed order', (t) => {
  useTempHome(t);
  assert.deepEqual(saveSetting('digestAgents', ['deepseek', 'claude', 'deepseek']).digestAgents, ['claude', 'deepseek']);
});

test('a hand-edited file with a bad value falls back to the default for that setting only', (t) => {
  useTempHome(t);
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), 'widget.json'), JSON.stringify({ settings: { theme: 'neon', archiveDays: 14, digestAgents: 'all' } }));
  assert.deepEqual(loadSettings(), { ...DEFAULT_SETTINGS, archiveDays: 14 });
});

test('settings share the widget file with the window position and other state without overwriting it', (t) => {
  useTempHome(t);
  saveBounds({ x: 1, y: 2, width: 300, height: 400 });
  setCompact(true);
  markOrganizeOffered();
  saveSetting('theme', 'dark');
  assert.deepEqual(loadBounds(), { x: 1, y: 2, width: 300, height: 400 });
  assert.deepEqual(loadWidgetState(), { organizeOffered: true, compact: true });
  saveBounds({ x: 9, y: 9, width: 300, height: 400 });
  setCompact(false);
  assert.equal(loadSettings().theme, 'dark');
});

// ---- archive length ----

test('the archive shows as many days as the setting says', (t) => {
  useTempHome(t);
  const iso = new Date().toISOString();
  const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();
  update((data) => {
    for (const [name, when] of [['today', daysAgo(0)], ['8 days ago', daysAgo(8)], ['20 days ago', daysAgo(20)], ['40 days ago', daysAgo(40)]]) {
      const created = addTask(data, { name, steps: ['s'] }, iso);
      setStepDone(data, created.id, 1, true, 'user', when);
    }
  });
  assert.deepEqual([readState().archiveDays, readState().archive.map((x) => x.name)], [7, ['today']]);
  saveSetting('archiveDays', 14);
  assert.deepEqual(readState().archive.map((x) => x.name), ['today', '8 days ago']);
  saveSetting('archiveDays', 30);
  assert.deepEqual([readState().archiveDays, readState().archive.map((x) => x.name)], [30, ['today', '8 days ago', '20 days ago']]);
});

// ---- digest defaults ----

test('task digest without options uses the sources and days from the settings; options win', (t) => {
  useTempHome(t);
  const homes = useTempAgents(t);
  const env = { TASKBOARD_CLAUDE_HOME: homes.claudeHome, TASKBOARD_DSH_HOME: homes.dshHome };
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
  writeClaudeSession(homes.claudeHome, 'recent', [claudeUser('claude 昨天', { timestamp: ago(1) })], { daysAgo: 1 });
  writeClaudeSession(homes.claudeHome, 'older', [claudeUser('claude 五天前', { timestamp: ago(5) })], { daysAgo: 5 });
  writeDshSession(homes.dshHome, 'd', [dshSession(), dshUser('deepseek 昨天', Date.now() - 86400000)], { daysAgo: 1 });

  const all = task(['digest'], env).out;
  for (const piece of ['claude 昨天', 'claude 五天前', 'deepseek 昨天']) assert.ok(all.includes(piece), piece);

  saveSetting('digestAgents', ['claude']);
  saveSetting('digestDays', 3);
  const narrowed = task(['digest'], env).out;
  assert.ok(narrowed.includes('claude 昨天'));
  assert.ok(!narrowed.includes('claude 五天前'), 'days come from the settings');
  assert.ok(!narrowed.includes('deepseek 昨天'), 'sources come from the settings');
  assert.match(narrowed, /last 3 days/);

  const overridden = task(['digest', '--agent', 'deepseek', '--days', '7'], env).out;
  assert.ok(overridden.includes('deepseek 昨天'));
  assert.ok(!overridden.includes('claude 昨天'));
  const both = task(['digest', '--agent', 'all'], env).out;
  assert.ok(both.includes('claude 昨天') && both.includes('deepseek 昨天'));
});

// ---- agent integration status and install ----

function agentEnv(t) {
  const homes = useTempAgents(t);
  return { env: { TASKBOARD_CLAUDE_HOME: homes.claudeHome, TASKBOARD_DSH_HOME: homes.dshHome, PATH: '' }, homes };
}

const skillFile = (home) => path.join(home, 'skills', 'taskboard', 'SKILL.md');

test('agents that are not on this machine are reported as not detected, with no skill installed', (t) => {
  const { env } = agentEnv(t);
  assert.deepEqual(agentStatuses(env).map((a) => [a.id, a.name, a.detected, a.skill]), [
    ['claude', 'Claude Code', false, 'missing'],
    ['deepseek', 'DeepSeek Harness', false, 'missing'],
  ]);
});

test('an agent whose home directory is in use is detected; an empty one is not', (t) => {
  const { env, homes } = agentEnv(t);
  fs.mkdirSync(homes.claudeHome, { recursive: true });
  assert.deepEqual(agentStatuses(env).map((a) => a.detected), [false, false]);
  fs.mkdirSync(path.join(homes.claudeHome, 'projects'));
  assert.deepEqual(agentStatuses(env).map((a) => a.detected), [true, false]);
});

test('looking at the status writes nothing', (t) => {
  const { env, homes } = agentEnv(t);
  agentStatuses(env);
  assert.equal(fs.existsSync(homes.claudeHome), false);
  assert.equal(fs.existsSync(homes.dshHome), false);
});

test('installing copies the skill for that agent only, and the status becomes current', (t) => {
  const { env, homes } = agentEnv(t);
  const after = installAgentSkill('claude', env);
  assert.equal(after.skill, 'current');
  assert.match(fs.readFileSync(skillFile(homes.claudeHome), 'utf8'), /--by claude/);
  assert.equal(fs.existsSync(homes.dshHome), false);
  installAgentSkill('deepseek', env);
  assert.match(fs.readFileSync(skillFile(homes.dshHome), 'utf8'), /--by deepseek/);
  assert.deepEqual(agentStatuses(env).map((a) => a.skill), ['current', 'current']);
});

test('a skill that differs from the current one is reported as outdated, and installing updates it', (t) => {
  const { env, homes } = agentEnv(t);
  fs.mkdirSync(path.dirname(skillFile(homes.claudeHome)), { recursive: true });
  fs.writeFileSync(skillFile(homes.claudeHome), 'an older version of the skill');
  assert.equal(agentStatuses(env)[0].skill, 'outdated');
  assert.equal(installAgentSkill('claude', env).skill, 'current');
});

test('line-ending differences alone do not make a skill outdated', (t) => {
  const { env, homes } = agentEnv(t);
  installAgentSkill('claude', env);
  const file = skillFile(homes.claudeHome);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
  assert.equal(agentStatuses(env)[0].skill, 'current');
});

test('installing for an unknown agent, or where it cannot write, fails with a reason', (t) => {
  const { env, homes } = agentEnv(t);
  assert.throws(() => installAgentSkill('gpt', env), TaskError);
  // A file where the skills directory should be makes the copy impossible.
  fs.mkdirSync(homes.claudeHome, { recursive: true });
  fs.writeFileSync(path.join(homes.claudeHome, 'skills'), 'not a directory');
  assert.throws(() => installAgentSkill('claude', env), (error) => error instanceof TaskError && error.message.includes('Claude Code'));
});

// ---- found in code review ----

test('installing for an agent that is not on this machine does not make it look detected', (t) => {
  const { env } = agentEnv(t);
  installAgentSkill('deepseek', env);
  const [, deepseek] = agentStatuses(env);
  assert.deepEqual([deepseek.detected, deepseek.skill], [false, 'current']);
});

test('an agent home with other content than our skill is detected', (t) => {
  const { env, homes } = agentEnv(t);
  installAgentSkill('deepseek', env);
  fs.mkdirSync(path.join(homes.dshHome, 'sessions'));
  assert.equal(agentStatuses(env)[1].detected, true);
  installAgentSkill('claude', env);
  fs.mkdirSync(path.join(homes.claudeHome, 'skills', 'another-skill'));
  assert.equal(agentStatuses(env)[0].detected, true);
});

test('a missing template does not break the status; installing then fails with a reason', (t) => {
  const { env } = agentEnv(t);
  installAgentSkill('claude', env);
  const real = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...rest) => {
    if (String(file).includes(path.join('integrations', 'claude'))) throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
    return real(file, ...rest);
  });
  t.mock.method(fs, 'copyFileSync', () => { throw Object.assign(new Error('no such file'), { code: 'ENOENT' }); });
  assert.doesNotThrow(() => agentStatuses(env));
  assert.equal(agentStatuses(env)[0].skill, 'current');
  assert.throws(() => installAgentSkill('claude', env), TaskError);
});
