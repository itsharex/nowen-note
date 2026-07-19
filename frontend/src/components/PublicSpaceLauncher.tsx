import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, ChevronRight, Globe2, Layers3 } from "lucide-react";

const LEGACY_TRANSFER_TRIGGER = 'button[aria-label="跨空间转移笔记"]';

/**
 * 空间级操作入口。
 *
 * “跨空间”和“公共空间”都属于低频、全局的空间操作，不应长期以两个悬浮胶囊
 * 覆盖编辑区。这里将它们收进一个紧凑的“空间”入口：
 *   - 桌面端仅占一个 40px 图标位；
 *   - 移动端使用 44px 触控目标，并避开底部导航与安全区；
 *   - 展开后再显示完整名称和说明，减少误触。
 *
 * NoteTransferCenter 当前仍自行持有弹窗状态和旧触发按钮。迁移期间由本组件隐藏
 * 旧按钮并复用其 click 行为，避免同时出现两个入口；后续转移中心改为事件式 API
 * 后可移除这段兼容桥。
 */
export default function PublicSpaceLauncher() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const transferTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const syncLegacyTransferTrigger = () => {
      const trigger = document.querySelector<HTMLButtonElement>(LEGACY_TRANSFER_TRIGGER);
      if (!trigger) return;
      transferTriggerRef.current = trigger;
      trigger.hidden = true;
      trigger.dataset.spaceActionsManaged = "true";
    };

    syncLegacyTransferTrigger();
    const observer = new MutationObserver(syncLegacyTransferTrigger);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      const trigger = transferTriggerRef.current;
      if (trigger?.dataset.spaceActionsManaged === "true") {
        trigger.hidden = false;
        delete trigger.dataset.spaceActionsManaged;
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const openTransferCenter = () => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      const cached = transferTriggerRef.current;
      const trigger = cached?.isConnected
        ? cached
        : document.querySelector<HTMLButtonElement>(LEGACY_TRANSFER_TRIGGER);

      if (trigger) {
        transferTriggerRef.current = trigger;
        trigger.click();
        return;
      }

      // 为后续事件式实现保留兼容入口；旧版本没有监听器时静默无副作用。
      window.dispatchEvent(new CustomEvent("nowen:open-note-transfer"));
    });
  };

  return (
    <div
      ref={rootRef}
      className="fixed bottom-[calc(var(--safe-area-bottom,0px)+72px)] right-3 z-40 md:bottom-6 md:right-6"
    >
      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 w-[min(18rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-app-border bg-app-elevated/98 p-1.5 shadow-2xl backdrop-blur-xl"
          role="menu"
          aria-label="空间操作"
        >
          <div className="px-3 pb-2 pt-1.5">
            <div className="text-xs font-semibold text-tx-primary">空间操作</div>
            <div className="mt-0.5 text-[11px] text-tx-tertiary">管理内容流转与公开知识库</div>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={openTransferCenter}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-app-hover active:bg-app-active"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-primary/10 text-accent-primary">
              <ArrowLeftRight size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-tx-primary">跨空间转移</span>
              <span className="mt-0.5 block text-[11px] text-tx-tertiary">个人空间与团队空间之间复制或移动</span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-tx-tertiary" />
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => window.location.assign("/public")}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-app-hover active:bg-app-active"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <Globe2 size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-tx-primary">公共空间</span>
              <span className="mt-0.5 block text-[11px] text-tx-tertiary">浏览公开发布的知识库</span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-tx-tertiary" />
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-app-border bg-app-elevated/95 text-tx-secondary shadow-lg backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-accent-primary/40 hover:text-accent-primary hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50 md:h-10 md:w-10"
        aria-label="打开空间操作"
        aria-haspopup="menu"
        aria-expanded={open}
        title="空间操作"
      >
        <Layers3 size={18} />
      </button>
    </div>
  );
}
