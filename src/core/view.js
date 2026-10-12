// Derived, read-only facts about tasks for display: urgency and ordering.

import { taskProgress } from './model.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SOON_DAYS = 3;

function dueParts(due) {
  const [date, time] = due.split(' ');
  const [year, month, day] = date.split('-').map(Number);
  return { year, month, day, time };
}

// A date without a time is due at the end of that day (local time).
function dueTime(due) {
  const { year, month, day, time } = dueParts(due);
  if (!time) return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute).getTime();
}

// Whole calendar days from today to the due day; negative when the day has passed.
function daysUntil(due, now) {
  const { year, month, day } = dueParts(due);
  const today = new Date(now);
  const from = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.UTC(year, month - 1, day) - from) / DAY_MS);
}

// state: 'done' | 'none' | 'overdue' | 'soon' | 'normal'
export function describeTask(task, now) {
  const progress = taskProgress(task);
  const days = task.due ? daysUntil(task.due, now) : null;
  let state;
  if (progress === 100) state = 'done';
  else if (!task.due) state = 'none';
  else if (now > dueTime(task.due)) state = 'overdue';
  else if (days <= SOON_DAYS) state = 'soon';
  else state = 'normal';
  return { progress, state, days };
}

// Unfinished tasks by nearest due date, then unfinished without a due date, then finished.
export function sortTasks(tasks, now) {
  const rank = (task) => {
    if (describeTask(task, now).state === 'done') return 2;
    return task.due ? 0 : 1;
  };
  return [...tasks].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (rank(a) === 0) return dueTime(a.due) - dueTime(b.due) || a.id - b.id;
    return a.id - b.id;
  });
}
