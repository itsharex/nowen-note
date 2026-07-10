import React, { useEffect, useMemo, useRef, useState } from "react";
import { SmilePlus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { getCachedNoteIcon, refreshNoteIcons, setNoteIcon } from "@/lib/noteIcons";

const PRESET_ICONS = [
  "📝", "📌", "📚", "💡", "✅", "⭐", "🔥", "🎯",
  "🚀", "💻", "🧠", "📅", "💼", "🏠", "❤️", "🔖",
  "📖", "✍️", "🗂️", "🔒", "🌱", "🎨", "📊", "🧩",
  "🔬", "🛠️", "🎵", "🌍", "💬", "📎", "🧪", "☕",
] as const;
const MAX_ICON_CODE_POINTS = 32;

interface NoteIconPickerModalProps {
  noteId: string | null;
  locked?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

function getCopy() {
  const language = (localStorage.getItem("i18nextLng") || navigator.language || "").toLowerCase();
  return language.startsWith("zh") ? {
    title: "设置笔记图标",
    subtitle: "选择 emoji，或粘贴一个自定义短图标。",
    custom: "自定义图标",
    placeholder: "例如：📝",
    remove: "移除图标",
    cancel: "取消",
    save: "保存",
    saving: "保存中…",
    success: "笔记图标已更新",
    failed: "更新笔记图标失败",
    locked: "笔记已锁定，无法修改图标",
    invalid: `图标最多 ${MAX_ICON_CODE_POINTS} 个字符，且不能包含换行`,
  } : {
    title: "Set note icon",
    subtitle: "Choose an emoji or paste a short custom icon.",
    custom: "Custom icon",
    placeholder: "For example: 📝",
    remove: "Remove icon",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    success: "Note icon updated",
    failed: "Failed to update note icon",
    locked: "This note is locked and its icon cannot be changed",
    invalid: `The icon must be at most ${MAX_ICON_CODE_POINTS} characters without line breaks`,
  };
}

export default function NoteIconPickerModal({
  noteId,
  locked = false,
  onClose,
  onSaved,
}: NoteIconPickerModalProps) {
  const copy = useMemo(() => getCopy(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [icon, setIcon] = useState("");
  const [originalIcon, setOriginalIcon] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!noteId) return;
    let cancelled = false;
    const cached = getCachedNoteIcon(noteId) || "";
    setIcon(cached);
    setOriginalIcon(cached);
    setError("");
    setLoading(true);
    void refreshNoteIcons([noteId]).finally(() => {
      if (cancelled) return;
      const fresh = getCachedNoteIcon(noteId) || "";
      setIcon(fresh);
      setOriginalIcon(fresh);
      setLoading(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  useEffect(() => {
    if (!noteId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [noteId, onClose, saving]);

  if (!noteId) return null;

  const normalizedIcon = icon.trim();
  const invalid = /[\r\n\t]/.test(normalizedIcon)
    || Array.from(normalizedIcon).length > MAX_ICON_CODE_POINTS;
  const unchanged = normalizedIcon === originalIcon.trim();

  const persist = async (value: string) => {
    if (saving || locked) return;
    const normalized = value.trim();
    if (/[\r\n\t]/.test(normalized) || Array.from(normalized).length > MAX_ICON_CODE_POINTS) {
      setError(copy.invalid);
      inputRef.current?.focus();
      return;
    }

    setSaving(true);
    setError("");
    try {
      await setNoteIcon(noteId, normalized || null);
      toast.success(copy.success);
      onSaved?.();
      onClose();
    } catch (requestError: any) {
      const message = requestError?.code === "NOTE_LOCKED"
        ? copy.locked
        : (requestError?.message || copy.failed);
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={saving ? undefined : onClose} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!loading && !saving && !locked && !invalid && !unchanged) {
            void persist(normalizedIcon);
          }
        }}
        className="relative w-full max-w-[460px] overflow-hidden rounded-xl border border-app-border bg-app-elevated shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-app-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <SmilePlus size={16} className="shrink-0 text-accent-primary" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-tx-primary">{copy.title}</div>
              <div className="mt-0.5 truncate text-[11px] text-tx-tertiary">{copy.subtitle}</div>
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-md p-1 text-tx-tertiary hover:bg-app-hover disabled:opacity-40"
            aria-label={copy.cancel}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="grid grid-cols-8 gap-2 sm:grid-cols-10">
            {PRESET_ICONS.map((preset) => {
              const selected = normalizedIcon === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  disabled={loading || saving || locked}
                  onClick={() => {
                    setIcon(preset);
                    setError("");
                  }}
                  className={`flex aspect-square items-center justify-center rounded-lg border text-xl transition-colors ${selected
                    ? "border-accent-primary bg-accent-primary/10"
                    : "border-app-border bg-app-bg hover:border-accent-primary/40 hover:bg-app-hover"}`}
                  aria-pressed={selected}
                >
                  {preset}
                </button>
              );
            })}
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-tx-secondary">{copy.custom}</span>
            <input
              ref={inputRef}
              type="text"
              value={icon}
              disabled={loading || saving || locked}
              onChange={(event) => {
                setIcon(event.target.value);
                if (error) setError("");
              }}
              placeholder={copy.placeholder}
              className="w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-lg text-tx-primary outline-none transition-colors placeholder:text-sm placeholder:text-tx-tertiary focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>

          {invalid && <p className="text-xs text-red-500">{copy.invalid}</p>}
          {locked && <p className="text-xs text-amber-500">{copy.locked}</p>}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-app-border px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading || saving || locked || !originalIcon}
            onClick={() => void persist("")}
            className="text-red-500 hover:text-red-600"
          >
            <Trash2 size={14} className="mr-1.5" />
            {copy.remove}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              {copy.cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={loading || saving || locked || invalid || unchanged}
              className="bg-accent-primary text-white hover:bg-accent-primary/90 disabled:opacity-40"
            >
              {saving ? copy.saving : copy.save}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
