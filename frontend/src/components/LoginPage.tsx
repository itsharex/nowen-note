import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Lock, User, BookOpen, CheckCircle2, AlertCircle, Mail, UserPlus, ShieldCheck, Eye, EyeOff, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getServerUrl, setServerUrl, clearServerUrl, testServerConnection, fetchRegisterConfig, registerAccount, diagnoseConnection, type DiagnosisResult } from "@/lib/api";
import { buildServerUrl, parseServerUrl, type ServerAddressParts } from "@/lib/serverUrl";
import ServerAddressInput from "@/components/ServerAddressInput";
import LanDiscoveryPanel from "@/components/LanDiscoveryPanel";
import { useKeyboardLayout } from "@/hooks/useCapacitor";
import { useKeyboardVisible } from "@/hooks/useKeyboardVisible";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import {
  loadRememberedCredentials,
  saveRememberedCredentials,
  clearRememberedCredentials,
  canPersistPassword,
} from "@/lib/rememberLogin";

interface LoginPageProps {
  onLogin: (token: string, user: any) => void;
  /** 是否为客户端模式（Electron / Android / 曾配置过服务器地址） */
  isClientMode?: boolean;
  onDisconnect?: () => void;
}

type Mode = "login" | "register";

// 体验环境配置（仅 demo 站点构建时通过 VITE_DEMO_MODE=true 开启；自部署用户默认 false）。
// 账号/密码可通过 VITE_DEMO_USERNAME / VITE_DEMO_PASSWORD 覆盖，未设置时使用默认值。
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const DEMO_USERNAME = import.meta.env.VITE_DEMO_USERNAME || "demo";
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD || "demo123456";

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

