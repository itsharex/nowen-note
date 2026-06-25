# 桌面端文件夹同步

> 状态：MVP 已完成（DESKTOP-FOLDER-KB-SYNC-01）

## 功能范围

将本地文件夹中的文本文件同步到 Nowen 笔记本，支持手动和自动同步。

### 当前支持的文件类型

| 类型 | 导入方式 | 状态 |
|------|----------|------|
| `.md` / `.txt` / `.markdown` | 创建/更新笔记正文 | ✅ 已支持 |
| `.html` / `.htm` | 创建/更新笔记正文 | ✅ 已支持 |
| `.pdf` | 附件上传 + 索引笔记 + 文本提取（用于搜索） | ✅ 已支持 |
| `.docx` | 附件上传 + 索引笔记 + 文本提取（用于搜索） | ✅ 已支持 |
| 图片 | 不扫描 | ⏭️ 后续支持 |

### 当前不支持的能力

- Web 端本地文件夹同步（仅 Electron 桌面端）
- PDF/DOCX OCR（图片型 PDF 无法提取文本）
- 本地删除自动删除 Nowen 笔记/附件
- 文件系统实时监听（watcher）
- 系统后台服务 / 开机自启
- 向量库 / RAG / AI 知识库

## 安全设计

| 设计点 | 说明 |
|--------|------|
| Token 不落盘 | Electron 主进程不保存登录 token，上传由 renderer 带 token 完成 |
| 不传绝对路径 | 后端只接收 `relativePath`，`isUnsafePath` 拒绝盘符/`/`/`..` |
| sourcePathHash 命名空间 | `sha256(folderId + ":" + relativePath)`，不同文件夹同名文件不冲突 |
| 单文件限制 | 文本内容最大 2MB，超过标记 skipped |
| 忽略规则 | node_modules/.git/隐藏文件/临时文件/Thumbs.db 等 |
| 路径安全 | 拒绝扫描系统根目录和用户 home 目录 |

## 数据流

```
[用户点击"同步"] 或 [调度器到期]
    ↓
Electron: runNow → 扫描文件 → 计算 SHA-256 → 合并索引
    ↓
Electron: getPendingUploads → 读取文本文件内容
    ↓
Renderer: api.folderSync.importFile (带 token)
    ↓
后端: 创建/更新笔记 (contentFormat=markdown)
    ↓
Renderer: markUploadResult → 写回 noteId/lastSyncedAt/status
```

## 本地配置文件

位置：`{userData}/folder-sync.json`

```json
[
  {
    "folderId": "abc123",
    "folderPath": "D:\\知识库",
    "targetNotebookId": "uuid",
    "includeSubfolders": true,
    "fileTypes": [".md", ".txt", ".html", ".pdf", ".docx"],
    "enabled": true,
    "intervalMinutes": 30,
    "lastSyncedAt": "2026-06-24T12:00:00Z",
    "lastScanAt": "2026-06-24T12:00:00Z",
    "lastScanStats": { "total": 10, "added": 2, "changed": 1 },
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

## 本地索引文件

位置：`{userData}/folder-sync-index-{folderId}.json`

每个文件记录：
- `relativePath` — 相对路径
- `sha256` — 文件内容 hash
- `status` — new/unchanged/changed/deleted/synced/skipped/error
- `noteId` — 同步后对应的 Nowen 笔记 ID
- `lastSyncedAt` — 上次同步时间

## 后端导入接口

### `POST /api/folder-sync/import-file`

创建或更新笔记。纯 Markdown 正文，sync 元信息存为 HTML 注释。

### `POST /api/folder-sync/check-dedup`

批量检查 sourcePathHash 是否已存在。

### `folder_sync_files` 表

v32 迁移新增，存储 `sourcePathHash → noteId` 映射，用于去重和增量更新。

## 自动同步策略

| 条件 | 说明 |
|------|------|
| Electron 环境 | `window.nowenDesktop?.isDesktop` |
| 用户已登录 | `localStorage.nowen-token` 存在 |
| 页面可见 | `document.hidden === false` |
| 配置启用 | `config.enabled === true` |
| 有间隔 | `config.intervalMinutes > 0` |
| 已到期 | `now - lastSyncedAt >= intervalMinutes` |
| 无并发 | 同一 folderId 不重入，全局最多 1 个 |
| 失败冷却 | 失败后 5 分钟内不重试 |

自动同步不弹 toast，日志写入 `auto_sync_started/completed/failed`。

## 已知限制

1. 仅 Electron 桌面端，Web 不支持
2. 本地删除不会删除 Nowen 笔记和附件（标记 deleted）
3. 自动同步仅在 App 运行且用户已登录时生效
4. 不做系统后台服务、不做 watcher、不做开机自启
5. 同步是单向的：本地 → Nowen，不支持反向同步
6. 不支持 OCR，图片型 PDF 无法提取文本
7. PDF/DOCX 文本提取最多 200,000 字符，超出截断

## 后续计划

- 可选：双向同步 / 冲突合并
- 可选：文件系统监听（chokidar）
- 可选：OCR 支持（图片型 PDF）
