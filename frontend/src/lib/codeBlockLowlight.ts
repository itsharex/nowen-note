import { common, createLowlight, type LanguageFn } from "lowlight";
import maxscript from "@/lib/codeBlockLanguages/maxscript";

const commonRegistry = common as Record<string, LanguageFn>;

/**
 * Extend lowlight's shared `common` registry before editor-level instances are created.
 *
 * TiptapEditor currently constructs its lowlight instance at module evaluation time. CodeBlockView
 * is one of its static dependencies, so importing this module there guarantees MAXScript is present
 * before `createLowlight(common)` runs, without duplicating the grammar in editor and Markdown paths.
 */
export function installCodeBlockLanguages(): Record<string, LanguageFn> {
  if (!commonRegistry.maxscript) commonRegistry.maxscript = maxscript;
  return commonRegistry;
}

installCodeBlockLanguages();

/** Create an isolated lowlight instance with every Nowen code-block language registered. */
export function createCodeBlockLowlight() {
  return createLowlight({ ...installCodeBlockLanguages() });
}

/** User-facing label for language badges and selectors. */
export function formatCodeBlockLanguageLabel(raw: string | null | undefined): string {
  if (!raw) return "auto";
  const language = raw.toLowerCase();
  if (language === "plaintext" || language === "text") return "text";
  if (language === "maxscript" || language === "ms" || language === "mcr") return "MAXScript";
  return language;
}
