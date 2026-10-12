// The `task` command. run() returns an exit code and prints through the given
// callbacks, so tests can call it in-process.

import { parseArgs } from 'node:util';
import {
  TaskError, addTask, editTask, removeTask, addStep, renameStep, removeStep,
  setStepProgress, setTaskProgress, taskProgress, findTask,
  addSuggestion, pendingSuggestions, acceptSuggestion, dismissSuggestion,
} from '../core/model.js';
import { load, update } from '../core/store.js';
import { buildDigest, agentHomes, AGENTS } from '../core/digest/index.js';

const USAGE = `Usage: task <command> [arguments] [options]

Tasks
  task add <name> [--due <date>]             Create a task, print its id
  task edit <task> [--name <name>] [--due <date> | --no-due]
  task rm <task>                             Delete a task

Steps
  task step add <task> <name>                Add a step, print its id
  task step rename <task> <step> <name>
  task step rm <task> <step>

Progress
  task progress <task> <step> <percent>      Set a step to 0-100
  task progress <task> <percent>             Set a task that has no steps
  task done <task> [<step>]                  Same as progress ... 100

View
  task list [--json]                         All tasks with due date and progress
  task show <task> [--json]                  One task with its steps

Suggestions (proposed tasks that wait for the user to accept or dismiss)
  task suggest <name> [--due <date>] [--done-step <name>]... [--step <name>]... [--source <text>]
  task suggestions [--json]                  Pending suggestions
  task accept <suggestion>                   Turn a suggestion into a task
  task dismiss <suggestion>                  Drop it; it will not be suggested again

Conversations
  task digest [--days <n>] [--agent <name>] [--json]
                                             What you said to your coding agents lately,
                                             for an agent to turn into suggestions.
                                             Reads local records only. Agents: claude, deepseek

Options
  --due <date>   YYYY-MM-DD or "YYYY-MM-DD HH:mm" (local time)
  --step <name>  A step of the suggested task that is still to do; repeat for several
  --done-step <name>  A step that is already finished. Steps keep the order given
  --source <text> Where a suggestion came from, e.g. which conversation
  --by <name>    Who made the update. Defaults to $TASKBOARD_ACTOR, then "user"
  --json         Machine-readable output
  -h, --help     Show this help`;

const COMMANDS = ['add', 'edit', 'rm', 'step', 'progress', 'done', 'list', 'show', 'suggest', 'suggestions', 'accept', 'dismiss', 'digest'];

function toId(value, what) {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new TaskError(`${what} id must be a number, got "${value ?? ''}"`);
  }
  return Number(value);
}

// Non-numeric input becomes NaN so the model reports the usual range error.
function toPercent(value) {
  return /^\d+$/.test(value ?? '') ? Number(value) : NaN;
}

function expectCount(positionals, counts, usage) {
  if (!counts.includes(positionals.length)) throw new TaskError(`usage: ${usage}`);
}

function withProgress(task) {
  return { ...task, progress: taskProgress(task) };
}

function localTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updatedNote(item) {
  return item.updatedBy ? `  (${item.updatedBy}, ${localTime(item.updatedAt)})` : '';
}

function listLine(task) {
  const due = task.due ? `due ${task.due}` : 'no due date';
  return `#${task.id}  ${String(taskProgress(task)).padStart(3)}%  ${due}  ${task.name}`;
}

function showLines(task) {
  const lines = [`#${task.id}  ${task.name}`, `Due: ${task.due ?? 'none'}`];
  lines.push(`Progress: ${taskProgress(task)}%${task.steps.length === 0 ? updatedNote(task) : ''}`);
  if (task.steps.length === 0) lines.push('No steps.');
  for (const step of task.steps) {
    lines.push(`  ${step.id}. [${String(step.percent).padStart(3)}%] ${step.name}${updatedNote(step)}`);
  }
  return lines;
}

const SKIP_REASONS = {
  task: 'a task with this name already exists',
  pending: 'this is already a pending suggestion',
  dismissed: 'the user dismissed this suggestion before',
};

function suggestionLines(suggestion) {
  const due = suggestion.due ? `due ${suggestion.due}` : 'no due date';
  const origin = suggestion.source ? `${suggestion.by}: ${suggestion.source}` : suggestion.by;
  const lines = [`#${suggestion.id}  ${due}  ${suggestion.name}  (${origin})`];
  for (const step of suggestion.steps) lines.push(`      [${step.done ? 'x' : ' '}] ${step.name}`);
  return lines;
}

