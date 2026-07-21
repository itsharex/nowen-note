import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  getActiveEditorRuntimeDecision,
  subscribeEditorRuntime,
} from "@/lib/editorRuntimeStore";

export interface LazyNodeViewOptions {
  forceMount?: boolean;
  rootMargin?: string;
}

/**
 * Keep the ProseMirror NodeView wrapper mounted while deferring only the expensive inner view.
 * This preserves document positions, selection and transactions, unlike virtualizing the whole
 * contenteditable tree.
 */
export function useLazyNodeView<T extends Element>({
  forceMount = false,
  rootMargin = "900px 0px",
}: LazyNodeViewOptions = {}) {
  const decision = useSyncExternalStore(
    subscribeEditorRuntime,
    getActiveEditorRuntimeDecision,
    getActiveEditorRuntimeDecision,
  );
  const lazyEnabled = !decision.capabilities.eagerHeavyNodes;
  const [element, setElement] = useState<T | null>(null);
  const [nearViewport, setNearViewport] = useState(() => !lazyEnabled);

  const observeRef = useCallback((next: T | null) => {
    setElement(next);
  }, []);

  useEffect(() => {
    if (!lazyEnabled || forceMount) {
      setNearViewport(true);
      return;
    }
    if (!element || typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }

    setNearViewport(false);
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNearViewport(true);
    }, { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, forceMount, lazyEnabled, rootMargin]);

  return {
    decision,
    lazyEnabled,
    shouldRenderHeavyContent: !lazyEnabled || forceMount || nearViewport,
    observeRef,
  };
}
