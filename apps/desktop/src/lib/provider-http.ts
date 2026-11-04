'use client';

import { setFetchImplementation } from '@axiom/ai';
import { isDesktopRuntime } from './tauri';

let installed: Promise<void> | null = null;

/**
 * Desktop model servers (LM Studio, Ollama) usually omit CORS headers, so the
 * webview's fetch rejects even when the server is up. Tauri's HTTP plugin
 * sends the request from Rust, where browser CORS does not apply. This is
 * idempotent and only active in the desktop runtime; a browser tab keeps its
 * normal fetch.
 */
export function installProviderFetch(): Promise<void> {
  if (!isDesktopRuntime()) return Promise.resolve();
  if (installed !== null) return installed;

  installed = (async () => {
    try {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      setFetchImplementation(tauriFetch as unknown as typeof fetch);
    } catch {
      // Leave the webview fetch in place; the probe will report the failure.
      installed = null;
    }
  })();

  return installed;
}
