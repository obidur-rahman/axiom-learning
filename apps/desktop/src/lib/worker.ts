/**
 * In-process job runner (pivot plan task 1): claims queued jobs and executes
 * the matching pipeline step. Runs in the webview next to the UI
 * (local-first). Polls every 5 s while idle; one job runs at a time.
 */
import {
  buildLessonStep,
  buildRoadmapStep,
  buildTeachingLesson,
  buildTopicsStep,
  extractPastQuestionsStep,
  generateQuestionsStep,
  type RunContext,
} from '@axiom/pipeline';
import {
  claimNext,
  complete,
  fail,
  getActiveLesson,
  requeueStuck,
  type AxiomDb,
  type Course,
  type DbDriver,
  type JobRow,
} from '@axiom/data';
import { getDb } from './db';
import { loadConfig } from './provider';
import { installProviderFetch } from './provider-http';
import { emitAppEvent } from './events';

const IDLE_POLL_MS = 5_000;
const BUSY_POLL_MS = 500;

let running = false;
let stopped = true;

async function requireCourse(driver: DbDriver, courseId: string): Promise<Course> {
  const rows = await driver.select<Record<string, unknown>>(
    'SELECT * FROM courses WHERE id = $1',
    [courseId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`course ${courseId} disappeared`);
  }
  return row as unknown as Course;
}

async function runJob(job: JobRow, db: AxiomDb, driver: DbDriver): Promise<void> {
  let failure: string | null = null;
  const report = (percent: number, message: string) =>
    emitAppEvent({
      kind: 'job-progress',
      jobId: job.id,
      courseId: job.courseId ?? '',
      jobKind: job.jobType,
      percent,
      message,
    });
  try {
    if (job.courseId === null) {
      throw new Error(`job ${job.id} has no course`);
    }
    if (job.jobType === 'build_topics') {
      const course = await requireCourse(driver, job.courseId);
      const pages = await driver.select<{ text: string | null }>(
        `SELECT p.text FROM material_pages p
         JOIN materials m ON m.id = p.material_id
         WHERE m.course_id = $1 ORDER BY p.id`,
        [job.courseId],
      );
      if (pages.length === 0) {
        throw new Error('No readable pages yet. Upload material first.');
      }
      const ctx: RunContext = { db, course, config: loadConfig };
      await buildTopicsStep(ctx, pages);
      await complete(driver, job.id);
    } else if (job.jobType === 'build_roadmap') {
      const course = await requireCourse(driver, job.courseId);
      const ctx: RunContext = { db, course, config: loadConfig };
      await buildRoadmapStep(ctx);
      await complete(driver, job.id);
    } else if (job.jobType === 'build_lesson') {
      const payload = (job.payload as { topicId?: unknown; depth?: unknown } | null) ?? {};
      const topicId = String(payload.topicId ?? '');
      if (topicId === '') throw new Error('build_lesson requires a topicId in the payload');
      const rawDepth = String(payload.depth ?? 'core');
      const depth: 'core' | 'bridge' = rawDepth === 'bridge' ? 'bridge' : 'core';
      const course = await requireCourse(driver, job.courseId);
      const ctx: RunContext = { db, course, config: loadConfig };
      let lessonId: string | null = null;
      try {
        const result = await buildTeachingLesson(ctx, topicId, { depth, onProgress: report });
        lessonId = result.lessonId;
      } catch {
        // Teaching board failed: keep the older Markdown lesson working.
        await buildLessonStep(driver, job.courseId, topicId, loadConfig, depth);
        const active = await getActiveLesson(driver, topicId, 'mixed', depth);
        lessonId = active?.id ?? null;
      }
      await complete(driver, job.id);
      emitAppEvent({
        kind: 'lesson-ready',
        courseId: job.courseId,
        topicId,
        lessonId: lessonId ?? job.id,
      });
    } else if (job.jobType === 'extract_past_questions') {
      const course = await requireCourse(driver, job.courseId);
      const ctx: RunContext = { db, course, config: loadConfig };
      await extractPastQuestionsStep(ctx);
      await complete(driver, job.id);
    } else if (job.jobType === 'generate_questions') {
      const course = await requireCourse(driver, job.courseId);
      const ctx: RunContext = { db, course, config: loadConfig };
      await generateQuestionsStep(ctx);
      await complete(driver, job.id);
    } else {
      // Unknown kind: finish it so the queue does not clog.
      await complete(driver, job.id);
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    await fail(driver, job.id, failure);
  }
  const status = await driver
    .select<{ status: string }>('SELECT status FROM jobs WHERE id = $1', [job.id])
    .then((rows) => rows[0]?.status ?? 'done');
  emitAppEvent({
    kind: 'job-updated',
    jobId: job.id,
    courseId: job.courseId ?? '',
    jobKind: job.jobType,
    status,
    ...(failure === null ? {} : { error: failure }),
  });
}

async function loop(): Promise<void> {
  // Pipeline model calls run in the webview too; use the desktop transport.
  await installProviderFetch();
  const db = await getDb();
  const driver = db.driver;
  await requeueStuck(driver); // work off a stale backlog from earlier sessions
  try {
    while (!stopped) {
      const job = await claimNext(driver);
      if (job === null) {
        await sleep(IDLE_POLL_MS);
        continue;
      }
      emitAppEvent({
        kind: 'job-updated',
        jobId: job.id,
        courseId: job.courseId ?? '',
        jobKind: job.jobType,
        status: 'running',
      });
      await runJob(job, db, driver);
      await sleep(BUSY_POLL_MS);
    }
  } catch {
    // The db handle vanished (window shutting down): end quietly.
  } finally {
    running = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Starts the background loop; safe to call multiple times. */
export function startWorker(): void {
  if (running) return;
  running = true;
  stopped = false;
  void loop();
}

export function stopWorker(): void {
  stopped = true;
}
