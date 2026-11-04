import type { PrerequisiteEdge } from './types';

/**
 * Find one cycle in the edge list with a DFS over the prerequisite graph.
 * Returns the cycle as a list of edges (e[i].from -> e[i].to), or null.
 */
export function findCycle(edges: PrerequisiteEdge[]): PrerequisiteEdge[] | null {
  const adjacency = new Map<string, PrerequisiteEdge[]>();
  for (const e of edges) {
    if (e.from === e.to) return [e];
    const list = adjacency.get(e.to) ?? [];
    list.push(e);
    adjacency.set(e.to, list);
  }

  const state = new Map<string, 'open' | 'closed'>();
  const path: PrerequisiteEdge[] = [];

  const visit = (node: string): PrerequisiteEdge[] | null => {
    const s = state.get(node);
    if (s === 'closed') return null;
    if (s === 'open') {
      // A cycle is the chain of edges from the first edge that *enters* this
      // node again to the end of the current path.
      const cycleStart = path.findIndex((e) => e.to === node);
      return path.slice(cycleStart);
    }
    state.set(node, 'open');
    for (const e of adjacency.get(node) ?? []) {
      path.push(e);
      const found = visit(e.from);
      path.pop();
      if (found) return found;
    }
    state.set(node, 'closed');
    return null;
  };

  for (const node of adjacency.keys()) {
    if (state.get(node) !== 'closed') {
      const cycle = visit(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * Remove dependency cycles (TRD 5.5 step 5): in each cycle, remove the edge
 * with the lowest confidence. Repeats until the graph is acyclic.
 */
export function removeCycles(edges: PrerequisiteEdge[]): PrerequisiteEdge[] {
  let current = edges.map((e) => ({ ...e }));
  for (let i = 0; i <= edges.length; i++) {
    const cycle = findCycle(current);
    if (!cycle) return current;
    let weakest = 0;
    for (let j = 1; j < cycle.length; j++) {
      if (cycle[j]!.confidence < cycle[weakest]!.confidence) weakest = j;
    }
    const removed = cycle[weakest]!;
    current = current.filter((e) => !(e.from === removed.from && e.to === removed.to));
  }
  return current;
}
