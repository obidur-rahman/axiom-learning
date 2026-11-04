import { describe, expect, it } from 'vitest';
import { applyOverrides, buildRoadmap, findDependents } from '../src';
import type { Override, RoadmapInput } from '../src';

const t = (...ids: string[]) => ids.map((id) => ({ id, title: id }));

function edge(from: string, to: string, confidence = 0.8) {
  return { from, to, confidence, source: 'model' as const };
}

const BASE: RoadmapInput = {
  topics: t('A', 'B', 'C'),
  edges: [edge('B', 'A'), edge('C', 'A')],
  weights: { A: 0.5 },
  excluded: [],
  known: [],
  bridgeDepth: 2,
};

describe('overrides (TRD 6.4)', () => {
  it('a mark_skip override keeps a needed prerequisite as Bridge (TRD 6.2 rule 3)', () => {
    const overrides: Override[] = [{ action: 'mark_skip', topicId: 'C' }];
    const roadmap = buildRoadmap(applyOverrides(BASE, overrides));
    const c = roadmap.nodes.find((n) => n.id === 'C');
    expect(c?.type).toBe('bridge');
    expect(c?.reason).toBe('EXCLUDED');
  });

  it('a mark_skip override skips a topic that no core topic needs', () => {
    const overrides: Override[] = [{ action: 'mark_skip', topicId: 'S' }];
    const loner = {
      topics: t('A', 'S'),
      edges: [],
      weights: { A: 0.5 },
      excluded: [],
      known: [],
      bridgeDepth: 2,
    };
    const roadmap = buildRoadmap(applyOverrides(loner, overrides));
    const s = roadmap.nodes.find((n) => n.id === 'S');
    expect(s?.type).toBe('skipped');
    expect(s?.reason).toBe('EXCLUDED');
  });

  it('a restore override brings the topic back', () => {
    const overrides: Override[] = [
      { action: 'mark_skip', topicId: 'C' },
      { action: 'restore', topicId: 'C' },
    ];
    const roadmap = buildRoadmap(applyOverrides(BASE, overrides));
    expect(roadmap.nodes.find((n) => n.id === 'C')?.type).toBe('bridge');
  });

  it('a rebuild keeps the overrides (they stay applied)', () => {
    const overrides: Override[] = [{ action: 'mark_skip', topicId: 'A' }];
    const baseAfterEdit = applyOverrides(BASE, overrides);
    const first = buildRoadmap(applyOverrides(baseAfterEdit, []));
    const rebuilt = buildRoadmap(applyOverrides(BASE, overrides));
    expect(first.nodes.map((n) => [n.id, n.type])).toEqual(
      rebuilt.nodes.map((n) => [n.id, n.type]),
    );
    expect(rebuilt.nodes.find((n) => n.id === 'A')?.type).toBe('skipped');
  });

  it('add_node adds a skipped topic until a core topic needs it', () => {
    const overrides: Override[] = [
      { action: 'add_node', topic: { id: 'N', title: 'New node' } },
      { action: 'add_edge', edge: edge('N', 'A') },
    ];
    const roadmap = buildRoadmap(applyOverrides(BASE, overrides));
    const added = roadmap.nodes.find((n) => n.id === 'N');
    expect(added?.type).toBe('bridge');
    expect(added?.neededBy).toEqual(['A']);
  });

  it('delete_node removes the topic and its edges', () => {
    const overrides: Override[] = [{ action: 'delete_node', topicId: 'C' }];
    const next = applyOverrides(BASE, overrides);
    expect(next.topics.some((n) => n.id === 'C')).toBe(false);
    expect(next.edges.some((e) => e.from === 'C')).toBe(false);
    const roadmap = buildRoadmap(next);
    expect(roadmap.nodes.some((n) => n.id === 'C')).toBe(false);
  });

  it('delete_edge removes the prerequisite link and drops the node out', () => {
    const overrides: Override[] = [{ action: 'delete_edge', from: 'C', to: 'A' }];
    const roadmap = buildRoadmap(applyOverrides(BASE, overrides));
    expect(roadmap.nodes.find((n) => n.id === 'C')?.type).toBe('skipped');
  });

  it('findDependents returns the warning before a delete that breaks a prerequisite', () => {
    const dependents = findDependents(BASE, 'B');
    expect(dependents.map((d) => d.id)).toContain('A');
  });
});
