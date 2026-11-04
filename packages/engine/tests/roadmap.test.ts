import { describe, expect, it } from 'vitest';
import { buildRoadmap, computeWeights, findDependents, removeCycles } from '../src';
import type { RoadmapInput } from '../src';

const t = (...ids: string[]) => ids.map((id) => ({ id, title: id }));

function edge(from: string, to: string, confidence = 0.8) {
  return { from, to, confidence, source: 'model' as const };
}

function input(partial: Partial<RoadmapInput>): RoadmapInput {
  return {
    topics: [],
    edges: [],
    weights: {},
    excluded: [],
    known: [],
    bridgeDepth: 2,
    ...partial,
  };
}

const ONE_SEC = 1000;

describe('roadmap pruning rules (TRD 6)', () => {
  it('marks an excluded prerequisite of a core topic as Bridge (TRD 6.2 rule 3)', () => {
    const roadmap = buildRoadmap(
      input({
        topics: t('A', 'B'),
        edges: [edge('B', 'A')],
        weights: { A: 0.5 },
        excluded: ['B'],
      }),
    );
    const a = roadmap.nodes.find((n) => n.id === 'A');
    const b = roadmap.nodes.find((n) => n.id === 'B');
    expect(a?.type).toBe('core');
    expect(b?.type).toBe('bridge');
    expect(b?.reason).toBe('EXCLUDED');
    expect(b?.neededBy).toEqual(['A']);
  });

  it('keeps the prerequisites of a Known bridge topic out of the Roadmap (FR-177)', () => {
    const roadmap = buildRoadmap(
      input({
        topics: t('A', 'B', 'C'),
        edges: [edge('C', 'B'), edge('B', 'A')],
        weights: { A: 0.5 },
        known: ['B'],
      }),
    );
    const b = roadmap.nodes.find((n) => n.id === 'B');
    const c = roadmap.nodes.find((n) => n.id === 'C');
    expect(b?.type).toBe('known');
    expect(c?.type).toBe('skipped');
    expect(c?.reason).toBe('LOW_WEIGHT');
  });

  it('removes a cycle by dropping the lowest-confidence edge (TRD 5.5 step 5)', () => {
    const edges = [edge('A', 'B', 0.9), edge('B', 'C', 0.8), edge('C', 'A', 0.4)];
    const remaining = removeCycles(edges);
    expect(remaining).toHaveLength(2);
    expect(remaining.map((e) => e.from + '>' + e.to)).toEqual(
      expect.arrayContaining(['A>B', 'B>C']),
    );
  });

  it('topological sort lists prerequisites before dependents (FR-042)', () => {
    const roadmap = buildRoadmap(
      input({
        topics: t('chain', 'A', 'B', 'C'),
        edges: [edge('A', 'B'), edge('B', 'C')],
        weights: { chain: 0.6, C: 0.5 },
      }),
    );
    const order = new Map(roadmap.nodes.map((n) => [n.id, n.order]));
    expect(order.get('A')!).toBeLessThan(order.get('B')!);
    expect(order.get('B')!).toBeLessThan(order.get('C')!);
  });

  it('puts higher-weight nodes first on equal topological rank', () => {
    const roadmap = buildRoadmap(
      input({
        topics: t('X', 'Y'),
        weights: { X: 0.2, Y: 0.9 },
      }),
    );
    const order = new Map(roadmap.nodes.map((n) => [n.id, n.order]));
    expect(order.get('Y')!).toBeLessThan(order.get('X')!);
  });

  it('warns with the dependents before a deleting a needed prerequisite (FR-053)', () => {
    const base = input({
      topics: t('A', 'B'),
      edges: [edge('B', 'A')],
      weights: { A: 0.5 },
    });
    const dependents = findDependents(base, 'B');
    expect(dependents.map((d) => d.id)).toEqual(['A']);
    expect(buildRoadmap(base).nodes.find((n) => n.id === 'B')?.type).toBe('bridge');
  });
});

describe('bridge depth (FR-044)', () => {
  it('respects the depth limit of the backward walk', () => {
    const topics = t('A', 'B', 'C', 'D');
    const edges = [edge('D', 'C'), edge('C', 'B'), edge('B', 'A')];
    const atDepth1 = buildRoadmap(
      input({ topics, edges, weights: { A: 1 }, bridgeDepth: 1 }),
    );
    expect(atDepth1.nodes.find((n) => n.id === 'B')?.type).toBe('bridge');
    expect(atDepth1.nodes.find((n) => n.id === 'C')?.type).toBe('skipped');
    const atDepth2 = buildRoadmap(
      input({ topics, edges, weights: { A: 1 }, bridgeDepth: 2 }),
    );
    expect(atDepth2.nodes.find((n) => n.id === 'C')?.type).toBe('bridge');
    expect(atDepth2.nodes.find((n) => n.id === 'D')?.type).toBe('skipped');
    const atDepth3 = buildRoadmap(
      input({ topics, edges, weights: { A: 1 }, bridgeDepth: 3 }),
    );
    expect(atDepth3.nodes.find((n) => n.id === 'D')?.type).toBe('bridge');
  });
});

describe('weight computation (TRD 5.4)', () => {
  it('follows 0.5*past + 0.3*suggested + 0.2*syllabus and forces excluded to 0', () => {
    const weights = computeWeights(t('H', 'M', 'L', 'X'), {
      pastQuestionCounts: { H: 10, M: 5 },
      suggested: ['M'],
      inSyllabus: ['L'],
      excluded: ['X'],
    });
    expect(weights.H).toBeCloseTo(0.5);
    expect(weights.M).toBeCloseTo(0.25 + 0.3);
    expect(weights.L).toBeCloseTo(0.2);
    expect(weights.X).toBe(0);
  });
});
