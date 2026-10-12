import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { skillText, skillFile, cleanAgentName, BUILT_IN_SKILLS } from '../src/core/skill-text.js';
import { TaskError } from '../src/core/model.js';
import { run } from '../src/cli/run.js';
import { useTempHome } from './helpers/tmp-home.js';

function task(args, env = {}) {
  let out = '';
  let err = '';
  const code = run(args, { env, stdout: (text) => { out += `${text}\n`; }, stderr: (text) => { err += `${text}\n`; } });
  return { code, out, err };
}

const normalized = (text) => text.replace(/\r\n/g, '\n');

test('the instructions sign every example with the given name and no other', () => {
  const text = skillText({ by: 'codex' });
  assert.ok(text.includes('--by codex'));
  assert.doesNotMatch(text, /--by (claude|deepseek)\b/);
  assert.match(text, /task done 3 2 --by codex/);
  assert.match(text, /task suggest .* --by codex/);
});

test('the instructions cover updating, adding, organizing and the rules', () => {
  const text = skillText({ by: 'glm' });
  for (const piece of ['task list', 'task show', 'task done', 'task reopen', 'task add', 'task digest', 'task suggest', 'Never read or edit the data file']) {
    assert.ok(text.includes(piece), piece);
  }
});

test('for an agent without its own reader, the instructions say whose conversations organize can see', () => {
  const other = skillText({ by: 'glm' });
  assert.match(other, /only reads .*Claude Code and DeepSeek Harness/i);
  assert.match(other, /your own .*conversations .*not/i);
  for (const builtIn of ['claude', 'deepseek']) {
    assert.doesNotMatch(skillText({ by: builtIn }), /your own .*conversations .*not/i);
  }
});

test('the plain instructions have no skill front matter; the skill file has it', () => {
  assert.ok(skillText({ by: 'codex' }).startsWith('# taskboard'));
  const file = skillFile({ by: 'claude' });
  assert.ok(file.startsWith('---\nname: taskboard\n'));
  assert.ok(file.includes(skillText({ by: 'claude' })));
});

test('an agent name is one short word', () => {
  assert.equal(cleanAgentName(' codex '), 'codex');
  assert.equal(cleanAgentName('glm-4.6'), 'glm-4.6');
  for (const bad of ['', '  ', 'my agent', 'a\nb', 'x'.repeat(51), undefined, 'semi;colon', '$(rm)']) {
    assert.throws(() => cleanAgentName(bad), TaskError, JSON.stringify(bad));
  }
});

test('the templates in the repository are exactly what the generator produces', () => {
  for (const { folder, by, sandbox } of BUILT_IN_SKILLS) {
    const file = fileURLToPath(new URL(`../integrations/${folder}/taskboard/SKILL.md`, import.meta.url));
    assert.equal(
      normalized(fs.readFileSync(file, 'utf8')),
      skillFile({ by, sandbox }),
      `${folder}: run "node scripts/build-skills.js" after changing the instructions`,
    );
  }
});

// ---- CLI ----

test('task skill --by prints the instructions for that name', (t) => {
  useTempHome(t);
  const { code, out } = task(['skill', '--by', 'codex']);
  assert.equal(code, 0);
  assert.equal(out.trimEnd(), skillText({ by: 'codex' }).trimEnd());
});

test('task skill without --by, or with a bad name, fails with a reason', (t) => {
  useTempHome(t);
  const missing = task(['skill']);
  assert.notEqual(missing.code, 0);
  assert.match(missing.err, /--by/);
  const bad = task(['skill', '--by', 'my agent']);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /space/i);
  assert.equal(bad.out, '');
});

test('task skill does not take its name from TASKBOARD_ACTOR', (t) => {
  useTempHome(t);
  assert.notEqual(task(['skill'], { TASKBOARD_ACTOR: 'claude' }).code, 0);
});

test('help mentions task skill', (t) => {
  useTempHome(t);
  assert.ok(task(['--help']).out.includes('task skill'));
});
