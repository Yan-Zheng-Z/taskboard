// Reads DeepSeek Harness conversation records:
// <home>/sessions/<project>/session-<id>/session.v<N>.jsonl.zstd
// The file is a series of zstd frames appended one after another; each holds JSON lines.
// The format is not a published interface and may change.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function decompressFrames(file) {
  const data = fs.readFileSync(file);
  const parts = [];
  let offset = 0;
  while (offset < data.length) {
    const { buffer, engine } = zlib.zstdDecompressSync(data.subarray(offset), { info: true });
    if (!(engine.bytesWritten > 0)) throw new Error('zstd decoder made no progress');
    parts.push(buffer);
    offset += engine.bytesWritten; // input bytes consumed by this frame
  }
  return Buffer.concat(parts).toString('utf8');
}

function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n');
}

// Returns the conversation, or null for a sub-agent session.
function readSession(file) {
  const conversation = { agent: 'deepseek', project: null, title: null, messages: [] };
  for (const line of decompressFrames(file).split('\n')) {
    if (line === '') continue;
    const record = JSON.parse(line);
    if (record.type === 'session') {
      if (record.delegationDepth > 0) return null;
      conversation.project = record.cwd ?? null;
    } else if (record.type === 'session/title') {
      conversation.title = record.data?.title ?? conversation.title;
    } else if (record.type === 'user/message' && record.data?.source?.kind === 'user') {
      // Other source kinds are instructions and context the harness injects as user turns.
      conversation.messages.push({
        time: Number.isFinite(record.time) ? new Date(record.time).toISOString() : null,
        text: textOf(record.data.content),
      });
    }
  }
  return conversation;
}

function sessionFiles(root) {
  const files = [];
  for (const project of fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const projectDir = path.join(root, project.name);
    for (const session of fs.readdirSync(projectDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const sessionDir = path.join(projectDir, session.name);
      for (const name of fs.readdirSync(sessionDir).filter((entry) => /^session\..*\.jsonl\.zstd$/.test(entry))) {
        files.push(path.join(sessionDir, name));
      }
    }
  }
  return files;
}

// Returns { conversations, skipped } for sessions modified at or after sinceMs.
export function readDeepseekConversations(home, sinceMs) {
  const result = { conversations: [], skipped: 0 };
  let files;
  try {
    files = sessionFiles(path.join(home, 'sessions'));
  } catch {
    return result; // DeepSeek Harness is not installed, or has no records
  }
  for (const file of files) {
    try {
      if (fs.statSync(file).mtimeMs < sinceMs) continue;
      const conversation = readSession(file);
      if (conversation) result.conversations.push(conversation);
    } catch {
      result.skipped += 1;
    }
  }
  return result;
}
