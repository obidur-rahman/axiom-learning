import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCourse,
  getProviderSettings,
  initDb,
  listProviderFallbacks,
  resetCourse,
  saveProviderFallbacks,
  saveProviderSettings,
  type DbDriver,
} from '../src';

// Node ships a synchronous SQLite binding; it is the closest thing to the
// Tauri plugin inside a unit test, so the migration path is exercised for real.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { DatabaseSync } = require('node:sqlite') as any;

function realDriver(): { driver: DbDriver; close: () => void } {
  const db = new DatabaseSync(':memory:');
  // The app's driver uses $1 placeholders (Tauri SQLite); node:sqlite binds
  // anonymous parameters, so translate and order them for the test only.
  const convert = (sql: string, params: unknown[]) => {
    const ordered: unknown[] = [];
    const text = sql.replace(/\$(\d+)/g, (_match, index: string) => {
      ordered.push(params[Number(index) - 1]);
      return '?';
    });
    return { text, ordered };
  };
  const driver: DbDriver = {
    async execute(sql: string, params: unknown[] = []): Promise<number> {
      const { text, ordered } = convert(sql, params);
      const result = db.prepare(text).run(...ordered);
      return Number(result.changes ?? 0);
    },
    async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const { text, ordered } = convert(sql, params);
      return db.prepare(text).all(...ordered) as T[];
    },
  };
  return { driver, close: () => db.close() };
}

const open: (() => void)[] = [];
afterEach(() => {
  for (const close of open.splice(0)) close();
});

