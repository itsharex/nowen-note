import type { Task } from "@/types";

/**
 * 树形任务节点：在 Task 基础上扩展 children 数组。
 * children 为空数组时表示叶子节点。
 */
export type TaskTreeNode = Task & { children: TaskTreeNode[] };

/**
 * 将平铺的 Task[] 构建为树形结构。
 *
 * 规则：
 *   - parentId 为空的作为根节点
 *   - 子节点按 parentId 挂载到对应父节点
 *   - 找不到父节点的孤儿任务归入根节点列表（防御性处理）
 *   - 同层节点保持原数组顺序（后端已排好序）
 */
export function buildTaskTree(tasks: Task[]): TaskTreeNode[] {
  const map = new Map<string, TaskTreeNode>();
  // 第一轮：创建所有节点，children 初始化为空数组
  for (const t of tasks) {
    map.set(t.id, { ...t, children: [] });
  }

  const roots: TaskTreeNode[] = [];

  for (const t of tasks) {
    const node = map.get(t.id)!;
    if (t.parentId && map.has(t.parentId)) {
      map.get(t.parentId)!.children.push(node);
    } else {
      // parentId 为空 或 父节点不在当前列表中 → 根节点
      roots.push(node);
    }
  }

  return roots;
}

/**
 * 计算单个任务节点的进度。
 *
 * 规则：
 *   - 无子任务：isCompleted=1 → 100，否则 → 0
 *   - 有子任务：递归计算所有子任务进度的平均值
 *   - 返回百分比整数（0-100）
 */
export function calculateTaskProgress(node: TaskTreeNode): {
  progress: number;
  completedChildren: number;
  totalChildren: number;
} {
  if (node.children.length === 0) {
    return {
      progress: node.isCompleted === 1 ? 100 : 0,
      completedChildren: 0,
      totalChildren: 0,
    };
  }

  let sum = 0;
  let completed = 0;
  for (const child of node.children) {
    sum += calculateTaskProgress(child).progress;
    if (child.isCompleted === 1) completed++;
  }

  return {
    progress: Math.round(sum / node.children.length),
    completedChildren: completed,
    totalChildren: node.children.length,
  };
}
