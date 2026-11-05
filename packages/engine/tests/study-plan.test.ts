import { describe, expect, it } from 'vitest';
import {
  buildStudyPlan,
  type PlanQuestion,
  type PlanTopic,
  type StudyPlanInput,
} from '../src/study-plan';

const topics: PlanTopic[] = [
  {
    id: 'T1',
    title: 'Thermodynamics',
    weight: 0.6,
    order: 0,
    type: 'core',
    progress: 'not_started',
    lessonId: 'lesson-T1',
  },
  {
    id: 'T2',
    title: 'Equilibrium',
    weight: 0.3,
    order: 1,
    type: 'core',
    progress: 'not_started',
    lessonId: 'lesson-T2',
  },
];

const questions: PlanQuestion[] = [
  { id: 'q1', topicIds: ['T1'], source: 'past_paper', difficulty: 2, year: 2022, marks: 5, status: 'confirmed' },
  { id: 'q2', topicIds: ['T1'], source: 'past_paper', difficulty: 4, year: 2023, marks: 10, status: 'confirmed' },
  { id: 'q3', topicIds: ['T2'], source: 'generated', difficulty: 1, year: null, marks: 3, status: 'confirmed' },
  { id: 'draft', topicIds: ['T1'], source: 'past_paper', difficulty: 1, year: 2024, marks: 5, status: 'draft' },
];

function input(profile: StudyPlanInput['profile'], extra: Partial<StudyPlanInput> = {}): StudyPlanInput {
  return {
    profile,
    dailyMinutes: 120,
    examDate: '2026-12-01',
    topics,
    questions,
    attempts: [],
    now: '2026-11-05T09:00:00.000Z',
    ...extra,
  };
}

describe('buildStudyPlan', () => {
  it('is deterministic for the same input', () => {
    const first = buildStudyPlan(input('adaptive'));
    const second = buildStudyPlan(input('adaptive'));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('puts confirmed past questions easiest first in past_first', () => {
    const plan = buildStudyPlan(input('past_first'));
    const questionsInPlan = plan.items.filter((item) => item.kind === 'question');
    expect(questionsInPlan.slice(0, 2).map((item) => item.refId)).toEqual(['q1', 'q2']);
    expect(plan.items.map((item) => item.refId)).not.toContain('draft');
  });

  it('starts with the lesson in notes_first', () => {
    const plan = buildStudyPlan(input('notes_first'));
    expect(plan.items[0]).toMatchObject({ kind: 'lesson', topicId: 'T1' });
    expect(plan.items.map((item) => item.refId)).toContain('q1');
  });

  it('produces a different order per profile', () => {
    const past = buildStudyPlan(input('past_first')).items.map((item) => `${item.kind}:${item.refId}`);
    const notes = buildStudyPlan(input('notes_first')).items.map((item) => `${item.kind}:${item.refId}`);
    const adaptive = buildStudyPlan(input('adaptive')).items.map((item) => `${item.kind}:${item.refId}`);
    expect(past).not.toEqual(notes);
    expect(past).not.toEqual(adaptive);
    expect(adaptive).not.toEqual(notes);
  });

  it('never schedules drafts', () => {
    const plan = buildStudyPlan(input('past_first'));
    expect(plan.items.some((item) => item.refId === 'draft')).toBe(false);
    expect(plan.coverage.pastQuestionsTotal).toBe(2);
  });

  it('timeboxes the day but always includes one item', () => {
    const plan = buildStudyPlan(input('past_first', { dailyMinutes: 5 }));
    expect(plan.items).toHaveLength(1);
    expect(plan.backlog.length).toBeGreaterThan(0);
    expect(plan.items[0]!.estimatedMinutes).toBeGreaterThan(5);
  });

  it('skips known and skipped topics', () => {
    const plan = buildStudyPlan(
      input('notes_first', {
        topics: [
          { ...topics[0]!, progress: 'known' },
          { ...topics[1]!, type: 'skipped' },
        ],
      }),
    );
    expect(plan.items).toHaveLength(0);
    expect(plan.coverage.topicsTotal).toBe(0);
  });

  it('reports exam proximity and coverage', () => {
    const plan = buildStudyPlan(input('past_first'));
    expect(plan.daysUntilExam).toBe(26);
    expect(plan.coverage.pastQuestionsDone).toBe(0);
    expect(plan.coverage.pastQuestionsTotal).toBe(2);
    expect(plan.coverage.topicsTotal).toBe(2);
  });
});
