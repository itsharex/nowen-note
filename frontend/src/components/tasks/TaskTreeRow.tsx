import React from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2, Circle, Flag, ChevronRight, ChevronDown,
  Trash2, User as UserIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getCurrentWorkspace } from "@/lib/api";
import type { Task, TaskPriority } from "@/types";
import type { TaskTreeNode } from "./taskProgress";
import { calculateTaskProgress } from "./taskProgress";
import { TitleView, DateBadge } from "../TaskCenter";

/* ===== 树形任务行 ===== */
export const TaskTreeRow = React.forwardRef<HTMLDivElement, {
  task: TaskTreeNode;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  onToggle: (id: string) => void;
  onSelect: (task: Task) => void;
  onDelete: (id: string) => void;
  onToggleExpand: (id: string) => void;
}>(({
  task,
  depth,
  isExpanded,
  hasChildren,
  onToggle,
  onSelect,
  onDelete,
  onToggleExpand,
}, ref) => {
  const { t } = useTranslation();
  const isCompleted = task.isCompleted === 1;

  const PRIORITY_CONFIG: Record<number, { label: string; color: string; flagClass: string }> = {
    3: { label: t('tasks.high'), color: "text-red-500", flagClass: "text-red-500" },
    2: { label: t('tasks.medium'), color: "text-amber-500", flagClass: "text-amber-500" },
    1: { label: t('tasks.low'), color: "text-blue-400", flagClass: "text-blue-400" },
  };
  const pri = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG[2];

  const showCreator =
    !!task.creatorName && getCurrentWorkspace() !== "personal";

  // 父任务进度信息
  const progressInfo = hasChildren ? calculateTaskProgress(task) : null;

  // 缩进量：每层 24px，最多 6 层
  const indentPx = Math.min(depth, 6) * 24;

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
      style={{ paddingLeft: `${indentPx}px` }}
      className={cn(
        "group flex items-start gap-2 w-full min-w-0 pr-4 py-3 rounded-lg border transition-all cursor-pointer",
        isCompleted
          ? "border-transparent bg-app-hover/50 opacity-60"
          : "border-app-border bg-app-elevated hover:shadow-md hover:border-accent-primary/30"
      )}
      onClick={() => onSelect(task)}
    >
      {/* 展开/折叠箭头 */}
      {hasChildren ? (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand(task.id); }}
          className="flex-shrink-0 mt-0.5 p-0.5 rounded hover:bg-app-hover transition-colors"
          title={isExpanded ? t('tasks.collapse') : t('tasks.expand')}
        >
          {isExpanded
            ? <ChevronDown size={16} className="text-tx-tertiary" />
            : <ChevronRight size={16} className="text-tx-tertiary" />}
        </button>
      ) : (
        <span className="flex-shrink-0 w-5" />
      )}

      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
        className="flex-shrink-0 mt-0.5 transition-transform hover:scale-110"
      >
        {isCompleted ? (
          <CheckCircle2 className="w-5 h-5 text-indigo-500" />
        ) : (
          <Circle className="w-5 h-5 text-tx-tertiary group-hover:text-indigo-400 transition-colors" />
        )}
      </button>

      {/* Title + 元信息 */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span
          className={cn(
            "text-[13px] md:text-sm leading-relaxed break-words [overflow-wrap:anywhere] line-clamp-2 transition-all",
            isCompleted ? "line-through text-tx-tertiary" : "text-tx-primary"
          )}
          title={task.title}
        >
          <TitleView title={task.title} compact isCompleted={isCompleted} />
        </span>
        {/* 移动端元信息行 */}
        {(task.dueDate || showCreator) && (
          <div className="md:hidden flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
            <DateBadge dateStr={task.dueDate} />
            {showCreator && (
              <span
                className="flex items-center gap-1 text-[10px] text-tx-tertiary min-w-0"
                title={t('common.createdBy', { name: task.creatorName })}
              >
                <UserIcon size={10} className="shrink-0" />
                <span className="truncate">{task.creatorName}</span>
              </span>
            )}
          </div>
        )}
        {/* 桌面端 creator 行 */}
        {showCreator && (
          <span
            className="hidden md:flex items-center gap-1 text-[10px] text-tx-tertiary truncate"
            title={t('common.createdBy', { name: task.creatorName })}
          >
            <UserIcon size={10} className="shrink-0" />
            <span className="truncate">{task.creatorName}</span>
          </span>
        )}
      </div>

      {/* 右侧 badges */}
      <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
        {/* 父任务进度条 */}
        {progressInfo && (
          <div className="hidden sm:flex items-center gap-1.5" title={`${progressInfo.completedChildren}/${progressInfo.totalChildren}`}>
            <span className="text-[10px] text-tx-tertiary whitespace-nowrap">
              {progressInfo.completedChildren}/{progressInfo.totalChildren}
            </span>
            <div className="w-16 h-1.5 rounded-full bg-app-border overflow-hidden">
              <div
                className="h-full rounded-full bg-accent-primary transition-all duration-300"
                style={{ width: `${progressInfo.progress}%` }}
              />
            </div>
          </div>
        )}
        <span className="hidden md:inline-flex">
          <DateBadge dateStr={task.dueDate} />
        </span>
        <Flag size={14} className={pri.flagClass} />
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(task.id); }}
          className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-tx-tertiary hover:text-accent-danger transition-all"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </motion.div>
  );
});

TaskTreeRow.displayName = "TaskTreeRow";
