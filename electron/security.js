/**
 * Electron 安全工具函数
 * ---------------------------------------------------------------------------
 * SEC-ELECTRON-01-B: 统一 IPC 来源校验和外部 URL 安全检查。
 *
 * 独立模块，避免 main.js ↔ credentials.js 循环依赖。
 */

/**
 * 验证外部 URL 协议是否允许通过 shell.openExternal 打开。
 * 只允许 http/https/mailto，禁止 file/javascript/data/vbscript 等危险协议。
 */
function isAllowedExternalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * 判断 event.senderFrame 是否来自主窗口的可信 renderer。
 * 允许：file:// 本地 frontend/dist、开发环境 localhost
 */
function isTrustedMainWindowSender(event) {
  try {
    const frame = event.senderFrame;
    if (!frame) return false;
    const url = frame.url || "";
    if (url.startsWith("file://")) return true;
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * 判断 event.senderFrame 是否来自 setupWindow 的 data: 页面。
 */
function isTrustedSetupWindowSender(event) {
  try {
    const frame = event.senderFrame;
    if (!frame) return false;
    const url = frame.url || "";
    return url.startsWith("data:");
  } catch {
    return false;
  }
}

/**
 * 统一 IPC 来源校验：只允许主窗口调用。
 * 返回 null 表示校验通过，返回错误对象表示拒绝。
 */
function assertMainWindowSender(event) {
  if (!isTrustedMainWindowSender(event)) {
    console.warn("[security] blocked IPC from untrusted sender:", event.senderFrame?.url || "unknown");
    return { ok: false, error: "UNTRUSTED_SENDER" };
  }
  return null;
}

/**
 * 判断主窗口导航是否允许。
 * 允许：同源导航、hash 路由、file:// 本地页面、data: 页面。
 * 拒绝：外部 http/https、mailto、javascript/data/vbscript 等危险协议。
 */
function isAllowedMainWindowNavigation(targetUrl, currentUrl) {
  try {
    const target = new URL(targetUrl);
    const current = new URL(currentUrl);

    // 同源导航允许
    if (target.origin === current.origin) return true;

    // file:// 协议：只允许本地文件（生产环境）
    if (target.protocol === "file:" && current.protocol === "file:") return true;

    // data: 协议：允许（错误页面等）
    if (target.protocol === "data:") return true;

    // about:blank 允许
    if (target.protocol === "about:") return true;

    // 其他协议拒绝
    return false;
  } catch {
    // URL 解析失败拒绝
    return false;
  }
}

module.exports = {
  isAllowedExternalUrl,
  isAllowedMainWindowNavigation,
  isTrustedMainWindowSender,
  isTrustedSetupWindowSender,
  assertMainWindowSender,
};
