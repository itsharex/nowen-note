import * as React from "react"
import { cn } from "@/lib/utils"
import {
  emitSidebarSearchChange,
  normalizeSidebarSearchValue,
  SIDEBAR_SEARCH_SYNC_EVENT,
} from "@/lib/sidebarSearchBridge"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

type SearchNativeEvent = Event & {
  isComposing?: boolean
}

export function shouldForwardSidebarSearchChange(
  nativeEvent: SearchNativeEvent,
  composing: boolean,
): boolean {
  return !composing
    && nativeEvent.isComposing !== true
    && nativeEvent.isTrusted === true
}

function normalizeInputValue(value: InputProps["value"] | InputProps["defaultValue"]): string {
  if (Array.isArray(value)) return value.join(",")
  return value == null ? "" : String(value)
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      value,
      defaultValue,
      onChange,
      onCompositionStart,
      onCompositionEnd,
      ...props
    },
    ref,
  ) => {
    const isSidebarSearch = Object.prototype.hasOwnProperty.call(props, "data-sidebar-search")
    const composingRef = React.useRef(false)
    const awaitingCompositionCommitRef = React.useRef(false)
    const suppressTrustedDuplicateRef = React.useRef<string | null>(null)
    const [sidebarValue, setSidebarValue] = React.useState(() =>
      normalizeInputValue(value ?? defaultValue),
    )

    React.useEffect(() => {
      if (!isSidebarSearch || typeof window === "undefined") return

      const handleSync = (event: Event) => {
        const nextValue = normalizeSidebarSearchValue((event as CustomEvent<unknown>).detail)
        if (nextValue == null || composingRef.current) return
        awaitingCompositionCommitRef.current = false
        suppressTrustedDuplicateRef.current = null
        setSidebarValue(nextValue)
      }

      window.addEventListener(SIDEBAR_SEARCH_SYNC_EVENT, handleSync)
      return () => window.removeEventListener(SIDEBAR_SEARCH_SYNC_EVENT, handleSync)
    }, [isSidebarSearch])

    const commitSidebarSearch = React.useCallback((nextValue: string) => {
      emitSidebarSearchChange(nextValue)
    }, [])

    const handleChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
      if (!isSidebarSearch) {
        onChange?.(event)
        return
      }

      const nextValue = event.currentTarget.value
      const nativeEvent = event.nativeEvent as SearchNativeEvent
      setSidebarValue(nextValue)

      // SearchCenter still mirrors the visible sidebar field with an untrusted native input
      // event. It may update presentation, but it must never execute Sidebar's legacy
      // "empty value -> viewMode all" branch.
      if (!shouldForwardSidebarSearchChange(nativeEvent, composingRef.current)) return

      if (suppressTrustedDuplicateRef.current === nextValue) {
        suppressTrustedDuplicateRef.current = null
        awaitingCompositionCommitRef.current = false
        return
      }

      awaitingCompositionCommitRef.current = false
      commitSidebarSearch(nextValue)
    }, [commitSidebarSearch, isSidebarSearch, onChange])

    const handleCompositionStart = React.useCallback((event: React.CompositionEvent<HTMLInputElement>) => {
      if (isSidebarSearch) {
        composingRef.current = true
        awaitingCompositionCommitRef.current = false
        suppressTrustedDuplicateRef.current = null
      }
      onCompositionStart?.(event)
    }, [isSidebarSearch, onCompositionStart])

    const handleCompositionEnd = React.useCallback((event: React.CompositionEvent<HTMLInputElement>) => {
      if (isSidebarSearch) {
        const input = event.currentTarget
        composingRef.current = false
        awaitingCompositionCommitRef.current = true
        setSidebarValue(input.value)

        // Most Chromium builds emit a final trusted input after compositionend. Some Android
        // and Windows IMEs do not, so commit once in a microtask and suppress a late duplicate.
        void Promise.resolve().then(() => {
          if (!awaitingCompositionCommitRef.current || !input.isConnected) return
          awaitingCompositionCommitRef.current = false
          suppressTrustedDuplicateRef.current = input.value
          commitSidebarSearch(input.value)
        })
      }
      onCompositionEnd?.(event)
    }, [commitSidebarSearch, isSidebarSearch, onCompositionEnd])

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-app-border bg-app-surface px-3 py-1 text-sm text-tx-primary shadow-sm transition-colors placeholder:text-tx-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-primary disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
        {...(isSidebarSearch
          ? { value: sidebarValue }
          : value !== undefined
            ? { value }
            : { defaultValue })}
        onChange={handleChange}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
    )
  },
)
Input.displayName = "Input"

export { Input }
