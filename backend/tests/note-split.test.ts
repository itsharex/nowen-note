import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarkdownSplitDirectory,
  planMarkdownNoteSplit,
  validateMarkdownSplitPlan,
} from "../src/lib/noteSplit.ts";

test("splits exact H1 boundaries and preserves the preamble", () => {
  const source = [
    "Intro paragraph.",
    "",
    "# Alpha",
    "Alpha body",
    "## Nested",
    "nested body",
    "# Beta",
    "Beta body",
  ].join("\n");
  const plan = planMarkdownNoteSplit(source, 1);
  assert.equal(plan.preamble, "Intro paragraph.");
  assert.deepEqual(plan.sections.map((section) => section.title), ["Alpha", "Beta"]);
  assert.match(plan.sections[0].content, /## Nested/);
  assert.equal(validateMarkdownSplitPlan(plan), null);
});

test("ignores heading-shaped lines inside fenced code blocks", () => {
  const source = [
    "# One",
    "```md",
    "# not a section",
    "```",
    "# Two",
  ].join("\n");
  const plan = planMarkdownNoteSplit(source, 1);
  assert.deepEqual(plan.sections.map((section) => section.title), ["One", "Two"]);
  assert.match(plan.sections[0].content, /# not a section/);
});

test("uses exact H2 boundaries instead of flattening H1 headings", () => {
  const source = [
    "# Book",
    "intro",
    "## Chapter A",
    "A",
    "## Chapter B",
    "B",
  ].join("\n");
  const plan = planMarkdownNoteSplit(source, 2);
  assert.equal(plan.preamble, "# Book\nintro");
  assert.deepEqual(plan.sections.map((section) => section.title), ["Chapter A", "Chapter B"]);
});

test("builds a directory with stable note ids and escaped aliases", () => {
  const directory = buildMarkdownSplitDirectory({
    sourceTitle: "Book",
    operationId: "op-1",
    headingLevel: 1,
    preamble: "Intro",
    preservePreamble: true,
    sections: [
      { id: "note-a", title: "Alpha | A" },
      { id: "note-b", title: "Beta ] B" },
    ],
  });
  assert.match(directory, /Intro/);
  assert.match(directory, /nowen-note-split:op-1/);
  assert.match(directory, /\[\[note-a\|Alpha ｜ A\]\]/);
  assert.match(directory, /\[\[note-b\|Beta ］ B\]\]/);
});

test("requires at least two sections", () => {
  const plan = planMarkdownNoteSplit("# Only\nbody", 1);
  assert.equal(validateMarkdownSplitPlan(plan), "至少需要两个同级标题才能拆分");
});
