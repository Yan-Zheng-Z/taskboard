// Builds a short digest of recent agent conversations: what the user said, and where.
// Read-only and local. Deciding which of it is a task is left to the agent that reads the digest.

import os from 'node:os';
import path from 'node:path';
import { readClaudeConversations } from './claude.js';
import { readDeepseekConversations } from './deepseek.js';
import { cleanMessage } from './text.js';

// A long conversation keeps its opening messages (where the goal is usually stated)
// and its most recent ones; messagesPerConversation is the total kept.
export const LIMITS = { messageChars: 300, messagesPerConversation: 20, openingMessages: 3, totalChars: 60_000 };

export const AGENTS = ['claude', 'deepseek'];

const READERS = { claude: readClaudeConversations, deepseek: readDeepseekConversations };

export function agentHomes(env) {
  return {
    claudeHome: env.TASKBOARD_CLAUDE_HOME || path.join(os.homedir(), '.claude'),
    dshHome: env.TASKBOARD_DSH_HOME || env.DSH_HOME || path.join(os.homedir(), '.dsh'),
  };
}

// Cleans and trims one conversation; returns null when the user said nothing in it.
// How taskboard's own background organize prompts begin (current wording and earlier ones).
// Those runs are conversations too, but not something the user said.
const OWN_PROMPTS = [
  'Bring the user taskboard up to date',
  'Find the projects the user is working on and file each one as a taskboard suggestion',
  'Find things the user still needs to do and file them as taskboard suggestions',
];

function tidy(conversation) {
  const firstText = conversation.messages[0]?.text.trim() ?? '';
  if (OWN_PROMPTS.some((prompt) => firstText.startsWith(prompt))) return null;
  const messages = conversation.messages
    .map((message) => ({ time: message.time, text: cleanMessage(message.text, LIMITS.messageChars) }))
    .filter((message) => message.text !== '');
  if (messages.length === 0) return null;
  const { messagesPerConversation: limit, openingMessages: opening } = LIMITS;
  const omitted = Math.max(0, messages.length - limit);
  const kept = omitted === 0 ? messages : [...messages.slice(0, opening), ...messages.slice(opening - limit)];
  return {
    agent: conversation.agent,
    project: conversation.project,
    title: conversation.title,
    lastActive: messages.at(-1).time,
    omittedMessages: omitted,
    // The gap sits after this many kept messages; null when nothing was left out.
    omittedAfter: omitted === 0 ? null : opening,
    messages: kept,
  };
}

const sizeOf = (conversation) => conversation.messages.reduce((sum, message) => sum + message.text.length, 0);

export function buildDigest({ claudeHome, dshHome, days, agents, now }) {
  const homes = { claude: claudeHome, deepseek: dshHome };
  const sinceMs = now - days * 24 * 60 * 60 * 1000;
  const all = [];
  const skipped = [];
  for (const agent of agents) {
    const result = READERS[agent](homes[agent], sinceMs);
    // A file can change recently without the user having said anything recently.
    const active = (conversation) => conversation && !(Date.parse(conversation.lastActive) < sinceMs);
    all.push(...result.conversations.map(tidy).filter(active));
    if (result.skipped > 0 || result.lines > 0) skipped.push({ agent, records: result.skipped, lines: result.lines });
  }
  // Most recent first; conversations without message times go last.
  all.sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''));

  // Keep the most recent conversations that fit; count the rest.
  const conversations = [];
  let total = 0;
  for (const conversation of all) {
    total += sizeOf(conversation);
    if (total > LIMITS.totalChars) break;
    conversations.push(conversation);
  }
  return { days, conversations, omittedConversations: all.length - conversations.length, skipped };
}
