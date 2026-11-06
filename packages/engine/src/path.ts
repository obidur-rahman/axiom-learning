import type { Roadmap, RoadmapNode } from './types';

/**
 * The roadmap graph is not a plan. This turns it into one: each topic is
 * either ready to study now, waiting on a prerequisite, already known, or out
 * of scope, and the first ready core topic is the next thing to do.
 *
 * Pure and deterministic, like the builder, so the screen and the tests agree.
 */
export type StudyPhase = 'ready' | 'waiting' | 'known';

export interface StudyPathStep {
  node: RoadmapNode;
  phase: StudyPhase;
  /** Included prerequisites that are not known yet. */
  blockedBy: { id: string; title: string }[];
  /** Included topics that become ready once this one is known. */
  unlocks: { id: string; title: string }[];
  /** True for the one step the learner should open next. */
  isNext: boolean;
}

export interface StudyPath {
  steps: StudyPathStep[];
  counts: { core: number; bridge: number; known: number; skipped: number; ready: number };
  totalInPath: number;
  knownInPath: number;
  knownCore: number;
  percentKnown: number;
  next: StudyPathStep | null;
}

export function buildStudyPath(
  roadmap: Roadmap,
  edges: { from: string; to: string }[],
  extraKnown: readonly string[] = [],
): StudyPath {
  const byId = new Map(roadmap.nodes.map((node) => [node.id, node]));
  const known = new Set(extraKnown);
  for (const node of roadmap.nodes) {
    if (node.isKnown || node.type === 'known') known.add(node.id);
  }

  const prerequisitesOf = new Map<string, string[]>();
  const dependentsOf = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const prerequisites = prerequisitesOf.get(edge.to) ?? [];
    prerequisites.push(edge.from);
    prerequisitesOf.set(edge.to, prerequisites);

    const dependents = dependentsOf.get(edge.from) ?? [];
    dependents.push(edge.to);
    dependentsOf.set(edge.from, dependents);
  }

  const included = roadmap.nodes.filter((node) => node.type !== 'skipped');
  const toRefs = (ids: string[], currentId: string) =>
    ids
      .filter((id) => id !== currentId)
      .map((id) => byId.get(id))
      .filter((entry): entry is RoadmapNode => entry !== undefined)
      .filter((entry) => entry.type !== 'skipped' && !known.has(entry.id))
      .map((entry) => ({ id: entry.id, title: entry.title }));

  const steps: StudyPathStep[] = included.map((node) => {
    const blockedBy = toRefs(prerequisitesOf.get(node.id) ?? [], node.id);
    const unlocks = toRefs(dependentsOf.get(node.id) ?? [], node.id);
    const phase: StudyPhase = known.has(node.id)
      ? 'known'
      : blockedBy.length === 0
        ? 'ready'
        : 'waiting';
    return { node, phase, blockedBy, unlocks, isNext: false };
  });
  steps.sort((a, b) => a.node.order - b.node.order);

  const next =
    steps.find((step) => step.phase === 'ready' && step.node.type === 'core') ??
    steps.find((step) => step.phase === 'ready') ??
    null;
  if (next !== null) next.isNext = true;

  const totalInPath = included.length;
  const knownInPath = steps.filter((step) => step.phase === 'known').length;
  return {
    steps,
    counts: {
      core: roadmap.nodes.filter((node) => node.type === 'core').length,
      bridge: roadmap.nodes.filter((node) => node.type === 'bridge').length,
      known: knownInPath,
      skipped: roadmap.nodes.filter((node) => node.type === 'skipped').length,
      ready: steps.filter((step) => step.phase === 'ready').length,
    },
    totalInPath,
    knownInPath,
    knownCore: steps.filter((step) => step.phase === 'known' && step.node.type === 'core').length,
    percentKnown: totalInPath === 0 ? 0 : Math.round((knownInPath / totalInPath) * 100),
    next,
  };
}
