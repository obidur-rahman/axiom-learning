/**
 * Deterministic study planner. The app decides the order; the model only
 * fills lessons and questions. Same inputs always produce the same plan.
 */
export type StudyProfile = 'past_first' | 'notes_first' | 'adaptive';
export type PlanSource = 'past_paper' | 'generated' | 'user' | 'notes' | 'mock';
export type PlanItemKind = 'question' | 'lesson' | 'recall' | 'mock';
export type PlanProgress = 'not_started' | 'in_progress' | 'done' | 'known';

export interface PlanTopic {
  id: string;
  title: string;
  weight: number;
  order: number;
  type: 'core' | 'bridge' | 'skipped' | 'known';
  progress: PlanProgress;
  /** Existing active teaching lesson for this topic. */
  lessonId: string | null;
}

export interface PlanQuestion {
  id: string;
  topicIds: string[];
  source: 'past_paper' | 'generated' | 'user';
  difficulty: number;
  year: number | null;
  marks: number | null;
  status: 'draft' | 'confirmed' | 'rejected';
}

export interface PlanAttempt {
  questionId: string | null;
  topicId: string | null;
  itemKind: 'question' | 'lesson' | 'recall' | 'mock';
  result: 'correct' | 'partial' | 'wrong' | 'skipped' | null;
  score: number | null;
  completedAt: string;
}

export interface StudyPlanInput {
  profile: StudyProfile;
  dailyMinutes: number;
  examDate: string | null;
  topics: PlanTopic[];
  questions: PlanQuestion[];
  attempts: PlanAttempt[];
  now: string;
}

export interface StudyItem {
  id: string;
  kind: PlanItemKind;
  refId: string;
  topicId: string | null;
  title: string;
  reason: string;
  estimatedMinutes: number;
  difficulty: number | null;
  source: PlanSource;
}

export interface StudyPlan {
  daysUntilExam: number | null;
  items: StudyItem[];
  backlog: StudyItem[];
  coverage: {
    pastQuestionsDone: number;
    pastQuestionsTotal: number;
    topicsTaught: number;
    topicsTotal: number;
  };
  weakTopics: string[];
}

const RESULT_WEIGHT = { wrong: 2, partial: 1, correct: 0, skipped: 0 } as const;

function minutesForQuestion(question: PlanQuestion): number {
  const marks = question.marks ?? 5;
  return Math.max(5, Math.min(20, Math.round(marks * 1.5)));
}

