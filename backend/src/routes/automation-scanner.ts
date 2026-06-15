import { getDb } from "../db/schema";

/**
 * Lightweight automation scanners for Phase 6.4.
 *
 * These produce "system reminders" that enter the same recent ring buffer
 * as normal task reminders. They do NOT modify tasks, dates, or statuses.
 */

export interface SystemReminder {
  reminderId: string;
  taskId: string;
  taskTitle: string;
  userId: string;
  type: "task_reminder" | "dependency_ready" | "overdue_daily";
}

// In-memory dedup sets (reset on process restart — acceptable)
const dependencyReadySent = new Set<string>();
const overdueDailySent = new Set<string>();

function makeDepKey(userId: string, successorId: string, predecessorId: string) {
  return `${userId}:${successorId}:${predecessorId}`;
}

function makeOverdueKey(userId: string, taskId: string, day: string) {
  return `${userId}:${taskId}:${day}`;
}

/**
 * Scan for dependencies where predecessor just completed and successor is still pending.
 * Returns notifications for successors that can now start.
 *
 * Dedup: per user+successor+predecessor, in-memory. Restart re-notifies (acceptable).
 */
export function scanDependencyReadyNotifications(): SystemReminder[] {
  const db = getDb();

  // Find unfinished successors whose predecessor is completed
  const rows = db.prepare(`
    SELECT
      d.id AS depId,
      d.predecessorTaskId,
      d.successorTaskId,
      d.userId,
      d.type AS depType,
      pred.isCompleted AS predCompleted,
      pred.title AS predTitle,
      succ.isCompleted AS succCompleted,
      succ.title AS succTitle
    FROM task_dependencies d
    JOIN tasks pred ON pred.id = d.predecessorTaskId
    JOIN tasks succ ON succ.id = d.successorTaskId
    WHERE d.type = 'finish_to_start'
      AND pred.isCompleted = 1
      AND succ.isCompleted = 0
  `).all() as any[];

  const results: SystemReminder[] = [];

  for (const row of rows) {
    const key = makeDepKey(row.userId, row.successorTaskId, row.predecessorTaskId);
    if (dependencyReadySent.has(key)) continue;

    dependencyReadySent.add(key);

    results.push({
      reminderId: `dep-ready:${row.depId}`,
      taskId: row.successorTaskId,
      taskTitle: row.succTitle,
      userId: row.userId,
      type: "dependency_ready",
    });
  }

  return results;
}

/**
 * Scan for overdue tasks and produce a daily reminder.
 *
 * Uses the task's own userId (from tasks table, not from task_reminders).
 * Each task gets at most one overdue reminder per calendar day (UTC-based).
 *
 * Dedup: per user+task+day, in-memory. Restart may re-notify for today (acceptable).
 */
export function scanOverdueDailyNotifications(): SystemReminder[] {
  const db = getDb();

  const now = new Date();
  const todayUtc = now.toISOString().slice(0, 10); // YYYY-MM-DD

  // Find all incomplete tasks that have a due date in the past
  // dueAt: if present, check < now
  // dueDate: if present (and no dueAt), check < today (i.e., the whole day is past)
  const rows = db.prepare(`
    SELECT id, title, userId, dueAt, dueDate
    FROM tasks
    WHERE isCompleted = 0
      AND (
        (dueAt IS NOT NULL AND dueAt < datetime('now'))
        OR
        (dueAt IS NULL AND dueDate IS NOT NULL AND dueDate < ?)
      )
  `).all(todayUtc) as any[];

  const results: SystemReminder[] = [];

  for (const row of rows) {
    const key = makeOverdueKey(row.userId, row.id, todayUtc);
    if (overdueDailySent.has(key)) continue;

    overdueDailySent.add(key);

    results.push({
      reminderId: `overdue-daily:${row.id}:${todayUtc}`,
      taskId: row.id,
      taskTitle: row.title,
      userId: row.userId,
      type: "overdue_daily",
    });
  }

  return results;
}

/** Reset dedup sets (for testing). */
export function resetAutomationDedup() {
  dependencyReadySent.clear();
  overdueDailySent.clear();
}
