import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import i18n from "i18next";
import { api, SERVER_URL_CHANGED_EVENT } from "@/lib/api";

export interface SiteConfig {
  title: string;
  favicon: string;
  /** ICP 备案号；为空时不展示底部备案信息。 */
  icpBeian: string;
  editorFontFamily: string; // 空串=默认(Inter), 自定义字体 id, 或内置字体名
  // 注：v6 起，"个人空间导出/导入"不再是站点级全站开关；它已下沉为 users 表
  // 的 personalExportEnabled / personalImportEnabled 两列，由管理员在
  // 「用户管理 → 编辑用户」里为每个用户独立控制。消费方（Sidebar、DataManager）
  // 请读当前登录用户自己（api.getMe() 的返回）上的这两字段，不要再从这里读。
}

const DEFAULT_CONFIG: SiteConfig = {
  title: "nowen-note",
  favicon: "",
  icpBeian: "",
  editorFontFamily: "",
};

// 内置字体选项（不需要上传）
export const BUILTIN_FONTS = [
  { id: "", nameKey: "fonts.interDefault", family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: "__system", nameKey: "fonts.systemDefault", family: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { id: "__serif", nameKey: "fonts.serif", family: "Georgia, 'Noto Serif SC', 'Source Han Serif SC', serif" },
  { id: "__mono", nameKey: "fonts.monospace", family: "'Cascadia Code', 'Fira Code', 'Source Code Pro', 'Menlo', 'Consolas', monospace" },
];

// Helper to get translated font name
export function getBuiltinFontName(font: typeof BUILTIN_FONTS[number]): string {
  return i18n.t(font.nameKey);
}

interface SiteSettingsContextValue {
  siteConfig: SiteConfig;
  updateSiteConfig: (title: string, favicon: string, icpBeian?: string) => Promise<void>;
  updateIcpBeian: (icpBeian: string) => Promise<void>;
  updateEditorFont: (fontId: string) => Promise<void>;
  isLoaded: boolean;
}

const SiteSettingsContext = createContext<SiteSettingsContextValue>({
  siteConfig: DEFAULT_CONFIG,
  updateSiteConfig: async () => {},
  updateIcpBeian: async () => {},
  updateEditorFont: async () => {},
  isLoaded: false,
});

/**
 * 应用站点标题与 favicon 到 DOM。
 *
 * 历史坑点（2026-04 修复）：
 *  1. index.html 里同时存在 `<link rel="icon">`、`<link rel="alternate icon">`、
 *     `<link rel="apple-touch-icon">`。以前只更新第一个，其他继续指向旧 URL,
 *     浏览器可能回退到 `alternate icon` → 看起来"换了没生效"。
 *  2. 直接改 `link.href` 时，浏览器常常复用已缓存的 favicon 不刷新。稳妥做法
 *     是 **移除旧节点、新建节点**，这样浏览器必须重新发起解析。
 *  3. 之前 `link.type` 只识别 svg / png / x-icon，上传 jpg/webp/ico 时一律被
 *     写成 image/png → 某些浏览器直接拒渲。改为从 data URL 真实 MIME 读取。
 */
function parseDataUrlMime(url: string): string {
  // data:image/png;base64,... → image/png
  const m = /^data:([^;,]+)[;,]/i.exec(url);
  return m ? m[1].toLowerCase() : "image/png";
}

function applyToDOM(title: string, faviconUrl: string) {
  document.title = title || "nowen-note";

  // 清理页面上所有"图标类"link（含 alternate/apple-touch/shortcut），避免旧节点覆盖新节点
  const oldLinks = document.head.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="alternate icon"], link[rel="apple-touch-icon"]'
  );
  oldLinks.forEach((n) => n.parentNode?.removeChild(n));

  // 新建主 icon 节点
  const link = document.createElement("link");
  link.rel = "icon";
  if (faviconUrl) {
    link.type = parseDataUrlMime(faviconUrl) || "image/png";
    link.href = faviconUrl;
  } else {
    // 恢复内置品牌 favicon（与 index.html 保持一致）
    link.type = "image/svg+xml";
    link.href = "/favicon.svg";
  }
  document.head.appendChild(link);

  // apple-touch-icon 同步更新；自定义图标时复用相同 href（PWA/添加到主屏幕体验一致）
  const apple = document.createElement("link");
  apple.rel = "apple-touch-icon";
  apple.href = faviconUrl || "/apple-touch-icon.svg";
  document.head.appendChild(apple);
}

