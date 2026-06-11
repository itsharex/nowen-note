import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Circle, Flag, Calendar, Plus, ListTodo,
  CalendarDays, AlertTriangle, CheckCheck, Inbox, X,
  Trash2, ImagePlus, Link as LinkIcon, ExternalLink, Loader2,
  User as UserIcon
} from "lucide-react";
import { format, isToday, isPast, isTomorrow, isThisWeek, parseISO, parse } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { api, getCurrentWorkspace } from "@/lib/api";
import { Task, TaskFilter, TaskPriority, TaskStats } from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import {
  TASK_CENTER_MAIN_CLASS,
  TASK_CENTER_ROOT_CLASS,
  TASK_MOBILE_FILTER_BAR_CLASS,
} from "@/lib/taskLayout";

// 子组件 & 工具
import { useTaskTree } from "./tasks/useTaskTree";
import { calculateTaskProgress, buildTaskTree } from "./tasks/taskProgress";
import type { TaskTreeNode } from "./tasks/taskProgress";
import { TaskOverview } from "./tasks/TaskOverview";
import { TaskTreeRow } from "./tasks/TaskTreeRow";
import { TaskQuickAdd } from "./tasks/TaskQuickAdd";
import { TaskDetailPanel } from "./tasks/TaskDetailPanel";

/* ===========================================================================
 * 任务标题富文本协议
 * ---------------------------------------------------------------------------
 * 为了零侵入向后兼容，task.title 仍然是**纯字符串**，但允许内嵌两种 markdown
 * 风格的 token：
 *
 *   - 图片：![alt](/api/task-attachments/<id>)
 *           渲染时按 token 拆段：列表里显示 28×28 缩略图，详情里显示完整图片。
 *
 *   - 链接：[text](https://...) 或裸 URL（粘贴时自动包成 markdown 链接形式，
 *           text 默认为 hostname 让显示更紧凑）。
 *
 * 老数据没有任何 token —— parser 命中 0 个 match，退回单段纯文本，行为完全
 * 等价于改造前。
 * ========================================================================= */

export type Token =
  | { kind: "text"; value: string }
  | { kind: "image"; alt: string; url: string }
  | { kind: "link"; text: string; url: string };

// markdown 图片 + 链接 + 裸 URL 的合并正则。
// 顺序：image > link > raw URL。先匹配到优先级高的。
//
// 注意：[^\]]* 与 [^)]* 都禁止换行，避免吞掉跨行内容。
const TOKEN_RE = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s)]+)/g;

export function parseTaskTitle(title: string): Token[] {
  if (!title) return [];
  const out: Token[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(title)) !== null) {
    if (m.index > lastIndex) {
      out.push({ kind: "text", value: title.slice(lastIndex, m.index) });
    }
    if (m[1] !== undefined && m[2] !== undefined) {
      out.push({ kind: "image", alt: m[1], url: m[2] });
    } else if (m[3] !== undefined && m[4] !== undefined) {
      out.push({ kind: "link", text: m[3], url: m[4] });
    } else if (m[5]) {
      out.push({ kind: "link", text: hostnameOf(m[5]), url: m[5] });
    }
    lastIndex = TOKEN_RE.lastIndex;
  }
  if (lastIndex < title.length) {
    out.push({ kind: "text", value: title.slice(lastIndex) });
  }
  return out;
}

/** 把 URL 截成 hostname；解析失败时返回截短的原串，避免抛异常打破 UI。 */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.length > 24 ? url.slice(0, 24) + "…" : url;
  }
}



