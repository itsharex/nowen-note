import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Bell, BellOff, Clock, AlertTriangle, Loader2, RefreshCw, Monitor, MoreHorizontal, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { ReminderOverview, ReminderOverviewItem } from "@/types";

interface ReminderCenterProps {
  open: boolean;
  onClose: () => void;
  onSelectTask: (taskId: string) => void;
}

const GROUP_ORDER: Array<{ key: keyof ReminderOverview; icon: React.ReactNode }> = [
  { key: "missed", icon: <AlertTriangle size={14} /> },
  { key: "today", icon: <Clock size={14} /> },
  { key: "upcoming", icon: <Clock size={14} /> },
  { key: "disabled", icon: <BellOff size={14} /> },
];

function formatOffset(minutes: number, t: (key: string, opts?: any) => string): string {
  if (minutes === 0) return t("tasks.reminderCenter.atDue");
  if (minutes < 60) return t("tasks.reminderCenter.minutesBefore", { minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0
    ? t("tasks.reminderCenter.hoursMinutesBefore", { hours: h, minutes: m })
    : t("tasks.reminderCenter.hoursBefore", { hours: h });
}

const SNOOZE_OPTIONS = [
  { key: "10min", compute: () => new Date(Date.now() + 10 * 60000).toISOString() },
  { key: "1hour", compute: () => new Date(Date.now() + 60 * 60000).toISOString() },
  { key: "tomorrow", compute: () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }},
];

export function ReminderCenter({ open, onClose, onSelectTask }: ReminderCenterProps) {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<ReminderOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [notifPermission, setNotifPermission] = useState<string>(() => {
    if (typeof window === "undefined") return "default";
    if ((window as any).nowenDesktop?.taskNotify || (window as any).nowenDesktop?.taskNotifyPermission) return "electron";
    return typeof Notification !== "undefined" ? Notification.permission : "default";
  });
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [snoozeMenuId, setSnoozeMenuId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getReminderOverview(7);
      setOverview(data);
    } catch {
      setError(t("tasks.reminderCenter.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) { load(); setActionMenuId(null); setSnoozeMenuId(null); }
  }, [open, load]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleEnableNotification = async () => {
    if (typeof Notification === "undefined") return;
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
    } catch { /* ignore */ }
  };

  const handleClickItem = (item: ReminderOverviewItem) => {
    onClose();
    onSelectTask(item.taskId);
  };

  const handleDisableReminder = async (item: ReminderOverviewItem) => {
    setActing(item.reminderId);
    try {
      await api.updateTaskReminder(item.reminderId, { enabled: false });
      await load();
    } catch { /* ignore */ }
    finally { setActing(null); setActionMenuId(null); }
  };

  const handleEnableReminder = async (item: ReminderOverviewItem) => {
    setActing(item.reminderId);
    try {
      await api.updateTaskReminder(item.reminderId, { enabled: true });
      await load();
    } catch { /* ignore */ }
    finally { setActing(null); setActionMenuId(null); }
  };

  const handleSnooze = async (item: ReminderOverviewItem, computeSnooze: () => string) => {
    setActing(item.reminderId);
    try {
      const snoozedUntil = computeSnooze();
      await api.updateTaskReminder(item.reminderId, { enabled: true, snoozedUntil });
      await load();
    } catch { /* ignore */ }
    finally { setActing(null); setSnoozeMenuId(null); setActionMenuId(null); }
  };

  if (!open) return null;

  const totalMissedToday = overview
    ? overview.missed.length + overview.today.length
    : 0;

  return (
    <motion.div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.97, opacity: 0, y: 10 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-md max-h-[80vh] bg-bg-primary rounded-xl shadow-2xl border border-app-border flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
          <div className="flex items-center gap-2">
            <Bell size={18} className="text-accent-primary" />
            <h2 className="text-sm font-semibold text-tx-primary">
              {t("tasks.reminderCenter.title")}
            </h2>
            {totalMissedToday > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 font-medium">
                {totalMissedToday}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={load}
              disabled={isLoading}
              className="p-1.5 rounded-md text-tx-tertiary hover:text-tx-secondary hover:bg-bg-hover transition-colors"
              title={t("tasks.reminderCenter.refresh")}
            >
              <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-tx-tertiary hover:text-tx-secondary hover:bg-bg-hover transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Notification permission */}
        <div className="px-4 py-2 border-b border-app-border text-xs">
          {notifPermission === "electron" && (
            <div className="flex items-center gap-1.5 text-tx-tertiary">
              <Monitor size={13} />
              {t("tasks.reminderCenter.desktopNotificationEnabled")}
            </div>
          )}
          {notifPermission === "granted" && (
            <div className="flex items-center gap-1.5 text-green-600">
              <Bell size={13} />
              {t("tasks.reminderCenter.permissionEnabled")}
            </div>
          )}
          {notifPermission === "denied" && (
            <div className="flex items-center gap-1.5 text-red-500">
              <BellOff size={13} />
              {t("tasks.reminderCenter.permissionDenied")}
            </div>
          )}
          {notifPermission === "default" && (
            <button
              type="button"
              onClick={handleEnableNotification}
              className="flex items-center gap-1.5 text-accent-primary hover:underline"
            >
              <Bell size={13} />
              {t("tasks.reminderCenter.enableNotification")}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && !overview && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin text-tx-tertiary" />
            </div>
          )}
          {error && (
            <div className="px-4 py-8 text-center">
              <div className="text-sm text-red-500 mb-3">{error}</div>
              <button type="button" onClick={load} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-app-elevated border border-app-border hover:bg-app-hover text-tx-secondary transition-colors">
                <RefreshCw size={12} />
                {t("tasks.reminderCenter.retry")}
              </button>
            </div>
          )}
          {!isLoading && !error && overview && (
            <div>
              {GROUP_ORDER.map(({ key, icon }) => {
                const items = overview[key];
                const isCollapsed = collapsed.has(key);
                return (
                  <div key={key}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(key)}
                      className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-tx-secondary hover:bg-bg-hover transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        {icon}
                        {t(`tasks.reminderCenter.${key}`)}
                      </span>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                        key === "missed" && items.length > 0
                          ? "bg-red-500/15 text-red-500"
                          : key === "today" && items.length > 0
                          ? "bg-amber-500/15 text-amber-500"
                          : "bg-bg-hover text-tx-tertiary"
                      )}>
                        {items.length}
                      </span>
                    </button>
                    {!isCollapsed && items.length > 0 && (
                      <div>
                        {items.map((item) => (
                          <div
                            key={item.reminderId}
                            className="relative border-b border-app-border/50"
                          >
                            <div className="flex items-stretch">
                              {/* Left: clickable task area */}
                              <button
                                type="button"
                                onClick={() => handleClickItem(item)}
                                className="flex-1 text-left px-4 py-2 hover:bg-bg-hover transition-colors"
                              >
                                <div className="text-sm text-tx-primary truncate">
                                  {item.taskTitle}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-tx-tertiary">
                                  {item.snoozedUntil ? (
                                    <span>
                                      {t("tasks.reminderCenter.snoozedUntil")}:{" "}
                                      {new Date(item.snoozedUntil).toLocaleString()}
                                    </span>
                                  ) : item.reminderAt ? (
                                    <span>
                                      {t("tasks.reminderCenter.reminderAt")}:{" "}
                                      {new Date(item.reminderAt).toLocaleString()}
                                    </span>
                                  ) : null}
                                  {(item.dueAt || item.dueDate) && (
                                    <span>
                                      {t("tasks.reminderCenter.dueAt")}:{" "}
                                      {item.dueAt
                                        ? new Date(item.dueAt).toLocaleString()
                                        : item.dueDate}
                                    </span>
                                  )}
                                  {!item.snoozedUntil && (
                                    <span>{formatOffset(item.offsetMinutes, t)}</span>
                                  )}
                                </div>
                              </button>

                              {/* Right: action button */}
                              <div className="flex items-center pr-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActionMenuId(actionMenuId === item.reminderId ? null : item.reminderId);
                                    setSnoozeMenuId(null);
                                  }}
                                  className="p-1 rounded text-tx-tertiary hover:text-tx-secondary hover:bg-bg-hover transition-colors"
                                  disabled={acting === item.reminderId}
                                >
                                  <MoreHorizontal size={14} />
                                </button>
                              </div>
                            </div>

                            {/* Action menu */}
                            <AnimatePresence>
                              {actionMenuId === item.reminderId && (
                                <motion.div
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  transition={{ duration: 0.12 }}
                                  className="absolute right-3 top-full z-10 bg-bg-primary border border-app-border rounded-lg shadow-lg py-1 min-w-[140px]"
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleClickItem(item); }}
                                    className="w-full text-left px-3 py-1.5 text-xs text-tx-secondary hover:bg-bg-hover flex items-center gap-2"
                                  >
                                    <ExternalLink size={12} />
                                    {t("tasks.reminderCenter.goToTask")}
                                  </button>

                                  {(key === "missed" || key === "today" || key === "upcoming") && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSnoozeMenuId(snoozeMenuId === item.reminderId ? null : item.reminderId);
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-xs text-tx-secondary hover:bg-bg-hover flex items-center gap-2"
                                    >
                                      <Clock size={12} />
                                      {t("tasks.reminderCenter.snooze")}
                                    </button>
                                  )}

                                  {(key === "missed" || key === "today" || key === "upcoming") && (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handleDisableReminder(item); }}
                                      disabled={acting === item.reminderId}
                                      className="w-full text-left px-3 py-1.5 text-xs text-tx-secondary hover:bg-bg-hover flex items-center gap-2"
                                    >
                                      <BellOff size={12} />
                                      {t("tasks.reminderCenter.disableReminder")}
                                    </button>
                                  )}

                                  {key === "disabled" && item.enabled !== 1 && (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handleEnableReminder(item); }}
                                      disabled={acting === item.reminderId}
                                      className="w-full text-left px-3 py-1.5 text-xs text-tx-secondary hover:bg-bg-hover flex items-center gap-2"
                                    >
                                      <Bell size={12} />
                                      {t("tasks.reminderCenter.enableReminder")}
                                    </button>
                                  )}
                                </motion.div>
                              )}
                            </AnimatePresence>

                            {/* Snooze submenu */}
                            <AnimatePresence>
                              {snoozeMenuId === item.reminderId && (
                                <motion.div
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  transition={{ duration: 0.12 }}
                                  className="absolute right-3 top-full mt-[60px] z-10 bg-bg-primary border border-app-border rounded-lg shadow-lg py-1 min-w-[120px]"
                                >
                                  {SNOOZE_OPTIONS.map((opt) => (
                                    <button
                                      key={opt.key}
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handleSnooze(item, opt.compute); }}
                                      disabled={acting === item.reminderId}
                                      className="w-full text-left px-3 py-1.5 text-xs text-tx-secondary hover:bg-bg-hover"
                                    >
                                      {t(`tasks.reminderCenter.snooze${opt.key}`)}
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        ))}
                      </div>
                    )}
                    {!isCollapsed && items.length === 0 && (
                      <div className="px-4 py-2 text-xs text-tx-tertiary">
                        {t("tasks.reminderCenter.empty")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
