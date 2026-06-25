import React, { useState, useEffect, useCallback } from "react";
import { FolderSync, FolderOpen, Plus, Trash2, Loader2, RefreshCw, ChevronDown, ChevronUp, Save, Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { api } from "@/lib/api";
import type { FolderSyncConfig } from "@/lib/desktopBridge";
import type { Notebook } from "@/types";
import { confirm } from "@/components/ui/confirm";

const DEFAULT_FILE_TYPES = [".md", ".txt", ".html", ".pdf", ".docx"];

function isDesktop(): boolean {
  return !!(window as any).nowenDesktop?.isDesktop;
}

function getFolderSync() {
  return (window as any).nowenDesktop?.folderSync as import("@/lib/desktopBridge").FolderSyncAPI | undefined;
}

/** 单个配置卡片（含展开/编辑） */
function ConfigCard({
  config,
  notebooks,
  saving,
  onRunNow,
  onRemove,
  onUpdate,
  runLoading,
}: {
  config: FolderSyncConfig;
  notebooks: Notebook[];
  saving: boolean;
  onRunNow: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<FolderSyncConfig>) => void;
  runLoading: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editNotebook, setEditNotebook] = useState(config.targetNotebookId || "");
  const [editSubfolders, setEditSubfolders] = useState(config.includeSubfolders);
  const [editFileTypes, setEditFileTypes] = useState<string[]>(config.fileTypes);
  const [editEnabled, setEditEnabled] = useState(config.enabled);

  const nbName = notebooks.find((n) => n.id === config.targetNotebookId)?.name || "—";
  const canEnable = !!config.targetNotebookId;

  const handleSave = () => {
    onUpdate({
      targetNotebookId: editNotebook || null,
      includeSubfolders: editSubfolders,
      fileTypes: editFileTypes,
      enabled: editNotebook ? editEnabled : false,
    });
  };

  const toggleFileType = (ext: string) => {
    setEditFileTypes((prev) =>
      prev.includes(ext) ? prev.filter((e) => e !== ext) : [...prev, ext]
    );
  };

  return (
    <div className="rounded-xl border border-app-border bg-app-surface overflow-hidden">
      {/* 头部摘要 */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-tx-primary truncate" title={config.folderPath}>
              {config.folderPath}
            </p>
            <p className="text-xs text-tx-tertiary mt-1">
              {t("folderSync.targetNotebook")}: {nbName}
            </p>
            <p className="text-xs text-tx-tertiary">
              {t("folderSync.lastSynced")}: {config.lastSyncedAt
                ? new Date(config.lastSyncedAt).toLocaleString()
                : t("folderSync.never")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full",
              config.enabled
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-zinc-500/10 text-zinc-500"
            )}>
              {config.enabled ? t("folderSync.enabled") : t("folderSync.disabled")}
            </span>
          </div>
        </div>

        {/* 操作按钮行 */}
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={onRunNow}
            disabled={runLoading}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md text-tx-secondary hover:text-accent-primary hover:bg-accent-primary/5 transition-colors disabled:opacity-50"
          >
            {runLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {t("folderSync.runNow")}
          </button>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? t("common.cancel") : t("folderSync.editConfig")}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md text-tx-tertiary hover:text-red-500 hover:bg-red-500/5 transition-colors ml-auto"
          >
            <Trash2 size={12} />
            {t("folderSync.removeConfig")}
          </button>
        </div>
      </div>

      {/* 展开编辑区 */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-app-border/50 pt-3">
          {/* 目标笔记本 */}
          <div>
            <label className="block text-xs text-tx-tertiary mb-1">{t("folderSync.targetNotebook")}</label>
            <select
              value={editNotebook}
              onChange={(e) => setEditNotebook(e.target.value)}
              className="w-full text-sm rounded-lg border border-app-border bg-app-bg text-tx-primary px-3 py-1.5 outline-none focus:ring-2 focus:ring-accent-primary/30"
            >
              <option value="">{t("folderSync.selectNotebook")}</option>
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>{nb.name}</option>
              ))}
            </select>
          </div>

          {/* 包含子文件夹 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editSubfolders}
              onChange={(e) => setEditSubfolders(e.target.checked)}
              className="rounded border-app-border text-accent-primary focus:ring-accent-primary/30"
            />
            <span className="text-xs text-tx-secondary">{t("folderSync.includeSubfolders")}</span>
          </label>

          {/* 文件类型 */}
          <div>
            <label className="block text-xs text-tx-tertiary mb-1.5">{t("folderSync.fileTypes")}</label>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_FILE_TYPES.map((ext) => (
                <button
                  key={ext}
                  type="button"
                  onClick={() => toggleFileType(ext)}
                  className={cn(
                    "px-2 py-0.5 text-[11px] rounded-md border transition-colors",
                    editFileTypes.includes(ext)
                      ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary"
                      : "border-app-border text-tx-tertiary hover:text-tx-secondary"
                  )}
                >
                  {ext}
                </button>
              ))}
            </div>
          </div>

          {/* 启用开关 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editEnabled}
              onChange={(e) => setEditEnabled(e.target.checked)}
              disabled={!editNotebook}
              className="rounded border-app-border text-accent-primary focus:ring-accent-primary/30 disabled:opacity-40"
            />
            <span className={cn("text-xs", editNotebook ? "text-tx-secondary" : "text-tx-tertiary")}>
              {t("folderSync.enableSync")}
              {!editNotebook && ` (${t("folderSync.selectNotebookFirst")})`}
            </span>
          </label>

          {/* 保存 */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-accent-primary text-white hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {t("folderSync.saveConfig")}
          </button>
        </div>
      )}
    </div>
  );
}