/* ===== 富文本渲染：列表里"紧凑模式"，详情里"完整模式" ===== */
export function TitleView({
  title,
  compact,
  isCompleted,
}: {
  title: string;
  compact: boolean;
  isCompleted: boolean;
}) {
  const { t } = useTranslation();
  const tokens = parseTaskTitle(title);
  if (tokens.length === 1 && tokens[0].kind === "text") {
    return <>{tokens[0].value}</>;
  }

  return (
    <span className="inline">
      {tokens.map((tok, i) => {
        if (tok.kind === "text") {
          return <React.Fragment key={i}>{tok.value}</React.Fragment>;
        }
        if (tok.kind === "image") {
          if (compact) {
            return (
              <span
                key={i}
                className="inline-flex align-middle mx-0.5 w-7 h-7 rounded overflow-hidden bg-app-hover border border-app-border"
              >
                <img
                  src={tok.url}
                  alt={tok.alt || 'image'}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </span>
            );
          }
          return (
            <span key={i} className="block my-2 max-w-full overflow-hidden rounded border border-app-border">
              <img
                src={tok.url}
                alt={tok.alt || 'image'}
                className="max-w-full h-auto max-h-64 object-contain"
                loading="lazy"
              />
            </span>
          );
        }
        if (tok.kind === "link") {
          return (
            <a
              key={i}
              href={tok.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex items-center gap-0.5 align-middle max-w-[120px] md:max-w-[160px] truncate",
                compact ? "text-[12px]" : "text-sm",
                isCompleted
                  ? "text-tx-tertiary no-underline"
                  : "text-accent-primary underline underline-offset-2 hover:text-accent-primary/80"
              )}
              title={tok.url}
            >
              {compact ? (
                tok.text
              ) : (
                <>
                  <LinkIcon size={12} className="flex-shrink-0 opacity-60" />
                  {tok.text}
                </>
              )}
            </a>
          );
        }
        return null;
      })}
    </span>
  );
}

/* ===== 辅助函数 ===== */

function toLocalDate(dateStr: string): Date {
  const d = parseISO(dateStr);
  if (isNaN(d.getTime())) {
    const parts = dateStr.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return d;
}

/* ===== 日期胶囊 ===== */
export function DateBadge({ dateStr }: { dateStr: string | null }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === "zh-CN" ? zhCN : enUS;
  if (!dateStr) return null;
  const d = toLocalDate(dateStr);
  const formatted = format(d, "M/d", { locale: dateLocale });

  let label: string;
  let cls: string;
  if (isToday(d)) {
    label = t('tasks.today');
    cls = "bg-indigo-500/10 text-indigo-500";
  } else if (isTomorrow(d)) {
    label = t('tasks.tomorrow');
    cls = "bg-blue-500/10 text-blue-500";
  } else if (isPast(d) && !isToday(d)) {
    label = t('tasks.overdue');
    cls = "bg-red-500/10 text-red-500";
  } else if (isThisWeek(d, { weekStartsOn: 1 })) {
    label = format(d, "EEEE", { locale: dateLocale });
    cls = "bg-emerald-500/10 text-emerald-500";
  } else {
    label = formatted;
    cls = "bg-app-hover text-tx-secondary";
  }

  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full", cls)}>
      <Calendar size={10} />
      {label}
    </span>
  );
}

