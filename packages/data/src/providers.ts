import type { DbDriver } from './driver';
import type { ProviderConfig, Capabilities } from '@axiom/ai';

/**
 * The stored provider configuration. The API key never touches this table:
 * it lives in the OS secure store (SEC-10), read through the keyring
 * commands in the Tauri shell. `capabilities` is JSON in `mode` scope.
 */
export interface ProviderSettings {
  baseUrl: string;
  chatModel: string;
  embedModel: string | null;
  mode: 'local' | 'hosted';
}

interface ProviderRow extends Record<string, unknown> {
  base_url: string; chat_model: string; embed_model: string | null; mode: string;
}

export function rowToSettings(row: ProviderRow): ProviderSettings {
  return {
    baseUrl: row.base_url,
    chatModel: row.chat_model,
    embedModel: row.embed_model ?? null,
    mode: row.mode as ProviderSettings['mode'],
  };
}

export async function getProviderSettings(db: DbDriver): Promise<ProviderSettings | null> {
  const rows = await db.select<ProviderRow>(
    "SELECT base_url, chat_model, embed_model, mode FROM provider_config WHERE id = 'default'",
  );
  return rows.length > 0 ? rowToSettings(rows[0]!) : null;
}

export async function saveProviderSettings(
  db: DbDriver,
  settings: ProviderSettings,
  detected = false,
): Promise<void> {
  await db.execute(
    `REPLACE INTO provider_config (id, base_url, chat_model, embed_model, mode, detected_at)
     VALUES ('default', $1, $2, $3, $4, $5)`,
    [
      settings.baseUrl,
      settings.chatModel,
      settings.embedModel,
      settings.mode,
      detected ? new Date().toISOString() : null,
    ],
  );
}

export function settingsToProviderConfig(
  settings: ProviderSettings,
  apiKey: string | undefined,
): ProviderConfig {
  return {
    baseUrl: settings.baseUrl,
    apiKey,
    chatModel: settings.chatModel,
    embedModel: settings.embedModel ?? undefined,
  };
}

/**
 * Feature gates (pivot plan task 8): features shrink when the probe found no
 * matching capability. Stored so the UI can gate without re-probing.
 */
export interface StoredCapabilities extends Record<string, unknown> {
  chat: boolean;
  jsonMode: boolean;
  embeddings: boolean;
  vision: boolean;
}

export const DEFAULT_CAPABILITIES: StoredCapabilities = {
  chat: false, jsonMode: false, embeddings: false, vision: false,
};

export function capabilitiesToStored(caps: Capabilities): StoredCapabilities {
  return { chat: caps.chat, jsonMode: caps.jsonMode, embeddings: caps.embeddings, vision: caps.vision };
}
