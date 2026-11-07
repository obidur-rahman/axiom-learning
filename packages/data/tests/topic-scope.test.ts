import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { upsertTopics } from '../src';
import type { DbDriver } from '../src';

function sqliteDriver(): DbDriver {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE courses (id TEXT PRIMARY KEY);
    CREATE TABLE topics (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      parent_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      syllabus_order INTEGER,
      source TEXT NOT NULL,
      shared_concept_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO courses (id) VALUES ('c1'), ('c2');
  `);
  return {
    async execute(sql, params = []) {
      // node:sqlite binds $1-style parameters by name; the app driver passes
      // them positionally, so translate for this test adapter.
      return Number(db.prepare(sql.replace(/\$\d+/g, '?')).run(...(params as never[])).changes);
    },
    async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      return db.prepare(sql.replace(/\$\d+/g, '?')).all(...(params as never[])) as T[];
    },
  };
}

it('keeps the topics of two courses apart in a real SQLite database', async () => {
  const db = sqliteDriver();
  await upsertTopics(db, 'c2', [{ id: 'c2:T1', title: 'Quantum Mechanics' }], 'syllabus');

  // A pre-fix T1 row for c1 is adopted, not duplicated.
  await db.execute("INSERT INTO topics (id, course_id, title, source) VALUES ('T1', 'c1', 'Old', 'syllabus')");
  const saved = await upsertTopics(db, 'c1', [{ id: 'c1:T1', title: 'Machine Learning' }], 'syllabus');
  expect(saved[0]!.id).toBe('T1');
  await upsertTopics(db, 'c1', [{ id: 'c1:T1', title: 'Machine Learning v2' }], 'syllabus');

  expect(await db.select('SELECT id, course_id, title FROM topics ORDER BY course_id')).toEqual([
    { id: 'T1', course_id: 'c1', title: 'Machine Learning v2' },
    { id: 'c2:T1', course_id: 'c2', title: 'Quantum Mechanics' },
  ]);
});