/* ===== 平铺模式任务行（保留原有 TaskRow 视觉） ===== */
const TaskRow = React.forwardRef<HTMLDivElement, {
  task: Task;
  onToggle: (id: string) => void;
  onSelect: (task: Task) => void;
  onDelete: (id: string) => void;
}>(({ task, onToggle, onSelect, onDelete }, ref) => {
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

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
      className={cn(
        "group flex items-start gap-3 w-full min-w-0 px-4 py-3 rounded-lg border transition-all cursor-pointer",
        isCompleted
          ? "border-transparent bg-app-hover/50 opacity-60"
          : "border-app-border bg-app-elevated hover:shadow-md hover:border-accent-primary/30"
      )}
      onClick={() => onSelect(task)}
    >
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

      <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
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

/* ===== 主组件 ===== */
export default function TaskCenter() {
  const { t } = useTranslation();

  const FILTERS: { key: TaskFilter; label: string; icon: React.ReactNode }[] = [
    { key: "all", label: t('tasks.allTasks'), icon: <Inbox size={16} /> },
    { key: "today", label: t('tasks.today'), icon: <CalendarDays size={16} /> },
    { key: "week", label: t('tasks.next7Days'), icon: <Calendar size={16} /> },
    { key: "overdue", label: t('tasks.overdue'), icon: <AlertTriangle size={16} /> },
    { key: "completed", label: t('tasks.completed'), icon: <CheckCheck size={16} /> },
  ];

  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingOrphansRef = useRef<string[]>([]);

  // 树形任务 hook
  const {
    flatOrderedTasks,
    expandedTaskIds,
    toggleExpand,
    isTreeMode,
  } = useTaskTree(tasks, filter);

  const loadTasks = useCallback(async () => {
    try {
      const [data, statsData] = await Promise.all([
        api.getTasks(filter),
        api.getTaskStats(),
      ]);
      setTasks(data);
      setStats(statsData);
    } catch (err) {
      console.error("Failed to load tasks:", err);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const onWs = () => {
      setSelectedTask(null);
      loadTasks();
    };
    window.addEventListener("nowen:workspace-changed", onWs);
    return () => window.removeEventListener("nowen:workspace-changed", onWs);
  }, [loadTasks]);

  const handleToggle = async (id: string) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isCompleted: t.isCompleted ? 0 : 1 } : t))
    );
    try {
      await api.toggleTask(id);
      const s = await api.getTaskStats();
      setStats(s);
    } catch {
      loadTasks();
    }
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    const titleToCreate = newTitle.trim();
    const orphanIds = pendingOrphansRef.current;
    pendingOrphansRef.current = [];
    try {
      const task = await api.createTask({ title: titleToCreate });
      setTasks((prev) => [task, ...prev]);
      setNewTitle("");
      inputRef.current?.focus();
      if (orphanIds.length) {
        await Promise.all(
          orphanIds.map((id) =>
            api.taskAttachments.bind(id, task.id).catch(() => null)
          )
        );
      }
      const s = await api.getTaskStats();
      setStats(s);
    } catch (err) {
      console.error("Failed to create task:", err);
      pendingOrphansRef.current = orphanIds;
    }
  };

  const handleUpdate = async (id: string, data: Partial<Task>) => {
    try {
      const updated = await api.updateTask(id, data);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      if (selectedTask?.id === id) setSelectedTask(updated);
      const affectsStats =
        "dueDate" in data ||
        "isCompleted" in data ||
        "priority" in data;
      if (affectsStats) {
        try {
          const s = await api.getTaskStats();
          setStats(s);
        } catch (e) {
          console.error("Failed to refresh task stats:", e);
        }
      }
    } catch (err) {
      console.error("Failed to update task:", err);
    }
  };

  const handleDelete = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (selectedTask?.id === id) setSelectedTask(null);
    try {
      await api.deleteTask(id);
      const s = await api.getTaskStats();
      setStats(s);
    } catch {
      loadTasks();
    }
  };

  const filterCount = (key: TaskFilter): number => {
    if (!stats) return 0;
    switch (key) {
      case "all": return stats.total;
      case "today": return stats.today;
      case "week": return stats.week ?? 0;
      case "overdue": return stats.overdue;
      case "completed": return stats.completed;
      default: return 0;
    }
  };

  // 查找 selectedTask 对应的树节点（用于详情面板进度计算）
  const selectedTreeNode = React.useMemo(() => {
    if (!selectedTask || !isTreeMode) return null;
    const findNode = (nodes: TaskTreeNode[]): TaskTreeNode | null => {
      for (const n of nodes) {
        if (n.id === selectedTask.id) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    };
    // 从 flatOrderedTasks 中重建树查找（避免重复构建）
    // 直接用 buildTaskTree 查找更准确

    const tree = buildTaskTree(tasks);
    return findNode(tree);
  }, [selectedTask, tasks, isTreeMode]);

  return (
    <div className={TASK_CENTER_ROOT_CLASS}>
      {/* Left: Filter Panel — 桌面端显示 */}
      <div className="hidden md:flex w-[220px] min-w-[220px] shrink-0 border-r border-app-border bg-app-surface flex-col transition-colors">
        <div className="px-4 py-4 border-b border-app-border">
          <div className="flex items-center gap-2">
            <ListTodo size={18} className="text-accent-primary" />
            <h2 className="text-sm font-bold text-tx-primary">{t('tasks.title')}</h2>
          </div>
          {stats && (
            <div className="mt-2 text-xs text-tx-tertiary">
              {t('tasks.pendingCount', { pending: stats.pending, completed: stats.completed })}
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setSelectedTask(null); }}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors",
                filter === f.key
                  ? "bg-app-active text-accent-primary"
                  : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
              )}
            >
              <span className="flex items-center gap-2.5">
                {f.icon}
                {f.label}
              </span>
              <span className={cn(
                "text-xs min-w-[20px] text-center rounded-full px-1.5 py-0.5",
                filter === f.key ? "bg-accent-primary/20 text-accent-primary" : "text-tx-tertiary"
              )}>
                {filterCount(f.key)}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Center: Task List */}
      <div className={TASK_CENTER_MAIN_CLASS}>
        {/* 移动端：水平筛选标签 */}
        <div className={TASK_MOBILE_FILTER_BAR_CLASS}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setSelectedTask(null); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0",
                filter === f.key
                  ? "bg-accent-primary/15 text-accent-primary"
                  : "text-tx-secondary bg-app-hover/50 active:bg-app-active"
              )}
            >
              {f.icon}
              {f.label}
              <span className={cn(
                "text-[10px] min-w-[16px] text-center",
                filter === f.key ? "text-accent-primary" : "text-tx-tertiary"
              )}>
                {filterCount(f.key)}
              </span>
            </button>
          ))}
        </div>

        {/* 顶部概览卡片 — 仅在 "all" 过滤时显示 */}
        {filter === "all" && !isLoading && (
          <TaskOverview tasks={tasks} stats={stats} />
        )}

        {/* Header — 桌面端显示 */}
        <div className="hidden md:block px-6 py-4 border-b border-app-border">
          <h1 className="text-lg font-bold text-tx-primary">
            {FILTERS.find((f) => f.key === filter)?.label || t('tasks.allTasks')}
          </h1>
        </div>

        {/* Quick Add */}
        <div className="px-4 md:px-6 py-3 border-b border-app-border">
          <TaskQuickAdd
            value={newTitle}
            onChange={setNewTitle}
            onSubmit={handleCreate}
            onUploaded={(ids) => { pendingOrphansRef.current = ids; }}
            inputRef={inputRef}
          />
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-tx-tertiary text-sm">
              {t('common.loading')}
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-tx-tertiary">
              <CheckCheck size={36} className="mb-3 opacity-40" />
              <span className="text-sm">{t('tasks.noTasks')}</span>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {isTreeMode ? (
                  // 树形模式：使用 flatOrderedTasks 渲染带缩进的任务行
                  flatOrderedTasks.map((item) => (
                    <TaskTreeRow
                      key={item.node.id}
                      task={item.node}
                      depth={item.depth}
                      isExpanded={expandedTaskIds.has(item.node.id)}
                      hasChildren={item.node.children.length > 0}
                      onToggle={handleToggle}
                      onSelect={setSelectedTask}
                      onDelete={handleDelete}
                      onToggleExpand={toggleExpand}
                    />
                  ))
                ) : (
                  // 过滤模式：平铺渲染
                  tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={handleToggle}
                      onSelect={setSelectedTask}
                      onDelete={handleDelete}
                    />
                  ))
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* Right: Detail Panel */}
      <AnimatePresence>
        {selectedTask && (
          <TaskDetailPanel
            key={selectedTask.id}
            task={selectedTask}
            treeNode={selectedTreeNode}
            onClose={() => setSelectedTask(null)}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}