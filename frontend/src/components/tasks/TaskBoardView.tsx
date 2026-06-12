import React, { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Circle, CheckCircle2, AlertTriangle, Ban, Flag, Calendar,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Task, TaskStatus } from "@/types";
import { TitleView } from "./taskTitleTokens";
import { DateBadge } from "./DateBadge";
import { calculateTaskProgress } from "./taskProgress";
import { buildTaskTree, type TaskTreeNode } from "./taskProgress";

const COLUMNS: { key: TaskStatus; icon: React.ReactNode; color: string }[] = [
  { key: "todo", icon: <Circle size={16} />, color: "text-tx-tertiary" },
  { key: "doing", icon: <AlertTriangle size={16} />, color: "text-amber-500" },
  { key: "blocked", icon: <Ban size={16} />, color: "text-red-500" },
  { key: "done", icon: <CheckCircle2 size={16} />, color: "text-indigo-500" },
];

const PRIORITY_CONFIG: Record<number, { label: string; flagClass: string }> = {
  3: { label: "High", flagClass: "text-red-500" },
  2: { label: "Medium", flagClass: "text-amber-500" },
  1: { label: "Low", flagClass: "text-blue-400" },
};

export function TaskBoardView({
  tasks,
  onSelect,
  onStatusChange,
}: {
  tasks: Task[];
  onSelect: (task: Task) => void;
  onStatusChange: (id: string, status: TaskStatus) => void;
}) {
  const { t } = useTranslation();

  // Build a map for quick child count lookup
  const childCountMap = useMemo(() => {
    const map = new Map<string, { total: number; completed: number }>();
    for (const task of tasks) {
      if (task.parentId) {
        const existing = map.get(task.parentId) || { total: 0, completed: 0 };
        existing.total++;
        if (task.isCompleted) existing.completed++;
        map.set(task.parentId, existing);
      }
    }
    return map;
  }, [tasks]);

  const grouped = useMemo(() => {
    const groups: Record<TaskStatus, Task[]> = {
      todo: [], doing: [], blocked: [], done: [],
    };
    for (const task of tasks) {
      // Only show root tasks or tasks with status
      const status = task.status || (task.isCompleted ? "done" : "todo");
      if (groups[status]) {
        groups[status].push(task);
      } else {
        groups.todo.push(task);
      }
    }
    return groups;
  }, [tasks]);

  const STATUS_LABELS: Record<TaskStatus, string> = {
    todo: t("tasks.statusTodo"),
    doing: t("tasks.statusDoing"),
    blocked: t("tasks.statusBlocked"),
    done: t("tasks.statusDone"),
  };

  return (
    <div className="flex gap-3 overflow-x-auto overflow-y-hidden px-4 md:px-6 py-4 h-full">
      {COLUMNS.map((col) => {
        const columnTasks = grouped[col.key];
        return (
          <div
            key={col.key}
            className="flex flex-col min-w-[240px] w-[240px] shrink-0 bg-app-elevated/50 rounded-xl border border-app-border"
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-app-border">
              <span className={col.color}>{col.icon}</span>
              <span className="text-sm font-medium text-tx-primary">
                {STATUS_LABELS[col.key]}
              </span>
              <span className="text-xs text-tx-tertiary ml-auto">
                {columnTasks.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {columnTasks.map((task) => {
                const pri = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG[2];
                const childInfo = childCountMap.get(task.id);
                return (
                  <motion.div
                    key={task.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-3 rounded-lg bg-app-surface border border-app-border hover:shadow-md hover:border-accent-primary/30 cursor-pointer transition-all"
                    onClick={() => onSelect(task)}
                  >
                    {/* Priority flag */}
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-[13px] text-tx-primary leading-snug line-clamp-2 break-words [overflow-wrap:anywhere]">
                        <TitleView title={task.title} compact isCompleted={task.isCompleted === 1} />
                      </span>
                      <Flag size={12} className={cn("shrink-0 mt-0.5", pri.flagClass)} />
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {task.dueDate && (
                        <DateBadge dateStr={task.dueDate} dueAt={task.dueAt} />
                      )}
                      {childInfo && childInfo.total > 0 && (
                        <span className="text-[10px] text-tx-tertiary">
                          {childInfo.completed}/{childInfo.total}
                        </span>
                      )}
                    </div>

                    {/* Status selector */}
                    <div className="flex items-center gap-1 mt-2 pt-2 border-t border-app-border/50">
                      {COLUMNS.map((c) => {
                        const isActive = (task.status || (task.isCompleted ? "done" : "todo")) === c.key;
                        return (
                          <button
                            key={c.key}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isActive) onStatusChange(task.id, c.key);
                            }}
                            className={cn(
                              "p-1 rounded transition-colors",
                              isActive ? "bg-accent-primary/15" : "hover:bg-app-hover opacity-50 hover:opacity-100"
                            )}
                            title={STATUS_LABELS[c.key]}
                          >
                            <span className={c.color}>{React.cloneElement(c.icon as React.ReactElement, { size: 12 })}</span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}

              {columnTasks.length === 0 && (
                <div className="text-center text-xs text-tx-tertiary py-8 opacity-50">
                  -
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
