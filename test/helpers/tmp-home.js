import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Points TASKBOARD_HOME at a fresh temp directory for one test and cleans up afterwards.
export function useTempHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskboard-test-'));
  const previous = process.env.TASKBOARD_HOME;
  process.env.TASKBOARD_HOME = dir;
  t.after(() => {
    if (previous === undefined) delete process.env.TASKBOARD_HOME;
    else process.env.TASKBOARD_HOME = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
