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
  /** Model used for embeddings. Optional: without it, search falls back to keyword only. */
  embedModel: z.string().optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

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
