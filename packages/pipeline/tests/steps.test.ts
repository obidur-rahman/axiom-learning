import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb, initDb, type DbDriver } from '@axiom/data';
import {
  PipelineError,
  buildRoadmapStep,
  buildTopicsStep,
  countMentions,
  providerConfigLoader,
} from '../src';

/** Same select/execute behavior as packages/data tests, copied for isolation. */
class FakeDriver implements DbDriver {
  calls: { sql: string; params: unknown[] }[] = [];
  constructor(private tables: Record<string, Record<string, unknown>[]>) {}
  async execute(sql: string, params: unknown[] = []): Promise<number> {
    this.calls.push({ sql, params });
    // Minimal write-simulation so read-after-write steps see the rows.
    if (sql.includes('INSERT INTO topics') || sql.includes('REPLACE INTO topics')) {
      this.tables['topics']!.push({
        id: String(params[0]),
        course_id: String(params[1]),
        title: String(params[2]),
        syllabus_order: Number(params[3]),
        created_at: new Date().toISOString(),
      });
    } else if (sql.includes('UPDATE topics SET title')) {
      const row = (this.tables['topics'] ?? []).find((row) => row['id'] === params[3]);
      if (row) {
        row['title'] = params[0];
        row['syllabus_order'] = params[1];
      }
    } else if (sql.includes('REPLACE INTO topic_weights')) {
      this.tables['topic_weights']!.push({ topic_id: String(params[0]), weight: Number(params[6]) });
    } else if (sql.includes('INSERT INTO topic_edges')) {
      this.tables['topic_edges']!.push({
        prerequisite_id: String(params[2]),
        topic_id: String(params[3]),
        confidence: Number(params[4]),
        source: String(params[5]),
      });
    } else if (sql.includes("DELETE FROM topic_edges WHERE course_id")) {
      this.tables['topic_edges'] = [];
    } else if (sql.includes('INSERT INTO roadmap_versions')) {
      this.tables['roadmap_versions']!.push({ version: Number(params[2]) });
    }
    return 1;
  }
  async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params });
    const match = /from\s+([a-z_]+)/i.exec(sql);
    const table = match?.[1]?.toLowerCase() ?? '';
    const rows = this.tables[table] ?? [];
    if (/select\s+count\(\*\)\s+as\s+c\s+from\s+([a-z_]+)\s+where\s+id\s*=\s*\$1/i.test(sql)) {
      const countTable = /count\(\*\)\s+as\s+c\s+from\s+([a-z_]+)/i.exec(sql)![1]!;
      const stored = this.tables[countTable] ?? [];
      return [{ c: stored.filter((row) => row['id'] === params[0]).length } as unknown as T];
    }
    if (/from\s+topics\s+where\s+id\s*=\s*\$1/i.test(sql)) {
      return (this.tables['topics'] ?? []).filter((row) => row['id'] === params[0]) as T[];
    }
    const maxInc = /select\s+coalesce\(max\(([a-z_]+)\),\s*0\)\s*\+\s*1\s+as\s+([a-z_]+)\s+from\s+([a-z_]+)/i.exec(sql);
    if (maxInc) {
      let max = 0;
      for (const row of this.tables[maxInc[3]!.toLowerCase()] ?? []) {
        const value = row[maxInc[1]!];
        if (typeof value === 'number' && value > max) max = value;
      }
      return [{ [maxInc[2]!]: max + 1 } as unknown as T];
    }
    return rows as T[];
  }
}

interface ChatBody {
  choices?: { message?: { content?: string } }[];
  model?: string;
}

function chatResponse(content: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
      model: 'test-chat',
    } satisfies ChatBody),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const course = {
  id: 'c1', title: 'Circuit Analysis', level: 'university' as const,
  language: 'mixed' as const, examDate: null, isPremade: false, clonedFrom: null,
  bridgeDepth: 2, status: 'processing' as const, createdAt: '2026-11-03T10:00:00.000Z',
};

const PROVIDER_ROW = {
  base_url: 'http://localhost:11434', chat_model: 'test-chat', embed_model: 'emb', mode: 'local',
};

