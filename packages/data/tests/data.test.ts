import { describe, expect, it } from 'vitest';
import {
  createCourse,
  createDb,
  getBaseInput,
  initDb,
  loadLatestRoadmap,
  loadOverrides,
  pageIsLowConfidence,
  replaceEdges,
  rowToCourse,
  rowToMaterial,
  setExcludedTopics,
  upsertTopics,
  upsertWeights,
  buildAndSaveRoadmap,
  addOverride,
  saveActiveLesson,
  getActiveLesson,
  type DbDriver,
} from '../src';
import type { Roadmap } from '@axiom/engine';

const COURSE_ROW = {
  id: 'c1', title: 'Circuit Analysis', level: 'university', language: 'mixed',
  exam_date: '2026-12-01', is_premade: 0, cloned_from: null, bridge_depth: 2,
  status: 'draft', created_at: '2026-11-03T10:00:00.000Z',
};

const MATERIAL_ROW = {
  id: 'm1', course_id: 'c1', kind: 'notes', file_path: '/f.pdf', mime_type: 'application/pdf',
  size_bytes: 1024, page_count: 3, status: 'ready', error_message: null,
  content_hash: 'h1', created_at: '2026-11-03T10:00:00.000Z',
};

interface Call { sql: string; params: unknown[] }

/** Records writes, and answers SELECTs from a table -> rows map. */
class FakeDriver implements DbDriver {
  calls: Call[] = [];
  constructor(private tables: Record<string, Record<string, unknown>[]>) {}
  async execute(sql: string, params: unknown[] = []): Promise<number> {
    this.calls.push({ sql, params });
    return 1;
  }
  async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params });
    // COUNT(*) gets computed in the app database; the fake computes it from
    // the stored rows so upsert-style COUNT checks behave like the real one.
    if (/select\s+count\(\*\)\s+as\s+c\s+from\s+([a-z_]+)\s+where\s+id\s*=\s*\$1/i.test(sql)) {
      const table = /count\(\*\)\s+as\s+c\s+from\s+([a-z_]+)/i.exec(sql)![1]!;
      const rows = this.tables[table] ?? [];
      return [{ c: rows.filter((row) => row['id'] === params[0]).length } as unknown as T];
    }
    // Topic lookups are by global primary key; honor the id so a course that
    // does not own another course's id sees it as free.
    if (/from\s+topics\s+where\s+id\s*=\s*\$1/i.test(sql)) {
      return (this.tables['topics'] ?? []).filter((row) => row['id'] === params[0]) as T[];
    }
    // Same for COALESCE(MAX(col), 0) + 1 AS alias (version/seq counters).
    const maxInc = /select\s+coalesce\(max\(([a-z_]+)\),\s*0\)\s*\+\s*1\s+as\s+([a-z_]+)\s+from\s+([a-z_]+)/i.exec(sql);
    if (maxInc) {
      const col = maxInc[1]!;
      const alias = maxInc[2]!;
      const table = maxInc[3]!.toLowerCase();
      let max = 0;
      for (const row of this.tables[table] ?? []) {
        const value = row[col];
        if (typeof value === 'number' && value > max) max = value;
      }
      return [{ [alias]: max + 1 } as unknown as T];
    }
    const match = /from\s+([a-z_]+)/i.exec(sql);
    const table = match?.[1]?.toLowerCase() ?? '';
    return (this.tables[table] ?? []) as T[];
  }
}

const sampleRoadmap: Roadmap = {
  version: 1,
  nodes: [
    { id: 't1', title: 'Ohm law', type: 'bridge', reason: 'NEEDED_BY',
      neededBy: ['t2'], depth: 1, order: 0, weight: 0, isKnown: false },
    { id: 't2', title: 'RC circuits', type: 'core', reason: 'EXAM_TOPIC',
      neededBy: [], depth: 0, order: 1, weight: 0.5, isKnown: false },
  ],
};

describe('init and migrations', () => {
  it('runs the foreign key pragma and every DDL statement', async () => {
    const fake = new FakeDriver({});
    await initDb(fake);
    await initDb(fake); // second start must be safe
    const sqlWithParams = fake.calls[0]!;
    expect(sqlWithParams.sql).toBe('PRAGMA foreign_keys = ON');
    expect(sqlWithParams.params).toEqual([]);
    expect(fake.calls.length).toBeGreaterThan(10);
  });
});

