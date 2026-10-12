// Which coding agents are on this machine, whether taskboard's skill is installed for
// each, and installing it. Nothing here writes unless installAgentSkill is called:
// starting taskboard or opening the settings page must never touch an agent's files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskError } from '../core/model.js';
import { agentHomes } from '../core/digest/index.js';
import { findClaude } from './organize.js';

const template = (folder) => fileURLToPath(new URL(`../../integrations/${folder}/taskboard/SKILL.md`, import.meta.url));

const AGENTS = [
  { id: 'claude', name: 'Claude Code', templateFile: template('claude'), home: (homes) => homes.claudeHome, hasCli: findClaude },
  { id: 'deepseek', name: 'DeepSeek Harness', templateFile: template('dsh'), home: (homes) => homes.dshHome, hasCli: () => null },
];

const skillFile = (home) => path.join(home, 'skills', 'taskboard', 'SKILL.md');
// Git may check the template out with either line ending; that is not a difference.
const normalized = (text) => text.replace(/\r\n/g, '\n');

function readIfPresent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function statusOf(agent, env) {
  const home = agent.home(agentHomes(env));
  const installed = readIfPresent(skillFile(home));
  let skill = 'missing';
  if (installed !== null) {
    skill = normalized(installed) === normalized(fs.readFileSync(agent.templateFile, 'utf8')) ? 'current' : 'outdated';
  }
  return {
    id: agent.id,
    name: agent.name,
    // On this machine if its command is on PATH or it has a home directory.
    detected: Boolean(agent.hasCli(env)) || fs.existsSync(home),
    skill, // 'missing' | 'current' | 'outdated'
    target: skillFile(home),
  };
}

export function agentStatuses(env) {
  return AGENTS.map((agent) => statusOf(agent, env));
}

// Copies the skill into the agent's own skills directory. Returns the new status.
export function installAgentSkill(id, env) {
  const agent = AGENTS.find((candidate) => candidate.id === id);
  if (!agent) throw new TaskError(`unknown agent "${id}"`);
  const target = skillFile(agent.home(agentHomes(env)));
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(agent.templateFile, target);
  } catch (error) {
    throw new TaskError(`could not install the skill for ${agent.name} at ${target}: ${error.message}`);
  }
  return statusOf(agent, env);
}
