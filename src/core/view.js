// Derived, read-only facts about tasks for display: urgency, ordering and the recent archive.

import { taskProgress } from './model.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SOON_DAYS = 3;
// Finished tasks stay visible in the archive this long unless the user chose otherwise; after that they are only kept in the file.
export const ARCHIVE_DAYS = 7;

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

export const isArchived = (task) => Boolean(task.completedAt);

// state: 'done' | 'none' | 'overdue' | 'soon' | 'normal'
export function describeTask(task, now) {
  const days = task.due ? daysUntil(task.due, now) : null;
  let state;
  if (isArchived(task)) state = 'done';
  else if (!task.due) state = 'none';
  else if (now > dueTime(task.due)) state = 'overdue';
  else if (days <= SOON_DAYS) state = 'soon';
  else state = 'normal';
  return { progress: taskProgress(task), state, days };
}

// Unfinished tasks by nearest due date, then those without a due date.
export function activeTasks(tasks) {
  return tasks.filter((task) => !isArchived(task)).sort((a, b) => {
    if (a.due && b.due) return dueTime(a.due) - dueTime(b.due) || a.id - b.id;
    if (a.due || b.due) return a.due ? -1 : 1;
    return a.id - b.id;
  });
}

// Tasks finished within the last `days` days, most recently finished first.
export function recentArchive(tasks, now, days = ARCHIVE_DAYS) {
  const since = now - days * DAY_MS;
  return tasks
    .filter((task) => isArchived(task) && Date.parse(task.completedAt) >= since)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || b.id - a.id);
}

// Every finished task, most recently finished first.
export function allArchived(tasks) {
  return tasks.filter(isArchived).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || b.id - a.id);
}
