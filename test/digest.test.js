import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDigest, LIMITS } from '../src/core/digest/index.js';
import { run } from '../src/cli/run.js';
import { dataFile } from '../src/core/store.js';
import { useTempHome } from './helpers/tmp-home.js';
import {
  useTempAgents, claudeUser, writeClaudeSession, dshSession, dshUser, writeDshSession,
} from './helpers/conversations.js';

const NOW = new Date(2026, 9, 12, 12, 0).getTime();

const digest = (homes, options = {}) => buildDigest({ ...homes, now: NOW, days: 7, agents: ['claude', 'deepseek'], ...options });

function task(args, env = {}) {
  let out = '';
  let err = '';
  const code = run(args, { env, stdout: (text) => { out += `${text}\n`; }, stderr: (text) => { err += `${text}\n`; } });
  return { code, out, err };
}

const agentEnv = (homes) => ({ TASKBOARD_CLAUDE_HOME: homes.claudeHome, TASKBOARD_DSH_HOME: homes.dshHome });

// ---- Claude Code reader ----

test('a Claude Code conversation gives project, title, last activity and the user messages', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'a', [
    { type: 'ai-title', aiTitle: 'auto title' },
    claudeUser('帮我把第二章的文献综述改一下', { timestamp: '2026-10-11T09:00:00.000Z' }),
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '好的，我来改。这是助手的回复。' }] } },
    claudeUser('周五前还要交报销单', { timestamp: '2026-10-11T09:30:00.000Z' }),
    { type: 'custom-title', customTitle: '论文' },
  ], { now: NOW });
  const { conversations } = digest(homes);
  assert.equal(conversations.length, 1);
  const [conversation] = conversations;
  assert.equal(conversation.agent, 'claude');
  assert.equal(conversation.project, 'C:\\work\\thesis');
  assert.equal(conversation.title, '论文');
  assert.equal(conversation.lastActive, '2026-10-11T09:30:00.000Z');
  assert.deepEqual(conversation.messages.map((m) => m.text), ['帮我把第二章的文献综述改一下', '周五前还要交报销单']);
});

test('assistant replies, tool results, meta records, sidechains and summaries are left out', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'a', [
    claudeUser('真正的用户消息'),
    claudeUser([{ type: 'tool_result', tool_use_id: 'x', content: 'SECRET TOOL OUTPUT' }], { toolUseResult: { stdout: 'SECRET TOOL OUTPUT' } }),
    claudeUser('meta text', { isMeta: true }),
    claudeUser('subagent prompt', { isSidechain: true }),
    claudeUser('summary of earlier conversation', { isCompactSummary: true }),
    claudeUser([{ type: 'image', source: {} }]),
    claudeUser([{ type: 'image', source: {} }, { type: 'text', text: '看这张截图' }]),
    { type: 'assistant', message: { content: [{ type: 'text', text: 'ASSISTANT REPLY' }] } },
  ], { now: NOW });
  const [conversation] = digest(homes).conversations;
  assert.deepEqual(conversation.messages.map((m) => m.text), ['真正的用户消息', '看这张截图']);
  assert.ok(!JSON.stringify(conversation).includes('SECRET'));
  assert.ok(!JSON.stringify(conversation).includes('ASSISTANT'));
});

test('text inserted by the tool is removed while the words the user typed next to it are kept', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'a', [
    claudeUser('<system-reminder>\nhidden instructions\n</system-reminder>\n真正的问题'),
    claudeUser('<local-command-caveat>caveat</local-command-caveat>\n<command-name>/plugin</command-name>\n<command-args>install x</command-args>\n<local-command-stdout>Installed</local-command-stdout>\n继续吧'),
    claudeUser('<bash-input>ls</bash-input>\n<bash-stdout>file list</bash-stdout><bash-stderr></bash-stderr>'),
    claudeUser('[SYSTEM NOTIFICATION - NOT USER INPUT]\n<task-notification>done</task-notification>'),
    claudeUser('[Request interrupted by user]'),
    claudeUser('<task-notification>agent finished</task-notification>'),
  ], { now: NOW });
  const [conversation] = digest(homes).conversations;
  assert.deepEqual(conversation.messages.map((m) => m.text), ['真正的问题', '继续吧']);
});

test('whitespace is collapsed and long messages are cut with a marker', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'a', [claudeUser('第一行\n\n   第二行'), claudeUser('长'.repeat(5000))], { now: NOW });
  const [first, long] = digest(homes).conversations[0].messages;
  assert.equal(first.text, '第一行 第二行');
  assert.equal(long.text.length, LIMITS.messageChars + 1);
  assert.ok(long.text.endsWith('…'));
});

test('only the most recent messages of a long conversation are kept, with a count of the rest', (t) => {
  const homes = useTempAgents(t);
  const records = Array.from({ length: LIMITS.messagesPerConversation + 5 }, (_, i) => claudeUser(`消息 ${i}`));
  writeClaudeSession(homes.claudeHome, 'a', records, { now: NOW });
  const [conversation] = digest(homes).conversations;
  assert.equal(conversation.messages.length, LIMITS.messagesPerConversation);
  assert.equal(conversation.messages.at(-1).text, `消息 ${LIMITS.messagesPerConversation + 4}`);
  assert.equal(conversation.earlierMessages, 5);
});

