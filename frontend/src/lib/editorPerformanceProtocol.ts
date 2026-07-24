import {
  evaluateEditorPerformanceBudget,
  type EditorPerformanceSample,
  type EditorPerformanceTarget,
} from "@/lib/editorPerformanceBudget";

export type EditorPerformancePlatform = "web" | "electron" | "android";
export type EditorPerformanceScenario =
  | "markdown-2.4mb"
  | "tiptap-20000"
  | "list-batch-100"
  | "heavy-and-code-100"
  | "switch-20-and-close";

export const EDITOR_PERFORMANCE_PLATFORMS: EditorPerformancePlatform[] = ["web", "electron", "android"];
export const EDITOR_PERFORMANCE_SCENARIOS: EditorPerformanceScenario[] = [
  "markdown-2.4mb",
  "tiptap-20000",
  "list-batch-100",
  "heavy-and-code-100",
  "switch-20-and-close",
];

export interface EditorPerformanceRun extends EditorPerformanceSample {
  platform: EditorPerformancePlatform;
  scenario: EditorPerformanceScenario;
  firstInteractiveMs: number;
  noteSwitchMs: number[];
  heapOpenedBytes?: number;
  heapScrolledBytes?: number;
  markdownRenderMatches?: boolean;
}

export interface EditorPerformanceMatrixResult {
  passed: boolean;
  missing: string[];
  failed: Array<{ platform: EditorPerformancePlatform; scenario: EditorPerformanceScenario; failures: string[] }>;
}

function targetFor(platform: EditorPerformancePlatform): EditorPerformanceTarget {
  return platform === "android" ? "android-low-power" : "desktop";
}

/** 对 Web、Electron、Android 的固定矩阵执行 fail-closed 签收。 */
export function evaluateEditorPerformanceMatrix(runs: EditorPerformanceRun[]): EditorPerformanceMatrixResult {
  const byKey = new Map(runs.map((run) => [`${run.platform}:${run.scenario}`, run]));
  const missing: string[] = [];
  const failed: EditorPerformanceMatrixResult["failed"] = [];
  for (const platform of EDITOR_PERFORMANCE_PLATFORMS) {
    for (const scenario of EDITOR_PERFORMANCE_SCENARIOS) {
      const run = byKey.get(`${platform}:${scenario}`);
      if (!run) {
        missing.push(`${platform}:${scenario}`);
        continue;
      }
      const budget = evaluateEditorPerformanceBudget(run, targetFor(platform));
      const failures = [...budget.failures];
      if (!Number.isFinite(run.firstInteractiveMs) || run.firstInteractiveMs < 0) failures.push("first interactive time is missing");
      if (scenario === "switch-20-and-close" && run.noteSwitchMs.length !== 20) failures.push("20 note-switch samples are required");
      if (scenario === "markdown-2.4mb" && run.markdownRenderMatches !== true) failures.push("markdown segmented render mismatch");
      if (failures.length > 0) failed.push({ platform, scenario, failures });
    }
  }
  return { passed: missing.length === 0 && failed.length === 0, missing, failed };
}

export interface EditorPerformanceCollector {
  inputStarted(): () => void;
  noteSwitchStarted(): () => void;
  recordHeap(stage: "before" | "opened" | "scrolled" | "after", bytes: number): void;
  recordFirstInteractive(ms: number): void;
  recordLifecycle(workers: number, mediaRequests: number): void;
  finish(markdownRenderMatches?: boolean): EditorPerformanceRun;
  dispose(): void;
}

/** 浏览器壳、Electron 和 Android WebView 共用的无框架采集器。 */
export function createEditorPerformanceCollector(
  platform: EditorPerformancePlatform,
  scenario: EditorPerformanceScenario,
  clock: () => number = () => performance.now(),
): EditorPerformanceCollector {
  const inputLatencyMs: number[] = [];
  const noteSwitchMs: number[] = [];
  const longTaskMs: number[] = [];
  const heap: Partial<Record<"before" | "opened" | "scrolled" | "after", number>> = {};
  let firstInteractiveMs = Number.NaN;
  let activeWorkersAfterClose = 0;
  let activeMediaRequestsAfterClose = 0;
  const observer = typeof PerformanceObserver !== "undefined"
    ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTaskMs.push(entry.duration);
      })
    : null;
  try { observer?.observe({ entryTypes: ["longtask"] }); } catch { /* WebView 可能不支持 longtask。 */ }
  const startSample = (target: number[]) => {
    const started = clock();
    return () => target.push(Math.max(0, clock() - started));
  };
  return {
    inputStarted: () => startSample(inputLatencyMs),
    noteSwitchStarted: () => startSample(noteSwitchMs),
    recordHeap: (stage, bytes) => { if (Number.isFinite(bytes) && bytes >= 0) heap[stage] = bytes; },
    recordFirstInteractive: (ms) => { firstInteractiveMs = ms; },
    recordLifecycle: (workers, mediaRequests) => {
      activeWorkersAfterClose = Math.max(0, workers);
      activeMediaRequestsAfterClose = Math.max(0, mediaRequests);
    },
    finish: (markdownRenderMatches) => ({
      platform,
      scenario,
      inputLatencyMs: [...inputLatencyMs],
      longTaskMs: [...longTaskMs],
      noteSwitchMs: [...noteSwitchMs],
      firstInteractiveMs,
      heapBeforeBytes: heap.before,
      heapOpenedBytes: heap.opened,
      heapScrolledBytes: heap.scrolled,
      heapAfterBytes: heap.after,
      activeWorkersAfterClose,
      activeMediaRequestsAfterClose,
      markdownRenderMatches,
    }),
    dispose: () => observer?.disconnect(),
  };
}
