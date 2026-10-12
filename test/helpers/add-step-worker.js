// Child process used by the concurrency test: adds one step and sets its progress.
import { update } from '../../src/core/store.js';
import { addStep, setStepProgress } from '../../src/core/model.js';

const [name] = process.argv.slice(2);
update((data) => {
  const step = addStep(data, 1, name);
  setStepProgress(data, 1, step.id, 100, name, new Date().toISOString());
});
