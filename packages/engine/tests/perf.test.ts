import { describe, expect, it } from 'vitest';
import { buildRoadmap } from '../src';
import type { RoadmapInput } from '../src';

/**
 * NFR / TRD 6.5: a Roadmap of 200 nodes updates in less than 1 second.
 */
describe('performance (TRD 6.5)', () => {
  it('builds a 200-node roadmap in under 1 second', () => {
    const count = 200;
    const topics = Array.from({ length: count }, (_, i) => ({
      id: `t${i.toString().padStart(3, '0')}`,
      title: `Topic ${i}`,
    }));
    const edges = Array.from({ length: count - 1 }, (_, i) => ({
      from: topics[i]!.id,
      to: topics[i + 1]!.id,
      confidence: 0.8,
      source: 'model' as const,
    }));
    const input: RoadmapInput = {
      topics,
      edges,
      weights: { [topics[count - 1]!.id]: 0.7 },
      excluded: [],
      known: [],
      bridgeDepth: 2,
    };
    const started = performance.now();
    const roadmap = buildRoadmap(input);
    const elapsed = performance.now() - started;
    expect(roadmap.nodes).toHaveLength(count);
    expect(elapsed).toBeLessThan(ONE_SEC_MS);
  });
});

const ONE_SEC_MS = 1000;
