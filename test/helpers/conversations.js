// Builds small, made-up agent conversation records in a temp directory, in the same
// shapes Claude Code and DeepSeek Harness write on disk. No real conversation content.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export function useTempAgents(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-agents-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { claudeHome: path.join(root, 'claude'), dshHome: path.join(root, 'dsh') };
}

function setAge(file, daysAgo, now) {
  const when = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
  fs.utimesSync(file, when, when);
}

// ---- Claude Code: <home>/projects/<project>/<session>.jsonl, one JSON record per line ----

export const claudeUser = (text, extra = {}) => ({
  type: 'user', message: { role: 'user', content: text }, cwd: 'C:\\work\\thesis', timestamp: new Date().toISOString(), ...extra,
});

export function writeClaudeSession(claudeHome, name, records, { daysAgo = 0, now = Date.now(), project = 'C--work-thesis' } = {}) {
  const dir = path.join(claudeHome, 'projects', project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(file, records.map((record) => (typeof record === 'string' ? record : JSON.stringify(record))).join('\n'));
  setAge(file, daysAgo, now);
  return file;
}

// ---- DeepSeek Harness: <home>/sessions/<project>/session-<id>/session.v4.jsonl.zstd ----
// The file is a sequence of zstd frames appended one after another.

export const dshSession = (extra = {}) => ({ type: 'session', version: 4, cwd: 'C:\\work\\reports', createdAt: 1791700000000, delegationDepth: 0, ...extra });

export const dshUser = (text, time, kind = 'user') => ({
  type: 'user/message', seq: 1, time, data: { role: 'user', content: [{ type: 'text', text }], source: { kind } },
});

export function writeDshSession(dshHome, name, records, { daysAgo = 0, now = Date.now(), frames = 2, raw = null } = {}) {
  const dir = path.join(dshHome, 'sessions', '--C-work-reports--', `session-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'session.v4.jsonl.zstd');
  const lines = records.map((record) => `${JSON.stringify(record)}\n`);
  const size = Math.ceil(lines.length / frames) || 1;
  const chunks = [];
  for (let i = 0; i < lines.length; i += size) chunks.push(zlib.zstdCompressSync(Buffer.from(lines.slice(i, i + size).join(''))));
  fs.writeFileSync(file, raw ?? Buffer.concat(chunks));
  setAge(file, daysAgo, now);
  return file;
}
