import React, { useCallback } from "react";
import { FileCode, FileText, Lock, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions, type OpenNoteTab } from "@/store/AppContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";

function getNextTabAfterClose(tabs: OpenNoteTab[], closingId: string): OpenNoteTab | null {
  const index = tabs.findIndex((tab) => tab.id === closingId);
  if (index === -1) return null;
  return tabs[index + 1] || tabs[index - 1] || null;
}

export default function NoteTabsBar() {
  const { state } = useApp();
  const actions = useAppActions();
  const { t } = useTranslation();
  const { openNoteTabs, activeNote, noteLoading } = state;

  const openNote = useCallback(async (noteId: string) => {
    if (activeNote?.id === noteId) return;
    try { window.dispatchEvent(new CustomEvent("nowen:before-note-switch")); } catch { /* ignore */ }
    actions.setNoteLoading(true);
    try {
      const note = await api.getNote(noteId);
      actions.setActiveNote(note);
      actions.setMobileView("editor");
      actions.openNoteTab({
        id: note.id,
        title: note.title,
        notebookId: note.notebookId,
        workspaceId: note.workspaceId,
        contentFormat: note.contentFormat,
        isLocked: note.isLocked,
        isTrashed: note.isTrashed,
        updatedAt: note.updatedAt,
      });
    } catch (err: any) {
      toast.error(err?.message || t("noteList.createFailed"));
    } finally {
      actions.setNoteLoading(false);
    }
  }, [actions, activeNote?.id, t]);

  const closeTab = useCallback((noteId: string) => {
    const closingActive = activeNote?.id === noteId;
    const nextTab = closingActive ? getNextTabAfterClose(openNoteTabs, noteId) : null;
    actions.closeNoteTab(noteId);
    if (!closingActive) return;
    if (nextTab) {
      void openNote(nextTab.id);
    } else {
      actions.setActiveNote(null);
    }
  }, [actions, activeNote?.id, openNote, openNoteTabs]);

  if (openNoteTabs.length === 0) return null;

  return (
    <div
      className="hidden md:flex h-9 shrink-0 items-stretch border-b border-app-border bg-app-surface/60 overflow-hidden"
      aria-label={t("editorTabs.openedTabs")}
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden px-2">
        {openNoteTabs.map((tab) => {
          const active = activeNote?.id === tab.id;
          const title = tab.title || t("editorTabs.noTitle");
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => void openNote(tab.id)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.id);
                }
              }}
              className={cn(
                "group relative my-1 mr-1 flex max-w-[180px] min-w-[108px] items-center gap-1.5 rounded-t-md px-2.5 text-xs transition-colors",
                active
                  ? "bg-app-bg text-tx-primary shadow-sm"
                  : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
              )}
              title={title}
            >
              {tab.isLocked ? (
                <Lock size={12} className="shrink-0 text-orange-500" />
              ) : tab.contentFormat === "markdown" ? (
                <FileCode size={12} className="shrink-0 text-emerald-500" />
              ) : (
                <FileText size={12} className="shrink-0 text-tx-tertiary" />
              )}
              <span className="min-w-0 flex-1 truncate text-left">{title}</span>
              {active && noteLoading ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary animate-pulse" />
              ) : tab.contentFormat === "markdown" ? (
                <span className="shrink-0 rounded border border-emerald-500/30 px-1 text-[9px] font-mono text-emerald-500">
                  MD
                </span>
              ) : null}
              <span
                role="button"
                tabIndex={-1}
                aria-label={t("editorTabs.close")}
                title={t("editorTabs.close")}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-tx-tertiary opacity-60 hover:bg-app-active hover:text-tx-primary group-hover:opacity-100"
              >
                <X size={11} />
              </span>
              {active && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent-primary" />}
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none w-8 bg-gradient-to-r from-transparent to-app-surface/80" />
    </div>
  );
}
