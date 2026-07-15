from pathlib import Path

# The compatibility migration wrapper already owns v45-v47. Move this feature to v48,
# make the test cleanup resilient, use a real notebook collaborator fixture, and make
# idempotent replays win over the now-stale expected version.
backend_script_path = Path(".github/issue-165-backend.py")
backend_script = backend_script_path.read_text(encoding="utf-8")
backend_script = backend_script.replace(
    "  // v45: 通用块索引、幂等块操作与来源块级双链。",
    "  // v48: 通用块索引、幂等块操作与来源块级双链。",
    1,
)
backend_script = backend_script.replace(
    '    version: 45,\n    name: "knowledge-block-index-and-source-links",',
    '    version: 48,\n    name: "knowledge-block-index-and-source-links",',
    1,
)
backend_script = backend_script.replace("  closeDb();", "  if (closeDb) closeDb();", 1)
backend_script = backend_script.replace(
    '''  const { note, userId } = required;
  if (note.isLocked) return c.json({ error: "Note is locked", code: "NOTE_LOCKED" }, 403);
  if (note.version !== body.expectedNoteVersion) {
    return c.json({ error: "Version conflict", code: "VERSION_CONFLICT", currentVersion: note.version }, 409);
  }

  const cached = readIdempotentResult(userId, body.operationId);
  if (cached) return c.json({ ...cached as any, idempotentReplay: true });''',
    '''  const { note, userId } = required;
  const cached = readIdempotentResult(userId, body.operationId);
  if (cached) return c.json({ ...cached as any, idempotentReplay: true });

  if (note.isLocked) return c.json({ error: "Note is locked", code: "NOTE_LOCKED" }, 403);
  if (note.version !== body.expectedNoteVersion) {
    return c.json({ error: "Version conflict", code: "VERSION_CONFLICT", currentVersion: note.version }, 409);
  }''',
    1,
)
backend_script = backend_script.replace(
    '''  db.prepare("INSERT INTO notebooks (id, userId, name) VALUES (?, ?, ?)").run(notebookId, owner, "Knowledge");
  db.prepare(`INSERT INTO notes (id, userId, notebookId, title, content, contentText, contentFormat)''',
    '''  db.prepare("INSERT INTO notebooks (id, userId, name) VALUES (?, ?, ?)").run(notebookId, owner, "Knowledge");
  db.prepare("INSERT INTO notebook_members (id, notebookId, userId, role, status, invitedBy) VALUES (?, ?, ?, ?, 'active', ?)")
    .run("knowledge-notebook-member", notebookId, viewer, "viewer", owner);
  db.prepare(`INSERT INTO notes (id, userId, notebookId, title, content, contentText, contentFormat)''',
    1,
)
backend_script_path.write_text(backend_script, encoding="utf-8")

path = Path(".github/issue-165-client.py")
source = path.read_text(encoding="utf-8")

# Replace the fragile whole-tool MCP search patch with marker-based slicing.
start_marker = "replace_once(\n    \"packages/nowen-mcp/src/index.ts\",\n    '''server.tool(\n  \"nowen_search\","
start = source.index(start_marker)
end_marker = '''    "MCP note/block search",
)
'''
end = source.index(end_marker, start) + len(end_marker)
search_replacement = r"""mcp_index_path = Path("packages/nowen-mcp/src/index.ts")
mcp_index_source = mcp_index_path.read_text(encoding="utf-8")
search_start = mcp_index_source.index('server.tool(\n  "nowen_search",')
search_end_marker = '\n);\n\n// ==================== 标签工具'
search_end = mcp_index_source.index(search_end_marker, search_start) + len('\n);')
new_search_tool = r'''server.tool(
  "nowen_search",
  "搜索笔记或块；块级搜索会返回稳定 blockId",
  {
    query: z.string().describe("搜索关键词"),
    level: z.enum(["note", "block"]).optional().describe("搜索层级，默认 note"),
    notebookId: z.string().optional().describe("块级搜索时限定笔记本"),
    limit: z.number().int().positive().max(200).optional().describe("块级结果上限"),
  },
  async ({ query, level, notebookId, limit }) => {
    try {
      if (level === "block") {
        const blocks = await api.searchBlocks(query, { notebookId, limit: limit || 50 });
        return { content: [{ type: "text" as const, text: `找到 ${blocks.length} 个块:\n${JSON.stringify(blocks, null, 2)}` }] };
      }
      const results = await api.search(query);
      const summary = results.map((r: any) => ({
        id: r.id,
        title: r.title,
        snippet: r.snippet,
        notebookId: r.notebookId,
        updatedAt: r.updatedAt,
      }));
      return {
        content: [{ type: "text" as const, text: `找到 ${results.length} 条结果:\n${JSON.stringify(summary, null, 2)}` }],
      };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `错误: ${err.message}` }], isError: true };
    }
  }
);'''
mcp_index_path.write_text(
    mcp_index_source[:search_start] + new_search_tool + mcp_index_source[search_end:],
    encoding="utf-8",
)
"""
source = source[:start] + search_replacement + source[end:]

