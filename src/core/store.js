// Persistence: the only module that reads or writes the data file.
// Writers take a lock file, then replace the data file atomically, so concurrent
// processes never lose each other's updates and readers never see a partial file.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyData, TaskError } from './model.js';

export class CorruptDataError extends TaskError {}

const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 10_000;
// Windows reports these when another process briefly has the file open.
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

export function dataDir() {
  return process.env.TASKBOARD_HOME || path.join(os.homedir(), '.taskboard');
}

export function dataFile() {
  return path.join(dataDir(), 'tasks.json');
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function retryWhileBusy(action) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return action();
    } catch (error) {
      if (!BUSY_CODES.has(error.code) || attempt >= 20) throw error;
      sleep(10 + attempt * 5);
    }
  }
}

function checkShape(data) {
  const ok = data !== null && typeof data === 'object' && !Array.isArray(data)
    && data.version === 1 && Number.isInteger(data.nextTaskId) && Array.isArray(data.tasks);
  if (!ok) throw new Error('unexpected structure or version');
}

export function load() {
  const file = dataFile();
  let text;
  try {
    text = retryWhileBusy(() => fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyData();
    throw error;
  }
  try {
    const data = JSON.parse(text);
    checkShape(data);
    return data;
  } catch (error) {
    throw new CorruptDataError(
      `data file is not valid and was left untouched: ${file} (${error.message}). Fix or move the file to continue.`,
    );
  }
}

function acquireLock(lockFile, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockFile, 'wx'));
      return;
    } catch (error) {
      if (error.code !== 'EEXIST' && !BUSY_CODES.has(error.code)) throw error;
    }
    try {
      if (Date.now() - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(lockFile, { force: true });
        continue;
      }
    } catch {
      continue; // the lock vanished between the two calls: try again right away
    }
    if (Date.now() >= deadline) {
      throw new TaskError(`data is locked by another process (${lockFile}); try again`);
    }
    sleep(15 + Math.floor(Math.random() * 25));
  }
}

// Runs fn(data) under the lock and saves the result. Nothing is saved if fn throws.
export function update(fn, { timeoutMs = LOCK_TIMEOUT_MS } = {}) {
  const file = dataFile();
  const lockFile = `${file}.lock`;
  fs.mkdirSync(dataDir(), { recursive: true });
  acquireLock(lockFile, timeoutMs);
  try {
    const data = load();
    const result = fn(data);
    const tempFile = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tempFile, `${JSON.stringify(data, null, 2)}\n`);
    retryWhileBusy(() => fs.renameSync(tempFile, file));
    return result;
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
}
