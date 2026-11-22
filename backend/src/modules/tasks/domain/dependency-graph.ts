/**
 * Task dependency graph helpers (pure).
 * An edge task -> dependsOn means "task cannot start until dependsOn is completed".
 */
export interface DependencyEdge {
  taskId: string;
  dependsOnId: string;
}

/**
 * Would setting `taskId`'s dependencies to `newDependsOn` create a cycle?
 * Returns the offending path (taskId … taskId) or null when the graph stays acyclic.
 * Iterative DFS, O(V + E).
 */
export function findCycle(edges: readonly DependencyEdge[], taskId: string, newDependsOn: readonly string[]): string[] | null {
  if (newDependsOn.includes(taskId)) return [taskId, taskId];
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    if (e.taskId === taskId) continue; // this task's old edges are being replaced
    graph.set(e.taskId, [...(graph.get(e.taskId) ?? []), e.dependsOnId]);
  }
  for (const start of newDependsOn) {
    const stack: { node: string; path: string[] }[] = [{ node: start, path: [taskId, start] }];
    const visited = new Set<string>();
    while (stack.length) {
      const { node, path } = stack.pop()!;
      if (node === taskId) return path;
      if (visited.has(node)) continue;
      visited.add(node);
      for (const next of graph.get(node) ?? []) stack.push({ node: next, path: [...path, next] });
    }
  }
  return null;
}

/** Topological order (dependencies first). Throws if the graph has a cycle. */
export function topologicalOrder(ids: readonly string[], edges: readonly DependencyEdge[]): string[] {
  const idSet = new Set(ids);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const dependents = new Map<string, string[]>();
  for (const e of edges) {
    if (!idSet.has(e.taskId) || !idSet.has(e.dependsOnId)) continue;
    indegree.set(e.taskId, (indegree.get(e.taskId) ?? 0) + 1);
    dependents.set(e.dependsOnId, [...(dependents.get(e.dependsOnId) ?? []), e.taskId]);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const dep of dependents.get(id) ?? []) {
      const n = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, n);
      if (n === 0) queue.push(dep);
    }
  }
  if (out.length !== ids.length) throw new Error('Dependency graph contains a cycle');
  return out;
}