describe('courses and materials', () => {
  it('serializes a course insert and maps a row back', async () => {
    const fake = new FakeDriver({});
    const course = await createCourse(fake, { title: 'Circuit Analysis', language: 'mixed', examDate: '2026-12-01' });
    const insert = fake.calls[0]!;
    expect(insert.sql).toContain('INSERT INTO courses');
    expect(insert.params[1]).toBe('Circuit Analysis');
    expect(insert.params[0]).toEqual(course.id);
    expect(rowToCourse(COURSE_ROW).title).toBe('Circuit Analysis');
    expect(rowToCourse(COURSE_ROW).isPremade).toBe(false);
  });

  it('maps material rows with null-tolerant fields', () => {
    const material = rowToMaterial(MATERIAL_ROW);
    expect(material.status).toBe('ready');
    expect(material.pageCount).toBe(3);
    expect(rowToMaterial({ ...MATERIAL_ROW, page_count: null }).pageCount).toBeNull();
  });
});

describe('roadmap persistence', () => {
  const course = {
    id: 'c1', title: 'Circuit Analysis', level: 'university' as const,
    language: 'mixed' as const, examDate: null, isPremade: false, clonedFrom: null,
    bridgeDepth: 2, status: 'draft' as const, createdAt: '2026-11-03T10:00:00.000Z',
  };

  function baseDriver(): FakeDriver {
    return new FakeDriver({
      topics: [
        { id: 't1', course_id: 'c1', title: 'Ohm law', parent_id: null, syllabus_order: 1 },
        { id: 't2', course_id: 'c1', title: 'RC circuits', parent_id: null, syllabus_order: 2 },
      ],
      topic_edges: [
        { prerequisite_id: 't1', topic_id: 't2', confidence: 0.9, source: 'shared' },
      ],
      topic_weights: [
        { topic_id: 't1', weight: 0 },
        { topic_id: 't2', weight: 0.5 },
      ],
      exam_scope_rules: [],
      user_progress: [],
      node_overrides: [],
      roadmap_versions: [{ version: 2 }],
      roadmap_nodes: [],
    });
  }

  it('rebuilds the base graph input from the tables', async () => {
    const fake = baseDriver();
    const input = await getBaseInput(fake, course);
    expect(input.topics).toEqual([
      { id: 't1', title: 'Ohm law' },
      { id: 't2', title: 'RC circuits' },
    ]);
    expect(input.edges[0]).toMatchObject({ from: 't1', to: 't2', source: 'shared_table' });
    expect(input.weights).toEqual({ t1: 0, t2: 0.5 });
    expect(input.excluded).toEqual([]);
    expect(input.bridgeDepth).toBe(2);
  });

  it('builds and saves a roadmap as the next version, storing all nodes', async () => {
    const fake = baseDriver();
    const { version, roadmap } = await buildAndSaveRoadmap(fake, course);
    expect(version).toBe(3);
    expect(roadmap.nodes.map((n) => n.type)).toEqual(['bridge', 'core']);
    const versionInsert = fake.calls.find((call) => call.sql.includes('INSERT INTO roadmap_versions'));
    expect(versionInsert?.params[2]).toBe(3);
    const nodeInserts = fake.calls.filter((call) => call.sql.includes('INSERT INTO roadmap_nodes'));
    expect(nodeInserts).toHaveLength(2);
    expect(nodeInserts[0]!.params[5]).toBe(JSON.stringify(['t2']));
  });

  it('persists and reloads overrides in chronological order', async () => {
    const fake = new FakeDriver({
      node_overrides: [
        { payload: JSON.stringify({ action: 'mark_skip', topicId: 't1' }) },
        { payload: JSON.stringify({ action: 'add_edge', edge: { from: 't1', to: 't2', confidence: 0.7, source: 'model' } }) },
      ],
      roadmap_versions: [{ seq: 2 }],
    });
    await addOverride(fake, 'c1', { action: 'mark_skip', topicId: 't1' });
    const insert = fake.calls.find((call) => call.sql.includes('INSERT INTO node_overrides'))!;
    expect(insert).toBeDefined();
    expect(insert.params[2]).toBe(1); // seq after the two stored overrides
    const overrides = await loadOverrides(fake, 'c1');
    expect(overrides).toEqual([
      { action: 'mark_skip', topicId: 't1' },
      { action: 'add_edge', edge: { from: 't1', to: 't2', confidence: 0.7, source: 'model' } },
    ]);
  });

  it('loads a saved roadmap version back from the nodes table', async () => {
    const fake = new FakeDriver({
      roadmap_versions: [{ version: 3 }],
      roadmap_nodes: [
        { topic_id: 't1', node_type: 'bridge', reason_code: 'NEEDED_BY',
          needed_by: JSON.stringify(['t2']), depth: 1, order_index: 0, version: 3, weight: 0 },
        { topic_id: 't2', node_type: 'core', reason_code: 'EXAM_TOPIC',
          needed_by: JSON.stringify([]), depth: 0, order_index: 1, version: 3, weight: 0.5 },
      ],
    });
    const loaded = await loadLatestRoadmap(fake, 'c1');
    expect(loaded?.version).toBe(3);
    expect(loaded?.roadmap.nodes.map((n) => n.id)).toEqual(['t1', 't2']);
    expect(loaded?.roadmap.nodes[0]!.neededBy).toEqual(['t2']);
    expect(loaded?.roadmap.nodes[0]!.type).toBe('bridge');
  });

  it('marks excluded topics through the scope rules table', async () => {
    const fake = baseDriver();
    await setExcludedTopics(fake, 'c1', ['t1']);
    expect(fake.calls.some((call) => call.sql.includes("rule_type = 'exclude'"))).toBe(true);
    expect(fake.calls.some((call) => call.sql.includes("VALUES ($1, $2, $3, 'exclude'"))).toBe(true);
  });

  it('writes weights with the TRD 5.4 metadata', async () => {
    const fake = baseDriver();
    await upsertWeights(fake, 'c1', { t1: 0.75 }, { suggested: ['t1'], pastQuestionCounts: { t1: 2 } });
    const insert = fake.calls.find((call) => call.sql.includes('REPLACE INTO topic_weights'));
    expect(insert?.params[2]).toBe(2);
    expect(insert?.params[6]).toBe(0.75);
  });

  it('upserts topics without duplicating existing ids', async () => {
    const fake = baseDriver();
    await upsertTopics(fake, 'c1', [{ id: 't1', title: 'Ohm law (renamed)' }]);
    expect(fake.calls.some((call) => call.sql.includes('UPDATE topics'))).toBe(true);
    expect(fake.calls.some((call) => call.sql.includes('INSERT INTO topics'))).toBe(false);
  });

  it('never overwrites a topic id owned by another course', async () => {
    const fake = new FakeDriver({
      topics: [{ id: 'T1', course_id: 'c1', title: 'Ohm law' }],
    });
    const saved = await upsertTopics(fake, 'c2', [{ id: 'c2:T1', title: 'Quantum states' }]);
    expect(saved[0]!.id).toBe('c2:T1');
    expect(fake.calls.some((call) => call.sql.includes('UPDATE topics'))).toBe(false);
    const insert = fake.calls.find((call) => call.sql.includes('INSERT INTO topics'));
    expect(insert?.params[0]).toBe('c2:T1');
    expect(insert?.params[1]).toBe('c2');
  });

  it('adopts the legacy T1 row its own course already has', async () => {
    const fake = new FakeDriver({
      topics: [{ id: 'T1', course_id: 'c1', title: 'Old title' }],
    });
    const saved = await upsertTopics(fake, 'c1', [{ id: 'c1:T1', title: 'Ohm law' }]);
    expect(saved[0]!.id).toBe('T1');
    const update = fake.calls.find((call) => call.sql.includes('UPDATE topics'));
    expect(update?.params[3]).toBe('T1');
    expect(update?.params[4]).toBe('c1');
  });

  it('replaces the edge set in one shot', async () => {
    const fake = baseDriver();
    await replaceEdges(fake, 'c1', [
      { from: 't1', to: 't2', confidence: 0.6, source: 'manual' },
    ]);
    expect(fake.calls[0]!.sql).toContain('DELETE FROM topic_edges');
    const insert = fake.calls[1]!;
    expect(insert.sql).toContain('INSERT INTO topic_edges');
    expect(insert.params[5]).toBe('user');
  });
});