function makeCtx(extra: Record<string, Record<string, unknown>[]> = {}, provider = [PROVIDER_ROW]) {
  const driver = new FakeDriver({ provider_config: provider, ...extra });
  const db = createDb(driver);
  return {
    db,
    driver,
    ctx: {
      db,
      course,
      config: providerConfigLoader(db),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildTopicsStep', () => {
  it('extracts topics, saves them, and writes syllabus weights', async () => {
    const { db, driver, ctx } = makeCtx({ topics: [], topic_weights: [], roadmap_versions: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        chatResponse({ topics: [{ id: 'T1', title: 'Ohm law' }, { id: 'T2', title: 'RC circuits' }] }),
      ),
    );
    const topics = await buildTopicsStep(ctx, [{ text: 'Page content about Ohm law.' }]);
    expect(topics).toHaveLength(2);
    expect(topics.map((topic) => topic.id)).toEqual(['c1:T1', 'c1:T2']);
    const inserts = driver.calls.filter((call) => call.sql.includes('INSERT INTO topics'));
    expect(inserts).toHaveLength(2);
    expect(driver.calls.some((call) => call.sql.includes('REPLACE INTO topic_weights'))).toBe(true);
    expect(db).toBeDefined();
  });

  it('fails with the provider reason when no provider is set', async () => {
    const { driver, ctx } = makeCtx({}, []);
    await expect(buildTopicsStep(ctx, [{ text: 'x' }])).rejects.toMatchObject({
      name: 'PipelineError',
      reason: 'provider',
    });
    expect(driver.calls.filter((call) => call.sql.startsWith('INSERT'))).toHaveLength(0);
  });

  it('accepts a bare topic array and still shows the object shape to the model', async () => {
    const { ctx } = makeCtx({ topics: [], topic_weights: [], roadmap_versions: [] });
    let systemPrompt = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          messages?: { role: string; content: string }[];
        };
        systemPrompt = body.messages?.[0]?.content ?? '';
        return chatResponse([
          { id: 'T1', title: 'Ohm law' },
          { id: 'T2', title: 'RC circuits' },
        ]);
      }),
    );
    const topics = await buildTopicsStep(ctx, [{ text: 'Ohm law and RC circuits.' }]);
    expect(topics.map((topic) => topic.title)).toEqual(['Ohm law', 'RC circuits']);
    expect(systemPrompt).toContain('"topics"');
  });

  it('retries and then throws schema after three bad model answers', async () => {
    const { ctx } = makeCtx({ topics: [], topic_weights: [], roadmap_versions: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => chatResponse({ nothing: 'useful' })),
    );
    await expect(buildTopicsStep(ctx, [{ text: 'Page one.' }])).rejects.toBeInstanceOf(
      PipelineError,
    );
  });
});

describe('countMentions', () => {
  it('counts whole-word occurrences case-insensitively', () => {
    expect(countMentions('Ohm law', 'OHM LAW first, then ohm law again'))
      .toBe(2);
    expect(countMentions('RC circuits', 'no mentions here')).toBe(0);
  });
});

describe('buildRoadmapStep', () => {
  it('uses model edges and saves a roadmap version', async () => {
    const { db, driver, ctx } = makeCtx({
      topics: [
        { id: 'T1', title: 'Ohm law', syllabus_order: 1 },
        { id: 'T2', title: 'RC circuits', syllabus_order: 2 },
      ],
      user_progress: [],
      topic_edges: [],
      roadmap_versions: [],
      roadmap_nodes: [],
      node_overrides: [],
      exam_scope_rules: [],
      topic_weights: [{ topic_id: 'T2', weight: 0.2 }],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        chatResponse({ edges: [{ from: 'T1', to: 'T2', confidence: 0.9 }] }),
      ),
    );
    const { version } = await buildRoadmapStep(ctx);
    expect(version).toBe(1);
    const edgeInserts = driver.calls.filter((call) => call.sql.includes('INSERT INTO topic_edges'));
    expect(edgeInserts).toHaveLength(1);
    expect(edgeInserts[0]!.params[2]).toBe('T1');
    expect(edgeInserts[0]!.params[3]).toBe('T2');
    const nodeInserts = driver.calls.filter((call) => call.sql.includes('INSERT INTO roadmap_nodes'));
    expect(nodeInserts).toHaveLength(2);
    void db;
  });

  it('rebuilds with user edges only when the model keeps failing', async () => {
    const { driver, ctx } = makeCtx({
      topics: [
        { id: 'T1', title: 'Ohm law', syllabus_order: 1 },
        { id: 'T2', title: 'RC circuits', syllabus_order: 2 },
      ],
      user_progress: [],
      topic_edges: [
        { prerequisite_id: 'T1', topic_id: 'T2', confidence: 0.9, source: 'user' },
      ],
      roadmap_versions: [],
      roadmap_nodes: [],
      node_overrides: [],
      exam_scope_rules: [],
      topic_weights: [{ topic_id: 'T2', weight: 0.2 }],
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server down', { status: 500 })));
    const { version } = await buildRoadmapStep(ctx);
    expect(version).toBe(1);
    const edgeInserts = driver.calls.filter((call) => call.sql.includes('INSERT INTO topic_edges'));
    expect(edgeInserts).toHaveLength(1);
    expect(edgeInserts[0]!.params[5]).toBe('user');
  });
});

describe('pipeline init', () => {
  it('initDb runs fine through the shared createDb helper', async () => {
    const driver = new FakeDriver({});
    await initDb(driver);
    expect(driver.calls[0]!.sql).toBe('PRAGMA foreign_keys = ON');
  });
});
