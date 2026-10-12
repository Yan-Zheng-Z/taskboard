// Reads Claude Code conversation records: <home>/projects/<project>/<session>.jsonl,
// one JSON record per line. The format is not a published interface and may change.

import fs from 'node:fs';
import path from 'node:path';

// Yields the lines of a file without loading it whole; records can be tens of megabytes.
function* linesOf(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1 << 16);
    let pending = [];
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      let start = 0;
      for (let end = buffer.indexOf(10, 0); end !== -1 && end < read; end = buffer.indexOf(10, start)) {
        pending.push(Buffer.from(buffer.subarray(start, end)));
        yield Buffer.concat(pending).toString('utf8');
        pending = [];
        start = end + 1;
      }
      if (start < read) pending.push(Buffer.from(buffer.subarray(start, read)));
    }
    if (pending.length > 0) yield Buffer.concat(pending).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n');
}

// Only what the user typed: not tool results, injected context, sub-agent prompts or summaries.
function isTypedByUser(record) {
  return record.type === 'user' && !record.isMeta && !record.isSidechain && !record.isCompactSummary && !record.toolUseResult;
}

function readSession(file) {
  const conversation = { agent: 'claude', project: null, title: null, messages: [] };
  let customTitle = null;
  for (const line of linesOf(file)) {
    // Most lines are assistant output and tool data: skip them without parsing.
    if (!line.includes('"type":"user"') && !line.includes('-title"')) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a line cut off mid-write
    }
    if (record.type === 'custom-title') customTitle = record.customTitle ?? customTitle;
    else if (record.type === 'ai-title') conversation.title = record.aiTitle ?? conversation.title;
    else if (isTypedByUser(record)) {
      conversation.project ??= record.cwd ?? null;
      conversation.messages.push({ time: record.timestamp ?? null, text: textOf(record.message?.content) });
    }
  }
  conversation.title = customTitle ?? conversation.title;
  return conversation;
}

// Returns { conversations, skipped } for sessions modified at or after sinceMs.
export function readClaudeConversations(home, sinceMs) {
  const root = path.join(home, 'projects');
  const result = { conversations: [], skipped: 0 };
  let projects;
  try {
    projects = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return result; // Claude Code is not installed, or has no records
  }
  for (const project of projects) {
    const dir = path.join(root, project.name);
    for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith('.jsonl'))) {
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).mtimeMs >= sinceMs) result.conversations.push(readSession(file));
      } catch {
        result.skipped += 1;
      }
    }
  }
  return result;
}
