import type { DbDriver } from './driver';

/**
 * Drive the database through the Tauri sqlite plugin. Only import this
 * inside a Tauri webview: it dynamically loads the plugin package, so a
 * plain browser bundle does not crash on load.
 */
export async function createTauriDriver(dbName = 'axiom.db'): Promise<DbDriver> {
  const mod = await import('@tauri-apps/plugin-sql');
  const Database = mod.default;
  const db = await Database.load(`sqlite:${dbName}`);
  return {
    execute: async (sql, params = []) => {
      const result = await db.execute(sql, params);
      return result.rowsAffected ?? 0;
    },
    select: <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      return db.select<Record<string, unknown>>(sql, params) as unknown as Promise<T[]>;
    },
  };
}
