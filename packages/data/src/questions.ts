import type { DbDriver } from './driver';
import type {
  ExamQuestion,
  ExamQuestionDraft,
  QuestionStatus,
  QuestionType,
} from './types';

function uuid(): string {
  return crypto.randomUUID();
}

interface QuestionRow extends Record<string, unknown> {
  id: string;
  course_id: string;
  material_id: string | null;
  topic_id: string | null;
  source: string;
  prompt: string;
  answer_md: string | null;
  rubric_json: string | null;
  year: number | null;
  paper_label: string | null;
  question_number: string | null;
  marks: number | null;
  question_type: string;
  difficulty: number;
  difficulty_source: string;
  pattern_key: string | null;
  pattern_label: string | null;
  citation_pages: string | null;
  status: string;
  prompt_version: string | null;
  created_at: string;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function rowToQuestion(row: QuestionRow, topicIds: string[] = []): ExamQuestion {
  return {
    id: row.id,
    courseId: row.course_id,
    materialId: row.material_id,
    topicId: row.topic_id,
    topicIds,
    source: row.source as ExamQuestion['source'],
    prompt: row.prompt,
    answerMd: row.answer_md,
    rubric: parseJson<unknown>(row.rubric_json, null),
    year: row.year,
    paperLabel: row.paper_label,
    questionNumber: row.question_number,
    marks: row.marks,
    questionType: row.question_type as QuestionType,
    difficulty: row.difficulty,
    difficultySource: row.difficulty_source as ExamQuestion['difficultySource'],
    patternKey: row.pattern_key,
    patternLabel: row.pattern_label,
    citationPages: parseJson<number[]>(row.citation_pages, []),
    status: row.status as QuestionStatus,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
  };
}

/** Stable comparison key for duplicate extraction results. */
export function questionFingerprint(prompt: string, year: number | null, number: string | null): string {
  const text = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09ff]+/g, ' ')
    .trim();
  return `${year ?? ''}|${number ?? ''}|${text}`;
}

async function topicMap(db: DbDriver, courseId: string): Promise<Map<string, string[]>> {
  const rows = await db.select<{ question_id: string; topic_id: string }>(
    `SELECT q.question_id, q.topic_id FROM exam_question_topics q
     JOIN exam_questions e ON e.id = q.question_id
     WHERE e.course_id = $1`,
    [courseId],
  );
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.question_id) ?? [];
    list.push(row.topic_id);
    map.set(row.question_id, list);
  }
  return map;
}

export async function listQuestions(
  db: DbDriver,
  courseId: string,
  status?: QuestionStatus,
): Promise<ExamQuestion[]> {
  const rows = status === undefined
    ? await db.select<QuestionRow>(
        'SELECT * FROM exam_questions WHERE course_id = $1 ORDER BY year DESC, question_number, created_at',
        [courseId],
      )
    : await db.select<QuestionRow>(
        'SELECT * FROM exam_questions WHERE course_id = $1 AND status = $2 ORDER BY year DESC, question_number, created_at',
        [courseId, status],
      );
  const topics = await topicMap(db, courseId);
  return rows.map((row) => rowToQuestion(row, topics.get(row.id) ?? []));
}

export async function getQuestion(db: DbDriver, id: string): Promise<ExamQuestion | null> {
  const rows = await db.select<QuestionRow>('SELECT * FROM exam_questions WHERE id = $1', [id]);
  if (rows.length === 0) return null;
  const links = await db.select<{ topic_id: string }>(
    'SELECT topic_id FROM exam_question_topics WHERE question_id = $1',
    [id],
  );
  return rowToQuestion(rows[0]!, links.map((link) => link.topic_id));
}