describe('schema migration', () => {
  it('creates the schema v4 tables on a fresh database', async () => {
    const { driver, close } = realDriver();
    open.push(close);
    await initDb(driver);

    const version = await driver.select<{ value: string }>(
      "SELECT value FROM schema_meta WHERE key = 'schema_version'",
    );
    expect(version[0]?.value).toBe('4');

    const tables = await driver.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = tables.map((table) => table.name);
    expect(names).toContain('course_study_settings');
    expect(names).toContain('exam_questions');
    expect(names).toContain('exam_question_topics');
    expect(names).toContain('study_attempts');
    expect(names).toContain('lesson_documents');
    expect(names).toContain('provider_fallbacks');

    // New job types pass the rebuilt CHECK constraint.
    await driver.execute(
      "INSERT INTO jobs (id, job_type, payload) VALUES ('j1', 'extract_past_questions', '{}')",
    );

    // Per-role model columns exist from the first install.
    const providerColumns = await driver.select<{ name: string }>('PRAGMA table_info(provider_config)');
    const providerNames = providerColumns.map((column) => column.name);
    expect(providerNames).toContain('ocr_model');
    expect(providerNames).toContain('single_model_mode');
    expect(providerNames).toContain('auto_unload');
  });

  it('rebuilds an original jobs table without losing queued rows', async () => {
    const { driver, close } = realDriver();
    open.push(close);
    await driver.execute(`CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL CHECK (job_type IN (
        'read_material','build_topics','make_chunks','link_and_weight',
        'find_prerequisites','build_roadmap','build_lesson','make_practice','make_diagnostic')),
      course_id TEXT,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','done','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      run_after TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      locked_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      finished_at TEXT
    );`);
    await driver.execute(
      "INSERT INTO jobs (id, job_type, payload, status) VALUES ('old1', 'make_chunks', '{}', 'queued')",
    );

    await initDb(driver);

    const rows = await driver.select<{ id: string; job_type: string }>('SELECT id, job_type FROM jobs');
    expect(rows).toEqual([{ id: 'old1', job_type: 'make_chunks' }]);

    const indexes = await driver.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'jobs_queue_idx'",
    );
    expect(indexes).toHaveLength(1);

    await driver.execute(
      "INSERT INTO jobs (id, job_type, payload) VALUES ('new1', 'generate_questions', '{}')",
    );
    const count = await driver.select<{ c: number }>('SELECT COUNT(*) AS c FROM jobs');
    expect(Number(count[0]?.c)).toBe(2);

    const version = await driver.select<{ value: string }>(
      "SELECT value FROM schema_meta WHERE key = 'schema_version'",
    );
    expect(version[0]?.value).toBe('4');
  });

  it('round-trips fallback profiles in priority order', async () => {
    const { driver, close } = realDriver();
    open.push(close);
    await initDb(driver);

    const first = {
      id: 'f1',
      label: 'Groq key 2',
      baseUrl: 'https://api.groq.com/openai/v1',
      chatModel: 'openai/gpt-oss-20b',
      ocrModel: 'qwen/qwen3.8-27b',
      embedModel: null,
      mode: 'hosted' as const,
      ocrThink: false,
      chatThink: false,
      ocrMaxEdge: 1400,
      ocrMaxTokens: 1024,
      singleModelMode: true,
      autoUnload: true,
      enabled: true,
      priority: 0,
    };
    const second = {
      ...first,
      id: 'f2',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      embedModel: 'text-embedding-3-small',
      enabled: false,
    };

    await saveProviderFallbacks(driver, [first, second]);
    expect(await listProviderFallbacks(driver)).toEqual([
      { ...first, priority: 0 },
      { ...second, priority: 1 },
    ]);

    // Rewriting replaces the list; order is the new priority.
    await saveProviderFallbacks(driver, [{ ...second, enabled: true, priority: 0 }, first]);
    const saved = await listProviderFallbacks(driver);
    expect(saved.map((row) => row.id)).toEqual(['f2', 'f1']);
    expect(saved[0]).toMatchObject({ label: 'OpenRouter', enabled: true, priority: 0 });
  });

  it('round-trips the per-role model settings through SQLite', async () => {
    const { driver, close } = realDriver();
    open.push(close);
    await initDb(driver);

    await saveProviderSettings(driver, {
      baseUrl: 'http://localhost:11434/v1',
      chatModel: 'qwen2.5:7b',
      ocrModel: 'qwen2.5vl:3b',
      embedModel: 'nomic-embed-text',
      mode: 'local',
      ocrThink: false,
      chatThink: true,
      ocrMaxEdge: 1024,
      ocrMaxTokens: 2048,
      singleModelMode: true,
      autoUnload: false,
    });

    expect(await getProviderSettings(driver)).toEqual({
      baseUrl: 'http://localhost:11434/v1',
      chatModel: 'qwen2.5:7b',
      ocrModel: 'qwen2.5vl:3b',
      embedModel: 'nomic-embed-text',
      mode: 'local',
      ocrThink: false,
      chatThink: true,
      ocrMaxEdge: 1024,
      ocrMaxTokens: 2048,
      singleModelMode: true,
      autoUnload: false,
    });
  });

  it('adds the v3 provider columns to a v2 database without losing settings', async () => {
    const { driver, close } = realDriver();
    open.push(close);
    // A v2 database has the original provider_config shape and version 2.
    await driver.execute(`CREATE TABLE provider_config (
      id TEXT PRIMARY KEY CHECK (id = 'default'),
      base_url TEXT NOT NULL,
      chat_model TEXT NOT NULL,
      embed_model TEXT,
      mode TEXT NOT NULL DEFAULT 'local' CHECK (mode IN ('local','hosted')),
      detected_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );`);
    await driver.execute(
      "INSERT INTO provider_config (id, base_url, chat_model, mode) VALUES ('default', 'http://localhost:11434', 'qwen2.5:7b', 'local')",
    );
    await driver.execute(
      "CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
    await driver.execute(
      "INSERT INTO schema_meta (key, value) VALUES ('schema_version', '2')",
    );

    await initDb(driver);

    const columns = await driver.select<{ name: string }>('PRAGMA table_info(provider_config)');
    const names = columns.map((column) => column.name);
    expect(names).toContain('ocr_model');
    expect(names).toContain('ocr_think');
    expect(names).toContain('ocr_max_edge');

    const rows = await driver.select<{ chat_model: string; single_model_mode: number }>(
      'SELECT chat_model, single_model_mode FROM provider_config',
    );
    expect(rows[0]?.chat_model).toBe('qwen2.5:7b');
    expect(rows[0]?.single_model_mode).toBe(1);
  });

  it('resets a course to an empty shell without deleting the course', async () => {
    const { driver, close } = realDriver();
    open.push(close);
    await initDb(driver);

    const course = await createCourse(driver, { title: 'Circuit Analysis' });
    const id = course.id;
    await driver.execute(
      "INSERT INTO materials (id, course_id, kind, page_count, status) VALUES ('m1', $1, 'notes', 1, 'ready')",
      [id],
    );
    await driver.execute(
      "INSERT INTO material_pages (id, material_id, page_number, extraction_method) VALUES ('p1', 'm1', 1, 'text_layer')",
    );
    await driver.execute(
      "INSERT INTO material_embeddings (material_id, page_number, vector, model) VALUES ('m1', 1, '[1,0]', 'e')",
    );
    await driver.execute(
      "INSERT INTO topics (id, course_id, title, source) VALUES ('t1', $1, 'Ohm law', 'notes')",
      [id],
    );
    await driver.execute(
      "INSERT INTO topics (id, course_id, title, source) VALUES ('t2', $1, 'RC circuits', 'notes')",
      [id],
    );
    await driver.execute(
      "INSERT INTO topic_edges (id, course_id, prerequisite_id, topic_id, source) VALUES ('e1', $1, 't1', 't2', 'model')",
      [id],
    );
    await driver.execute(
      "INSERT INTO topic_weights (topic_id, course_id) VALUES ('t1', $1)",
      [id],
    );
    await driver.execute(
      "INSERT INTO roadmap_versions (id, course_id, version, params, engine_version) VALUES ('r1', $1, 1, '{}', '1')",
      [id],
    );
    await driver.execute(
      "INSERT INTO roadmap_nodes (id, roadmap_version_id, topic_id, node_type, reason_code) VALUES ('n1', 'r1', 't1', 'core', 'EXAM_TOPIC')",
    );
    await driver.execute(
      "INSERT INTO lessons (id, scope, course_id, topic_id, language, depth, content_md) VALUES ('l1', 'course', $1, 't1', 'en', 'core', '## Ohm law')",
      [id],
    );
    await driver.execute(
      "INSERT INTO lesson_documents (lesson_id, structure_json, beat_count) VALUES ('l1', '{}', 1)",
    );
    await driver.execute(
      "INSERT INTO lesson_reports (id, lesson_id, reason) VALUES ('lr1', 'l1', 'wrong')",
    );
    await driver.execute(
      "INSERT INTO exam_questions (id, course_id, source, prompt) VALUES ('q1', $1, 'user', 'Explain Ohm law')",
      [id],
    );
    await driver.execute(
      "INSERT INTO exam_question_topics (question_id, topic_id) VALUES ('q1', 't1')",
    );
    await driver.execute(
      "INSERT INTO study_attempts (id, course_id, item_kind) VALUES ('a1', $1, 'recall')",
      [id],
    );
    await driver.execute(
      "INSERT INTO user_progress (course_id, topic_id, status) VALUES ($1, 't1', 'done')",
      [id],
    );
    await driver.execute(
      "INSERT INTO node_overrides (id, course_id, seq, action) VALUES ('o1', $1, 1, 'mark_skip')",
      [id],
    );
    await driver.execute(
      "INSERT INTO exam_scope_rules (id, course_id, rule_type) VALUES ('s1', $1, 'exclude')",
      [id],
    );
    await driver.execute(
      "INSERT INTO jobs (id, job_type, course_id, payload) VALUES ('j1', 'build_topics', $1, '{}')",
      [id],
    );
    await driver.execute(
      "INSERT INTO course_study_settings (course_id, profile, daily_minutes, has_past_papers, plan_version) VALUES ($1, 'adaptive', 45, 1, 3)",
      [id],
    );

    await resetCourse(driver, id);

    const emptied = [
      'jobs', 'study_attempts', 'exam_question_topics', 'exam_questions',
      'lesson_documents', 'lesson_reports', 'lessons', 'user_progress',
      'node_overrides', 'roadmap_nodes', 'roadmap_versions', 'exam_scope_rules',
      'topic_edges', 'topic_weights', 'topics', 'material_embeddings',
      'material_pages', 'materials',
    ];
    for (const table of emptied) {
      const rows = await driver.select<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`);
      expect(Number(rows[0]?.c), table).toBe(0);
    }

    const courses = await driver.select<{ title: string; status: string }>(
      'SELECT title, status FROM courses WHERE id = $1',
      [id],
    );
    expect(courses[0]).toEqual({ title: 'Circuit Analysis', status: 'draft' });

    const settings = await driver.select<{ has_past_papers: number; plan_version: number }>(
      'SELECT has_past_papers, plan_version FROM course_study_settings WHERE course_id = $1',
      [id],
    );
    expect(settings[0]?.has_past_papers).toBe(0);
    expect(settings[0]?.plan_version).toBe(4);
  });
});
