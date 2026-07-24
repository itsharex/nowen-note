import { describe, expect, it } from "vitest";
import {
  createEditorPerformanceCollector,
  EDITOR_PERFORMANCE_PLATFORMS,
  EDITOR_PERFORMANCE_SCENARIOS,
  evaluateEditorPerformanceMatrix,
  type EditorPerformanceRun,
} from "@/lib/editorPerformanceProtocol";

function passingRun(platform: EditorPerformanceRun["platform"], scenario: EditorPerformanceRun["scenario"]): EditorPerformanceRun {
  return {
    platform,
    scenario,
    inputLatencyMs: [4, 8, 12],
    longTaskMs: [20],
    firstInteractiveMs: 50,
    noteSwitchMs: scenario === "switch-20-and-close" ? Array(20).fill(10) : [],
    heapBeforeBytes: 100_000_000,
    heapAfterBytes: 110_000_000,
    activeWorkersAfterClose: 0,
    activeMediaRequestsAfterClose: 0,
    markdownRenderMatches: scenario === "markdown-2.4mb" ? true : undefined,
  };
}

describe("editor performance sign-off protocol", () => {
  it("requires and accepts the complete 3x5 matrix", () => {
    const runs = EDITOR_PERFORMANCE_PLATFORMS.flatMap((platform) => (
      EDITOR_PERFORMANCE_SCENARIOS.map((scenario) => passingRun(platform, scenario))
    ));
    expect(evaluateEditorPerformanceMatrix(runs)).toEqual({ passed: true, missing: [], failed: [] });
    expect(evaluateEditorPerformanceMatrix(runs.slice(1)).missing).toHaveLength(1);
  });

  it("collects latency, heap and lifecycle values with a shared clock", () => {
    let now = 10;
    const collector = createEditorPerformanceCollector("electron", "tiptap-20000", () => now);
    const finishInput = collector.inputStarted();
    now = 18;
    finishInput();
    collector.recordHeap("before", 100);
    collector.recordHeap("after", 120);
    collector.recordFirstInteractive(25);
    collector.recordLifecycle(0, 0);
    expect(collector.finish()).toMatchObject({ inputLatencyMs: [8], heapBeforeBytes: 100, heapAfterBytes: 120 });
    collector.dispose();
  });
});
