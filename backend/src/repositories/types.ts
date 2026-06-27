/**
 * Repository 共享类型定义
 *
 * 职责：
 * - 定义 Repository 方法的参数/返回值类型
 * - 确保类型在整个项目中一致使用
 */

/** system_settings 表结构 */
export interface SystemSetting {
  key: string;
  value: string;
  updatedAt: string;
}

/** custom_fonts 表结构 */
export interface CustomFont {
  id: string;
  name: string;
  fileName: string;
  format: string;
  fileSize: number;
  createdAt: string;
}

/** api_tokens 表结构（完整记录） */
export interface ApiTokenRecord {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  scopes: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** api_tokens 列表项（不含 tokenHash） */
export interface ApiTokenListItem {
  id: string;
  name: string;
  scopes: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** api_token_usage 聚合行 */
export interface ApiTokenUsageRow {
  day: string;
  count: number;
}

/** 创建 api_token 输入 */
export interface CreateApiTokenInput {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  scopes: string[];
  expiresAt: string | null;
}