export default function FolderSyncSettings() {
  const { t } = useTranslation();
  const [configs, setConfigs] = useState<FolderSyncConfig[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    const fs = getFolderSync();
    if (!fs) return;
    try {
      setLoading(true);
      const data = await fs.getConfigs();
      setConfigs(data);
    } catch (e) {
      console.warn("[FolderSyncSettings] load failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNotebooks = useCallback(async () => {
    try {
      const data = await api.getNotebooks();
      setNotebooks(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadConfigs(); loadNotebooks(); }, [loadConfigs, loadNotebooks]);

  const handleSelectFolder = useCallback(async () => {
    const fs = getFolderSync();
    if (!fs) return;
    if (notebooks.length === 0) {
      toast.error(t("folderSync.noNotebooks"));
      return;
    }
    try {
      const result = await fs.selectFolder();
      if (result.cancelled || !result.path) return;
      // 检查是否已存在
      if (configs.some((c) => c.folderPath === result.path)) {
        toast.error(t("folderSync.duplicatePath"));
        return;
      }
      setActionLoading("save");
      const res = await fs.saveConfig({
        folderPath: result.path,
        targetNotebookId: notebooks[0]?.id || null,
        includeSubfolders: true,
        fileTypes: DEFAULT_FILE_TYPES,
        enabled: false, // 需要用户确认笔记本后再启用
      });
      if (res.ok) {
        toast.success(t("folderSync.configCreated"));
        await loadConfigs();
      }
    } catch (e: any) {
      toast.error(e?.message || "Failed to save config");
    } finally {
      setActionLoading(null);
    }
  }, [notebooks, configs, loadConfigs, t]);

  const handleRemove = useCallback(async (folderId: string) => {
    const ok = await confirm({ title: t("folderSync.removeConfirm"), danger: true });
    if (!ok) return;
    const fs = getFolderSync();
    if (!fs) return;
    try {
      setActionLoading(folderId);
      await fs.removeConfig(folderId);
      await loadConfigs();
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove");
    } finally {
      setActionLoading(null);
    }
  }, [loadConfigs, t]);

  const handleUpdate = useCallback(async (folderId: string, patch: Partial<FolderSyncConfig>) => {
    const fs = getFolderSync();
    if (!fs) return;
    try {
      setActionLoading(`update-${folderId}`);
      await fs.saveConfig({ folderId, ...patch });
      await loadConfigs();
      toast.success(t("folderSync.configUpdated"));
    } catch (e: any) {
      toast.error(e?.message || "Failed to update");
    } finally {
      setActionLoading(null);
    }
  }, [loadConfigs, t]);

  const handleRunNow = useCallback(async (folderId: string) => {
    const fs = getFolderSync();
    if (!fs) return;
    try {
      setActionLoading(`run-${folderId}`);
      const result = await fs.runNow(folderId);
      if (!result.ok && result.code === "NOT_IMPLEMENTED") {
        toast.info(t("folderSync.notImplemented"));
      }
    } catch (e: any) {
      toast.error(e?.message || "Sync failed");
    } finally {
      setActionLoading(null);
    }
  }, [t]);

  // Web 端不显示
  if (!isDesktop()) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-tx-tertiary">
        <FolderSync size={32} className="mb-3 opacity-40" />
        <p className="text-sm">{t("folderSync.noDesktop")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FolderSync className="w-4 h-4 text-accent-primary" />
          <h3 className="text-lg font-bold text-tx-primary">{t("folderSync.title")}</h3>
        </div>
        <p className="text-sm text-tx-tertiary mb-4">{t("folderSync.description")}</p>
      </div>

      {/* 添加按钮 */}
      <button
        type="button"
        onClick={handleSelectFolder}
        disabled={actionLoading === "save"}
        className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-accent-primary text-white hover:opacity-90 disabled:opacity-50 transition-colors"
      >
        {actionLoading === "save" ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Plus size={14} />
        )}
        {t("folderSync.selectFolder")}
      </button>

      {/* 配置列表 */}
      {loading ? (
        <div className="flex items-center gap-2 text-tx-tertiary text-sm">
          <Loader2 size={14} className="animate-spin" />
          Loading...
        </div>
      ) : configs.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-tx-tertiary">
          <FolderOpen size={24} className="mb-2 opacity-40" />
          <p className="text-sm">{t("folderSync.noConfigs")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {configs.map((config) => (
            <ConfigCard
              key={config.folderId}
              config={config}
              notebooks={notebooks}
              saving={actionLoading === `update-${config.folderId}`}
              runLoading={actionLoading === `run-${config.folderId}`}
              onRunNow={() => handleRunNow(config.folderId)}
              onRemove={() => handleRemove(config.folderId)}
              onUpdate={(patch) => handleUpdate(config.folderId, patch)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