function shortTime(iso) {
  return iso ? localTime(iso).slice(5) : '';
}

function digestText(digest) {
  const lines = [];
  if (digest.conversations.length === 0) {
    lines.push(`No conversations found in the last ${digest.days} days.`);
  } else {
    lines.push(`Conversations from the last ${digest.days} days (${digest.conversations.length}). Only what the user typed is shown.`);
  }
  for (const conversation of digest.conversations) {
    const title = conversation.title ? ` ${conversation.title} -` : '';
    lines.push('', `## [${conversation.agent}]${title} ${conversation.project ?? 'unknown folder'} - last active ${shortTime(conversation.lastActive)}`);
    conversation.messages.forEach((message, index) => {
      if (index === conversation.omittedAfter) lines.push(`  (${conversation.omittedMessages} messages in between not shown)`);
      lines.push(`- ${shortTime(message.time)}  ${message.text}`);
    });
  }
  if (digest.omittedConversations > 0) {
    lines.push('', `(${digest.omittedConversations} older conversations left out to keep this short; use a smaller --days to focus)`);
  }
  for (const { agent, records } of digest.skipped) {
    lines.push('', `Skipped: ${agent}: ${records} record(s) could not be read`);
  }
  return lines.join('\n');
}

function digestCommand(options, env) {
  const days = /^\d+$/.test(options.days ?? '7') ? Number(options.days ?? '7') : 0;
  if (days < 1 || days > 365) throw new TaskError(`--days must be a number from 1 to 365, got "${options.days}"`);
  const agent = options.agent ?? 'all';
  if (agent !== 'all' && !AGENTS.includes(agent)) {
    throw new TaskError(`unknown agent "${agent}". Available: ${AGENTS.join(', ')}, all`);
  }
  const digest = buildDigest({
    ...agentHomes(env), days, agents: agent === 'all' ? AGENTS : [agent], now: Date.now(),
  });
  return options.json ? JSON.stringify(digest, null, 2) : digestText(digest);
}

function setProgress(args, percent, by) {
  const now = new Date().toISOString();
  const taskId = toId(args[0], 'task');
  if (args.length === 1) {
    update((data) => setTaskProgress(data, taskId, percent, by, now));
    return `Task ${taskId} set to ${percent}%`;
  }
  const stepId = toId(args[1], 'step');
  update((data) => setStepProgress(data, taskId, stepId, percent, by, now));
  return `Task ${taskId} step ${stepId} set to ${percent}%`;
}

function stepCommand(args) {
  const [action, ...rest] = args;
  if (action === 'add') {
    expectCount(rest, [2], 'task step add <task> <name>');
    const taskId = toId(rest[0], 'task');
    const step = update((data) => addStep(data, taskId, rest[1]));
    return `Added step ${step.id} to task ${taskId}: ${step.name}`;
  }
  if (action === 'rename') {
    expectCount(rest, [3], 'task step rename <task> <step> <name>');
    const [taskId, stepId] = [toId(rest[0], 'task'), toId(rest[1], 'step')];
    update((data) => renameStep(data, taskId, stepId, rest[2]));
    return `Renamed step ${stepId} of task ${taskId}`;
  }
  if (action === 'rm') {
    expectCount(rest, [2], 'task step rm <task> <step>');
    const [taskId, stepId] = [toId(rest[0], 'task'), toId(rest[1], 'step')];
    update((data) => removeStep(data, taskId, stepId));
    return `Removed step ${stepId} from task ${taskId}`;
  }
  throw new TaskError(`unknown step command "${action ?? ''}". Available: add, rename, rm`);
}

