import type { DbDriver } from './driver';
import type { Material, MaterialDraft, MaterialPage } from './types';

function uuid(): string {
  return crypto.randomUUID();
}

export function rowToMaterial(row: Record<string, unknown>): Material {
  return {
    id: row.id as string,
    courseId: row.course_id as string,
    kind: row.kind as Material['kind'],
    filePath: (row.file_path as string | null) ?? null,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: (row.size_bytes as number | null) ?? null,
    pageCount: (row.page_count as number | null) ?? null,
    status: row.status as Material['status'],
    errorMessage: (row.error_message as string | null) ?? null,
    contentHash: (row.content_hash as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

export function rowToPage(row: Record<string, unknown>): MaterialPage {
  return {
    id: row.id as string,
    materialId: row.material_id as string,
    pageNumber: row.page_number as number,
    text: (row.text as string | null) ?? null,
    extractionMethod: row.extraction_method as MaterialPage['extractionMethod'],
    confidence: (row.confidence as number | null) ?? null,
    lowConfidence: !!row.low_confidence,
  };
}

export async function createMaterial(db: DbDriver, draft: MaterialDraft): Promise<Material> {
  const material: Material = {
    id: uuid(),
    courseId: draft.courseId,
    kind: draft.kind,
    filePath: draft.filePath ?? null,
    mimeType: draft.mimeType ?? null,
    sizeBytes: draft.sizeBytes ?? null,
    pageCount: null,
    status: 'queued',
    errorMessage: null,
    contentHash: null,
    createdAt: new Date().toISOString(),
  };
  await db.execute(
    `INSERT INTO materials (id, course_id, kind, file_path, mime_type, size_bytes,
       page_count, status, error_message, content_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      material.id,
      material.courseId,
      material.kind,
      material.filePath,
      material.mimeType,
      material.sizeBytes,
      material.pageCount,
      material.status,
      material.errorMessage,
      material.contentHash,
      material.createdAt,
    ],
  );
  return material;
}

export async function listMaterials(db: DbDriver, courseId: string): Promise<Material[]> {
  const rows = await db.select(
    'SELECT * FROM materials WHERE course_id = $1 ORDER BY created_at',
    [courseId],
  );
  return rows.map(rowToMaterial);
}

export async function updateMaterialStatus(
  db: DbDriver,
  materialId: string,
  patch: {
    status: Material['status'];
    errorMessage?: string | null;
    pageCount?: number | null;
    contentHash?: string | null;
  },
): Promise<void> {
  await db.execute(
    `UPDATE materials SET status = $1, error_message = COALESCE($2, error_message),
       page_count = COALESCE($3, page_count), content_hash = COALESCE($4, content_hash)
     WHERE id = $5`,
    [patch.status, patch.errorMessage ?? null, patch.pageCount ?? null, patch.contentHash ?? null, materialId],
  );
}

/** Replaces all pages of a material. Used by the read step. */
export async function replacePages(
  db: DbDriver,
  materialId: string,
  pages: Omit<MaterialPage, 'id' | 'materialId'>[],
): Promise<void> {
  await db.execute('DELETE FROM material_pages WHERE material_id = $1', [materialId]);
  for (const page of pages) {
    await db.execute(
      `INSERT INTO material_pages (id, material_id, page_number, text, extraction_method,
         confidence, low_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        uuid(),
        materialId,
        page.pageNumber,
        page.text,
        page.extractionMethod,
        page.confidence,
        page.lowConfidence ? 1 : 0,
      ],
    );
  }
}

export async function listPages(
  db: DbDriver,
  materialId: string,
): Promise<MaterialPage[]> {
  const rows = await db.select(
    'SELECT * FROM material_pages WHERE material_id = $1 ORDER BY page_number',
    [materialId],
  );
  return rows.map(rowToPage);
}

/**
 * Marks the low-confidence pages list (FR-025): pages at or below the given
 * confidence are flagged. Called by the read step after extraction.
 */
export function pageIsLowConfidence(
  confidence: number | null,
  threshold = 0.75,
): boolean {
  return confidence !== null && confidence < threshold;
}

/** Deletes the material; cascades to its pages. */
export async function deleteMaterial(db: DbDriver, materialId: string): Promise<void> {
  await db.execute('DELETE FROM materials WHERE id = $1', [materialId]);
}
