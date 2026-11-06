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
  /** Preferred bridge depth for this course (0-4). Defaults to 2. */
  bridgeDepth?: number;
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

/* ---------- Adaptive study ---------- */

export type StudyProfile = 'past_first' | 'notes_first' | 'adaptive';
export type QuestionSource = 'past_paper' | 'generated' | 'user';
export type QuestionStatus = 'draft' | 'confirmed' | 'rejected';
export type QuestionType =
  | 'definition'
  | 'explanation'
  | 'derivation'
  | 'numerical'
  | 'comparison'
  | 'diagram'
  | 'essay'
  | 'code'
  | 'other';
export type AttemptResult = 'correct' | 'partial' | 'wrong' | 'skipped';
export type StudyItemKindDb = 'question' | 'lesson' | 'recall' | 'mock';

export interface CourseStudySettings {
  courseId: string;
  profile: StudyProfile;
  dailyMinutes: number;
  hasPastPapers: boolean;
  planVersion: number;
  updatedAt: string;
}

export interface ExamQuestion {
  id: string;
  courseId: string;
  materialId: string | null;
  topicId: string | null;
  topicIds: string[];
  source: QuestionSource;
  prompt: string;
  answerMd: string | null;
  rubric: unknown;
  year: number | null;
  paperLabel: string | null;
  questionNumber: string | null;
  marks: number | null;
  questionType: QuestionType;
  difficulty: number;
  difficultySource: 'model' | 'user' | 'computed';
  patternKey: string | null;
  patternLabel: string | null;
  citationPages: number[];
  status: QuestionStatus;
  promptVersion: string | null;
  createdAt: string;
}

export interface ExamQuestionDraft {
  id?: string;
  courseId: string;
  materialId?: string | null;
  topicId?: string | null;
  source: QuestionSource;
  prompt: string;
  answerMd?: string | null;
  rubric?: unknown;
  year?: number | null;
  paperLabel?: string | null;
  questionNumber?: string | null;
  marks?: number | null;
  questionType?: QuestionType;
  difficulty?: number;
  difficultySource?: 'model' | 'user' | 'computed';
  patternKey?: string | null;
  patternLabel?: string | null;
  citationPages?: number[];
  status?: QuestionStatus;
  promptVersion?: string | null;
}

/* ---------- Teaching lesson documents ---------- */

export type LessonBeatKind =
  | 'hook'
  | 'intuition'
  | 'worked'
  | 'contrast'
  | 'note_anchor'
  | 'recall'
  | 'exam_shape';

export type LessonBlock =
  | { type: 'text'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'compare'; columns: string[]; rows: string[][] }
  | { type: 'equation'; latex: string; label?: string }
  | { type: 'code'; language: string; code: string; trace?: string[] }
  | { type: 'callout'; tone: 'trap' | 'tip' | 'note'; title?: string; text: string }
  | { type: 'flow'; nodes: { id: string; label: string }[]; edges: { from: string; to: string; label?: string }[] }
  | { type: 'recall'; prompt: string; answer: string };

export interface LessonBeat {
  title: string;
  kind: LessonBeatKind;
  intro: string;
  blocks: LessonBlock[];
  takeaway: string | null;
  check: { prompt: string; answer: string } | null;
  citationPages: number[];
}

export interface LessonDocument {
  version: 2;
  title: string;
  objective: string;
  beats: LessonBeat[];
  /** How many slides the planner chose, so a partly built lesson can say so. */
  plannedBeats?: number;
  checkQuestions: { prompt: string; answer: string }[];
  citations: number[];
  isGeneralContent: boolean;
}

export interface StudyAttempt {
  id: string;
  courseId: string;
  itemKind: StudyItemKindDb;
  questionId: string | null;
  topicId: string | null;
  lessonId: string | null;
  result: AttemptResult | null;
  score: number | null;
  maxScore: number | null;
  confidence: number | null;
  durationSeconds: number | null;
  meta: unknown;
  startedAt: string | null;
  completedAt: string;
}
