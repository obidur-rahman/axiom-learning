import type { RoadmapInput } from './types';
import type { Override } from './types';

/**
 * Apply the learner's Overrides to the base graph input before the build
 * (TRD 6.4, DEC-5). A rebuild re-runs this: the overrides are kept in order
 * and reapplied to the fresh base graph.
 */
export function applyOverrides(input: RoadmapInput, overrides: Override[]): RoadmapInput {
  const next: RoadmapInput = {
    topics: [...input.topics],
    edges: input.edges.map((e) => ({ ...e })),
    weights: { ...input.weights },
    excluded: [...input.excluded],
    known: [...input.known],
    bridgeDepth: input.bridgeDepth,
  };

  for (const override of overrides) {
    switch (override.action) {
      case 'mark_skip': {
        if (!next.excluded.includes(override.topicId)) {
          next.excluded.push(override.topicId);
        }
        break;
      }
      case 'restore': {
        next.excluded = next.excluded.filter((id) => id !== override.topicId);
        break;
      }
      case 'add_node': {
        if (!next.topics.some((t) => t.id === override.topic.id)) {
          next.topics.push(override.topic);
        }
        break;
      }
      case 'delete_node': {
        next.topics = next.topics.filter((t) => t.id !== override.topicId);
        next.edges = next.edges.filter(
          (e) => e.from !== override.topicId && e.to !== override.topicId,
        );
        delete next.weights[override.topicId];
        next.excluded = next.excluded.filter((id) => id !== override.topicId);
        next.known = next.known.filter((id) => id !== override.topicId);
        break;
      }
      case 'add_edge': {
        const edge = { ...override.edge };
        if (!next.edges.some((e) => e.from === edge.from && e.to === edge.to)) {
          next.edges.push(edge);
        }
        break;
      }
      case 'delete_edge': {
        next.edges = next.edges.filter(
          (e) => !(e.from === override.from && e.to === override.to),
        );
        break;
      }
    }
  }
  return next;
}
