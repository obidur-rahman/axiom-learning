'use client';

import type { AxiomDb, DbDriver } from '@axiom/data';
import { createTauriDriver, createDb, initDb } from '@axiom/data';

/**
 * Access to the local database. Only meaningful inside the Tauri webview.
 * In a plain browser (e.g. `next dev` in Chrome), `isDesktopRuntime()` is
 * false and `getDb()` stays unused.
 */
export function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let instance: Promise<AxiomDb> | null = null;

export function getDb(): Promise<AxiomDb> {
  if (!isDesktopRuntime()) {
    return Promise.reject(new Error('The local database runs inside the desktop app only.'));
  }
  if (instance === null) {
    instance = (async () => {
      const driver: DbDriver = await createTauriDriver();
      await initDb(driver);
      return createDb(driver);
    })();
  }
  return instance;
}
