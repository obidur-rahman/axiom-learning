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
  cancelJob,
  claimNext,
  complete,
  fail,
  getActiveLesson,
  getLessonDocument,
  requeueStuck,
  type AxiomDb,
  type Course,
  type DbDriver,
  type JobRow,
} from '@axiom/data';
import { getDb } from './db';
import { loadConfig } from './provider';
import { installModelManager, releaseModelsAfterJob } from './model-manager';
import { installProviderFetch } from './provider-http';
import { readMaterial } from './read-material';
import { beginJob, endJob } from './job-control';
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

async function runJob(
  job: JobRow,
  db: AxiomDb,
  driver: DbDriver,
  signal: AbortSignal,
): Promise<void> {
  let failure: string | null = null;
  const report = (
    percent: number,
    message: string,
    detail: { materialId?: string; page?: { number: number; total: number; method: string; chars: number } } = {},
  ) =>
    emitAppEvent({
      kind: 'job-progress',
      jobId: job.id,
      courseId: job.courseId ?? '',
      jobKind: job.jobType,
      percent,
      message,
      ...detail,
    });
  try {
    if (job.courseId === null) {
      throw new Error(`job ${job.id} has no course`);
    }
    // A job claimed just before Stop was pressed never starts its work.
    signal.throwIfAborted();
    if (job.jobType === 'read_material') {
      const payload = (job.payload as { materialId?: unknown } | null) ?? {};
      const materialId = String(payload.materialId ?? '');
      if (materialId === '') throw new Error('read_material requires a materialId in the payload');
      report(3, 'Preparing the read');
      const result = await readMaterial(driver, materialId, {
        onProgress: ({ percent, message, page }) =>
          report(percent, message, {
            materialId,
            ...(page === undefined
              ? {}
              : {
                  page: {
                    number: page.number,
                    total: page.total,
                    method: page.method,
                    chars: page.chars,
                  },
                }),
          }),
        signal,
      });
      report(
        97,
        `Read ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}` +
          ` (${result.readable} with text${result.embedded > 0 ? `, ${result.embedded} embedded` : ''})` +
          (result.visionError === null
            ? ''
            : ` - model read failed: ${result.visionError}`),
      );
      await complete(driver, job.id);
    } else if (job.jobType === 'build_topics') {
      const course = await requireCourse(driver, job.courseId);
      // Syllabus pages first: they carry the topic list, and chunked extraction
      // samples evenly, so those chunks are always part of the run.
      const pages = await driver.select<{ text: string | null }>(
        `SELECT p.text FROM material_pages p
         JOIN materials m ON m.id = p.material_id
         WHERE m.course_id = $1 AND p.text IS NOT NULL AND p.text <> ''
         ORDER BY CASE m.kind
             WHEN 'syllabus' THEN 0 WHEN 'notes' THEN 1
             WHEN 'past_questions' THEN 2 ELSE 3 END,
           m.created_at, p.page_number`,
        [job.courseId],
      );
      if (pages.length === 0) {
        throw new Error('No readable pages yet. Upload material first.');
      }
      report(10, `Reading ${pages.length} page${pages.length === 1 ? '' : 's'}`);
      const ctx: RunContext = { db, course, config: loadConfig, signal };
      await buildTopicsStep(ctx, pages, (done, total) =>
        report(
          15 + Math.round((done / Math.max(1, total)) * 70),
          `Extracting topics from part ${done} of ${total}`,
        ),
      );
      report(90, 'Saving the topic list');
      await complete(driver, job.id);
    } else if (job.jobType === 'build_roadmap') {
      const course = await requireCourse(driver, job.courseId);
      report(15, 'Loading the topics');
      const ctx: RunContext = { db, course, config: loadConfig, signal };
      report(45, 'Proposing prerequisites with the model');
      await buildRoadmapStep(ctx);
      report(90, 'Saving the new roadmap');
      await complete(driver, job.id);
    } else if (job.jobType === 'build_lesson') {
      const payload =
        (job.payload as {
          topicId?: unknown;
          depth?: unknown;
        } | null) ?? {};
      const topicId = String(payload.topicId ?? '');
      if (topicId === '') throw new Error('build_lesson requires a topicId in the payload');
      const rawDepth = String(payload.depth ?? 'core');
      const depth: 'core' | 'bridge' = rawDepth === 'bridge' ? 'bridge' : 'core';
      const course = await requireCourse(driver, job.courseId);
      const ctx: RunContext = { db, course, config: loadConfig, signal };
      let readyLessonId: string | null = null;

      let lessonId: string | null = null;
      let partialId: string | null = null;
      try {
        const result = await buildTeachingLesson(ctx, topicId, {
          depth,
          onProgress: report,
          onSlide: (document, id) => {
            partialId = id;
            lessonId = id;
            emitAppEvent({
              kind: 'lesson-progress',
              courseId: job.courseId ?? '',
              topicId,
              lessonId: id,
              beatCount: document.beats.length,
              totalBeats: document.plannedBeats ?? document.beats.length,
            });
          },
        });
        lessonId = result.lessonId;
      } catch {
        // Teaching board failed: keep the older Markdown lesson working, but
        // never throw away slides that were already written and shown.
        if (partialId === null) {
          await buildLessonStep(driver, job.courseId, topicId, loadConfig, depth);
          const active = await getActiveLesson(driver, topicId, 'mixed', depth);
          lessonId = active?.id ?? null;
        } else {
          const saved = await getLessonDocument(driver, partialId);
          lessonId = saved !== null && saved.beats.length > 0 ? partialId : null;
          if (lessonId === null) {
            await buildLessonStep(driver, job.courseId, topicId, loadConfig, depth);
            const active = await getActiveLesson(driver, topicId, 'mixed', depth);
            lessonId = active?.id ?? null;
          }
        }
      }
      readyLessonId = lessonId;
      await complete(driver, job.id);
      emitAppEvent({
        kind: 'lesson-ready',
        courseId: job.courseId,
        topicId,
        lessonId: readyLessonId ?? job.id,
      });
    } else if (job.jobType === 'extract_past_questions') {
      const course = await requireCourse(driver, job.courseId);
      report(20, 'Reading the past-paper pages');
      const ctx: RunContext = { db, course, config: loadConfig, signal };
      await extractPastQuestionsStep(ctx);
      report(90, 'Saving the questions');
      await complete(driver, job.id);
    } else if (job.jobType === 'generate_questions') {
      const course = await requireCourse(driver, job.courseId);
      report(20, 'Writing questions from the notes');
      const ctx: RunContext = { db, course, config: loadConfig, signal };
      await generateQuestionsStep(ctx);
      report(90, 'Saving the questions');
      await complete(driver, job.id);
    } else {
      // Unknown kind: finish it so the queue does not clog.
      await complete(driver, job.id);
    }
  } catch (error) {
    if (signal.aborted) {
      // Stopped by the learner: record it, but never retry it.
      failure = 'Stopped by you.';
      await cancelJob(driver, job.id);
    } else {
      failure = error instanceof Error ? error.message : String(error);
      await fail(driver, job.id, failure);
    }
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
  // Pipeline model calls run in the webview too; use the desktop transport
  // and route each request through the role-aware local model manager.
  await installProviderFetch();
  installModelManager();
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
      const controller = beginJob(job.id);
      try {
        await runJob(job, db, driver, controller.signal);
      } finally {
        endJob(job.id);
        // The job is over: free the local model memory when the setting asks.
        // The next job's first request swaps in the model it needs.
        await releaseModelsAfterJob();
      }
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
