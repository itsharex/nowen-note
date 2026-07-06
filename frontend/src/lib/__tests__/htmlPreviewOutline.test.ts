import { describe, expect, it, vi } from "vitest";
import {
  scrollToHtmlPreviewHeading,
  syncHtmlPreviewOutline,
} from "@/lib/htmlPreviewOutline";

describe("htmlPreviewOutline", () => {
  it("syncs heading ids to the rendered DOM and scrolls by outline position", () => {
    document.body.innerHTML = `
      <article>
        <h1>Intro</h1>
        <p>text</p>
        <h2>Intro</h2>
        <h4>Deep Topic</h4>
      </article>
    `;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const outline = syncHtmlPreviewOutline(document.body);

    expect(outline).toEqual([
      { id: "intro", level: 1, text: "Intro", pos: 0 },
      { id: "intro-2", level: 2, text: "Intro", pos: 1 },
      { id: "deep-topic", level: 4, text: "Deep Topic", pos: 2 },
    ]);
    expect(document.querySelector("h1")?.id).toBe("intro");
    expect(document.querySelector("h2")?.id).toBe("intro-2");

    expect(scrollToHtmlPreviewHeading(document.body, 1)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});
