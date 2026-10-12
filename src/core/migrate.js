// Converts a data file written by version 1 into the current shape.
// Version 1 gave every step a percentage and let a task without steps carry its own.
// Now a step is either done or not, and every task has at least one step.

import { DATA_VERSION } from './model.js';

const latest = (times) => times.filter(Boolean).sort().at(-1) ?? null;

function migrateTask(task) {
  const { percent, updatedBy, updatedAt, ...kept } = task;
  let steps = task.steps.map((step) => ({
    id: step.id,
    name: step.name,
    done: step.percent === 100,
    updatedBy: step.updatedBy ?? null,
    updatedAt: step.updatedAt ?? null,
  }));
  let { nextStepId } = task;
  if (steps.length === 0) {
    // The task was its own single piece of work: keep that as one step.
    steps = [{ id: 1, name: task.name, done: percent === 100, updatedBy: updatedBy ?? null, updatedAt: updatedAt ?? null }];
    nextStepId = 2;
  }
  const complete = steps.every((step) => step.done);
  return {
    ...kept,
    // A finished task must have a completion time; fall back to when it was created.
    completedAt: complete ? latest(steps.map((step) => step.updatedAt)) ?? task.createdAt ?? new Date(0).toISOString() : null,
    nextStepId,
    steps,
  };
}

// Takes already-validated version 1 data and returns version 2 data. Does not write anything.
export function migrateFromV1(data) {
  return { ...data, version: DATA_VERSION, tasks: data.tasks.map(migrateTask) };
}
