import { describe, expect, it } from "vitest";
import { siyuanSyToMarkdown, siyuanTimestampToIso, type SiyuanNode } from "@/lib/siyuanSyParser";

const text = (Data: string): SiyuanNode => ({ Type: "NodeText", Data });

describe("siyuanSyParser", () => {
  it("converts document paragraphs and timestamps", () => {
    const result = siyuanSyToMarkdown({
      Type: "NodeDocument",
      Properties: { title: "Welcome", updated: "20230419153642" },
      Children: [{ Type: "NodeParagraph", Children: [text("Hello Siyuan")] }],
    });

    expect(result.title).toBe("Welcome");
    expect(result.markdown).toBe("Hello Siyuan");
    expect(result.plainText).toBe("Hello Siyuan");
    expect(result.updatedAt).toBe("2023-04-19T15:36:42");
    expect(siyuanTimestampToIso("bad")).toBeUndefined();
  });

  it("converts headings and common text marks", () => {
    const result = siyuanSyToMarkdown({
      Type: "NodeDocument",
      Children: [
        { Type: "NodeHeading", Properties: { level: 2 }, Children: [text("Guide")] },
        {
          Type: "NodeParagraph",
          Children: [
            { Type: "NodeTextMark", TextMarkType: "strong", TextMarkTextContent: "bold" },
            text(" "),
            { Type: "NodeTextMark", TextMarkType: "em", TextMarkTextContent: "em" },
            text(" "),
            { Type: "NodeTextMark", TextMarkType: "code", TextMarkTextContent: "code" },
            text(" "),
            { Type: "NodeTextMark", TextMarkType: "kbd", TextMarkTextContent: "Ctrl+K" },
            text(" "),
            { Type: "NodeTextMark", TextMarkType: "a", TextMarkTextContent: "link", TextMarkAHref: "https://example.com" },
            text(" "),
            { Type: "NodeTextMark", TextMarkType: "tag", TextMarkTextContent: "project" },
            text(" "),
            { Type: "NodeTextMark", TextMarkType: "block-ref", TextMarkBlockRefID: "20240101000000-abcdefg" },
          ],
        },
      ],
    });

    expect(result.markdown).toContain("## Guide");
    expect(result.markdown).toContain("**bold**");
    expect(result.markdown).toContain("*em*");
    expect(result.markdown).toContain("`code`");
    expect(result.markdown).toContain("<kbd>Ctrl+K</kbd>");
    expect(result.markdown).toContain("[link](https://example.com)");
    expect(result.markdown).toContain("#project#");
    expect(result.markdown).toContain("[块引用:20240101000000-abcdefg]");
    expect(result.stats.tags).toEqual(["project"]);
    expect(result.stats.blockRefs).toBe(1);
  });

  it("converts lists, code blocks, tables, images, math, and super blocks", () => {
    const result = siyuanSyToMarkdown({
      Type: "NodeDocument",
      Children: [
        {
          Type: "NodeList",
          Children: [
            { Type: "NodeListItem", Children: [{ Type: "NodeParagraph", Children: [text("first")] }] },
            {
              Type: "NodeListItem",
              Children: [
                { Type: "NodeTaskListItemMarker", Data: "[x]" },
                { Type: "NodeParagraph", Children: [text("done")] },
              ],
            },
          ],
        },
        {
          Type: "NodeCodeBlock",
          CodeBlockInfo: "ts",
          Children: [{ Type: "NodeCodeBlockCode", Data: "const ok = true;" }],
        },
        {
          Type: "NodeTable",
          Children: [
            {
              Type: "NodeTableRow",
              Children: [
                { Type: "NodeTableCell", Children: [text("A")] },
                { Type: "NodeTableCell", Children: [text("B")] },
              ],
            },
            {
              Type: "NodeTableRow",
              Children: [
                { Type: "NodeTableCell", Children: [text("1")] },
                { Type: "NodeTableCell", Children: [text("2")] },
              ],
            },
          ],
        },
        {
          Type: "NodeImage",
          Children: [
            { Type: "NodeLinkText", Children: [text("pic")] },
            { Type: "NodeLinkDest", Data: "assets/a.png" },
          ],
        },
        { Type: "NodeMathBlock", Children: [{ Type: "NodeMathBlockContent", Data: "E=mc^2" }] },
        { Type: "NodeSuperBlock", Children: [{ Type: "NodeParagraph", Children: [text("inside")] }] },
      ],
    });

    expect(result.markdown).toContain("- first");
    expect(result.markdown).toContain("- [x] done");
    expect(result.markdown).toContain("```ts");
    expect(result.markdown).toContain("| A | B |");
    expect(result.markdown).toContain("![pic](assets/a.png)");
    expect(result.stats.images).toEqual(["assets/a.png"]);
    expect(result.markdown).toContain("$$");
    expect(result.markdown).toContain("inside");
  });

  it("safely downgrades complex and unknown nodes", () => {
    const result = siyuanSyToMarkdown({
      Type: "NodeDocument",
      Children: [
        { Type: "NodeAttributeView", Data: "av" },
        { Type: "NodeBlockQueryEmbed", Data: "{{SELECT *}}" },
        { Type: "NodeVideo", Data: "assets/demo.mp4" },
        { Type: "NodeAudio", Data: "assets/demo.wav" },
        { Type: "NodeIFrame", Data: "<iframe src=\"https://example.com\"></iframe>" },
        { Type: "NodeUnknownThing", Data: "fallback" },
      ],
    });

    expect(result.markdown).toContain("属性视图暂不支持");
    expect(result.markdown).toContain("{{SELECT *}}");
    expect(result.markdown).toContain("[视频](assets/demo.mp4)");
    expect(result.markdown).toContain("[音频](assets/demo.wav)");
    expect(result.markdown).toContain("<iframe src=\"https://example.com\"></iframe>");
    expect(result.markdown).toContain("fallback");
    expect(result.stats.unsupportedNodes.NodeAttributeView).toBe(1);
    expect(result.stats.unsupportedNodes.NodeBlockQueryEmbed).toBe(1);
    expect(result.stats.unsupportedNodes.NodeUnknownThing).toBe(1);
  });
});
