import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDb, type DbDriver } from '@axiom/data';
import { buildLessonStep } from '../src';

/**
 * Lessons (task 6): retrieval by keyword score; JSON-mode lesson build;
 * save as the active lesson; 3-question check list; no-evidence rule.
 */
class FakeDriver implements DbDriver {
  constructor(private tables: Record<string, Record<string, unknown>[]>) {}
  calls: { sql: string; params: unknown[] }[] = [];
  async execute(sql: string, _params: unknown[] = []): Promise<number> {
    this.calls.push({ sql, params: _params });
    return 1;
  }
  async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params });
    const match = /from\s+([a-z_]+)/i.exec(sql);
    const table = match?.[1]?.toLowerCase() ?? '';
    const rows = this.tables[table] ?? [];
    if (/tools()/i.test(sql)) return [];
    return rows as T[];
  }
}

function lessonResponse(content: unknown) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], model: 'x' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const LESSON_JSON = {
  sections: [{ title: 'Big picture', markdown: 'Ohm law ties V, I, R. [p.1]' }],
  citations: [{ page: 1 }],
  checkQuestions: [
    { prompt: 'What does Ohm law relate?', answer: 'V, I and R.' },
    { prompt: 'Formula?', answer: 'V = IR.' },
    { prompt: 'Unit of R?', answer: 'Ohm.' },
    { prompt: 'Extra?', answer: 'extra' },
  ],
};

const PROVIDER_ROW = {
  base_url: 'http://localhost:11434', chat_model: 'c', embed_model: 'e', mode: 'local',
};

function makeDb() {
  const driver = new FakeDriver({
    provider_config: [PROVIDER_ROW],
    topics: [{ id: 'T1', title: 'Ohm law' }],
    material_pages: [
      { page_number: 1, text: 'Ohm law relates voltage and current.' },
      { page_number: 2, text: 'Completely unrelated cooking recipe text.' },
    ],
  });
  return createDb(driver);
}

afterEach(() => vi.unstubAllGlobals());

describe('buildLessonStep', () => {
  it('ranks pages by topic keywords, builds and saves the active lesson', async () => {
    const db = makeDb();
    const driver = db.driver as unknown as FakeDriver;
    vi.stubGlobal('fetch', vi.fn(async () => lessonResponse(LESSON_JSON)));
    const draft = await buildLessonStep(
      db.driver,
      'c1',
      'T1',
      async () => ({ baseUrl: 'http://localhost:11434', chatModel: 'c' }),
    );
    expect(draft.isGeneralContent).toBe(false);
    expect(draft.citations).toEqual([1]);
    expect(draft.checkQuestions).toHaveLength(3);
    expect(draft.contentMd).toContain('# Ohm law');
    // Retrieval happened over the course's material pages.
    const selectPages = driver.calls.find((call) => call.sql.includes('material_pages'));
    expect(selectPages).toBeDefined();
    // Saved as the active lesson for the topic.
    const insert = driver.calls.find((call) => call.sql.includes('INSERT INTO lessons'));
    expect(insert).toBeDefined();
  });

  it('throws a clear error when there is no material to ground on', async () => {
    const driver = new FakeDriver({
      provider_config: [PROVIDER_ROW],
      topics: [{ id: 'T1', title: 'Ohm law' }],
      material_pages: [],
    });
    await expect(
      buildLessonStep(
        driver,
        'c1',
        'T1',
        async () => ({ baseUrl: 'http://localhost:11434', chatModel: 'c' }),
      ),
    ).rejects.toThrow(/no material pages/i);
  });

  it('marked isGeneralContent when the model cites no pages', async () => {
    const driver = makeDb();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        lessonResponse({ ...LESSON_JSON, citations: [] }),
      ),
    );
    const draft = await buildLessonStep(
      driver.driver,
      'c1',
      'T1',
      async () => ({ baseUrl: 'http://localhost:11434', chatModel: 'c' }),
    );
    expect(draft.isGeneralContent).toBe(true);
    expect(draft.contentMd).toContain('could not find');
  });
});
