import { describe, expect, it } from "vitest";
import { isCompleteNoteDetail } from "@/lib/syncEngine";

describe("syncEngine note detail integrity", () => {
  it("accepts only complete server note details", () => {
    expect(isCompleteNoteDetail({
      id: "note-1",
      title: "Title",
      content: "Body",
      contentText: "Body",
      version: 2,
    })).toBe(true);

    expect(isCompleteNoteDetail({
      id: "note-1",
      title: "Title",
      version: 2,
    })).toBe(false);

    expect(isCompleteNoteDetail({
      id: "note-1",
      title: "Title",
      content: undefined,
      contentText: undefined,
      version: 2,
    })).toBe(false);
  });

  it("accepts a legitimate empty note when both body fields are present", () => {
    expect(isCompleteNoteDetail({
      id: "note-1",
      title: "Empty",
      content: "",
      contentText: "",
      version: 1,
    })).toBe(true);
  });
});
