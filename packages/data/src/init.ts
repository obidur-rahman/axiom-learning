import type { DbDriver } from './driver';
import { MIGRATIONS } from './ddl';
import * as coursesRepo from './courses';
import * as materialsRepo from './materials';
import * as roadmapsRepo from './roadmaps';
import * as progressRepo from './progress';
import * as lessonsRepo from './lessons';

/**
 * Creates the schema if it does not exist. Migrations are idempotent
 * (CREATE TABLE IF NOT EXISTS), so this is safe on every app start.
 */
export async function initDb(driver: DbDriver): Promise<void> {
  // Delete cascades need this pragma per connection (SQLite default: off).
  await driver.execute('PRAGMA foreign_keys = ON');
  for (const statement of MIGRATIONS) {
    await driver.execute(statement);
  }
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
  };
}

export type AxiomDb = ReturnType<typeof createDb>;