function isNativeClientRuntime(): boolean {
  try {
    const w = window as any;
    return !!w.nowenDesktop?.isDesktop
      || !!w.Capacitor?.isNativePlatform?.()
      || (!!w.Capacitor?.platform && w.Capacitor.platform !== "web");
  } catch {
    return false;
  }
}

function hasAuthToken(): boolean {
  try {
    return !!localStorage.getItem("nowen-token");
  } catch {
    return false;
  }
}

function ensureIcpBeianFooter(): { footer: HTMLElement; link: HTMLAnchorElement } | null {
  if (typeof document === "undefined") return null;

  let footer = document.getElementById("beian-footer") as HTMLElement | null;
  if (!footer) {
    footer = document.createElement("footer");
    footer.id = "beian-footer";
    footer.className = "beian-footer";
    footer.setAttribute("aria-label", "ICP备案信息");
    document.body.appendChild(footer);
  }

  let link = document.getElementById("beian-link") as HTMLAnchorElement | null;
  if (!link || !footer.contains(link)) {
    link = document.createElement("a");
    link.id = "beian-link";
    footer.textContent = "";
    footer.appendChild(link);
  }

  link.href = "https://beian.miit.gov.cn/";
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  // BEIAN-FOOTER-04：备案号只在未登录页展示。
  // 用户反馈：登录成功后的主工作台不需要常驻底部备案号，且之前主界面展示会压在
  // 空态区底部。这里仍复用 index.html 的 footer 节点，但显示条件改成：有备案号、
  // 非原生客户端、且当前没有 nowen-token。登录成功写入 token 后会被下方轮询隐藏；
  // 登出清 token 后会重新显示在登录页。
  footer.style.position = "fixed";
  footer.style.left = "max(12px, env(safe-area-inset-left))";
  footer.style.right = "max(12px, env(safe-area-inset-right))";
  footer.style.bottom = "max(8px, env(safe-area-inset-bottom))";
  footer.style.zIndex = "2147483000";
  footer.style.justifyContent = "center";
  footer.style.pointerEvents = "none";
  footer.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
  link.style.pointerEvents = "auto";

  return { footer, link };
}

function applyIcpBeianToDOM(icpBeian: string) {
  const refs = ensureIcpBeianFooter();
  if (!refs) return;
  const { footer, link } = refs;

  const text = String(icpBeian || "").trim();
  if (!text || isNativeClientRuntime() || hasAuthToken()) {
    footer.classList.remove("is-visible");
    footer.style.display = "none";
    link.textContent = "";
    return;
  }

  link.textContent = text;
  link.href = "https://beian.miit.gov.cn/";
  footer.classList.add("is-visible");
  footer.style.display = "flex";
}

function applyEditorFont(fontId: string, customFontName?: string) {
  const builtin = BUILTIN_FONTS.find(f => f.id === fontId);
  if (builtin) {
    document.documentElement.style.setProperty("--editor-font-family", builtin.family);
    return;
  }

  // 自定义字体：注入 @font-face 并设置 CSS 变量
  if (fontId && customFontName) {
    const fontFaceName = `CustomFont-${fontId.slice(0, 8)}`;
    const styleId = `font-face-${fontId}`;

    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `@font-face { font-family: '${fontFaceName}'; src: url('${api.getFontFileUrl(fontId)}'); font-display: swap; }`;
      document.head.appendChild(style);
    }

    document.documentElement.style.setProperty(
      "--editor-font-family",
      `'${fontFaceName}', system-ui, sans-serif`
    );
    return;
  }

  // 回退默认
  document.documentElement.style.setProperty(
    "--editor-font-family",
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif"
  );
}

