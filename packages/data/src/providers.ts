import type { DbDriver } from './driver';
import type { ProviderConfig, Capabilities } from '@axiom/ai';

/**
 * The stored provider configuration. The API key never touches this table:
 * it lives in the OS secure store (SEC-10), read through the keyring
 * commands in the Tauri shell. `capabilities` is JSON in `mode` scope.
 *
 * One endpoint serves several roles, and each role has its own model: OCR
 * reads page images, chat writes lessons and answers, embeddings rank pages.
 * `singleModelMode` / `autoUnload` describe how the local runtime handles
 * those models in memory (one at a time, unloaded when a job ends).
 */
export interface ProviderSettings {
  baseUrl: string;
  chatModel: string;
  /** Model that reads page images. Null falls back to chatModel. */
  ocrModel: string | null;
  embedModel: string | null;
  mode: 'local' | 'hosted';
  /** Thinking-model switches; only sent to a local (Ollama) endpoint. */
  ocrThink: boolean;
  chatThink: boolean;
  /** Long edge of the OCR page image, in pixels. */
  ocrMaxEdge: number;
  /** Cap on the OCR transcription reply. */
  ocrMaxTokens: number;
  /** Keep only the model in use loaded, unload the others before a call. */
  singleModelMode: boolean;
  /** Unload local models once the job that used them finishes. */
  autoUnload: boolean;
}

interface ProviderRow extends Record<string, unknown> {
  base_url: string;
  chat_model: string;
  ocr_model: string | null;
  embed_model: string | null;
  mode: string;
  ocr_think: number | null;
  chat_think: number | null;
  ocr_max_edge: number | null;
  ocr_max_tokens: number | null;
  single_model_mode: number | null;
  auto_unload: number | null;
}

export const OCR_DEFAULT_MAX_EDGE = 1400;
export const OCR_DEFAULT_MAX_TOKENS = 1024;

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function rowToSettings(row: ProviderRow): ProviderSettings {
  return {
    baseUrl: row.base_url,
    chatModel: row.chat_model,
    ocrModel: row.ocr_model === null || row.ocr_model === undefined || row.ocr_model === '' ? null : row.ocr_model,
    embedModel: row.embed_model ?? null,
    mode: row.mode as ProviderSettings['mode'],
    ocrThink: row.ocr_think === 1,
    chatThink: row.chat_think === 1,
    ocrMaxEdge: bounded(row.ocr_max_edge, OCR_DEFAULT_MAX_EDGE, 512, 4096),
    ocrMaxTokens: bounded(row.ocr_max_tokens, OCR_DEFAULT_MAX_TOKENS, 128, 8192),
    // Absent values are an upgraded database: keep the safe default on.
    singleModelMode: row.single_model_mode !== 0,
    autoUnload: row.auto_unload !== 0,
  };
}

export async function getProviderSettings(db: DbDriver): Promise<ProviderSettings | null> {
  const rows = await db.select<ProviderRow>(
    `SELECT base_url, chat_model, ocr_model, embed_model, mode,
            ocr_think, chat_think, ocr_max_edge, ocr_max_tokens,
            single_model_mode, auto_unload
     FROM provider_config WHERE id = 'default'`,
  );
  return rows.length > 0 ? rowToSettings(rows[0]!) : null;
}

/** One extra endpoint tried when the main provider cannot serve a request. */
export interface ProviderFallback extends ProviderSettings {
  id: string;
  label: string;
  /** Disabled profiles stay stored but are skipped by the fallback chain. */
  enabled: boolean;
  /** Lower runs first; the settings screen keeps this equal to list order. */
  priority: number;
}

interface FallbackRow extends ProviderRow {
  id: string;
  label: string;
  enabled: number;
  priority: number;
}

function rowToFallback(row: FallbackRow): ProviderFallback {
  return {
    ...rowToSettings(row),
    id: row.id,
    label: row.label,
    enabled: row.enabled !== 0,
    priority: Number(row.priority ?? 0),
  };
}

/** Fallback profiles in try order. */
export async function listProviderFallbacks(db: DbDriver): Promise<ProviderFallback[]> {
  const rows = await db.select<FallbackRow>(
    `SELECT id, label, base_url, chat_model, ocr_model, embed_model, mode,
            ocr_think, chat_think, ocr_max_edge, ocr_max_tokens,
            single_model_mode, auto_unload, enabled, priority
     FROM provider_fallbacks
     ORDER BY priority, updated_at`,
  );
  return rows.map(rowToFallback);
}

/** Replaces the whole fallback list; the array order is the try order. */
export async function saveProviderFallbacks(
  db: DbDriver,
  fallbacks: readonly ProviderFallback[],
): Promise<void> {
  await db.execute('DELETE FROM provider_fallbacks');
  for (const [index, fallback] of fallbacks.entries()) {
    await db.execute(
      `INSERT INTO provider_fallbacks
         (id, label, base_url, chat_model, ocr_model, embed_model, mode,
          ocr_think, chat_think, ocr_max_edge, ocr_max_tokens,
          single_model_mode, auto_unload, enabled, priority, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      [
        fallback.id,
        fallback.label,
        fallback.baseUrl,
        fallback.chatModel,
        fallback.ocrModel,
        fallback.embedModel,
        fallback.mode,
        fallback.ocrThink ? 1 : 0,
        fallback.chatThink ? 1 : 0,
        fallback.ocrMaxEdge,
        fallback.ocrMaxTokens,
        fallback.singleModelMode ? 1 : 0,
        fallback.autoUnload ? 1 : 0,
        fallback.enabled ? 1 : 0,
        index,
      ],
    );
  }
}

export async function saveProviderSettings(
  db: DbDriver,
  settings: ProviderSettings,
  detected = false,
): Promise<void> {
  await db.execute(
    `REPLACE INTO provider_config
       (id, base_url, chat_model, ocr_model, embed_model, mode,
        ocr_think, chat_think, ocr_max_edge, ocr_max_tokens,
        single_model_mode, auto_unload, detected_at, updated_at)
     VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    [
      settings.baseUrl,
      settings.chatModel,
      settings.ocrModel,
      settings.embedModel,
      settings.mode,
      settings.ocrThink ? 1 : 0,
      settings.chatThink ? 1 : 0,
      settings.ocrMaxEdge,
      settings.ocrMaxTokens,
      settings.singleModelMode ? 1 : 0,
      settings.autoUnload ? 1 : 0,
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
    ...(settings.ocrModel === null ? {} : { ocrModel: settings.ocrModel }),
    ...(settings.embedModel === null ? {} : { embedModel: settings.embedModel }),
    ocrMaxEdge: settings.ocrMaxEdge,
    ocrMaxTokens: settings.ocrMaxTokens,
    // `think` is an Ollama field; a hosted endpoint would reject it.
    ...(settings.mode === 'local'
      ? { chatThink: settings.chatThink, ocrThink: settings.ocrThink }
      : {}),
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
