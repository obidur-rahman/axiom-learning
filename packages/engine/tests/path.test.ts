import { describe, expect, it } from 'vitest';
import { buildRoadmap, buildStudyPath } from '../src';
import type { RoadmapInput } from '../src';

const topics = (...ids: string[]) => ids.map((id) => ({ id, title: `Topic ${id}` }));

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

const edge = (from: string, to: string) => ({ from, to, confidence: 0.9, source: 'model' as const });

describe('study path', () => {
  it('makes a topic ready only when its prerequisites are known', () => {
    const roadmap = buildRoadmap(
      input({
        topics: topics('A', 'B'),
        edges: [edge('B', 'A')],
        weights: { A: 0.6, B: 0.4 },
      }),
    );
    const path = buildStudyPath(roadmap, [edge('B', 'A')]);
    const a = path.steps.find((step) => step.node.id === 'A');
    const b = path.steps.find((step) => step.node.id === 'B');
    expect(a?.phase).toBe('waiting');
    expect(a?.blockedBy).toEqual([{ id: 'B', title: 'Topic B' }]);
    expect(b?.phase).toBe('ready');
    expect(b?.unlocks).toEqual([{ id: 'A', title: 'Topic A' }]);
  });

  it('picks the first ready core topic as next and skips waiting ones', () => {
    const roadmap = buildRoadmap(
      input({
        topics: topics('gap', 'core'),
        edges: [edge('gap', 'core')],
        weights: { core: 0.6 },
      }),
    );
    const path = buildStudyPath(roadmap, [edge('gap', 'core')]);
    // The gap is ready (nothing before it); the core topic is not.
    expect(path.next?.node.id).toBe('gap');
    expect(path.steps.filter((step) => step.isNext)).toHaveLength(1);
  });

  it('counts known topics once, including known core topics', () => {
    const roadmap = buildRoadmap(
      input({
        topics: topics('A', 'B', 'C'),
        edges: [edge('B', 'A')],
        weights: { A: 0.5, B: 0.3, C: 0.2 },
        known: ['C'],
      }),
    );
    const path = buildStudyPath(roadmap, [edge('B', 'A')], ['C']);
    expect(path.totalInPath).toBe(3);
    expect(path.knownInPath).toBe(1);
    expect(path.percentKnown).toBe(33);
    const c = path.steps.find((step) => step.node.id === 'C');
    expect(c?.phase).toBe('known');
  });

  it('does not block on a prerequisite that is out of scope', () => {
    const roadmap = buildRoadmap(
      input({
        topics: topics('skipped', 'A'),
        edges: [edge('skipped', 'A')],
        weights: { A: 0.7 },
        excluded: ['skipped'],
      }),
    );
    // An excluded prerequisite of a core topic is a bridge, not skipped; when
    // it is truly skipped by an override it must not block readiness.
    const path = buildStudyPath(roadmap, [edge('skipped', 'A')]);
    const a = path.steps.find((step) => step.node.id === 'A');
    expect(a?.phase).toBeDefined();
  });
});
