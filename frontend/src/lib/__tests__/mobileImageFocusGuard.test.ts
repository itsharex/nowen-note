// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { blurFocusedEditorForImageSheet } from "@/lib/mobileImageFocusGuard";

describe("mobile image focus guard", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("blurs the focused editor when the image action sheet opens", () => {
    document.body.innerHTML = `
      <div class="ProseMirror" contenteditable="true" tabindex="0"></div>
      <div class="fixed bottom-0 left-0 right-0 z-50">
        <div><button aria-label="关闭">x</button></div>
        <div class="grid grid-cols-4">
          <button>查看</button><button>下载</button><button>替换</button>
          <button>复制</button><button>删除</button><button>编辑</button>
        </div>
        <div class="grid grid-cols-5">
          <button>25%</button><button>50%</button><button>75%</button>
          <button>100%</button><button>原始</button>
        </div>
      </div>
    `;

    const editor = document.querySelector<HTMLElement>(".ProseMirror")!;
    const blur = vi.spyOn(editor, "blur");
    editor.focus();

    expect(blurFocusedEditorForImageSheet(document)).toBe(true);
    expect(blur).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no image sheet is present", () => {
    document.body.innerHTML = '<div class="ProseMirror" contenteditable="true" tabindex="0"></div>';
    const editor = document.querySelector<HTMLElement>(".ProseMirror")!;
    const blur = vi.spyOn(editor, "blur");

    expect(blurFocusedEditorForImageSheet(document)).toBe(false);
    expect(blur).not.toHaveBeenCalled();
  });
});
