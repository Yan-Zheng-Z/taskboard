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

// How many leading lines are parsed just to check that the file is a Claude Code record.
const PROBE_LINES = 5;

// Returns { conversation, badLines }. Throws when the file has content but none of it
// looks like a Claude Code record, so a changed format is reported, not read as "no conversations".
function readSession(file) {
  const conversation = { agent: 'claude', project: null, title: null, messages: [] };
  let customTitle = null;
  let seen = 0;
  let recognized = false;
  let badLines = 0;
  for (const line of linesOf(file)) {
    if (line.trim() === '') continue;
    seen += 1;
    // Most lines are assistant output and tool data: skip them without parsing,
    // except the first few, which tell us whether this is the format we know.
    const wanted = line.includes('"type":"user"') || line.includes('-title"');
    if (!wanted && seen > PROBE_LINES) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      badLines += 1; // cut off mid-write, or not a record at all
      continue;
    }
    if (record !== null && typeof record === 'object' && typeof record.type === 'string') recognized = true;
    if (!wanted) continue;
    if (record.type === 'custom-title') customTitle = record.customTitle ?? customTitle;
    else if (record.type === 'ai-title') conversation.title = record.aiTitle ?? conversation.title;
    else if (isTypedByUser(record)) {
      conversation.project ??= record.cwd ?? null;
      conversation.messages.push({ time: record.timestamp ?? null, text: textOf(record.message?.content) });
    }
  }
  if (seen > 0 && !recognized) throw new Error('not a Claude Code record');
  conversation.title = customTitle ?? conversation.title;
  return { conversation, badLines };
}

// Returns { conversations, skipped, lines } for sessions modified at or after sinceMs:
// skipped counts records that could not be read at all, lines counts unreadable lines in the rest.
export function readClaudeConversations(home, sinceMs) {
  const root = path.join(home, 'projects');
  const result = { conversations: [], skipped: 0, lines: 0 };
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
        if (fs.statSync(file).mtimeMs < sinceMs) continue;
        const { conversation, badLines } = readSession(file);
        result.conversations.push(conversation);
        result.lines += badLines;
      } catch {
        result.skipped += 1;
      }
    }
  }
  return result;
}
