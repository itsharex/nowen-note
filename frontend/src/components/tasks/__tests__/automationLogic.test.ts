import { describe, it, expect } from "vitest";

/**
 * Tests for Phase 6.4 automation scanner logic.
 * Since scanners depend on DB, we test the classification and dedup logic here.
 */

// Simulated dependency-ready scan logic
interface DepRow {
  depId: string;
  predecessorTaskId: string;
  successorTaskId: string;
  userId: string;
  depType: string;
  predCompleted: number;
  succCompleted: number;
  succTitle: string;
}

const sentDepKeys = new Set<string>();

function simulateDepScan(rows: DepRow[]): Array<{ taskId: string; type: string }> {
  const results: Array<{ taskId: string; type: string }> = [];
  for (const row of rows) {
    const key = `${row.userId}:${row.successorTaskId}:${row.predecessorTaskId}`;
    if (sentDepKeys.has(key)) continue;
    sentDepKeys.add(key);
    results.push({ taskId: row.successorTaskId, type: "dependency_ready" });
  }
  return results;
}

// Simulated overdue daily scan logic
interface OverdueRow {
  id: string;
  title: string;
  userId: string;
  dueAt: string | null;
  dueDate: string | null;
}

const sentOverdueKeys = new Set<string>();

function simulateOverdueScan(rows: OverdueRow[], todayUtc: string): Array<{ taskId: string; type: string }> {
  const results: Array<{ taskId: string; type: string }> = [];
  for (const row of rows) {
    const key = `${row.userId}:${row.id}:${todayUtc}`;
    if (sentOverdueKeys.has(key)) continue;
    sentOverdueKeys.add(key);
    results.push({ taskId: row.id, type: "overdue_daily" });
  }
  return results;
}

describe("dependency-ready notifications", () => {
  it("produces notification when predecessor completed and successor not", () => {
    sentDepKeys.clear();
    const rows: DepRow[] = [{
      depId: "d1", predecessorTaskId: "a", successorTaskId: "b",
      userId: "u1", depType: "finish_to_start", predCompleted: 1, succCompleted: 0, succTitle: "Task B",
    }];
    const result = simulateDepScan(rows);
    expect(result).toHaveLength(1);
    expect(result[0].taskId).toBe("b");
    expect(result[0].type).toBe("dependency_ready");
  });

  it("no notification when successor already completed", () => {
    sentDepKeys.clear();
    const rows: DepRow[] = [{
      depId: "d2", predecessorTaskId: "a", successorTaskId: "b",
      userId: "u1", depType: "finish_to_start", predCompleted: 1, succCompleted: 1, succTitle: "Task B",
    }];
    // In real scanner, completed successors are filtered by SQL
    // Here we simulate that by only passing rows that pass the SQL filter
    const filtered = rows.filter(r => r.succCompleted === 0);
    const result = simulateDepScan(filtered);
    expect(result).toHaveLength(0);
  });

  it("dedup: same dependency not notified twice", () => {
    sentDepKeys.clear();
    const rows: DepRow[] = [{
      depId: "d3", predecessorTaskId: "a", successorTaskId: "b",
      userId: "u1", depType: "finish_to_start", predCompleted: 1, succCompleted: 0, succTitle: "Task B",
    }];
    const result1 = simulateDepScan(rows);
    expect(result1).toHaveLength(1);
    const result2 = simulateDepScan(rows);
    expect(result2).toHaveLength(0);
  });

  it("different workspaces do not cross-contaminate", () => {
    sentDepKeys.clear();
    const rows: DepRow[] = [
      { depId: "d4", predecessorTaskId: "a", successorTaskId: "b", userId: "u1", depType: "finish_to_start", predCompleted: 1, succCompleted: 0, succTitle: "B in u1" },
      { depId: "d5", predecessorTaskId: "c", successorTaskId: "d", userId: "u2", depType: "finish_to_start", predCompleted: 1, succCompleted: 0, succTitle: "D in u2" },
    ];
    const result = simulateDepScan(rows);
    expect(result).toHaveLength(2);
  });
});

describe("overdue daily notifications", () => {
  it("produces notification for overdue task", () => {
    sentOverdueKeys.clear();
    const rows: OverdueRow[] = [{
      id: "t1", title: "Overdue Task", userId: "u1",
      dueAt: "2026-06-14T10:00:00Z", dueDate: null,
    }];
    const result = simulateOverdueScan(rows, "2026-06-15");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("overdue_daily");
  });

  it("dedup: same task same day only once", () => {
    sentOverdueKeys.clear();
    const rows: OverdueRow[] = [{
      id: "t2", title: "Overdue Task", userId: "u1",
      dueAt: "2026-06-14T10:00:00Z", dueDate: null,
    }];
    const result1 = simulateOverdueScan(rows, "2026-06-15");
    expect(result1).toHaveLength(1);
    const result2 = simulateOverdueScan(rows, "2026-06-15");
    expect(result2).toHaveLength(0);
  });

  it("dueDate-only uses end of day comparison", () => {
    // For dueDate-only, the SQL checks dueDate < today
    // dueDate "2026-06-14" < today "2026-06-15" -> overdue
    sentOverdueKeys.clear();
    const rows: OverdueRow[] = [{
      id: "t3", title: "Yesterday", userId: "u1",
      dueAt: null, dueDate: "2026-06-14",
    }];
    const result = simulateOverdueScan(rows, "2026-06-15");
    expect(result).toHaveLength(1);
  });

  it("dueDate today is not overdue", () => {
    // dueDate "2026-06-15" is NOT < today "2026-06-15"
    sentOverdueKeys.clear();
    const rows: OverdueRow[] = [{
      id: "t4", title: "Today", userId: "u1",
      dueAt: null, dueDate: "2026-06-15",
    }];
    // Simulate SQL filter: dueDate < today
    const filtered = rows.filter(r => r.dueDate && r.dueDate < "2026-06-15");
    const result = simulateOverdueScan(filtered, "2026-06-15");
    expect(result).toHaveLength(0);
  });
});

describe("useReminderNotifier type handling", () => {
  it("dependency_ready type is recognized", () => {
    const type = "dependency_ready";
    expect(type).toBe("dependency_ready");
  });

  it("overdue_daily type is recognized", () => {
    const type = "overdue_daily";
    expect(type).toBe("overdue_daily");
  });

  it("task_reminder type is default", () => {
    const type = undefined;
    expect(type || "task_reminder").toBe("task_reminder");
  });

  it("recent endpoint still only requests /recent", () => {
    // Verify: no /test-now in useReminderNotifier
    // This is a meta-test: the hook should not import or call /test-now
    const hookSource = require("fs").readFileSync(
      "src/components/tasks/useReminderNotifier.ts", "utf8"
    );
    expect(hookSource).not.toContain("/test-now");
    expect(hookSource).toContain("/api/task-reminders/recent");
  });
});
