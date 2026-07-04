import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileCode, FileText, Lock, Pin, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions, type OpenNoteTab } from "@/store/AppContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";

type TabContextMenuState = {
  tabId: string;
  x: number;
  y: number;
} | null;

function getNextTabAfterClose(tabs: OpenNoteTab[], closingId: string): OpenNoteTab | null {
  const index = tabs.findIndex((tab) => tab.id === closingId);
  if (index === -1) return null;
  return tabs[index + 1] || tabs[index - 1] || null;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy copy.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}

export default function NoteTabsBar() {
  const { state } = useApp();
  const actions = useAppActions();
  const { t } = useTranslation();
  const { openNoteTabs, activeNote, noteLoading } = state;
  const [contextMenu, setContextMenu] = useState<TabContextMenuState>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const targetTab = useMemo(() => {
    if (!contextMenu) return null;
    return openNoteTabs.find((tab) => tab.id === contextMenu.tabId) || null;
  }, [contextMenu, openNoteTabs]);

  const openNote = useCallback(async (noteId: string) => {
    if (activeNote?.id === noteId) return;
    try { window.dispatchEvent(new CustomEvent("nowen:before-note-switch")); } catch { /* ignore */ }
    actions.setNoteLoading(true);
    try {
      const note = await api.getNote(noteId);
      const existingTab = openNoteTabs.find((tab) => tab.id === note.id);
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
        pinned: existingTab?.pinned,
      });
    } catch (err: any) {
      toast.error(err?.message || t("noteList.createFailed"));
    } finally {
      actions.setNoteLoading(false);
    }
  }, [actions, activeNote?.id, openNoteTabs, t]);

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

  const ensureTargetActive = useCallback((tab: OpenNoteTab) => {
    if (activeNote?.id !== tab.id) {
      void openNote(tab.id);
    }
  }, [activeNote?.id, openNote]);

  const closeOtherTabs = useCallback((tab: OpenNoteTab) => {
    actions.setNoteTabs([tab]);
    ensureTargetActive(tab);
  }, [actions, ensureTargetActive]);

  const closeTabsToSide = useCallback((tab: OpenNoteTab, side: "left" | "right") => {
    const targetIndex = openNoteTabs.findIndex((item) => item.id === tab.id);
    if (targetIndex === -1) return;
    const nextTabs = side === "left"
      ? openNoteTabs.slice(targetIndex)
      : openNoteTabs.slice(0, targetIndex + 1);
    const activeKept = !!activeNote && nextTabs.some((item) => item.id === activeNote.id);
    actions.setNoteTabs(nextTabs);
    if (!activeKept) ensureTargetActive(tab);
  }, [actions, activeNote, ensureTargetActive, openNoteTabs]);

  const closeAllTabs = useCallback(() => {
    actions.clearNoteTabs();
    actions.setActiveNote(null);
  }, [actions]);

  const copyTabTitle = useCallback(async (tab: OpenNoteTab) => {
    const title = tab.title || t("editorTabs.noTitle");
    const ok = await copyText(title);
    ok ? toast.success(t("editorTabs.copySuccess")) : toast.error(t("editorTabs.copyFailed"));
  }, [t]);

  const togglePinned = useCallback((tab: OpenNoteTab) => {
    actions.updateNoteTab({ id: tab.id, pinned: !tab.pinned });
  }, [actions]);

  const runMenuAction = useCallback((action: () => void) => {
    action();
    setContextMenu(null);
  }, []);

  const runCopyAction = useCallback((action: () => Promise<void>) => {
    void action();
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (contextMenu && !targetTab) setContextMenu(null);
  }, [contextMenu, targetTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "w") return;
      if (isEditableTarget(event.target)) return;
      if (!activeNote || openNoteTabs.length === 0) return;
      event.preventDefault();
      closeTab(activeNote.id);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeNote, closeTab, openNoteTabs.length]);

  if (openNoteTabs.length === 0) return null;

  const menuX = contextMenu ? Math.min(contextMenu.x, window.innerWidth - 236) : 0;
  const menuY = contextMenu ? Math.min(contextMenu.y, window.innerHeight - 360) : 0;

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
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
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
              {tab.pinned && <Pin size={11} className="shrink-0 text-accent-primary fill-accent-primary/20" />}
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

      {contextMenu && targetTab && createPortal(
            <div
              ref={menuRef}
              className="fixed z-[80] w-56 rounded-xl border border-app-border bg-white py-1 shadow-xl dark:bg-zinc-950"
              style={{ left: menuX, top: menuY }}
              role="menu"
            >
          <TabMenuItem label={t("editorTabs.close")} shortcut="Ctrl+W" onClick={() => runMenuAction(() => closeTab(targetTab.id))} />
          <TabMenuItem label={t("editorTabs.closeOtherTabs")} onClick={() => runMenuAction(() => closeOtherTabs(targetTab))} />
          <TabMenuItem label={t("editorTabs.closeTabsToRight")} onClick={() => runMenuAction(() => closeTabsToSide(targetTab, "right"))} />
          <TabMenuItem label={t("editorTabs.closeTabsToLeft")} onClick={() => runMenuAction(() => closeTabsToSide(targetTab, "left"))} />
          <TabMenuItem label={t("editorTabs.closeAllTabs")} onClick={() => runMenuAction(closeAllTabs)} />
          <MenuSeparator />
          <TabMenuItem label={t("editorTabs.copyTitle")} onClick={() => runCopyAction(() => copyTabTitle(targetTab))} />
          <MenuSeparator />
          <TabMenuItem
            label={targetTab.pinned ? t("editorTabs.unpinTab") : t("editorTabs.pinTab")}
            onClick={() => runMenuAction(() => togglePinned(targetTab))}
          />
        </div>,
        document.body
      )}
    </div>
  );
}

function MenuSeparator() {
  return <div className="mx-2 my-1 h-px bg-app-border" />;
}

function TabMenuItem({
  label,
  shortcut,
  onClick,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex h-8 w-full items-center justify-between gap-3 px-3 text-left text-sm text-tx-secondary transition-colors hover:bg-app-hover hover:text-tx-primary"
      onClick={onClick}
      role="menuitem"
    >
      <span className="truncate">{label}</span>
      {shortcut && <span className="shrink-0 text-xs text-tx-tertiary">{shortcut}</span>}
    </button>
  );
}
