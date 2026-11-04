import type { Capabilities, ProviderConfig } from './config';
import { EMPTY_CAPABILITIES } from './config';
import { chat, embed, normalizeBaseUrl } from './client';
import { getFetch } from './http';

function strip(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

/** A 1x1 transparent PNG as a data URI, for the vision probe. */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAbSJb4AAAAEklEQVR42mNk+M+ACzCBkgAFgAIAn2cB/Q36NigAAAAASUVORK5CYII=';

/** Extra request headers some local endpoints (LM Studio) prefer. */
const localProbeHeaders = { 'Content-Type': 'application/json' };

/**
 * Probe what the configured endpoint can do (pivot plan: features expand or
 * shrink with capabilities). Each check runs on its own; a failing chat
 * probe makes the other probes pointless, so stop there.
 */
export async function probeCapabilities(
  config: ProviderConfig,
  options: { timeoutMs?: number } = {},
): Promise<Capabilities> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const createTimeout = () => AbortSignal.timeout(timeoutMs);
  const capabilities: Capabilities = { ...EMPTY_CAPABILITIES };

  // 1. Chat: a tiny completion.
  try {
    await chat(config, [{ role: 'user', content: 'Reply with the single word: ok.' }], {
      maxTokens: 8,
      signal: createTimeout(),
    });
    capabilities.chat = true;
  } catch {
    return capabilities;
  }

  // 2. JSON mode: ask for JSON and see if the reply parses.
  try {
    const result = await chat(
      config,
      [{ role: 'user', content: 'Return this exact JSON: {"ok":true}' }],
      { maxTokens: 32, temperature: 0, signal: createTimeout() },
    );
    const parsed = JSON.parse(
      strip(result.content),
    );
    capabilities.jsonMode = parsed === true || (typeof parsed === 'object' && parsed !== null);
  } catch {
    capabilities.jsonMode = false;
  }

  // 3. Embeddings, only when an embed model is configured.
  if (config.embedModel) {
    try {
      await embed(config, ['probe'], { signal: createTimeout() });
      capabilities.embeddings = true;
    } catch {
      capabilities.embeddings = false;
    }
  }

  // 4. Vision: send a 1x1 image and see if the endpoint accepts it.
  try {
    await chat(
      config,
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What color is this image? Reply in one word.' },
            { type: 'image_url', image_url: { url: TINY_PNG } },
          ] as unknown as string,
        },
      ],
      { maxTokens: 8, signal: createTimeout() },
    );
    capabilities.vision = true;
  } catch {
    capabilities.vision = false;
  }

  return capabilities;
}

/** Common local OpenAI-compatible endpoint ports (pivot plan). */
export const LOCAL_PORTS = [11434, 1234, 8080] as const;

/** A reachable local endpoint and the model IDs it advertises. */
export interface LocalProviderDetection {
  baseUrl: string;
  models: string[];
}

/**
 * Auto-detect a local endpoint on startup. Probes common ports for
 * OpenAI-compatible /v1/models. Returns the first base URL that answers
 * with a non-empty model list, or null.
 */
export async function detectLocalProvider(
  options: { ports?: readonly number[]; timeoutMs?: number } = {},
): Promise<LocalProviderDetection | null> {
  const ports = options.ports ?? LOCAL_PORTS;
  const timeoutMs = options.timeoutMs ?? 1_500;
  for (const port of ports) {
    const baseUrl = `http://localhost:${port}`;
    try {
      const response = await getFetch()(`${normalizeBaseUrl(baseUrl)}/models`, {
        headers: localProbeHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) continue;
      const body = (await response.json()) as { data?: unknown };
      if (!Array.isArray(body.data)) continue;
      const models = body.data
        .map((entry) =>
          typeof (entry as { id?: unknown }).id === 'string'
            ? (entry as { id: string }).id
            : null,
        )
        .filter((id): id is string => id !== null);
      if (models.length > 0) return { baseUrl, models };
    } catch {
      // Port closed or not OpenAI-compatible: try the next one.
    }
  }
  return null;
}

/**
 * Split a local server's model list into the chat and embedding roles.
 * Embedding IDs contain "embed"; chat prefers an explicit chat/instruct
 * model, otherwise the first non-embedding model in server order.
 */
export function pickLocalModels(models: readonly string[]): {
  chatModel: string;
  embedModel: string;
} {
  const embedModel = models.find((id) => /embed/i.test(id)) ?? '';
  const chatCandidates = models.filter((id) => !/embed/i.test(id));
  const chatModel =
    chatCandidates.find((id) => /instruct|chat/i.test(id)) ?? chatCandidates[0] ?? '';
  return { chatModel, embedModel };
}
