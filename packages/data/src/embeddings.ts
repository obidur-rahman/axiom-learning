import type { DbDriver } from './driver';

/**
 * Page vectors for embedding-based retrieval. One row per page; vectors are
 * JSON arrays (a local SQLite file keeps this dependency-free; the volume is
 * small: dozens of pages per course). Missing rows fall back to keyword
 * search - never a hard failure.
 */
export interface PageVector {
  materialId: string;
  pageNumber: number;
  vector: number[];
  model: string;
}

interface EmbeddingRow extends Record<string, unknown> {
  material_id: string; page_number: number; vector: string; model: string;
}

/** Replaces the stored vectors of one material. Called by the read flow. */
export async function replaceEmbeddings(
  db: DbDriver,
  materialId: string,
  vectors: { pageNumber: number; vector: number[] }[],
  model: string,
): Promise<void> {
  await db.execute('DELETE FROM material_embeddings WHERE material_id = $1', [materialId]);
  for (const entry of vectors) {
    await db.execute(
      `INSERT INTO material_embeddings (material_id, page_number, vector, model)
       VALUES ($1, $2, $3, $4)`,
      [materialId, entry.pageNumber, JSON.stringify(entry.vector), model],
    );
  }
}

/** All stored vectors of one course (joined with their pages' text). */
export async function listEmbeddings(
  db: DbDriver,
  courseId: string,
): Promise<(PageVector & { text: string | null })[]> {
  const rows = await db.select<EmbeddingRow>(
    `SELECT e.material_id, e.page_number, e.vector, e.model, p.text
     FROM material_embeddings e
     JOIN materials m ON m.id = e.material_id
     LEFT JOIN material_pages p
       ON p.material_id = e.material_id AND p.page_number = e.page_number
     WHERE m.course_id = $1`,
    [courseId],
  );
  return rows.map((row) => ({
    materialId: row.material_id,
    pageNumber: row.page_number,
    vector: JSON.parse(row.vector) as number[],
    model: row.model,
    text: (row['text'] as string | null) ?? null,
  }));
}