test('conversations older than the range, and ones without user messages, are not included', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'recent', [claudeUser('最近的')], { daysAgo: 1, now: NOW });
  writeClaudeSession(homes.claudeHome, 'old', [claudeUser('很久以前')], { daysAgo: 10, now: NOW });
  writeClaudeSession(homes.claudeHome, 'empty', [{ type: 'assistant', message: { content: [] } }], { daysAgo: 0, now: NOW });
  assert.deepEqual(digest(homes).conversations.map((c) => c.messages[0].text), ['最近的']);
  assert.deepEqual(digest(homes, { days: 30 }).conversations.map((c) => c.messages[0].text).sort(), ['很久以前', '最近的']);
});

test('a conversation whose file changed recently but whose last user message is old is not included', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'stale', [claudeUser('一个月前说的话', { timestamp: '2026-09-10T08:00:00.000Z' })], { daysAgo: 0, now: NOW });
  writeClaudeSession(homes.claudeHome, 'fresh', [claudeUser('昨天说的话', { timestamp: '2026-10-11T08:00:00.000Z' })], { daysAgo: 0, now: NOW });
  assert.deepEqual(digest(homes).conversations.map((c) => c.messages[0].text), ['昨天说的话']);
});

test('broken lines in a record are skipped without losing the rest', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'a', [claudeUser('前一条'), '{"type":"user","message":{"content":"cut off', claudeUser('后一条')], { now: NOW });
  assert.deepEqual(digest(homes).conversations[0].messages.map((m) => m.text), ['前一条', '后一条']);
});

// ---- DeepSeek Harness reader ----

test('a DeepSeek Harness conversation is read across several compressed frames', (t) => {
  const homes = useTempAgents(t);
  writeDshSession(homes.dshHome, 'a', [
    dshSession(),
    dshUser('整理一下周报', 1791700001000),
    dshUser('<system-reminder>workspace instructions</system-reminder>', 1791700001001, 'agent-instructions'),
    dshUser('Current runtime context.', 1791700001001, 'runtime-context'),
    { type: 'assistant/message', seq: 2, time: 1791700002000, data: { message: { role: 'assistant', content: [{ type: 'text', text: 'ASSISTANT REPLY' }] } } },
    { type: 'tool/result', seq: 3, time: 1791700003000, data: { message: { content: [{ type: 'text', text: 'TOOL OUTPUT' }] } } },
    { type: 'session/title', seq: 4, time: 1791700004000, data: { title: 'fallback title' } },
    { type: 'session/title', seq: 5, time: 1791700005000, data: { title: '周报' } },
    dshUser('顺便把图表也更新', 1791700006000),
  ], { now: NOW, frames: 4 });
  const [conversation] = digest(homes).conversations;
  assert.equal(conversation.agent, 'deepseek');
  assert.equal(conversation.project, 'C:\\work\\reports');
  assert.equal(conversation.title, '周报');
  assert.equal(conversation.lastActive, new Date(1791700006000).toISOString());
  assert.deepEqual(conversation.messages.map((m) => m.text), ['整理一下周报', '顺便把图表也更新']);
});

test('sub-agent sessions of DeepSeek Harness are not included', (t) => {
  const homes = useTempAgents(t);
  writeDshSession(homes.dshHome, 'sub', [dshSession({ delegationDepth: 1 }), dshUser('delegated prompt', 1791700001000)], { now: NOW });
  assert.deepEqual(digest(homes).conversations, []);
});

test('an unreadable DeepSeek Harness record is skipped and reported; other conversations still come out', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'a', [claudeUser('还在')], { now: NOW });
  writeDshSession(homes.dshHome, 'bad', [], { now: NOW, raw: Buffer.from('this is not zstd data') });
  const result = digest(homes);
  assert.deepEqual(result.conversations.map((c) => c.messages[0].text), ['还在']);
  assert.deepEqual(result.skipped, [{ agent: 'deepseek', records: 1 }]);
});

// ---- assembling ----

test('missing agent directories are fine', (t) => {
  const homes = useTempAgents(t);
  assert.deepEqual(digest(homes), { days: 7, conversations: [], omittedConversations: 0, skipped: [] });
});

test('conversations are ordered by most recent activity and can be limited to one agent', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'older', [claudeUser('claude 的', { timestamp: '2026-10-10T08:00:00.000Z' })], { now: NOW });
  writeDshSession(homes.dshHome, 'newer', [dshSession(), dshUser('deepseek 的', Date.parse('2026-10-11T08:00:00.000Z'))], { now: NOW });
  assert.deepEqual(digest(homes).conversations.map((c) => c.agent), ['deepseek', 'claude']);
  assert.deepEqual(digest(homes, { agents: ['claude'] }).conversations.map((c) => c.agent), ['claude']);
});

