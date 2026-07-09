# nowen-note

> A self-hosted private knowledge base, inspired by Synology Note Station.
>
> 自托管的私有知识库。[中文 README](./README.md) · [Author's Note](./AUTHOR_STORY.en.md) · [Live Demo](https://note.nowen.cn/)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-20%2B-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg?logo=docker&logoColor=white)](./Dockerfile)

## Features

- **Dual editor engines**: Tiptap 3 (rich text) + CodeMirror 6 (Markdown), sharing AI, version history, comments and other capabilities
- **AI assistant**: Works with Qwen / OpenAI / Gemini / DeepSeek / Doubao / Ollama — writing assist, title generation, tag suggestion, RAG Q&A
- **Knowledge management**: Unlimited-depth notebooks, color tags, tasks, mind maps, moments, FTS5 full-text search
- **Collaboration & history**: Shared links with 4 permission tiers (view / comment / edit / edit-with-login), guest comments, password / expiry, version rollback
- **File manager**: Image thumbnails (sharp webp at 240/480/960, ~100x bandwidth saving on dense galleries), "My uploads" view (referenced / unreferenced), orphan cleanup
- **Automation**: Sandboxed plugin system, Webhooks, audit log, scheduled auto-backup
- **Cross-platform**: Web / Electron (Win/macOS/Linux) / Android (Capacitor)
- **Developer ecosystem**: MCP Server, TypeScript SDK, CLI, [browser clipper extension](https://chromewebstore.google.com/detail/nowen-note-web-clipper/nglkodhfdbnfielchjpkjhenfaecafpg), OpenAPI 3.0 — see [`packages/`](./packages)

## Stack

React 18 · TypeScript · Vite 5 · Tiptap 3 · Tailwind · Hono 4 · SQLite(FTS5) · JWT · Electron 33 · Capacitor 8

## Screenshots

### Desktop

| AI writing assistant | AI provider settings |
| :---: | :---: |
| ![Desktop AI writing](./docs/screenshots/desktop-ai-writing.png) | ![AI settings](./docs/screenshots/settings-ai.png) |

### Mobile (Android / Capacitor)

| Sidebar | Note list | Editor |
| :---: | :---: | :---: |
| ![Mobile sidebar](./docs/screenshots/mobile-sidebar.png) | ![Mobile list](./docs/screenshots/mobile-list.png) | ![Mobile editor](./docs/screenshots/mobile-editor.png) |

## Live Demo

Don't want to self-host yet? Try the official demo site maintained by the author:

- URL: <https://note.nowen.cn/>
- Username: `demo`
- Password: `demo123456`

> ⚠ The demo account is for read-only evaluation. Data may be reset periodically — please do not store anything sensitive or important. For real use, self-host it via the Quick Start below.

## Quick Start

> Default admin: `admin` / `admin123`. Please change the password immediately after first login.

### Docker (recommended)

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
docker-compose up -d
```

Open `http://<your-ip>:3001`.

### Local development

Requires Node.js 20+.

```bash
git clone https://github.com/cropflre/nowen-note.git
cd nowen-note
npm run install:all
npm run dev:backend   # backend on :3001
npm run dev:frontend  # frontend on :5173
```

Open `http://localhost:5173`.

### Desktop / Mobile

```bash
npm run electron:dev      # Electron dev
npm run electron:build    # Package for Windows / macOS / Linux
```

For Android, download the APK directly from [Releases](https://github.com/cropflre/nowen-note/releases), or build it yourself with `npx cap sync android && npx cap open android`.

### fnOS (one-click .fpk install)

Grab the latest `nowen-note-x.y.z.fpk` from [Releases](https://github.com/cropflre/nowen-note/releases). On your fnOS NAS, open **App Center → Settings → Install app manually** and pick the file. After installation, click the "Nowen Note" icon on the desktop or open `http://<nas-ip>:3001` in your browser.

> The .fpk currently targets x86_64 fnOS only (`platform=x86`). To build it yourself, see [scripts/fpk/README.md](./scripts/fpk/README.md).

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Service port |
| `DB_PATH` | `/app/data/nowen-note.db` | Database file path |
| `OLLAMA_URL` | — | Local Ollama endpoint (optional) |

Data persistence: mount **`/app/data`** from the container to the host (not `/data`). The image declares `VOLUME ["/app/data"]`, so mainstream NAS panels will prefill this path.

Backup policy: auto-backups are written to `/app/data/backups` by default, sharing the same volume as the data. Following the 3-2-1 rule, it is strongly recommended to mount `/app/backups` to a separate disk and set `BACKUP_DIR=/app/backups` — see the inline notes in [`docker-compose.yml`](./docker-compose.yml).

## Documentation

- Browser clipper extension (Chrome / Edge): [Chrome Web Store](https://chromewebstore.google.com/detail/nowen-note-web-clipper/nglkodhfdbnfielchjpkjhenfaecafpg)
- Deployment guide (Local / Docker / Desktop / Mobile / Synology / UGREEN / QNAP / fnOS / ZSpace / ARM64): [docs/deployment.md](./docs/deployment.md)
- Attachment object storage (S3 / R2 / MinIO): [docs/object-storage.md](./docs/object-storage.md)
- fnOS .fpk packaging: [scripts/fpk/README.md](./scripts/fpk/README.md)
- ARM64 details: [docs/deploy-arm64.md](./docs/deploy-arm64.md)
- Email backup configuration: [docs/backup-email-smtp.md](./docs/backup-email-smtp.md)
- Editor mode switch: [docs/editor-mode-switch.md](./docs/editor-mode-switch.md)
- Privacy policy: [docs/PRIVACY.md](./docs/PRIVACY.md)
- OpenAPI: once running, visit `/api/openapi.json`

> 📚 **Tutorial Center**: [docs/tutorials/](./docs/tutorials/) — complete tutorials from quick start to advanced features

- **Getting Started**: [5-Minute Quick Start](./docs/tutorials/quick-start.md) · [UI Overview](./docs/tutorials/ui-overview.md) · [Create Your First Note](./docs/tutorials/first-note.md)
- **Note Management**: [Document Tree / Notebooks](./docs/tree-tutorial.md) · [Tags & Favorites](./docs/tutorials/tags-favorites.md) · [Search](./docs/tutorials/search.md)
- **Editor**: [Rich Text Editor](./docs/tutorials/editor-rich-text.md) · [Markdown Editor](./docs/tutorials/editor-markdown.md) · [Slash Commands](./docs/tutorials/slash-commands.md)
- **AI Features**: [AI Configuration](./docs/tutorials/ai-setup.md) · [AI Title & Tag Generation](./docs/tutorials/ai-title-tags.md) · [AI Summary](./docs/tutorials/ai-summary.md)
- **Mind Maps**: [Getting Started](./docs/tutorials/mindmap-intro.md) · [Generate from Note](./docs/tutorials/mindmap-from-note.md) · [Export](./docs/tutorials/mindmap-export.md)
- **Deployment**: [Docker](./docs/tutorials/docker-deploy.md) · [NAS](./docs/tutorials/nas-deploy.md) · [Backup & Migration](./docs/tutorials/backup-migrate.md)

## FAQ

### macOS: first launch error / won't start / "ERR_DLOPEN_FAILED"

Because this app is not Apple-notarized, macOS applies a quarantine attribute to the `.app` downloaded from the DMG, which causes the native `better-sqlite3` module to fail loading. The backend then hangs for 30 seconds and reports a startup timeout.

Run this one-liner in Terminal to remove the quarantine (adjust the path to wherever you placed the app):

```bash
sudo xattr -dr com.apple.quarantine "/Applications/Nowen Note.app"
# or
sudo xattr -dr com.apple.quarantine ~/Downloads/Nowen\ Note.app
```

After that, double-click to open it again. Apple Silicon users who downloaded the x64 build will need Rosetta 2 (the system will prompt you to install it automatically).

## Support

QQ group: `1093473044`

## Sponsor

If this project helps you, feel free to scan the QR code and buy the author a coffee.

<p align="center">
  <img src="./weixin.jpg" alt="WeChat sponsor QR" width="280" />
</p>

## License

[GPL-3.0](./LICENSE) — derivative works must also be distributed under GPL-3.0 and preserve the original copyright notice.

<!-- CHANGELOG:BEGIN -->
## 更新日志

> 最近 5 个版本的更新内容，完整历史见 [CHANGELOG.md](./CHANGELOG.md)。

### v1.3.1 - 2026-07-09

### ✨ 新增

- **editor**: 优化分屏拖拽 UI 并添加国际化支持 (b0fd101)
- **editor**: 支持分屏宽度拖拽调整、GFM任务复选框交互，优化标题保存逻辑 (96fe728)
- **editor**: 新增分屏拖拽和GFM任务复选框工具模块及测试 (da43c6f)
- **notebooks**: support drag reorder and per-level sort in notebook tree (50eeb2b)
- **notebooks**: add notebook tree sorting (c5b33ec)
- **tasks**: support delayed quick-add reminders (ff023b7)
- **editor**: add canvas image editor (62e627a)
- **editor**: add image action toolbar (a4e62b1)
- **tasks**: smart quick-add recognition (2e0ea40)
- **import**: safely preserve advanced Siyuan rich-text nodes (62e10c2)
- **import**: preserve Siyuan tables in rich-text import (19aab69)
- **import**: improve Siyuan rich-text tiptap fidelity (696e2c4)
- prompt for desktop data directory on first run (#168) (eab97d2)

### 🐛 修复

- **editor**: support line breaks in code blocks (d03a828)
- **editor**: copy image address with origin (c9e0852)
- **editor**: place image toolbar outside image (c179ae9)
- **editor**: keep note sort menu content aligned (327f392)
- **editor**: harden canvas image loading (57bf39c)
- **editor**: guard image replace target (f60fd65)
- **tasks**: require separators for smart recognition (a01d99c)
- 优化思源包导入服务与测试 (a88eb1f)
- guard siyuan zip entry and decompressed size budgets (4418a2c)
- add upload size limits for siyuan package import (891953a)
- keep backend bundle compatible with unzipper s3 helper (c3ed8c3)
- **import**: surface siyuan downgrade report and clean temp artifacts (9d81832)
- **import**: improve md rendering and downgrade reporting (a6c9781)
- **import**: support RT/MD siyuan media rendering (0305b28)
- **ci**: sync backend lockfile for npm ci (0b8551b)

### ✅ 测试

- cover backend siyuan package import (b5fe890)

### 🔧 其他

- 将开发期错误日志加入忽略列表 (84547a1)
- commit all local changes (b80bc3b)

### 📌 杂项

- 功能: 新增用户偏好设置接口与前端集成 (37a24b2)
- 功能: 接口层增加 Android 原生 HTTP 回退机制 (1a08701)
- 功能: AI 设置面板新增自定义 API 预设并优化 Ollama 预设 (8682237)

### v1.3.0 - 2026-07-07

_本版本无可展示的 commit 变更（可能全部是合并 / 工作流修改）_

### v1.2.9 - 2026-07-07

### ✨ 新增

- support custom desktop data directory (#168) (82babec)

### v1.2.8 - 2026-07-07

### ✨ 新增

- combine notebook tree expand toggle (5a283c6)
- add notebook tree expand collapse actions (#162) (add6eba)
- 标题输入框增加 IME 输入法状态感知，避免拼音串被误保存为标题 (9051ece)
- add browser-side size check and asset reference filtering for Siyuan import (fd6879a)

### 🐛 修复

- align notebook tree toggle icon state (3d37362)
- restore cross-device editor sync (da772b4)
- scroll markdown preview outline headings (#163) (b385fb9)
- support markdown default preview and siyuan callouts (#164) (4e94e0a)

### v1.2.7 - 2026-07-06

### ✨ 新增

- HTML 预览资源/大纲提取与编辑器联动优化 (8f46ae0)
- 任务重复/到期计算、导入导出、编辑器与任务面板优化 (25c6050)

<!-- CHANGELOG:END -->
