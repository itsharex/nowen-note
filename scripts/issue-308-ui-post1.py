from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "scripts/issue-308-ui.py"
text = path.read_text(encoding="utf-8")
old = r'''  async getLatestEnabledByNotebookAsync(notebookId: string): Promise<NotebookShareLinkRecord | undefined> {
    return getAdapter().queryOne<NotebookShareLinkRecord>(`SELECT ${RECORD_COLUMNS} FROM notebook_share_links
      WHERE "notebookId" = ? AND enabled = 1 ORDER BY "createdAt" DESC LIMIT 1`, [notebookId]);
  },

  async disableAllByNotebookAsync(notebookId: string): Promise<void> {'''
new = r'''  async getByIdAsync(linkId: string): Promise<NotebookShareLinkRecord | undefined> {
    return getAdapter().queryOne<NotebookShareLinkRecord>(
      `SELECT ${RECORD_COLUMNS} FROM notebook_share_links WHERE id = ?`,
      [linkId],
    );
  },

  async getLatestEnabledByNotebookAsync(notebookId: string): Promise<NotebookShareLinkRecord | undefined> {
    return getAdapter().queryOne<NotebookShareLinkRecord>(`SELECT ${RECORD_COLUMNS} FROM notebook_share_links
      WHERE "notebookId" = ? AND enabled = 1 ORDER BY "createdAt" DESC LIMIT 1`, [notebookId]);
  },

  async updateAsync(linkId: string, input: {
    token?: string; role?: string; enabled?: number; expiresAt?: string | null;
    maxUses?: number | null; useCount?: number;
  }): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => { updates.push(sql); params.push(value); };
    if (input.token !== undefined) add("token = ?", input.token);
    if (input.role !== undefined) add("role = ?", input.role);
    if (input.enabled !== undefined) add("enabled = ?", input.enabled);
    if (input.expiresAt !== undefined) add('"expiresAt" = ?', input.expiresAt);
    if (input.maxUses !== undefined) add('"maxUses" = ?', input.maxUses);
    if (input.useCount !== undefined) add('"useCount" = ?', input.useCount);
    if (!updates.length) return;
    updates.push('"updatedAt" = datetime(\'now\')');
    params.push(linkId);
    await getAdapter().execute(
      `UPDATE notebook_share_links SET ${updates.join(", ")} WHERE id = ?`,
      params,
    );
  },

  async disableAllByNotebookAsync(notebookId: string): Promise<void> {'''
if old not in text:
    raise RuntimeError("async repository insertion marker missing")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("Issue #308 share-link async repository API preserved")