test('conversations without message times sort after dated ones', (t) => {
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'undated', [claudeUser('没有时间的消息', { timestamp: undefined })], { now: NOW });
  writeClaudeSession(homes.claudeHome, 'dated', [claudeUser('有时间的消息', { timestamp: '2026-10-11T08:00:00.000Z' })], { now: NOW });
  assert.deepEqual(digest(homes).conversations.map((c) => c.messages[0].text), ['有时间的消息', '没有时间的消息']);
});

test('when the total is too large the oldest conversations are dropped and counted', (t) => {
  const homes = useTempAgents(t);
  const big = Array.from({ length: LIMITS.messagesPerConversation }, () => claudeUser('字'.repeat(LIMITS.messageChars)));
  const count = Math.ceil(LIMITS.totalChars / (LIMITS.messagesPerConversation * LIMITS.messageChars)) + 3;
  for (let i = 0; i < count; i += 1) {
    const stamp = new Date(NOW - i * 60_000).toISOString();
    writeClaudeSession(homes.claudeHome, `s${i}`, big.map((r) => ({ ...r, timestamp: stamp })), { now: NOW });
  }
  const result = digest(homes);
  assert.ok(result.conversations.length < count);
  assert.equal(result.conversations.length + result.omittedConversations, count);
  assert.equal(result.conversations[0].lastActive, new Date(NOW).toISOString());
  const size = result.conversations.reduce((sum, c) => sum + c.messages.reduce((n, m) => n + m.text.length, 0), 0);
  assert.ok(size <= LIMITS.totalChars);
});

// ---- CLI ----

test('task digest prints conversations with agent, project, title and user messages', (t) => {
  useTempHome(t);
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'a', [claudeUser('周五前交报销单'), { type: 'custom-title', customTitle: '杂事' }]);
  writeDshSession(homes.dshHome, 'b', [dshSession(), dshUser('整理一下周报', Date.now() - 1000)]);
  const result = task(['digest'], agentEnv(homes));
  assert.equal(result.code, 0);
  for (const piece of ['claude', 'deepseek', 'C:\\work\\thesis', 'C:\\work\\reports', '杂事', '周五前交报销单', '整理一下周报', '7']) {
    assert.ok(result.out.includes(piece), piece);
  }
});

test('task digest --days and --agent narrow the output', (t) => {
  useTempHome(t);
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'new', [claudeUser('新的')], { daysAgo: 1 });
  writeClaudeSession(homes.claudeHome, 'old', [claudeUser('旧的')], { daysAgo: 5 });
  writeDshSession(homes.dshHome, 'b', [dshSession(), dshUser('另一个代理', Date.now())]);
  const narrow = task(['digest', '--days', '2', '--agent', 'claude'], agentEnv(homes));
  assert.ok(narrow.out.includes('新的'));
  assert.ok(!narrow.out.includes('旧的'));
  assert.ok(!narrow.out.includes('另一个代理'));
});

test('task digest with nothing in range succeeds and says so', (t) => {
  useTempHome(t);
  const result = task(['digest'], agentEnv(useTempAgents(t)));
  assert.equal(result.code, 0);
  assert.match(result.out, /no conversations/i);
});

test('task digest rejects an unknown agent and a bad number of days', (t) => {
  useTempHome(t);
  const env = agentEnv(useTempAgents(t));
  const agent = task(['digest', '--agent', 'foo'], env);
  assert.notEqual(agent.code, 0);
  assert.match(agent.err, /claude.*deepseek/s);
  for (const days of ['0', 'week', '-1']) assert.notEqual(task(['digest', `--days=${days}`], env).code, 0, days);
});

test('task digest reports skipped records at the end', (t) => {
  useTempHome(t);
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'a', [claudeUser('还在')]);
  writeDshSession(homes.dshHome, 'bad', [], { raw: Buffer.from('not zstd') });
  const result = task(['digest'], agentEnv(homes));
  assert.equal(result.code, 0);
  assert.match(result.out, /skipped.*deepseek.*1/is);
});

test('task digest --json prints the same content as JSON', (t) => {
  useTempHome(t);
  const homes = useTempAgents(t);
  writeClaudeSession(homes.claudeHome, 'a', [claudeUser('周五前交报销单')]);
  const json = JSON.parse(task(['digest', '--json'], agentEnv(homes)).out);
  assert.equal(json.conversations[0].messages[0].text, '周五前交报销单');
  assert.deepEqual(json.skipped, []);
});

test('task digest changes neither the conversation records nor the task data', (t) => {
  useTempHome(t);
  const homes = useTempAgents(t);
  const files = [
    writeClaudeSession(homes.claudeHome, 'a', [claudeUser('一条消息')], { daysAgo: 1 }),
    writeDshSession(homes.dshHome, 'b', [dshSession(), dshUser('另一条', Date.now())], { daysAgo: 2 }),
  ];
  task(['add', 'existing'], agentEnv(homes));
  files.push(dataFile());
  const snapshot = () => files.map((file) => [fs.readFileSync(file).toString('base64'), fs.statSync(file).mtimeMs]);
  const before = snapshot();
  task(['digest'], agentEnv(homes));
  task(['digest', '--json'], agentEnv(homes));
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(fs.readdirSync(path.dirname(dataFile())), ['tasks.json']);
});
