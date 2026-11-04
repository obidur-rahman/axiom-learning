import type { ProviderConfig } from '@axiom/ai';
import { listEmbeddings, replaceEmbeddings, type DbDriver } from '@axiom/data';
import { retrievePages } from './tutor';

export interface RetrievedPage {
  pageNumber: number;
  text: string;
  score: number;
}

/**
 * Embeds texts with the provider's embeddings endpoint (OpenAI-compatible).
 * One request per batch; failures surface to the caller, which treats them
 * as "no embeddings available" rather than a fatal error.
 */
export async function embedTexts(
  config: ProviderConfig,
  texts: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  if (config.embedModel === undefined || config.embedModel === '') {
    throw new Error('no embedding model configured');
  }
  const batches: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += 16) {
    const chunk = texts.slice(offset, offset + 16);
    const response = await fetchImpl(`${config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: config.embedModel, input: chunk }),
    });
    if (!response.ok) throw new Error(`embeddings failed: HTTP ${response.status}`);
    const body = (await response.json()) as {
      data?: { embedding?: number[] }[];
    };
    for (const item of body.data ?? []) {
      if (item.embedding !== undefined) batches.push(item.embedding);
    }
  }
  if (batches.length !== texts.length) {
    throw new Error('embeddings response was missing vectors');
  }
  return batches;
}

export function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Embeds the course's pages once at read time; best effort, never fatal. */
export async function embedAndStorePages(
  driver: DbDriver,
  materialId: string,
  pages: { pageNumber: number; text: string | null }[],
  config: ProviderConfig,
): Promise<number> {
  const usable = pages.filter((page) => page.text !== null && page.text.trim() !== '');
  if (usable.length === 0 || config.embedModel === undefined) return 0;
  const vectors = await embedTexts(
    config,
    usable.map((page) => page.text!.slice(0, 4000)),
  );
  await replaceEmbeddings(
    driver,
    materialId,
    usable.map((page, index) => ({ pageNumber: page.pageNumber, vector: vectors[index]! })),
    config.embedModel,
  );
  return usable.length;
}

/**
 * Retrieval for tutor/practice: uses stored page vectors when they exist
 * (cosine against the embedded question), otherwise falls back to pruning
 * keyword search. Same return shape everywhere.
 */
export async function retrievePagesSmart(
  driver: DbDriver,
  courseId: string,
  question: string,
  config: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<RetrievedPage[]> {
  const limit = 6;
  if (config.embedModel === undefined || config.embedModel === '') {
    return retrievePages(driver, courseId, question, limit);
  }
  try {
    const stored = await listEmbeddings(driver, courseId);
    if (stored.length === 0) {
      return retrievePages(driver, courseId, question, limit);
    }
    const [queryVector] = await embedTexts(config, [question], fetchImpl);
    if (queryVector === undefined) throw new Error('no query vector');
    return stored
      .map((row) => ({
        pageNumber: row.pageNumber,
        text: row.text ?? '',
        score: cosine(queryVector, row.vector),
      }))
      .filter((page) => page.text !== '')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch {
    return retrievePages(driver, courseId, question, limit);
  }
}
