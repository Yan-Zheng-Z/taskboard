// The `task` command. run() returns an exit code and prints through the given
// callbacks, so tests can call it in-process.

import { parseArgs } from 'node:util';
import {
  TaskError, addTask, editTask, removeTask, addStep, renameStep, removeStep,
  setStepDone, taskProgress, findTask,
  addSuggestion, pendingSuggestions, acceptSuggestion, dismissSuggestion,
} from '../core/model.js';
import { load, update } from '../core/store.js';
import { describeTask, activeTasks, allArchived } from '../core/view.js';
import { buildDigest, agentHomes, AGENTS } from '../core/digest/index.js';

const USAGE = `Usage: task <command> [arguments] [options]

Tasks (every task has at least one step)
  task add <name> --step <name>... [--due <date>]
                                             Create a task with its steps, print its id
  task edit <task> [--name <name>] [--due <date> | --no-due]
  task rm <task>                             Delete a task that was cancelled or added by mistake

Steps
  task step add <task> <name>                Add a step, print its id
  task step rename <task> <step> <name>
  task step rm <task> <step>                 Not allowed for a task's last step

Progress (a step is either done or not)
  task done <task> <step>                    Mark a step finished
  task reopen <task> <step>                  Mark it not finished again
                                             A task whose steps are all done is archived by itself.

View
  task list [--archived | --all] [--json]    Open tasks; --archived: finished ones; --all: both
  task show <task> [--json]                  One task with its steps

Suggestions (proposed tasks that wait for the user to accept or dismiss)
  task suggest <name> [--done-step <name>]... [--step <name>]... [--due <date>] [--source <text>]
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
  --step <name>  A step that is still to do; repeat for several. Steps keep the order given
  --done-step <name>  In a suggestion: a step that is already finished
  --source <text> Where a suggestion came from, e.g. which conversation
  --by <name>    Who made the update. Defaults to $TASKBOARD_ACTOR, then "user"
  --json         Machine-readable output
  -h, --help     Show this help`;

// Options that make sense only once; repeating one is a mistake, not a list.
const SINGLE_VALUE_OPTIONS = ['due', 'name', 'by', 'source', 'days', 'agent'];

// The option parser's own messages talk about "positional arguments"; say it plainly.
function plainMessage(error, argv) {
  if (error.code !== 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return error.message;
  const option = /'([^']+)'/.exec(error.message)?.[1] ?? '';
  // The parser reads "-15" as flags and names only "-1": report what was actually typed.
  const negative = /^-\d/.test(option) ? argv.find((arg) => /^-\d/.test(arg)) : undefined;
  if (negative) return `negative numbers are not valid here: "${negative}"`;
  return `unknown option "${option}". Run task --help to see the options`;
}

const COMMANDS = ['add', 'edit', 'rm', 'step', 'done', 'reopen', 'list', 'show', 'suggest', 'suggestions', 'accept', 'dismiss', 'digest'];

function toId(value, what) {
  // Fifteen digits is far beyond any real id and still exact as a number.
  if (value === undefined || !/^\d{1,15}$/.test(value)) {
    throw new TaskError(`${what} id must be a number, got "${value ?? ''}"`);
  }
  return Number(value);
}

function expectCount(positionals, counts, usage) {
  if (!counts.includes(positionals.length)) throw new TaskError(`usage: ${usage}`);
}