function execute(command, args, options, env) {
  // An empty TASKBOARD_ACTOR counts as unset; an explicitly empty --by is an error.
  const by = options.by ?? (env.TASKBOARD_ACTOR || 'user');
  switch (command) {
    case 'add': {
      expectCount(args, [1], 'task add <name> [--due <date>]');
      const task = update((data) => addTask(data, { name: args[0], due: options.due }, new Date().toISOString()));
      return `Added task ${task.id}: ${task.name}`;
    }
    case 'edit': {
      expectCount(args, [1], 'task edit <task> [--name <name>] [--due <date> | --no-due]');
      const changes = {};
      if (options.name !== undefined) changes.name = options.name;
      if (options.due !== undefined) changes.due = options.due;
      if (options['no-due']) changes.due = null;
      if (Object.keys(changes).length === 0) {
        throw new TaskError('nothing to change: pass --name, --due or --no-due');
      }
      const taskId = toId(args[0], 'task');
      update((data) => editTask(data, taskId, changes));
      return `Updated task ${taskId}`;
    }
    case 'rm': {
      expectCount(args, [1], 'task rm <task>');
      const taskId = toId(args[0], 'task');
      const task = update((data) => removeTask(data, taskId));
      return `Removed task ${taskId}: ${task.name}`;
    }
    case 'step':
      return stepCommand(args);
    case 'progress': {
      expectCount(args, [2, 3], 'task progress <task> [<step>] <percent>');
      return setProgress(args.slice(0, -1), toPercent(args.at(-1)), by);
    }
    case 'done': {
      expectCount(args, [1, 2], 'task done <task> [<step>]');
      return setProgress(args, 100, by);
    }
    case 'list': {
      expectCount(args, [0], 'task list [--json]');
      const { tasks } = load();
      if (options.json) return JSON.stringify({ tasks: tasks.map(withProgress) }, null, 2);
      if (tasks.length === 0) return 'No tasks yet. Add one with: task add "name" --due YYYY-MM-DD';
      return tasks.map(listLine).join('\n');
    }
    case 'show': {
      expectCount(args, [1], 'task show <task> [--json]');
      const task = findTask(load(), toId(args[0], 'task'));
      return options.json ? JSON.stringify(withProgress(task), null, 2) : showLines(task).join('\n');
    }
    case 'suggest': {
      expectCount(args, [1], 'task suggest <name> [--due <date>] [--done-step <name>]... [--step <name>]... [--source <text>]');
      const result = update((data) => addSuggestion(data, {
        name: args[0], due: options.due, steps: options.orderedSteps, source: options.source, by,
      }, new Date().toISOString()));
      if (result.skipped) return `Skipped "${args[0].trim()}": ${SKIP_REASONS[result.skipped]}`;
      return `Saved suggestion ${result.saved.id}: ${result.saved.name}`;
    }
    case 'suggestions': {
      expectCount(args, [0], 'task suggestions [--json]');
      const suggestions = pendingSuggestions(load());
      if (options.json) return JSON.stringify({ suggestions }, null, 2);
      if (suggestions.length === 0) return 'No suggestions.';
      return suggestions.flatMap(suggestionLines).join('\n');
    }
    case 'accept': {
      expectCount(args, [1], 'task accept <suggestion>');
      const id = toId(args[0], 'suggestion');
      const task = update((data) => acceptSuggestion(data, id, new Date().toISOString()));
      return `Accepted suggestion ${id} as task ${task.id}: ${task.name}`;
    }
    case 'dismiss': {
      expectCount(args, [1], 'task dismiss <suggestion>');
      const id = toId(args[0], 'suggestion');
      const suggestion = update((data) => dismissSuggestion(data, id));
      return `Dismissed suggestion ${id}: ${suggestion.name}`;
    }
    case 'digest': {
      expectCount(args, [0], 'task digest [--days <n>] [--agent <name>] [--json]');
      return digestCommand(options, env);
    }
    default:
      throw new TaskError(`unknown command "${command}". Available: ${COMMANDS.join(', ')}`);
  }
}

export function run(argv, { stdout, stderr, env }) {
  try {
    const { values, positionals, tokens } = parseArgs({
      args: argv,
      tokens: true,
      allowPositionals: true,
      options: {
        due: { type: 'string' },
        name: { type: 'string' },
        'no-due': { type: 'boolean' },
        by: { type: 'string' },
        step: { type: 'string', multiple: true },
        'done-step': { type: 'string', multiple: true },
        source: { type: 'string' },
        days: { type: 'string' },
        agent: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help || positionals.length === 0) {
      stdout(USAGE);
      return 0;
    }
    // --step and --done-step may be mixed; the tokens keep the order they were typed in.
    values.orderedSteps = tokens
      .filter((token) => token.kind === 'option' && (token.name === 'step' || token.name === 'done-step'))
      .map((token) => ({ name: token.value, done: token.name === 'done-step' }));
    const [command, ...args] = positionals;
    stdout(execute(command, args, values, env));
    return 0;
  } catch (error) {
    stderr(`task: ${error.message}`);
    return 1;
  }
}