source = source.replace(
    "'''       types: [\"heading\"],'''",
    "'''      types: [\"heading\"],'''",
    1,
)
source = source.replace(
    "'''       types: [\"heading\", \"paragraph\", \"listItem\", \"taskItem\", \"blockquote\", \"codeBlock\"],'''",
    "'''      types: [\"heading\", \"paragraph\", \"listItem\", \"taskItem\", \"blockquote\", \"codeBlock\"],'''",
    1,
)

label_pos = source.index('    "backlink panel excerpt",')
block_start = source.rfind("replace_once(", 0, label_pos)
block_end = source.index(")\n", label_pos) + 2
backlink_replacement = '''backlinks_path = Path("frontend/src/components/BacklinksPanel.tsx")
backlinks_source = backlinks_path.read_text(encoding="utf-8")
backlink_anchor = "\\n".join([
    "                      </div>",
    "                    </div>",
    "                  </div>",
    "                </motion.button>",
])
backlink_output = "\\n".join([
    "                      </div>",
    "                      {(item.excerpt || item.linkText) && (",
    "                        <p className=\\\"mt-1.5 text-xs leading-5 text-tx-secondary line-clamp-3\\\">",
    "                          {item.excerpt || item.linkText}",
    "                        </p>",
    "                      )}",
    "                    </div>",
    "                  </div>",
    "                </motion.button>",
])
if backlinks_source.count(backlink_anchor) != 1:
    raise SystemExit(f"backlink panel excerpt: expected one JSX anchor, got {backlinks_source.count(backlink_anchor)}")
backlinks_path.write_text(backlinks_source.replace(backlink_anchor, backlink_output, 1), encoding="utf-8")
'''
source = source[:block_start] + backlink_replacement + source[block_end:]

api_contract_patch = r'''
api_impl_path = Path("frontend/src/lib/api.impl.ts")
api_impl_source = api_impl_path.read_text(encoding="utf-8")
api_old = """        sourceNoteId: string;
        title: string;
        updatedAt: string;
        linkText: string | null;
        linkType: string;
        targetBlockId: string | null;
        excerpt: string | null;"""
api_new = """        sourceNoteId: string;
        sourceBlockId: string | null;
        sourceNotebookId: string;
        title: string;
        updatedAt: string;
        linkText: string | null;
        linkType: \"note\" | \"block\";
        targetBlockId: string | null;
        excerpt: string | null;"""
if api_impl_source.count(api_old) != 1:
    raise SystemExit(f"backlink API contract: expected one match, got {api_impl_source.count(api_old)}")
api_impl_path.write_text(api_impl_source.replace(api_old, api_new, 1), encoding="utf-8")
'''
print_pos = source.rfind('print("issue 165 client patch applied")')
source = source[:print_pos] + api_contract_patch + "\n" + source[print_pos:]

path.write_text(source, encoding="utf-8")
print("issue 165 idempotency, shared fixture and client patches normalized")
