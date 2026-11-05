import type { DbDriver } from './driver';
import { MIGRATIONS, REBUILD_JOBS_MIGRATION } from './ddl';
import * as coursesRepo from './courses';
import * as materialsRepo from './materials';
import * as roadmapsRepo from './roadmaps';
import * as progressRepo from './progress';
import * as lessonsRepo from './lessons';
import * as questionsRepo from './questions';
import * as studyRepo from './study';
import * as lessonDocsRepo from './lesson-docs';

const SCHEMA_VERSION = 2;

async function tableExists(driver: DbDriver, name: string): Promise<boolean> {
  const rows = await driver.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = $1",
    [name],
  );
  return rows.length > 0;
}

/**
 * Creates or upgrades the schema. The original tables use CREATE IF NOT
 * EXISTS; version 2 adds the adaptive-study tables and rebuilds the job queue
 * because SQLite cannot alter a CHECK constraint in place.
 */
export async function initDb(driver: DbDriver): Promise<void> {
  // Delete cascades need this pragma per connection (SQLite default: off).
  await driver.execute('PRAGMA foreign_keys = ON');
  await driver.execute(
    `CREATE TABLE IF NOT EXISTS schema_meta (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );`,
  );

  const versionRows = await driver.select<{ value: string }>(
    "SELECT value FROM schema_meta WHERE key = 'schema_version'",
  );
  let version = versionRows[0] ? Number(versionRows[0].value) : 0;
  const existingJobs = await tableExists(driver, 'jobs');

  for (const statement of MIGRATIONS) {
    await driver.execute(statement);
  }

  if (version === 0) {
    // A database that already has tables is an original install. A fresh one
    // already has the new job CHECK because MIGRATIONS ran above.
    version = existingJobs ? 1 : SCHEMA_VERSION;
  }

  if (version < 2) {
    for (const statement of REBUILD_JOBS_MIGRATION) {
      await driver.execute(statement);
    }
    version = 2;
  }

  await driver.execute(
    `REPLACE INTO schema_meta (key, value) VALUES ('schema_version', $1)`,
    [String(version)],
  );
}

/** All repositories bound to one driver. */
export function createDb(driver: DbDriver) {
  return {
    driver,
    courses: coursesRepo,
    materials: materialsRepo,
    roadmaps: roadmapsRepo,
    progress: progressRepo,
    lessons: lessonsRepo,
    questions: questionsRepo,
    study: studyRepo,
    lessonDocs: lessonDocsRepo,
  };
}

export type AxiomDb = ReturnType<typeof createDb>;
