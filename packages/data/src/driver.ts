/**
 * The database driver surface. All repositories sit on this, so the same
 * logic runs on Tauri's SQLite plugin and on the test fake.
 */
export interface DbDriver {
  /** Returns the number of affected rows (used by the job queue claims). */
  execute(sql: string, params?: unknown[]): Promise<number>;
  select<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Group type/enum values that the DDL checks against. */export const COURSE_LEVELS = ['school', 'university', 'general'] as const;
  export const COURSE_LANGUAGES = ['bn', 'en', 'mixed'] as const;
export const COURSE_STATUSES = ['draft', 'processing', 'ready', 'failed'] as const;
export const MATERIAL_KINDS = [
  'syllabus',
  'notes',
  'past_questions',
  'suggestions',
  'textbook',
  'other',
] as const;
export const MATERIAL_STATUSES = ['queued', 'reading', 'ready', 'failed'] as const;
export const EXTRACTION_METHODS = ['text_layer', 'ocr', 'vision', 'pasted'] as const;
export const TOPIC_SOURCES = ['syllabus', 'notes', 'user', 'premade'] as const;
export const EDGE_SOURCES = ['model', 'shared', 'user'] as const;
export const PROGRESS_STATUSES = ['not_started', 'in_progress', 'done', 'known'] as const;