export async function saveQuestion(
  db: DbDriver,
  draft: ExamQuestionDraft,
): Promise<ExamQuestion> {
  const id = draft.id ?? uuid();
  const citations = JSON.stringify(draft.citationPages ?? []);
  await db.execute(
    `INSERT OR REPLACE INTO exam_questions
       (id, course_id, material_id, topic_id, source, prompt, answer_md, rubric_json,
        year, paper_label, question_number, marks, question_type, difficulty,
        difficulty_source, pattern_key, pattern_label, citation_pages, status,
        prompt_version, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [
      id,
      draft.courseId,
      draft.materialId ?? null,
      draft.topicId ?? null,
      draft.source,
      draft.prompt,
      draft.answerMd ?? null,
      draft.rubric === undefined ? null : JSON.stringify(draft.rubric),
      draft.year ?? null,
      draft.paperLabel ?? null,
      draft.questionNumber ?? null,
      draft.marks ?? null,
      draft.questionType ?? 'other',
      draft.difficulty ?? 3,
      draft.difficultySource ?? 'model',
      draft.patternKey ?? null,
      draft.patternLabel ?? null,
      citations,
      draft.status ?? 'draft',
      draft.promptVersion ?? null,
      new Date().toISOString(),
    ],
  );
  const topicIds = [...new Set(draft.topicId ? [draft.topicId] : [])];
  await replaceQuestionTopics(db, id, topicIds);
  return (await getQuestion(db, id))!;
}

export async function saveQuestions(
  db: DbDriver,
  drafts: ExamQuestionDraft[],
): Promise<ExamQuestion[]> {
  const saved: ExamQuestion[] = [];
  for (const draft of drafts) {
    saved.push(await saveQuestion(db, draft));
  }
  return saved;
}

export async function replaceQuestionTopics(
  db: DbDriver,
  questionId: string,
  topicIds: string[],
): Promise<void> {
  await db.execute('DELETE FROM exam_question_topics WHERE question_id = $1', [questionId]);
  for (const topicId of [...new Set(topicIds)]) {
    await db.execute(
      'INSERT OR IGNORE INTO exam_question_topics (question_id, topic_id, confidence) VALUES ($1, $2, NULL)',
      [questionId, topicId],
    );
  }
}

export async function updateQuestion(
  db: DbDriver,
  id: string,
  patch: Partial<Pick<ExamQuestion, 'prompt' | 'answerMd' | 'year' | 'marks' | 'difficulty' | 'questionType' | 'patternLabel' | 'status' | 'topicId' | 'topicIds'>>,
): Promise<void> {
  if (patch.prompt !== undefined) {
    await db.execute('UPDATE exam_questions SET prompt = $1 WHERE id = $2', [patch.prompt, id]);
  }
  if (patch.answerMd !== undefined) {
    await db.execute('UPDATE exam_questions SET answer_md = $1 WHERE id = $2', [patch.answerMd, id]);
  }
  if (patch.year !== undefined) {
    await db.execute('UPDATE exam_questions SET year = $1 WHERE id = $2', [patch.year, id]);
  }
  if (patch.marks !== undefined) {
    await db.execute('UPDATE exam_questions SET marks = $1 WHERE id = $2', [patch.marks, id]);
  }
  if (patch.difficulty !== undefined) {
    await db.execute(
      "UPDATE exam_questions SET difficulty = $1, difficulty_source = 'user' WHERE id = $2",
      [patch.difficulty, id],
    );
  }
  if (patch.questionType !== undefined) {
    await db.execute('UPDATE exam_questions SET question_type = $1 WHERE id = $2', [
      patch.questionType,
      id,
    ]);
  }
  if (patch.patternLabel !== undefined) {
    await db.execute('UPDATE exam_questions SET pattern_label = $1 WHERE id = $2', [
      patch.patternLabel,
      id,
    ]);
  }
  if (patch.status !== undefined) {
    await db.execute('UPDATE exam_questions SET status = $1 WHERE id = $2', [patch.status, id]);
  }
  if (patch.topicId !== undefined) {
    await db.execute('UPDATE exam_questions SET topic_id = $1 WHERE id = $2', [patch.topicId, id]);
    await replaceQuestionTopics(db, id, patch.topicId ? [patch.topicId] : []);
  } else if (patch.topicIds !== undefined) {
    await replaceQuestionTopics(db, id, patch.topicIds);
  }
}

export async function setQuestionStatus(
  db: DbDriver,
  id: string,
  status: QuestionStatus,
): Promise<void> {
  await db.execute('UPDATE exam_questions SET status = $1 WHERE id = $2', [status, id]);
}

export async function confirmAllDrafts(db: DbDriver, courseId: string): Promise<void> {
  await db.execute(
    "UPDATE exam_questions SET status = 'confirmed' WHERE course_id = $1 AND status = 'draft'",
    [courseId],
  );
}

export async function deleteQuestion(db: DbDriver, id: string): Promise<void> {
  await db.execute('DELETE FROM exam_questions WHERE id = $1', [id]);
}

/** Counts of confirmed past questions per topic, for weight computation. */
export async function pastQuestionCounts(
  db: DbDriver,
  courseId: string,
): Promise<Record<string, number>> {
  const rows = await db.select<{ topic_id: string; c: number }>(
    `SELECT q.topic_id, COUNT(*) AS c
     FROM exam_questions e
     JOIN exam_question_topics q ON q.question_id = e.id
     WHERE e.course_id = $1 AND e.source = 'past_paper' AND e.status = 'confirmed'
     GROUP BY q.topic_id`,
    [courseId],
  );
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.topic_id] = Number(row.c);
  return counts;
}
