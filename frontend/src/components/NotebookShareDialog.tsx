import { useEffect, useMemo, useState } from "react";
import { X, Link2, Trash2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { confirm } from "@/components/ui/confirm";
import type { Notebook, NotebookMember, NotebookShareLink, UserPublicInfo } from "@/types";

interface NotebookShareDialogProps {
  notebook: Notebook;
  onClose: () => void;
}

export default function NotebookShareDialog({ notebook, onClose }: NotebookShareDialogProps) {
  const [members, setMembers] = useState<NotebookMember[]>([]);
  const [link, setLink] = useState<NotebookShareLink | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<UserPublicInfo[]>([]);
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [loading, setLoading] = useState(true);

  const shareUrl = useMemo(() => {
    if (!link?.token) return "";
    return `${window.location.origin}/notebook-share/${link.token}`;
  }, [link?.token]);

  const reload = async () => {
    const [nextMembers, nextLink] = await Promise.all([
      api.getNotebookMembers(notebook.id),
      api.getNotebookShareLink(notebook.id),
    ]);
    setMembers(nextMembers);
    setLink(nextLink);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload()
      .catch((err) => {
        if (!cancelled) toast.error(err?.message || "加载分享设置失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [notebook.id]);

  const search = async () => {
    const rows = await api.searchUsers(query.trim());
    setCandidates(rows.filter((u) => !members.some((m) => m.userId === u.id)));
  };

  const addMember = async (userId: string) => {
    await api.addNotebookMember(notebook.id, { userId, role });
    toast.success("已添加成员");
    setQuery("");
    setCandidates([]);
    await reload();
  };

  const removeMember = async (userId: string) => {
    await api.removeNotebookMember(notebook.id, userId);
    toast.success("已移除成员");
    await reload();
  };

  const createLink = async () => {
    const next = await api.createNotebookShareLink(notebook.id, { role });
    setLink(next);
    toast.success("分享链接已生成");
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    toast.success("链接已复制");
  };

  const revokeLink = async () => {
    const ok = await confirm({
      title: "撤销分享链接？",
      description: "撤销后，旧链接将立即失效，已加入的成员不受影响。",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteNotebookShareLink(notebook.id);
      setLink(null);
      toast.success("分享链接已撤销");
    } catch (err: any) {
      toast.error(err?.message || "撤销失败");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-lg rounded-lg border border-app-border bg-app-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">分享笔记本</div>
            <div className="text-xs text-tx-tertiary truncate">{notebook.icon} {notebook.name}</div>
          </div>
          <button className="p-1 rounded hover:bg-app-hover" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border border-app-border bg-app-bg px-2 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
            >
              <option value="viewer">只读</option>
              <option value="editor">可编辑</option>
            </select>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索用户名或邮箱"
              className="h-9"
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
              }}
            />
            <Button variant="outline" onClick={search}>搜索</Button>
          </div>

          {candidates.length > 0 && (
            <div className="rounded-md border border-app-border overflow-hidden">
              {candidates.map((u) => (
                <button
                  key={u.id}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-app-hover"
                  onClick={() => addMember(u.id)}
                >
                  <span>{u.displayName || u.username}</span>
                  <span className="text-xs text-tx-tertiary">添加</span>
                </button>
              ))}
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-tx-tertiary mb-2">成员</div>
            <div className="rounded-md border border-app-border divide-y divide-app-border">
              {loading ? (
                <div className="px-3 py-2 text-sm text-tx-tertiary">正在加载...</div>
              ) : members.length === 0 ? (
                <div className="px-3 py-2 text-sm text-tx-tertiary">暂无成员</div>
              ) : (
                members.map((m) => (
                  <div key={m.userId} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{m.displayName || m.username || m.userId}</div>
                      <div className="text-xs text-tx-tertiary">{m.role === "owner" ? "拥有者" : m.role === "editor" ? "可编辑" : "只读"}</div>
                    </div>
                    {m.role !== "owner" && (
                      <button
                        className="p-1 rounded hover:bg-app-hover text-tx-tertiary hover:text-red-500"
                        onClick={() => removeMember(m.userId)}
                        aria-label="移除成员"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-md border border-app-border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">邀请链接</div>
                <div className="text-xs text-tx-tertiary truncate">
                  {shareUrl || "生成链接后，别人登录即可加入这个笔记本"}
                </div>
              </div>
              {shareUrl ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button variant="outline" onClick={copyLink}>复制</Button>
                  <Button
                    variant="outline"
                    onClick={revokeLink}
                    className="text-red-500 hover:text-red-600 hover:border-red-300"
                    aria-label="撤销分享链接"
                  >
                    <Unlink size={14} />
                  </Button>
                </div>
              ) : (
                <Button variant="outline" onClick={createLink}>
                  <Link2 size={14} className="mr-1" />
                  生成
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
