import type { Capabilities, ProviderConfig } from './config';
import { EMPTY_CAPABILITIES } from './config';
import { chat, embed, normalizeBaseUrl } from './client';
import { getFetch } from './http';

function strip(text: string): string {
  return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}

/**
 * What the endpoint actually said. Thinking models (Qwen3, DeepSeek) default
 * to a scratchpad and leave `content` empty when the budget runs out, so the
 * reasoning text is the only evidence of what the model can do.
 */
function answerText(result: { content: string; reasoning?: string }): string {
  const content = result.content.trim();
  return content !== '' ? content : (result.reasoning ?? '').trim();
}

/** Parse the reply as JSON, falling back to the first object or array inside prose. */
function firstJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Fall through to the embedded-value search.
  }
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (match === null) return undefined;
  try {
    return JSON.parse(match[0]);
  } catch {
    return undefined;
  }
}

/**
 * A 32x32 solid red PNG, for the vision probe. Acceptance alone proves
 * nothing: a text-only endpoint happily answers the colour question without
 * ever seeing the image, so the reply itself has to name the colour.
 */
const PROBE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGO4IyJCU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJ3LED3QqzauAAAAAElFTkSuQmCC';

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

  // 1. Chat: a tiny completion. The budget covers a short thinking pass too,
  // otherwise a reasoning model fails every probe below it.
  try {
    await chat(config, [{ role: 'user', content: 'Reply with the single word: ok.' }], {
      maxTokens: 64,
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
      { maxTokens: 512, temperature: 0, signal: createTimeout() },
    );
    const parsed = firstJson(strip(answerText(result)));
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

  // 4. Vision: send a solid red image and require the reply to name the
  // colour. A model that cannot see answers the prompt anyway, and wrongly.
  // Probe the OCR model when one is configured: that is the model scans use.
  try {
    const result = await chat(
      config,
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What colour is this image? Reply in one word.' },
            { type: 'image_url', image_url: { url: PROBE_PNG } },
          ] as unknown as string,
        },
      ],
      {
        model: config.ocrModel ?? config.chatModel,
        maxTokens: 256,
        temperature: 0,
        signal: createTimeout(),
      },
    );
    capabilities.vision = /red\b|#f00\b|#ff0000|255,\s*0,\s*0/i.test(answerText(result));
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

/** IDs that usually mean "this model can see images". */
const VISION_HINT = /(?:\.|[/:_-])(vl|vision|llava|moondream|minicpm-v|gemma3|pixtral|internvl)/i;

/** Picks the first advertised model that looks vision-capable, or ''. */
export function pickOcrModel(models: readonly string[]): string {
  return (
    models.find((id) => VISION_HINT.test(id) && !/embed/i.test(id)) ?? ''
  );
}
