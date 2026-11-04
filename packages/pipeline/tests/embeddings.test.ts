import { describe, expect, it } from 'vitest';
import { cosine, embedTexts, retrievePagesSmart } from '../src/embeddings';
import type { ProviderConfig } from '@axiom/ai';

const config: ProviderConfig = {
  baseUrl: 'http://fake.local/v1',
  apiKey: undefined,
  chatModel: 'qwen2.5:7b',
  embedModel: 'nomic-embed-text',
};

function pageRows() {
  return [
    { material_id: 'm1', page_number: 1, vector: JSON.stringify([1, 0]), model: 'nomic-embed-text', text: 'Ohm law basics' },
    { material_id: 'm1', page_number: 2, vector: JSON.stringify([0, 1]), model: 'nomic-embed-text', text: 'RC circuits' },
  ];
}

const driver = {
  async execute() { return; },
  async select(sqlText: string) {
    if (sqlText.includes('material_embeddings')) {
      return pageRows();
    }
    return [
      { page_number: 1, text: 'Ohm law basics' },
      { page_number: 2, text: 'RC circuits' },
    ];
  },
} as never;

describe('cosine', () => {
  it('computes cosine similarity', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
});

describe('embedTexts', () => {
  it('maps embedding vectors from the provider response', async () => {
    const vectors = await embedTexts(
      config,
      ['hello', 'world'],
      (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [1, 0] }, { embedding: [0, 1] }] }),
      })) as unknown as typeof fetch,
    );
    expect(vectors).toEqual([[1, 0], [0, 1]]);
  });

  it('throws when no embedding model is configured', async () => {
    await expect(
      embedTexts({ ...config, embedModel: undefined }, ['x']),
    ).rejects.toThrow('no embedding model configured');
  });
});

describe('retrievePagesSmart', () => {
  it('falls back to keyword search when no vectors are stored', async () => {
    const empty = {
      async select() { return []; },
      async execute() { return; },
    } as never;
    const pages = await retrievePagesSmart(empty, 'c1', 'ohm law', config);
    expect(pages).toEqual([]);
  });

  it('ranks stored vectors by cosine similarity', async () => {
    const pages = await retrievePagesSmart(
      driver,
      'c1',
      'tell me about Ohm law',
      config,
      // query vector points at page 1
      (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ embedding: [0.9, 0.1] }] }),
      })) as unknown as typeof fetch,
    );
    expect(pages[0]!.pageNumber).toBe(1);
    expect(pages[0]!.text).toBe('Ohm law basics');
  });

  it('falls back to keyword search when the embeddings call fails', async () => {
    const pages = await retrievePagesSmart(
      driver,
      'c1',
      'ohm law',
      config,
      (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch,
    );
    expect(pages.map((page) => page.text)).toContain('Ohm law basics');
  });
});
