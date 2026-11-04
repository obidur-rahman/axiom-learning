import type { DbDriver } from './driver';

/**
 * In-process job queue (AXL-SCHEMA-001 section 4.13). The worker claims one
 * job at a time with a conditional UPDATE claim: only the writer whose
 * UPDATE changed a row owns the job (the Postgres `skip locked` query has
 * no direct SQLite form; the claim check is the same idea).
 */
export type JobType =
  | 'read_material'
  | 'build_topics'
  | 'find_prerequisites'
  | 'build_roadmap'
  | 'build_lesson'
  | 'make_practice';

export interface JobRow {
  id: string;
  jobType: JobType;
  courseId: string | null;
  materialId: string | null;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  maxAttempts: number;
}

interface JobRecord extends Record<string, unknown> {
  id: string; job_type: string; course_id: string | null; payload: string;
  status: string; attempts: number; max_attempts: number; last_error: string | null;
}

function uuid(): string {
  return crypto.randomUUID();
}

function rowToJob(row: JobRecord): JobRow {
  return {
    id: row.id,
    jobType: row.job_type as JobType,
    courseId: row.course_id,
    materialId: null,
    payload: row.payload ? (JSON.parse(row.payload) as Record<string, unknown>) : {},
    status: row.status as JobRow['status'],
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

export async function enqueue(
  db: DbDriver,
  jobType: JobType,
  args: { courseId: string | null; materialId?: string | null; payload?: Record<string, unknown> },
): Promise<string> {
  const id = uuid();
  const payload = { ...(args.payload ?? {}), materialId: args.materialId ?? null };
  await db.execute(
    `INSERT INTO jobs (id, job_type, course_id, payload, status, attempts, max_attempts)
     VALUES ($1, $2, $3, $4, 'queued', 0, 3)`,
    [id, jobType, args.courseId, JSON.stringify(payload)],
  );
  return id;
}

/** Claims the oldest queued job; returns null when the queue is empty. */
export async function claimNext(db: DbDriver, now = new Date().toISOString()): Promise<JobRow | null> {
  const rows = await db.select<JobRecord>(
    `SELECT id, job_type, course_id, payload, status, attempts, max_attempts, last_error
     FROM jobs WHERE status = 'queued' AND run_after <= $1
     ORDER BY created_at LIMIT 1`,
    [now],
  );
  const candidate = rows[0];
  if (!candidate) return null;
  const claimed = await db.execute(
    `UPDATE jobs SET status = 'running', locked_at = $2, attempts = attempts + 1
     WHERE id = $1 AND status = 'queued'`,
    [candidate.id, now],
  );
  if (claimed === 0) return null; // another worker claimed it first
  return { ...rowToJob(candidate), status: 'running', attempts: candidate.attempts + 1 };
}

export async function complete(db: DbDriver, jobId: string): Promise<void> {
  await db.execute(
    `UPDATE jobs SET status = 'done', finished_at = $2, last_error = NULL WHERE id = $1`,
    [jobId, new Date().toISOString()],
  );
}

/** Marks a failure; requeues with backoff while attempts remain. */
export async function fail(
  db: DbDriver,
  jobId: string,
  message: string,
  backoffSeconds = 30,
  now: Date = new Date(),
): Promise<void> {
  const rows = await db.select<{ attempts: number; max_attempts: number }>(
    'SELECT attempts, max_attempts FROM jobs WHERE id = $1',
    [jobId],
  );
  const row = rows[0];
  if (!row) return;
  const finishedAt = now.toISOString();
  const runAfter = new Date(now.getTime() + backoffSeconds * 1000).toISOString();
  if (row.attempts < row.max_attempts) {
    await db.execute(
      `UPDATE jobs SET status = 'queued', run_after = $3, last_error = $2 WHERE id = $1`,
      [jobId, message, runAfter],
    );
  } else {
    await db.execute(
      `UPDATE jobs SET status = 'failed', finished_at = $3, last_error = $2 WHERE id = $1`,
      [jobId, message, finishedAt],
    );
  }
}

export async function listJobs(
  db: DbDriver,
  courseId: string,
): Promise<(JobRow & { lastError: string | null })[]> {
  const rows = await db.select<JobRecord & { course_id: string | null }>(
    'SELECT id, job_type, course_id, payload, status, attempts, max_attempts, last_error FROM jobs WHERE course_id = $1 ORDER BY created_at DESC',
    [courseId],
  );
  return rows.map((row) => ({ ...rowToJob(row), lastError: row.last_error }));
}

/** Reset crashed 'running' jobs back to queued after app restart. */
export async function requeueStuck(db: DbDriver): Promise<void> {
  await db.execute(
    `UPDATE jobs SET status = 'queued' WHERE status = 'running'`,
  );
}