describe('progress and lessons', () => {
  it('writes known progress for the diagnostic flow', async () => {
    const fake = new FakeDriver({});
    const { setProgress } = createDb(fake).progress;
    await setProgress(fake, 'c1', 't1', 'known');
    const call = fake.calls[0]!;
    expect(call.sql).toContain('REPLACE INTO user_progress');
    expect(call.params[2]).toBe('known');
    expect(call.params[3]).not.toBeNull();
  });

  it('replaces the old active lesson and reloads it', async () => {
    const fake = new FakeDriver({});
    const saved = await saveActiveLesson(fake, {
      scope: 'course', courseId: 'c1', topicId: 't1', language: 'en', depth: 'bridge',
      contentMd: '## Ohm law', citations: [{ chunkId: 'ch1', page: 3 }], isGeneralContent: false,
    });
    expect(saved.status).toBe('active');
    expect(fake.calls[0]!.sql).toContain("SET status = 'replaced'");
    const insert = fake.calls[1]!;
    expect(insert.params[7]).toBe(JSON.stringify([{ chunkId: 'ch1', page: 3 }]));
  });

  it('returns no lesson when none is active', async () => {
    const fake = new FakeDriver({ lessons: [] });
    expect(await getActiveLesson(fake, 't1', 'en')).toBeNull();
  });
});

describe('helpers', () => {
  it('flags pages under the confidence threshold only', () => {
    expect(pageIsLowConfidence(0.5)).toBe(true);
    expect(pageIsLowConfidence(0.9)).toBe(false);
    expect(pageIsLowConfidence(null)).toBe(false);
  });
});
