import type {
  COURSE_LANGUAGES,
  COURSE_LEVELS,
  COURSE_STATUSES,
  EXTRACTION_METHODS,
  MATERIAL_KINDS,
  MATERIAL_STATUSES,
  PROGRESS_STATUSES,
  TOPIC_SOURCES,
} from './driver';

export type CourseLevel = (typeof COURSE_LEVELS)[number];
export type CourseLanguage = (typeof COURSE_LANGUAGES)[number];
export type CourseStatus = (typeof COURSE_STATUSES)[number];
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];
export type TopicSource = (typeof TOPIC_SOURCES)[number];
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export interface Course {
  id: string;
  title: string;
  level: CourseLevel;
  language: CourseLanguage;
  /** ISO date or null. */
  examDate: string | null;
  isPremade: boolean;
  clonedFrom: string | null;
  bridgeDepth: number;
  status: CourseStatus;
  createdAt: string;
}

export interface CourseDraft {
  title: string;
  level?: CourseLevel;
  language?: CourseLanguage;
  examDate?: string | null;
}

export interface Material {
  id: string;
  courseId: string;
  kind: MaterialKind;
  filePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  pageCount: number | null;
  status: MaterialStatus;
  errorMessage: string | null;
  contentHash: string | null;
  createdAt: string;
}

export interface MaterialDraft {
  courseId: string;
  kind: MaterialKind;
  filePath?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

export interface MaterialPage {
  id: string;
  materialId: string;
  pageNumber: number;
  text: string | null;
  extractionMethod: ExtractionMethod;
  /** 0 to 1; null = unknown. */
  confidence: number | null;
  lowConfidence: boolean;
}

export interface TopicRow {
  id: string;
  courseId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  syllabusOrder: number | null;
  source: TopicSource;
}

export interface Lesson {
  id: string;
  scope: 'course' | 'shared';
  courseId: string | null;
  topicId: string | null;
  language: CourseLanguage;
  depth: 'core' | 'bridge';
  contentMd: string;
  /** Chunk ids and pages, as JSON-serializable list. */
  citations: unknown[] | null;
  isGeneralContent: boolean;
  status: 'active' | 'flagged' | 'replaced';
  createdAt: string;
}

export interface ProgressRow {
  courseId: string;
  topicId: string;
  status: ProgressStatus;
}

/** A saved roadmap: version number plus the built nodes. */
export interface RoadmapRecord {
  courseId: string;
  version: number;
  roadmap: import('@axiom/engine').Roadmap;
}
