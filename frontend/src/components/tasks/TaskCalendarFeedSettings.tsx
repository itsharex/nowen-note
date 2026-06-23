import React, { useState, useEffect, useCallback } from "react";
import { Calendar, Copy, RefreshCw, Trash2, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { api, getBaseUrl } from "@/lib/api";
import { toast } from "@/lib/toast";

// 日历订阅配置类型
interface CalendarFeed {
  id: string;
  token: string;
  enabled: boolean;
  includeCompleted: boolean;
  includeDescription: boolean;
  defaultAlarmMinutes: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// 默认提醒时间选项
const ALARM_OPTIONS = [
  { value: 0, label: "0 min" },
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
  { value: 1440, label: "1 day" },
];

export function TaskCalendarFeedSettings() {
  const { t } = useTranslation();
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // 拉取订阅配置
  const loadFeed = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.taskCalendarFeed.get();
      setFeed(res.feed);
    } catch {
      // 静默失败
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  // 启用订阅
  const handleCreate = useCallback(async () => {
    try {
      setActionLoading("create");
      const res = await api.taskCalendarFeed.create();
      setFeed(res.feed);
      toast.success(t("tasks.calendarFeed.created"));
    } catch {
      toast.error(t("tasks.calendarFeed.error"));
    } finally {
      setActionLoading(null);
    }
  }, [t]);

  // 更新配置
  const handleUpdate = useCallback(async (data: Partial<CalendarFeed>) => {
    try {
      setActionLoading("update");
      const res = await api.taskCalendarFeed.update(data);
      setFeed(res.feed);
      toast.success(t("tasks.calendarFeed.updated"));
    } catch {
      toast.error(t("tasks.calendarFeed.error"));
    } finally {
      setActionLoading(null);
    }
  }, [t]);

  // 禁用订阅
  const handleDisable = useCallback(async () => {
    if (!window.confirm(t("tasks.calendarFeed.confirmDisable"))) return;
    try {
      setActionLoading("disable");
      await handleUpdate({ enabled: false });
    } finally {
      setActionLoading(null);
    }
  }, [handleUpdate, t]);

  // 重置 token
  const handleRotate = useCallback(async () => {
    if (!window.confirm(t("tasks.calendarFeed.confirmRotate"))) return;
    try {
      setActionLoading("rotate");
      await api.taskCalendarFeed.rotateToken();
      await loadFeed();
      toast.success(t("tasks.calendarFeed.rotated"));
    } catch {
      toast.error(t("tasks.calendarFeed.error"));
    } finally {
      setActionLoading(null);
    }
  }, [loadFeed, t]);

  // 复制订阅链接
  const handleCopy = useCallback(async () => {
    if (!feed?.token) return;
    const baseUrl = getBaseUrl().replace(/\/api$/, "");
    const url = `${baseUrl}/api/task-calendar/feed/${feed.token}.ics`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("tasks.calendarFeed.copied"));
    } catch {
      // fallback: 选中 input 内容
      const input = document.createElement("textarea");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      toast.success(t("tasks.calendarFeed.copied"));
    }
  }, [feed?.token, t]);

  // 生成完整订阅 URL
  const icsUrl = feed?.token
    ? `${getBaseUrl().replace(/\/api$/, "")}/api/task-calendar/feed/${feed.token}.ics`
    : "";

  if (loading) {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-1 px-2 py-1 text-xs text-tx-tertiary rounded-md"
      >
        <Loader2 size={13} className="animate-spin" />
        {t("tasks.calendarFeed.loading")}
      </button>
    );
  }

  // 未启用状态
  if (!feed) {
    return (
      <button
        type="button"
        onClick={handleCreate}
        disabled={actionLoading === "create"}
        className="flex items-center gap-1 px-2 py-1 text-xs text-tx-tertiary hover:text-accent-primary rounded-md hover:bg-accent-primary/5 transition-colors"
      >
        {actionLoading === "create" ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <Calendar size={13} />
        )}
        {t("tasks.calendarFeed.enable")}
      </button>
    );
  }

  // 已启用状态：折叠/展开卡片
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors",
          feed.enabled
            ? "text-accent-primary bg-accent-primary/5 hover:bg-accent-primary/10"
            : "text-tx-tertiary hover:text-tx-secondary hover:bg-app-hover"
        )}
      >
        <Calendar size={13} />
        {t("tasks.calendarFeed.title")}
        {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>

      {expanded && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-app-elevated rounded-xl border border-app-border shadow-lg z-50 p-3 space-y-3">
          {/* 标题 */}
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-tx-primary">{t("tasks.calendarFeed.title")}</h4>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-tx-tertiary hover:text-tx-secondary"
            >
              <X size={14} />
            </button>
          </div>

          {/* 说明 */}
          <p className="text-[10px] text-tx-tertiary leading-relaxed">
            {t("tasks.calendarFeed.description")}
          </p>

          {/* 状态 */}
          <div className="flex items-center gap-2 text-[11px]">
            <span className={cn("w-2 h-2 rounded-full", feed.enabled ? "bg-green-500" : "bg-gray-400")} />
            <span className="text-tx-secondary">
              {feed.enabled ? t("tasks.calendarFeed.active") : t("tasks.calendarFeed.disabled")}
            </span>
            {feed.lastAccessedAt && (
              <span className="text-tx-tertiary ml-auto">
                {t("tasks.calendarFeed.lastAccess")}: {new Date(feed.lastAccessedAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* 订阅链接 */}
          <div className="space-y-1">
            <label className="block text-[10px] text-tx-tertiary">{t("tasks.calendarFeed.link")}</label>
            <div className="flex gap-1">
              <input
                type="text"
                readOnly
                value={icsUrl}
                className="flex-1 px-2 py-1 text-[10px] bg-app-bg rounded border border-app-border text-tx-secondary truncate"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="px-2 py-1 text-[10px] text-tx-tertiary bg-app-hover rounded hover:bg-app-hover/80 transition-colors"
              >
                <Copy size={11} />
              </button>
            </div>
          </div>

          {/* 导出已完成待办 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={feed.includeCompleted}
              onChange={(e) => handleUpdate({ includeCompleted: e.target.checked })}
              disabled={actionLoading === "update"}
              className="rounded border-app-border text-accent-primary focus:ring-accent-primary/30"
            />
            <span className="text-[11px] text-tx-secondary">{t("tasks.calendarFeed.includeCompleted")}</span>
          </label>

          {/* 导出描述 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={feed.includeDescription}
              onChange={(e) => handleUpdate({ includeDescription: e.target.checked })}
              disabled={actionLoading === "update"}
              className="rounded border-app-border text-accent-primary focus:ring-accent-primary/30"
            />
            <span className="text-[11px] text-tx-secondary">{t("tasks.calendarFeed.includeDescription")}</span>
          </label>

          {/* 默认提醒时间 */}
          <div className="space-y-1">
            <label className="block text-[10px] text-tx-tertiary">{t("tasks.calendarFeed.defaultAlarm")}</label>
            <select
              value={feed.defaultAlarmMinutes}
              onChange={(e) => handleUpdate({ defaultAlarmMinutes: Number(e.target.value) })}
              disabled={actionLoading === "update"}
              className="w-full px-2 py-1 text-[11px] bg-app-bg rounded border border-app-border text-tx-primary focus:ring-accent-primary/30"
            >
              {ALARM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleRotate}
              disabled={actionLoading === "rotate"}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-tx-tertiary hover:text-amber-600 bg-app-hover rounded hover:bg-amber-50 transition-colors disabled:opacity-50"
            >
              {actionLoading === "rotate" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              {t("tasks.calendarFeed.rotate")}
            </button>
            <button
              type="button"
              onClick={handleDisable}
              disabled={actionLoading === "disable"}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-tx-tertiary hover:text-red-600 bg-app-hover rounded hover:bg-red-50 transition-colors disabled:opacity-50 ml-auto"
            >
              {actionLoading === "disable" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Trash2 size={11} />
              )}
              {t("tasks.calendarFeed.disable")}
            </button>
          </div>

          {/* 提示 */}
          <p className="text-[9px] text-tx-tertiary leading-relaxed">
            {t("tasks.calendarFeed.hint")}
          </p>
        </div>
      )}
    </div>
  );
}