function daysBetween(now: string, examDate: string | null): number | null {
  if (examDate === null || examDate.trim() === '') return null;
  const start = new Date(now);
  const end = new Date(`${examDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

function byTopic(topicIds: string[], topics: PlanTopic[]): string | null {
  const ranks = new Map(topics.map((topic) => [topic.id, topic.order]));
  const known = new Set(topics.map((topic) => topic.id));
  const candidates = topicIds.filter((id) => known.has(id));
  candidates.sort((a, b) => (ranks.get(a) ?? 0) - (ranks.get(b) ?? 0));
  return candidates[0] ?? null;
}

function weakTopicOrder(topics: PlanTopic[], attempts: PlanAttempt[]): string[] {
  const weakness = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.topicId === null) continue;
    const value = RESULT_WEIGHT[attempt.result ?? 'skipped'] ?? 0;
    weakness.set(attempt.topicId, (weakness.get(attempt.topicId) ?? 0) + value);
  }
  return [...topics]
    .filter((topic) => topic.progress !== 'known' && topic.type !== 'skipped')
    .sort((a, b) => {
      const wa = weakness.get(a.id) ?? 0;
      const wb = weakness.get(b.id) ?? 0;
      if (wb !== wa) return wb - wa;
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.order - b.order;
    })
    .map((topic) => topic.id);
}

function lessonItem(topic: PlanTopic, reason: string): StudyItem {
  return {
    id: '',
    kind: 'lesson',
    refId: topic.lessonId ?? topic.id,
    topicId: topic.id,
    title: topic.title,
    reason,
    estimatedMinutes: 8,
    difficulty: null,
    source: 'notes',
  };
}

function recallItem(topic: PlanTopic, reason: string): StudyItem {
  return {
    id: '',
    kind: 'recall',
    refId: topic.id,
    topicId: topic.id,
    title: `Recall: ${topic.title}`,
    reason,
    estimatedMinutes: 3,
    difficulty: null,
    source: 'notes',
  };
}

function questionItem(question: PlanQuestion, topicId: string | null, title: string): StudyItem {
  return {
    id: '',
    kind: 'question',
    refId: question.id,
    topicId,
    title,
    reason: question.source === 'past_paper' ? 'Past paper' : 'Generated from notes',
    estimatedMinutes: minutesForQuestion(question),
    difficulty: question.difficulty,
    source: question.source,
  };
}

function timebox(all: StudyItem[], dailyMinutes: number): { items: StudyItem[]; backlog: StudyItem[] } {
  const items: StudyItem[] = [];
  let used = 0;
  let index = 0;
  while (index < all.length) {
    const item = all[index]!;
    if (items.length > 0 && used + item.estimatedMinutes > dailyMinutes) break;
    items.push(item);
    used += item.estimatedMinutes;
    index += 1;
  }
  return { items, backlog: all.slice(index) };
}

/**
 * Build the plan. Questions must already be confirmed; drafts are ignored so
 * an unconfirmed extraction never enters the study queue.
 */
export function buildStudyPlan(input: StudyPlanInput): StudyPlan {
  const topics = [...input.topics].sort((a, b) => a.order - b.order);
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const active = topics.filter((topic) => topic.type !== 'skipped' && topic.progress !== 'known');
  const confirmed = input.questions.filter((question) => question.status === 'confirmed');
  const past = confirmed.filter((question) => question.source === 'past_paper');
  const generated = confirmed.filter((question) => question.source !== 'past_paper');
  const attempted = new Set(
    input.attempts
      .filter((attempt) => attempt.itemKind === 'question' && attempt.questionId !== null)
      .map((attempt) => attempt.questionId!),
  );
  const taught = new Set(
    input.attempts
      .filter((attempt) => attempt.itemKind === 'lesson' && attempt.topicId !== null)
      .map((attempt) => attempt.topicId!),
  );

  const questionsByTopic = (pool: PlanQuestion[]) => {
    const map = new Map<string, PlanQuestion[]>();
    for (const question of pool) {
      const topicId = byTopic(question.topicIds, topics);
      if (topicId === null) continue;
      const list = map.get(topicId) ?? [];
      list.push(question);
      map.set(topicId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.difficulty !== b.difficulty) return a.difficulty - b.difficulty;
        if ((a.year ?? 0) !== (b.year ?? 0)) return (a.year ?? 0) - (b.year ?? 0);
        return a.id < b.id ? -1 : 1;
      });
    }
    return map;
  };

  const pastByTopic = questionsByTopic(past);
  const generatedByTopic = questionsByTopic(generated);
  const queue: StudyItem[] = [];

  const pushQuestions = (topic: PlanTopic, pool: PlanQuestion[], reason: string) => {
    for (const question of pool) {
      if (attempted.has(question.id)) continue;
      queue.push(questionItem(question, topic.id, `Question for ${topic.title}`));
      void reason;
    }
  };

  if (input.profile === 'past_first') {
    for (const topic of active) {
      const questions = pastByTopic.get(topic.id) ?? [];
      if (questions.length > 0) {
        pushQuestions(topic, questions, 'Past paper, easiest first');
        if (topic.lessonId !== null && !taught.has(topic.id)) {
          queue.push(lessonItem(topic, 'Notes pass after the past questions'));
        }
      }
    }
    // Topics with no real past questions still get a teaching pass and
    // generated practice; the UI labels these clearly.
    for (const topic of active) {
      if ((pastByTopic.get(topic.id) ?? []).length > 0) continue;
      if (topic.lessonId !== null && !taught.has(topic.id)) {
        queue.push(lessonItem(topic, 'No past questions yet; learn from notes'));
      }
      pushQuestions(topic, generatedByTopic.get(topic.id) ?? [], 'Generated from notes');
    }
    // Remaining notes coverage after the question pass.
    for (const topic of active) {
      if (topic.lessonId !== null && !taught.has(topic.id)) {
        if (!queue.some((item) => item.kind === 'lesson' && item.topicId === topic.id)) {
          queue.push(lessonItem(topic, 'Notes coverage'));
        }
      }
    }
    for (const topic of active) {
      if (!taught.has(topic.id)) continue;
      const weak = input.attempts.some(
        (attempt) => attempt.topicId === topic.id && attempt.result === 'wrong',
      );
      if (weak) queue.push(recallItem(topic, 'Review a topic you missed'));
    }
  } else if (input.profile === 'notes_first') {
    for (const topic of active) {
      if (topic.lessonId !== null && !taught.has(topic.id)) {
        queue.push(lessonItem(topic, 'Learn the concept from your notes'));
      }
      pushQuestions(topic, generatedByTopic.get(topic.id) ?? [], 'Practice from notes');
      if (taught.has(topic.id)) queue.push(recallItem(topic, 'Recall before moving on'));
    }
    // Past papers become the final pass.
    for (const topic of active) {
      const questions = pastByTopic.get(topic.id) ?? [];
      if (questions.length > 0) pushQuestions(topic, questions, 'Optional past-paper pass');
    }
  } else {
    // Adaptive: a short diagnostic, then weak topics, then everything else.
    const diagnostic: PlanQuestion[] = [];
    const seenTopics = new Set<string>();
    for (const question of confirmed) {
      if (diagnostic.length >= 5) break;
      if (attempted.has(question.id)) continue;
      const topicId = byTopic(question.topicIds, topics);
      if (topicId === null || seenTopics.has(topicId)) continue;
      seenTopics.add(topicId);
      diagnostic.push(question);
    }
    for (const question of diagnostic) {
      const topicId = byTopic(question.topicIds, topics);
      const topic = topicId === null ? null : topicById.get(topicId) ?? null;
      if (topic === null) continue;
      queue.push(questionItem(question, topic.id, `Diagnostic: ${topic.title}`));
    }

    const weak = weakTopicOrder(active, input.attempts);
    for (const topicId of weak) {
      const topic = topicById.get(topicId);
      if (topic === undefined) continue;
      if (topic.lessonId !== null && !taught.has(topic.id)) {
        queue.push(lessonItem(topic, 'Teach the idea before drilling it'));
      }
      const pool = [...(generatedByTopic.get(topic.id) ?? []), ...(pastByTopic.get(topic.id) ?? [])]
        .sort((a, b) => a.difficulty - b.difficulty)
        .slice(0, 2);
      pushQuestions(topic, pool, 'Practice the weak topic');
      queue.push(recallItem(topic, 'Active recall'));
    }
    // Any topic that has not appeared at all still gets notes coverage.
    for (const topic of active) {
      if (!queue.some((item) => item.topicId === topic.id)) {
        if (topic.lessonId !== null) queue.push(lessonItem(topic, 'Cover remaining notes'));
      }
    }
  }

  // Remove duplicate lesson entries that can appear through several passes.
  const seen = new Set<string>();
  const deduped = queue.filter((item) => {
    const key = `${item.kind}:${item.refId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Items are built without ids while the queue is assembled; give each one a
  // stable, unique id so React lists and attempt records can rely on it.
  const withIds = deduped.map((item, index) => ({ ...item, id: `${item.kind}:${item.refId}:${index}` }));
  const { items, backlog } = timebox(withIds, input.dailyMinutes);
  const pastTotal = past.length;
  const pastDone = past.filter((question) => attempted.has(question.id)).length;

  return {
    daysUntilExam: daysBetween(input.now, input.examDate),
    items,
    backlog,
    coverage: {
      pastQuestionsDone: pastDone,
      pastQuestionsTotal: pastTotal,
      topicsTaught: active.filter((topic) => taught.has(topic.id)).length,
      topicsTotal: active.length,
    },
    weakTopics: weakTopicOrder(active, input.attempts).slice(0, 5),
  };
}