export function SiteSettingsProvider({ children }: { children: React.ReactNode }) {
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(DEFAULT_CONFIG);
  const [isLoaded, setIsLoaded] = useState(false);

  const loadSiteSettings = useCallback(() => {
    api.getSiteSettingsPublic().then(async (data) => {
      const config: SiteConfig = {
        title: data.site_title || "nowen-note",
        favicon: data.site_favicon || "",
        icpBeian: (data as any).site_icp_beian || "",
        editorFontFamily: data.editor_font_family || "",
      };
      setSiteConfig(config);
      applyToDOM(config.title, config.favicon);
      applyIcpBeianToDOM(config.icpBeian);

      // 加载自定义字体名
      if (config.editorFontFamily && !BUILTIN_FONTS.find(f => f.id === config.editorFontFamily)) {
        try {
          const fonts = await api.getFontsPublic();
          const font = fonts.find(f => f.id === config.editorFontFamily);
          applyEditorFont(config.editorFontFamily, font?.name);
        } catch {
          applyEditorFont(config.editorFontFamily);
        }
      } else {
        applyEditorFont(config.editorFontFamily);
      }

      setIsLoaded(true);
    }).catch(() => {
      applyToDOM(DEFAULT_CONFIG.title, DEFAULT_CONFIG.favicon);
      applyIcpBeianToDOM("");
      applyEditorFont("");
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    loadSiteSettings();

    const handleServerUrlChanged = () => {
      loadSiteSettings();
    };
    window.addEventListener(SERVER_URL_CHANGED_EVENT, handleServerUrlChanged);
    return () => window.removeEventListener(SERVER_URL_CHANGED_EVENT, handleServerUrlChanged);
  }, [loadSiteSettings]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      applyIcpBeianToDOM(siteConfig.icpBeian);
    }, 300);
    return () => window.clearInterval(timer);
  }, [siteConfig.icpBeian]);

  const updateSiteConfig = useCallback(async (title: string, favicon: string, icpBeian = siteConfig.icpBeian) => {
    const data = await api.updateSiteSettings({
      site_title: title,
      site_favicon: favicon,
      site_icp_beian: icpBeian,
    } as any);
    const config: SiteConfig = {
      title: data.site_title || "nowen-note",
      favicon: data.site_favicon || "",
      icpBeian: (data as any).site_icp_beian ?? icpBeian,
      editorFontFamily: data.editor_font_family || siteConfig.editorFontFamily,
    };
    setSiteConfig(config);
    applyToDOM(config.title, config.favicon);
    applyIcpBeianToDOM(config.icpBeian);
  }, [siteConfig.editorFontFamily, siteConfig.icpBeian]);

  const updateIcpBeian = useCallback(async (icpBeian: string) => {
    const submitted = icpBeian.trim();
    const data = await api.updateSiteSettings({ site_icp_beian: submitted } as any);
    const next = (data as any).site_icp_beian ?? submitted;
    setSiteConfig((prev) => {
      const config = { ...prev, icpBeian: next };
      applyIcpBeianToDOM(config.icpBeian);
      return config;
    });
  }, []);

  const updateEditorFont = useCallback(async (fontId: string) => {
    const data = await api.updateSiteSettings({ editor_font_family: fontId });
    const config: SiteConfig = {
      ...siteConfig,
      editorFontFamily: data.editor_font_family || "",
    };
    setSiteConfig(config);

    // 获取自定义字体名用于 @font-face
    if (fontId && !BUILTIN_FONTS.find(f => f.id === fontId)) {
      try {
        const fonts = await api.getFonts();
        const font = fonts.find(f => f.id === fontId);
        applyEditorFont(fontId, font?.name);
      } catch {
        applyEditorFont(fontId);
      }
    } else {
      applyEditorFont(fontId);
    }
  }, [siteConfig]);

  return (
    <SiteSettingsContext.Provider value={{ siteConfig, updateSiteConfig, updateIcpBeian, updateEditorFont, isLoaded }}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings() {
  return useContext(SiteSettingsContext);
}