export default function LoginPage({ onLogin, isClientMode = false, onDisconnect }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>("login");
  // 登录页外层滚动容器 ref（软键盘适配用，见下方 useEffect）
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // 登录页键盘适配 —— 直接复用全站既有的原生键盘事件链，**不要再自己用
  // visualViewport 推断键盘高度**（推断在 Android `Keyboard.resize: "none"`
  // 下不稳，会出现"露白"或残留 padding）。
  //
  // 实现方式：
  //   1) `useKeyboardLayout()`：注册 Capacitor 原生 `keyboardWillShow/Hide`
  //      事件，事件回调里把 `info.keyboardHeight` 写入 CSS 变量
  //      `--keyboard-height` 和 `data-keyboard` 属性。这是从原生层拿到的
  //      **精确像素**，与 WebView CSS 视口无关，跨 Android/iOS 一致。
  //      AppLayout（登录后）也调用了同一个 hook —— 没有冲突，各自 add/remove
  //      自己的 listener。**登录页必须独立调一次**，否则没人写 CSS 变量。
  //   2) `useKeyboardVisible()`：MutationObserver 监听 html 上 CSS 变量
  //      变化，把 `{ visible, height }` 转成 React state 供本组件用。
  //
  // 为什么之前的 `visualViewport.height` 方案不行？
  //   - 在 Android `Keyboard.resize: "none"` 下，WebView 全屏不缩，但
  //     `visualViewport.height` 也**不一定缩**（取决于 WebView 版本/厂商定制
  //     —— 部分 ROM 上 visualViewport 完全不感知键盘）。原生事件是唯一稳的源。
  //   - 上一版用 `maxHeight = visualViewport.height` 让外层容器只占屏幕上方，
  //     容器下方到屏幕底之间露出 body 背景（≈白色），就是截图里的"红框白块"。
  useKeyboardLayout();
  const { height: keyboardHeight } = useKeyboardVisible();
  const { siteConfig } = useSiteSettings();
  const icpBeianText = siteConfig.icpBeian?.trim() || "";
  const showIcpBeian = !!icpBeianText && !isNativeClientRuntime();

  // 【Android/iOS 关键修复】主动把 focused input 滚到容器可视区上 1/4 处。
  //
  // 背景：
  //   - 全局 CSS `html, body, #root { overflow: hidden }` 禁止了文档级滚动，
  //     因此必须在 LoginPage 外层 div 自己挂 overflow-y-auto 作为滚动容器。
  //   - Android WebView 下，浏览器自带的 focus-scrollIntoView **几乎不工作**,
  //     尤其是可滚动祖先不是 document 而是内部 div 时；iOS 相对稳但也有抖动。
  //   - 原生 `el.scrollIntoView({ block: "center" })` 会向上冒泡到**最近的**
  //     可滚动祖先 —— 就是我们的 scrollContainerRef —— 但在 Android WebView
  //     多次实测行为不可靠。因此直接**手动算 scrollTop**，跨平台最稳。
  //
  // 实现：
  //   1) 监听 document.focusin（冒泡，能捕获所有 input/textarea focus）；
  //   2) 同时监听 visualViewport.resize（键盘弹起/收起触发的视口变化）；
  //   3) 延迟 80ms 等 keyboardHeight state & DOM 布局完成；
  //   4) 计算 scrollTop 让输入框出现在容器可视区上 1/4 处（非居中），留下
  //      3/4 给"登录按钮 + 底部提示"，避免按钮被键盘盖住。
  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scrollFocusedIntoView = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const container = scrollContainerRef.current;
        const el = document.activeElement as HTMLElement | null;
        if (
          !container ||
          !el ||
          (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA")
        ) {
          return;
        }
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        // 输入框相对容器顶部的偏移（含当前已滚动部分）
        const offsetTop = elRect.top - containerRect.top + container.scrollTop;
        // 目标：把输入框滚到可视区**上 1/4 处**（而非居中）。
        // 理由：登录表单里用户真正需要看到的是"当前输入框 + 其下方的
        // 登录按钮 + 底部提示"，不是输入框上方的 logo/标题。如果把 input
        // 居中（container.clientHeight / 2），下方只剩一半可视区，登录按钮
        // 往往被挤到键盘下方 —— 截图里"记住密码下方一大片空白、按钮不可见"
        // 就是这个原因。滚到 1/4 处留下 3/4 可视区给下方内容，按钮始终可见。
        const target = offsetTop - container.clientHeight * 0.25;
        const maxScroll = container.scrollHeight - container.clientHeight;
        const next = Math.max(0, Math.min(target, maxScroll));
        container.scrollTo({ top: next, behavior: "smooth" });
      }, 80);
    };
    document.addEventListener("focusin", scrollFocusedIntoView);
    const vv = window.visualViewport;
    if (vv) vv.addEventListener("resize", scrollFocusedIntoView);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("focusin", scrollFocusedIntoView);
      if (vv) vv.removeEventListener("resize", scrollFocusedIntoView);
    };
  }, []);
  // 服务器地址拆成 (protocol, host, port) 三段，避免用户手填整串 URL 出错；
  // 旧数据 localStorage 里是完整 URL，下方 useEffect 里用 parseServerUrl 回填
  const [serverParts, setServerParts] = useState<ServerAddressParts>({
    protocol: "http",
    host: "",
    port: "",
    path: "",
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // 密码明文/密文切换（登录 + 注册共用；确认密码独立一个开关）
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [serverStatus, setServerStatus] = useState<"idle" | "checking" | "ok" | "fail">("idle");
  const [diagResults, setDiagResults] = useState<DiagnosisResult[] | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState<boolean>(true);
  const [hasUsers, setHasUsers] = useState(false);
  // Phase 6: 2FA 两阶段登录 state —— 第一步（密码）成功后若后端返回 requires2FA,
  // 就暂存 ticket + 当前 baseUrl，切到 2FA 面板让用户输入 6 位动态码或恢复码。
  const [twoFactor, setTwoFactor] = useState<{
    ticket: string;
    username: string;
    baseUrl: string; // 用于 2fa/verify 的 origin，保持与登录阶段一致
  } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  // 「记住密码 / 自动登录」
  //   - rememberMe：登录成功后把密码加密保存；下次打开自动预填
  //   - autoLogin：在 rememberMe 基础上，打开 App 自动触发登录（无需再点按钮）
  //   - canSavePassword：当前运行环境是否能安全保存密码（Web=false，Electron 要看 safeStorage）
  //   - triedAutoLoginRef：确保"自动登录"只触发一次，避免失败后无限自动重试
  const [rememberMe, setRememberMe] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);
  const [canSavePassword, setCanSavePassword] = useState(false);
  const triedAutoLoginRef = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const { t } = useTranslation();

  // 回填上次的服务器地址（兼容旧版：localStorage 里可能存的是完整 URL 字符串）
  //
  // Electron 桌面端特殊处理：首次启动时 localStorage 里什么都没有，若走常规逻辑会
  // 展示一个空的"服务器地址"框，强迫用户先填才能登录 —— 但 Electron 本身就带一个
  // 本机内置后端（窗口加载的就是 http://127.0.0.1:<port>/），默认就该连它。
  // 因此若 Electron 检测到 nowenDesktop 且没有历史 serverUrl，用 window.location.origin
  // 作为默认地址预填。用户想连远程时清空 host 另填即可。
  useEffect(() => {
    if (!isClientMode) return;
    const saved = getServerUrl() || localStorage.getItem("nowen-server-url-last") || "";
    if (saved) {
      setServerParts(parseServerUrl(saved));
      setServerStatus("ok");
      return;
    }
    const isElectron = !!(window as any).nowenDesktop?.isDesktop;
    if (isElectron && window.location.origin.startsWith("http")) {
      setServerParts(parseServerUrl(window.location.origin));
      // 不主动标 ok —— 让用户按"登录"时再测，避免误判
    }
  }, [isClientMode]);

  // 拉取注册开关
  useEffect(() => {
    let cancelled = false;
    const baseUrl = isClientMode ? (getServerUrl() || "") : "";
    fetchRegisterConfig(baseUrl || undefined).then((cfg) => {
      if (!cancelled) setAllowRegistration(cfg.allowRegistration);
        setHasUsers(!!(cfg as any).hasUsers || Number((cfg as any).userCount || 0) > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [isClientMode, serverStatus]);

  // 探测当前环境是否能落盘密码（决定"记住密码"开关是否显示）
  useEffect(() => {
    let alive = true;
    canPersistPassword().then((v) => {
      if (alive) setCanSavePassword(v);
    });
    return () => { alive = false; };
  }, []);

  // 启动时读取"记住的凭据"→ 预填 + 视情况触发自动登录
  //
  // 关键：本 effect 只跑一次（mount），后续用户编辑不会再覆盖输入。
  //   - 仅当拿到非空凭... (truncated)