// Stands in for a coding agent in the organize tests. The mode is the first argument.
import fs from 'node:fs';
import { update } from '../../src/core/store.js';
import { addSuggestion, addStep, setStepDone } from '../../src/core/model.js';

const [mode] = process.argv.slice(2);
const now = new Date().toISOString();

if (mode === 'three') {
  update((data) => {
    for (const name of ['写论文第二章', '交报销单', '整理读书笔记']) {
      addSuggestion(data, { name, steps: ['第一步'], source: 'fake conversation', by: 'claude' }, now);
    }
  });
} else if (mode === 'update') {
  // What a good organize run does for a project that is already in the list.
  update((data) => {
    setStepDone(data, 1, 1, true, 'claude', now);
    addStep(data, 1, '新出现的步骤');
    addSuggestion(data, { name: '另一个新项目', steps: ['第一步'], by: 'claude' }, now);
  });
} else if (mode === 'fail') {
  console.error('boom: the agent could not run');
  process.exit(3);
} else if (mode === 'hang') {
  // Leaves its pid behind so a test can check that it was really stopped.
  if (process.env.FAKE_AGENT_PID_FILE) fs.writeFileSync(process.env.FAKE_AGENT_PID_FILE, String(process.pid));
  setInterval(() => {}, 1000);
}
