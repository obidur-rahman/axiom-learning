import { removeCycles } from './cycles';
import type { NodeReason, NodeType, Roadmap, RoadmapInput, RoadmapNode } from './types';
import { RoadmapInputSchema } from './types';

/**
 * Build the Roadmap (TRD 6). Pure function, deterministic: same input gives
 * the same nodes in the same order.
 */
export function buildRoadmap(input: RoadmapInput): Roadmap {
  const parsed = RoadmapInputSchema.parse(input);
  const byId = new Map(parsed.topics.map((t) => [t.id, t]));
  if (byId.size !== parsed.topics.length) {
    throw new Error('duplicate topic id');
  }

  // Keep only edges whose endpoints exist, and remove cycles.
  const edges = removeCycles(
    parsed.edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to),
  );

  const excluded = new Set(parsed.excluded);
  const known = new Set(parsed.known);
  const weights = parsed.weights;

  // Rule 1: Core = weight above 0 and not excluded.
  const core = new Set<string>(
    parsed.topics.filter((t) => (weights[t.id] ?? 0) > 0 && !excluded.has(t.id)).map((t) => t.id),
  );

  // Reverse adjacency: for edge (u -> v), u is a prerequisite of v.
  const prerequisitesOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = prerequisitesOf.get(e.to) ?? [];
    list.push(e.from);
    prerequisitesOf.set(e.to, list);
  }

  // Rule 2: walk backward from each core along edges, stop at depth d,
  // stop at a Known topic. Found topics become Bridge unless core or known.
  // `seen` holds (topic, originating core) pairs so each (path, core) pair is
  // walked once, but a topic stays reachable through several cores.
  const maxDepth = parsed.bridgeDepth;
  const bridge = new Map<string, { depth: number; neededBy: Set<string> }>();
  const walk = (startId: string, startDepth: number, origin: string, seen: Set<string>) => {
    if (startDepth >= maxDepth) return;
    for (const p of prerequisitesOf.get(startId) ?? []) {
      const isCore = core.has(p);
      const isKnown = known.has(p);
      if (isKnown && !isCore) continue; // Known topic: stop the path (FR-177).
      const key = `${p}\u0000${origin}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!isCore) {
        const found = bridge.get(p) ?? { depth: Infinity, neededBy: new Set<string>() };
        found.depth = Math.min(found.depth, startDepth + 1);
        found.neededBy.add(origin);
        bridge.set(p, found);
      }
      walk(p, startDepth + 1, origin, seen);
    }
  };
  for (const coreId of core) {
    walk(coreId, 0, coreId, new Set());
  }

  const included = new Set<string>(core);
  for (const id of bridge.keys()) included.add(id);
  for (const id of known) if (byId.has(id) && !core.has(id)) included.add(id);

  const order = topologicalOrder(included, edges, weights);

  const nodes: RoadmapNode[] = [];
  for (const topic of parsed.topics) {
    const id = topic.id;
    const weight = weights[id] ?? 0;
    let type: NodeType;
    let reason: NodeReason;
    let neededBy: string[] = [];
    let depth = 0;
    if (core.has(id)) {
      type = 'core';
      reason = 'EXAM_TOPIC';
    } else if (bridge.has(id)) {
      type = 'bridge';
      // Rule 3: an excluded topic stays bridge when a core topic needs it.
      reason = excluded.has(id) ? 'EXCLUDED' : 'NEEDED_BY';
      neededBy = [...bridge.get(id)!.neededBy].sort();
      depth = bridge.get(id)!.depth;
    } else if (known.has(id)) {
      type = 'known';
      reason = 'KNOWN';
    } else {
      type = 'skipped';
      reason = excluded.has(id) ? 'EXCLUDED' : 'LOW_WEIGHT';
    }
    nodes.push({
      id,
      title: topic.title,
      type,
      reason,
      neededBy,
      depth,
      order: order.get(id) ?? 0,
      weight,
      isKnown: known.has(id),
    });
  }

  return { nodes, version: 0 };
}

/**
 * Topological order (TRD 6.2 rule 6): prerequisites first, tiebreak by
 * higher weight, then id for a stable sort. Kahn selection with a scan
 * keeps the code simple and is fast enough for thousands of nodes.
 */
export function topologicalOrder(
  included: Set<string>,
  edges: { from: string; to: string }[],
  weights: Record<string, number>,
): Map<string, number> {
  const includedEdges = edges.filter(
    (e) => included.has(e.from) && included.has(e.to) && e.from !== e.to,
  );
  const indegree = new Map<string, number>();
  for (const id of included) indegree.set(id, 0);
  for (const e of includedEdges) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);

  const ready = [...included].filter((id) => (indegree.get(id) ?? 0) === 0);
  const order = new Map<string, number>();
  while (ready.length > 0) {
    ready.sort((a, b) => {
      const wdiff = (weights[b] ?? 0) - (weights[a] ?? 0);
      if (wdiff !== 0) return wdiff;
      return a < b ? -1 : 1;
    });
    const id = ready.shift()!;
    order.set(id, order.size);
    for (const e of includedEdges) {
      if (e.from === id) {
        const deg = (indegree.get(e.to) ?? 0) - 1;
        indegree.set(e.to, deg);
        if (deg === 0) ready.push(e.to);
      }
    }
  }
  // Leftover nodes (input edge cleanup removed some links) go last.
  for (const id of included) {
    if (!order.has(id)) order.set(id, order.size);
  }
  return order;
}

/**
 * Does any included node depend on `topicId`? Used before a delete to show
 * the warning that TRD 6.4 requires (FR-053).
 */
export function findDependents(
  input: RoadmapInput,
  topicId: string,
): { id: string; title: string; type: NodeType }[] {
  const roadmap = buildRoadmap(input);
  const dependentIds = new Set(
    input.edges.filter((e) => e.from === topicId).map((e) => e.to),
  );
  return roadmap.nodes
    .filter(
      (n) =>
        dependentIds.has(n.id) &&
        n.id !== topicId &&
        (n.type === 'core' || n.type === 'bridge' || n.type === 'known'),
    )
    .map((n) => ({ id: n.id, title: n.title, type: n.type }));
}
