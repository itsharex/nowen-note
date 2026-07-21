import { describe, expect, it } from "vitest";
import {
  isIncrementalShortLatinQuery,
  normalizeProgressiveSearchQuery,
} from "../searchRequestPolicy";

describe("searchRequestPolicy", () => {
  it("normalizes full-width and mixed-case input", () => {
    expect(normalizeProgressiveSearchQuery("  Ｍt  ")).toBe("mt");
  });

  it("classifies 1-2 character Latin and numeric fragments as progressive input", () => {
    expect(isIncrementalShortLatinQuery("M")).toBe(true);
    expect(isIncrementalShortLatinQuery("MT")).toBe(true);
    expect(isIncrementalShortLatinQuery("12")).toBe(true);
    expect(isIncrementalShortLatinQuery("Ａ")).toBe(true);
  });

  it("keeps complete, Han, and punctuation-bearing queries searchable", () => {
    expect(isIncrementalShortLatinQuery("MTU")).toBe(false);
    expect(isIncrementalShortLatinQuery("搜索")).toBe(false);
    expect(isIncrementalShortLatinQuery("C++")).toBe(false);
    expect(isIncrementalShortLatinQuery("v1.4.1")).toBe(false);
    expect(isIncrementalShortLatinQuery(" ")).toBe(false);
  });
});
