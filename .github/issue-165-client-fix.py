from pathlib import Path

path = Path(".github/issue-165-client.py")
source = path.read_text(encoding="utf-8")
start_marker = "replace_once(\n    \"packages/nowen-mcp/src/index.ts\",\n    '''server.tool(\n  \"nowen_search\","
start = source.index(start_marker)
end_marker = '''    "MCP note/block search",
)
'''
end = source.index(end_marker, start) + len(end_marker)
replacement = r"""mcp_index_path = Path("packages/nowen-mcp/src/index.ts")
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
path.write_text(source[:start] + replacement + source[end:], encoding="utf-8")
print("issue 165 client search patch fixed")
