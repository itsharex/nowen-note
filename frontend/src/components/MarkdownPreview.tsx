/**
 * MarkdownPreview —— Markdown 渲染预览组件
 *
 * 用于 MarkdownEditor 的预览模式和分屏模式。
 * 使用 react-markdown + remark-gfm 渲染标准 Markdown。
 */

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";

interface MarkdownPreviewProps {
  markdown: string;
  className?: string;
}

/** 图片组件：支持 /api/attachments、http、data:image，带加载失败占位 */
function PreviewImage({ src, alt }: { src?: string; alt?: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);

  if (!src) return null;

  if (failed) {
    return (
      <span className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-app-hover text-tx-tertiary text-xs">
        ⚠ {t("markdown.preview.imageLoadFailed")}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt || ""}
      className="max-w-full max-h-[420px] rounded-lg border border-app-border object-contain cursor-pointer hover:opacity-90 transition-opacity"
      onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}

/** 链接组件：新窗口打开 */
function PreviewLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent-primary hover:underline"
    >
      {children}
    </a>
  );
}

/** 代码块组件 */
function PreviewCodeBlock({ className, children, ...props }: any) {
  const match = /language-(\w+)/.exec(className || "");
  const isBlock = props.node?.tagName === "pre";

  if (isBlock) {
    return (
      <pre className="rounded-lg bg-app-hover border border-app-border p-3 overflow-x-auto text-sm">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  }

  return (
    <code
      className="px-1.5 py-0.5 rounded bg-app-hover text-accent-primary text-sm font-mono"
      {...props}
    >
      {children}
    </code>
  );
}

export function MarkdownPreview({ markdown, className }: MarkdownPreviewProps) {
  const { t } = useTranslation();

  if (!markdown || !markdown.trim()) {
    return (
      <div className={`flex items-center justify-center h-full text-tx-tertiary text-sm ${className || ""}`}>
        {t("markdown.preview.empty")}
      </div>
    );
  }

  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none p-4 overflow-y-auto ${className || ""}`}
      style={{
        // 覆盖 prose 默认样式，适配 nowen-note 主题
        color: "var(--color-tx-primary, inherit)",
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: PreviewImage as any,
          a: PreviewLink as any,
          code: PreviewCodeBlock as any,
          // 表格样式
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="border-collapse border border-app-border text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-app-border px-3 py-1.5 bg-app-hover font-semibold text-left">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-app-border px-3 py-1.5">
              {children}
            </td>
          ),
          // 引用块样式
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-accent-primary/40 pl-3 py-1 my-2 text-tx-secondary italic bg-app-hover/30 rounded-r">
              {children}
            </blockquote>
          ),
          // 水平线
          hr: () => <hr className="my-4 border-app-border" />,
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
