import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { initDb, type DbDriver } from '../src';

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
  it('creates the schema v2 tables on a fresh database', async () => {
    const { driver, close } = realDriver();
    open.push(close);
    await initDb(driver);

    const version = await driver.select<{ value: string }>(
      "SELECT value FROM schema_meta WHERE key = 'schema_version'",
    );
    expect(version[0]?.value).toBe('2');

    const tables = await driver.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = tables.map((table) => table.name);
    expect(names).toContain('course_study_settings');
    expect(names).toContain('exam_questions');
    expect(names).toContain('exam_question_topics');
    expect(names).toContain('study_attempts');
    expect(names).toContain('lesson_documents');

    // New job types pass the rebuilt CHECK constraint.
    await driver.execute(
      "INSERT INTO jobs (id, job_type, payload) VALUES ('j1', 'extract_past_questions', '{}')",
    );
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
    expect(version[0]?.value).toBe('2');
  });
});
