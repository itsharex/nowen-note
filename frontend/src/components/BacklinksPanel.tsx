import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Link2, Loader2, FileText, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useApp, useAppActions } from "@/store/AppContext";

interface BacklinksPanelProps {
  noteId: string;
  noteTitle: string;
  onClose: () => void;
}

interface BacklinkItem {
  sourceNoteId: string;
  title: string;
  updatedAt: string;
  linkText: string | null;
}

export default function BacklinksPanel({ noteId, noteTitle, onClose }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const actions = useAppActions();

  const loadBacklinks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getBacklinks(noteId);
      setBacklinks(data.backlinks);
    } catch (e) {
      console.error("加载反向链接失败:", e);
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    loadBacklinks();
  }, [loadBacklinks]);

  // 点击来源笔记，打开对应笔记
  const handleOpenNote = async (sourceNoteId: string) => {
    try {
      const note = await api.getNote(sourceNoteId);
      if (note) {
        actions.setActiveNote(note);
      }
    } catch (e) {
      console.error("打开笔记失败:", e);
    }
  };

  // 格式化时间
  const formatTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr.replace(" ", "T") + (dateStr.includes("Z") ? "" : "Z"));
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return "刚刚";
      if (diffMins < 60) return `${diffMins}分钟前`;
      if (diffHours < 24) return `${diffHours}小时前`;
      if (diffDays < 7) return `${diffDays}天前`;

      return date.toLocaleDateString("zh-CN", {
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed right-0 top-0 bottom-0 w-80 bg-app-surface border-l border-app-border shadow-xl z-40 flex flex-col"
    >
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
        <div className="flex items-center gap-2">
          <Link2 size={16} className="text-accent-primary" />
          <h3 className="text-sm font-medium text-tx-primary">
            反向链接
            {!loading && backlinks.length > 0 && (
              <span className="ml-1.5 text-xs text-tx-tertiary">
                {backlinks.length}
              </span>
            )}
          </h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
        >
          <X size={14} />
        </Button>
      </div>

      {/* 内容区域 */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="animate-spin text-tx-tertiary" />
            </div>
          ) : backlinks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Link2 size={32} className="text-tx-tertiary mb-2 opacity-50" />
              <p className="text-sm text-tx-tertiary">暂无反向链接</p>
              <p className="text-xs text-tx-tertiary mt-1">
                其他笔记引用此笔记时会在这里显示
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {backlinks.map((item) => (
                <motion.button
                  key={item.sourceNoteId}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full text-left p-2.5 rounded-lg hover:bg-app-hover transition-colors group"
                  onClick={() => handleOpenNote(item.sourceNoteId)}
                >
                  <div className="flex items-start gap-2">
                    <FileText
                      size={14}
                      className="text-tx-tertiary mt-0.5 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-tx-primary truncate">
                          {item.title || "无标题笔记"}
                        </span>
                        <ExternalLink
                          size={10}
                          className="text-tx-tertiary opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        />
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-tx-tertiary">
                          {formatTime(item.updatedAt)}
                        </span>
                        {item.linkText && item.linkText !== item.title && (
                          <span className="text-xs text-tx-tertiary truncate">
                            引用: {item.linkText}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </motion.div>
  );
}
