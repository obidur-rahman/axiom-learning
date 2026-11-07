import { z } from 'zod';

/**
 * One configuration covers hosted OpenAI-compatible endpoints (OpenRouter,
 * OpenAI) and local ones (Ollama, LM Studio, vLLM).
 */
export const ProviderConfigSchema = z.object({
  /** Base URL ending before /v1, e.g. "http://localhost:11434" or an OpenRouter URL. */
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  /** Model used for chat, tutoring, lessons. */
  chatModel: z.string().min(1),
  /**
   * Model that reads page images (handwriting, scans, diagrams). Optional:
   * without it, the chat model is used, which wastes a text model on images.
   */
  ocrModel: z.string().optional(),
  /** Model used for embeddings. Optional: without it, search falls back to keyword only. */
  embedModel: z.string().optional(),
  /** Local thinking models: keep the scratchpad on for OCR only when it helps. */
  chatThink: z.boolean().optional(),
  ocrThink: z.boolean().optional(),
  /** Long edge of the page image sent to the OCR model, in pixels. */
  ocrMaxEdge: z.number().int().min(512).max(4096).optional(),
  /** Caps the transcription reply so a runaway model cannot stall a page. */
  ocrMaxTokens: z.number().int().min(128).max(8192).optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * A provider plus the endpoints tried, in order, when the first one fails.
 * `fallbacks` is never serialized into a request; it only drives the retry
 * loop inside chat/chatJson/embed.
 */
export type ProviderChain = ProviderConfig & { fallbacks?: ProviderConfig[] };

/** The primary profile followed by its enabled fallbacks. */
export function providerAttempts(config: ProviderConfig): ProviderConfig[] {
  const fallbacks = (config as ProviderChain).fallbacks;
  if (!Array.isArray(fallbacks) || fallbacks.length === 0) return [config];
  return [config, ...fallbacks];
}

/**
 * Capability probe result (pivot plan: features expand or shrink with these).
 */
export const CapabilitiesSchema = z.object({
  chat: z.boolean(),
  jsonMode: z.boolean(),
  embeddings: z.boolean(),
  vision: z.boolean(),
});

export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const EMPTY_CAPABILITIES: Capabilities = {
  chat: false,
  jsonMode: false,
  embeddings: false,
  vision: false,
};
