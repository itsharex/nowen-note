import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, Copy, ExternalLink, Eye, EyeOff, Link2, Loader2, Pencil, RefreshCw,
  RotateCcw, Settings2, Shield, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirm } from "@/components/ui/confirm";
import { api } from "@/lib/api";
import { buildPublicWebUrl } from "@/lib/publicWebOrigin";
import { toast } from "@/lib/toast";
import type { Share, SharePermission } from "@/types";
import { cn } from "@/lib/utils";

interface ShareModalProps {
  noteId: string;
  noteTitle: string;
  onClose: () => void;
}

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function permissionLabel(value: string): string {
  return value === "comment" ? "可评论" : value === "edit" ? "访客可编辑" : value === "edit_auth" ? "登录后可编辑" : "仅查看";
}

export default function ShareModal({ noteId, noteTitle, onClose }: ShareModalProps) {
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [permission, setPermission] = useState<SharePermission>("view");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [maxViews, setMaxViews] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

  const loadShares = useCallback(async () => {
    setLoading(true);
    try {
      setShares(await api.getSharesByNote(noteId));
    } catch (error: any) {
      toast.error(error?.message || "加载分享列表失败");
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => { void loadShares(); }, [loadShares]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const resetForm = () => {
    setEditingId(null);
    setPermission("view");
    setPassword("");
    setExpiresAt("");
    setMaxViews("");
    setShowPassword(false);
  };

  const editShare = (share: Share) => {
    setEditingId(share.id);
    setPermission(share.permission);
    setPassword("");
    setExpiresAt(toLocalDateTime(share.expiresAt));
    setMaxViews(share.maxViews ? String(share.maxViews) : "");
  };

  const submit = async () => {
    if (saving) return;
    const parsedMax = maxViews.trim() ? Number(maxViews) : null;
    if (parsedMax !== null && (!Number.isInteger(parsedMax) || parsedMax < 1)) {
      toast.error("最大访问会话数必须是正整数");
      return;
    }
    setSaving(true);
    try {
      const common = {
        permission,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        maxViews: parsedMax,
      };
      if (editingId) {
        await api.updateShare(editingId, {
          ...common,
          ...(password.trim() ? { password: password.trim() } : {}),
        });
        toast.success("分享设置已更新");
      } else {
        await api.createShare({
          noteId,
          permission,
          password: password.trim() || undefined,
          expiresAt: common.expiresAt || undefined,
          maxViews: parsedMax || undefined,
        });
        toast.success("分享链接已创建");
      }
      resetForm();
      await loadShares();
    } catch (error: any) {
      toast.error(error?.message || "保存分享失败");
    } finally {
      setSaving(false);
    }
  };

  const shareUrl = (token: string) => buildPublicWebUrl(`/share/${token}`);
  const copy = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1600);
      toast.success("分享链接已复制");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const mutate = async (action: () => Promise<unknown>, success: string) => {
    try { await action(); toast.success(success); await loadShares(); }
    catch (error: any) { toast.error(error?.message || "操作失败"); }
  };

  const rotate = async (share: Share) => {
    if (!await confirm({ title: "轮换分享链接？", description: "旧链接和旧密码访问令牌会立即失效，访问会话数会重置。" })) return;
    await mutate(() => api.updateShare(share.id, { rotateToken: true }), "已生成新链接");
  };
  const resetViews = async (share: Share) => {
    if (!await confirm({ title: "重置访问会话数？", description: "已记录的访问会话将清零，访客可重新占用名额。" })) return;
    await mutate(() => api.updateShare(share.id, { resetViews: true }), "访问会话数已重置");
  };
  const remove = async (share: Share) => {
    if (!await confirm({ title: "删除分享？", description: "链接、评论访问和附件签名将立即失效。", danger: true })) return;
    await mutate(() => api.deleteShare(share.id), "分享已删除");
  };

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-3 py-5 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <motion.div ref={modalRef} className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-2xl" initial={{ y: 18, scale: .98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 18, scale: .98 }}>
          <header className="flex items-center justify-between border-b border-app-border px-5 py-4">
            <div><h2 className="font-semibold">分享笔记</h2><p className="mt-0.5 max-w-xl truncate text-xs text-tx-tertiary">{noteTitle}</p></div>
            <button onClick={onClose} className="rounded-lg p-2 hover:bg-app-hover" aria-label="关闭"><X size={17} /></button>
          </header>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_1fr]">
            <section className="border-b border-app-border p-5 lg:border-b-0 lg:border-r">
              <div className="mb-4 flex items-center gap-2"><Settings2 size={16} className="text-accent-primary" /><h3 className="text-sm font-semibold">{editingId ? "编辑分享设置" : "创建新分享"}</h3></div>
              <div className="space-y-3">
                <label className="block space-y-1"><span className="text-xs text-tx-secondary">权限</span><select className="h-10 w-full rounded-lg border border-app-border bg-app-bg px-3 text-sm" value={permission} onChange={(event) => setPermission(event.target.value as SharePermission)}><option value="view">仅查看</option><option value="comment">查看 + 评论</option><option value="edit">访客可编辑</option><option value="edit_auth">登录后可编辑</option></select></label>
                <label className="block space-y-1"><span className="text-xs text-tx-secondary">访问密码（可选）</span><div className="relative"><Input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={editingId ? "留空保持原密码" : "至少 4 个字符"} className="pr-10" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-2.5 text-tx-tertiary">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
                <label className="block space-y-1"><span className="text-xs text-tx-secondary">有效期（可选）</span><Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
                <label className="block space-y-1"><span className="text-xs text-tx-secondary">最大访问会话数（可选）</span><Input type="number" min={1} value={maxViews} onChange={(event) => setMaxViews(event.target.value)} placeholder="同一浏览器标签页刷新不重复计数" /></label>
                <div className="flex gap-2 pt-1"><Button onClick={submit} disabled={saving} className="flex-1">{saving ? <Loader2 size={15} className="mr-1 animate-spin" /> : <Link2 size={15} className="mr-1" />}{editingId ? "保存设置" : "创建链接"}</Button>{editingId && <Button variant="outline" onClick={resetForm}>取消</Button>}</div>
              </div>
            </section>

            <section className="min-h-0 overflow-y-auto p-5">
              <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">已创建的分享</h3><Button variant="ghost" size="sm" onClick={loadShares}><RefreshCw size={14} /></Button></div>
              {loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin text-tx-tertiary" /></div> : shares.length === 0 ? (
                <div className="rounded-xl border border-dashed border-app-border py-14 text-center text-sm text-tx-tertiary">暂时没有分享链接</div>
              ) : <div className="space-y-3">{shares.map((share) => {
                const active = Boolean(share.isActive);
                const url = shareUrl(share.shareToken);
                return <article key={share.id} className={cn("rounded-xl border border-app-border p-3", !active && "opacity-60")}>
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{permissionLabel(share.permission)}</span><span className={cn("rounded-full px-2 py-0.5 text-[10px]", active ? "bg-emerald-500/10 text-emerald-600" : "bg-app-hover text-tx-tertiary")}>{active ? "有效" : "已停用"}</span>{share.hasPassword && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-600">密码</span>}</div><p className="mt-1 truncate text-xs text-tx-tertiary">{url}</p><p className="mt-1 text-[11px] text-tx-tertiary">访问会话 {share.viewCount || 0}{share.maxViews ? ` / ${share.maxViews}` : ""}{share.expiresAt ? ` · 到期 ${new Date(share.expiresAt).toLocaleString()}` : ""}</p></div><Shield size={16} className="shrink-0 text-tx-tertiary" /></div>
                  <div className="mt-3 flex flex-wrap gap-1.5"><Button size="sm" variant="outline" onClick={() => copy(url, share.id)}>{copied === share.id ? <Check size={13} /> : <Copy size={13} />}<span className="ml-1">复制</span></Button><Button size="sm" variant="outline" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}><ExternalLink size={13} /></Button><Button size="sm" variant="outline" onClick={() => editShare(share)}><Pencil size={13} className="mr-1" />编辑</Button><Button size="sm" variant="outline" onClick={() => resetViews(share)}><RotateCcw size={13} className="mr-1" />清零</Button><Button size="sm" variant="outline" onClick={() => rotate(share)}><RefreshCw size={13} className="mr-1" />换链接</Button><Button size="sm" variant="outline" onClick={() => mutate(() => api.updateShare(share.id, { isActive: active ? 0 : 1 }), active ? "分享已停用" : "分享已启用")}>{active ? "停用" : "启用"}</Button><Button size="sm" variant="outline" className="text-red-500" onClick={() => remove(share)}><Trash2 size={13} /></Button></div>
                </article>;
              })}</div>}
            </section>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