// Adds what the widget shows: progress, urgency state and whole days until the due date.
function withProgress(task) {
  return { ...task, ...describeTask(task, Date.now()) };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function urgency(task) {
  const { state, days } = describeTask(task, Date.now());
  if (state === 'done' || state === 'none') return '';
  if (state === 'overdue') return days < 0 ? `[overdue by ${plural(-days, 'day')}]  ` : '[overdue]  ';
  return days === 0 ? '[due today]  ' : `[${plural(days, 'day')} left]  `;
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
  if (task.completedAt) return `#${task.id}  done ${localTime(task.completedAt).slice(0, 10)}  ${task.name}`;
  const due = task.due ? `due ${task.due}` : 'no due date';
  return `#${task.id}  ${String(taskProgress(task)).padStart(3)}%  ${due}  ${urgency(task)}${task.name}`;
}

function showLines(task) {
  const finished = task.steps.filter((step) => step.done).length;
  const lines = [
    `#${task.id}  ${task.name}`,
    `Due: ${task.due ?? 'none'}`,
    `Progress: ${taskProgress(task)}% (${finished} of ${plural(task.steps.length, 'step')} done)`,
  ];
  if (task.completedAt) lines.push(`Completed: ${localTime(task.completedAt)} (archived)`);
  for (const step of task.steps) {
    lines.push(`  ${step.id}. [${step.done ? 'x' : ' '}] ${step.name}${updatedNote(step)}`);
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
  const out = [];
  if (digest.conversations.length === 0) {
    out.push(`No conversations found in the last ${digest.days} days.`);
  } else {
    out.push(`Conversations from the last ${digest.days} days (${digest.conversations.length}). Only what the user typed is shown.`);
  }
  for (const conversation of digest.conversations) {
    const title = conversation.title ? ` ${conversation.title} -` : '';
    out.push('', `## [${conversation.agent}]${title} ${conversation.project ?? 'unknown folder'} - last active ${shortTime(conversation.lastActive)}`);
    conversation.messages.forEach((message, index) => {
      if (index === conversation.omittedAfter) out.push(`  (${conversation.omittedMessages} messages in between not shown)`);
      out.push(`- ${shortTime(message.time)}  ${message.text}`);
    });
  }
  if (digest.omittedConversations > 0) {
    out.push('', `(${digest.omittedConversations} older conversations left out to keep this short; use a smaller --days to focus)`);
  }
  for (const { agent, records, lines } of digest.skipped) {
    const parts = [records > 0 && `${records} record(s)`, lines > 0 && `${lines} line(s)`].filter(Boolean);
    out.push('', `Skipped: ${agent}: ${parts.join(' and ')} could not be read`);
  }
  return out.join('\n');
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

// done: true marks the step finished, false reopens it.
function setDone(command, args, done, by) {
  expectCount(args, [2], `task ${command} <task> <step>  (a step number is required)`);
  const taskId = toId(args[0], 'task');
  const stepId = toId(args[1], 'step');
  const now = new Date().toISOString();
  const { step, wasArchived, isArchived } = update((data) => {
    const task = findTask(data, taskId);
    const before = Boolean(task.completedAt);
    const changed = setStepDone(data, taskId, stepId, done, by, now);
    return { step: changed, wasArchived: before, isArchived: Boolean(task.completedAt) };
  });
  // The name lets the caller see that this was the step they meant.
  let message = `Task ${taskId} step ${stepId} ${done ? 'done' : 'reopened'}: ${step.name}`;
  if (isArchived && !wasArchived) message += `\nTask ${taskId} is complete and archived.`;
  if (wasArchived && !isArchived) message += `\nTask ${taskId} is open again.`;
  return message;
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
    update((data) => removeStep(data, taskId, stepId, new Date().toISOString()));
    return `Removed step ${stepId} from task ${taskId}`;
  }
  throw new TaskError(`unknown step command "${action ?? ''}". Available: add, rename, rm`);
}

function listCommand(options) {
  if (options.archived && options.all) throw new TaskError('--archived and --all cannot be used together');
  const { tasks } = load();
  const open = activeTasks(tasks);
  const archived = allArchived(tasks);
  let chosen = open;
  if (options.archived) chosen = archived;
  else if (options.all) chosen = [...open, ...archived];
  if (options.json) return JSON.stringify({ tasks: chosen.map(withProgress) }, null, 2);
  if (chosen.length === 0) {
    return options.archived
      ? 'No archived tasks.'
      : 'No open tasks. Add one with: task add "name" --step "first step" --due YYYY-MM-DD';
  }
  return chosen.map(listLine).join('\n');
}

function execute(command, args, options, env) {
  // An empty or blank TASKBOARD_ACTOR counts as unset; an explicitly empty --by is an error.
  const by = options.by ?? (env.TASKBOARD_ACTOR?.trim() || 'user');
  const steps = options.orderedSteps;
  switch (command) {
    case 'add': {
      expectCount(args, [1], 'task add <name> --step <name>... [--due <date>]');
      if (steps.some((step) => step.done)) {
        throw new TaskError('--done-step is only for suggestions; add the task, then use task done');
      }
      if (steps.length === 0) {
        throw new TaskError('a task needs at least one step: add --step "name" (repeat for more)');
      }
      const task = update((data) => addTask(data, {
        name: args[0], due: options.due, steps: steps.map((step) => step.name),
      }, new Date().toISOString()));
      return `Added task ${task.id}: ${task.name} (${plural(task.steps.length, 'step')})`;
    }
    case 'edit': {
      expectCount(args, [1], 'task edit <task> [--name <name>] [--due <date> | --no-due]');
      const changes = {};
      if (options.name !== undefined) changes.name = options.name;
      if (options.due !== undefined) changes.due = options.due;
      if (options['no-due'] && options.due !== undefined) {
        throw new TaskError('--due and --no-due cannot be used together');
      }
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
    case 'done':
      return setDone('done', args, true, by);
    case 'reopen':
      return setDone('reopen', args, false, by);
    case 'progress':
      throw new TaskError('task progress was removed: a step is either done or not. '
        + 'Use: task done <task> <step>   or   task reopen <task> <step>');
    case 'list': {
      expectCount(args, [0], 'task list [--archived | --all] [--json]');
      return listCommand(options);
    }
    case 'show': {
      expectCount(args, [1], 'task show <task> [--json]');
      const task = findTask(load(), toId(args[0], 'task'));
      return options.json ? JSON.stringify(withProgress(task), null, 2) : showLines(task).join('\n');
    }
    case 'suggest': {
      expectCount(args, [1], 'task suggest <name> [--done-step <name>]... [--step <name>]... [--due <date>] [--source <text>]');
      if (steps.length === 0) {
        throw new TaskError('a suggestion needs at least one step: add --step "name" or --done-step "name"');
      }
      const result = update((data) => addSuggestion(data, {
        name: args[0], due: options.due, steps, source: options.source, by,
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
        archived: { type: 'boolean' },
        all: { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help || positionals.length === 0) {
      stdout(USAGE);
      return 0;
    }
    for (const name of SINGLE_VALUE_OPTIONS) {
      if (tokens.filter((token) => token.kind === 'option' && token.name === name).length > 1) {
        throw new TaskError(`--${name} can be given only once`);
      }
    }
    // --step and --done-step may be mixed; the tokens keep the order they were typed in.
    values.orderedSteps = tokens
      .filter((token) => token.kind === 'option' && (token.name === 'step' || token.name === 'done-step'))
      .map((token) => ({ name: token.value, done: token.name === 'done-step' }));
    const [command, ...args] = positionals;
    stdout(execute(command, args, values, env));
    return 0;
  } catch (error) {
    stderr(`task: ${plainMessage(error, argv)}`);
    return 1;
  }
}
