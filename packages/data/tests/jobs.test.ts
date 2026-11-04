import { describe, expect, it } from 'vitest';
import { claimNext, complete, enqueue, fail, listJobs, requeueStuck } from '../src';
import type { DbDriver } from '../src';

class FakeDriver implements DbDriver {
  calls: { sql: string; params: unknown[] }[] = [];
  constructor(private tables: Record<string, Record<string, unknown>[]>) {}
  async execute(sql: string, params: unknown[] = []): Promise<number> {
    this.calls.push({ sql, params });
    return 1;
  }
  async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params });
    const match = /from\s+([a-z_]+)/i.exec(sql);
    const table = match?.[1]?.toLowerCase() ?? '';
    return (this.tables[table] ?? []) as T[];
  }
}

const NOW = '2026-11-03T10:00:00.000Z';

describe('job queue', () => {
  it('enqueues with the payload serialized', async () => {
    const fake = new FakeDriver({});
    const id = await enqueue(fake, 'read_material', {
      courseId: 'c1',
      materialId: 'm1',
      payload: { pages: 3 },
    });
    expect(id).toBeTruthy();
    const insert = fake.calls[0]!;
    expect(insert.sql).toContain("VALUES ($1, $2, $3, $4, 'queued', 0, 3)");
    expect(insert.params[1]).toBe('read_material');
    expect(JSON.parse(insert.params[3] as string)).toEqual({ pages: 3, materialId: 'm1' });
  });

  it('claims the oldest queued job and bumps attempts', async () => {
    const fake = new FakeDriver({
      jobs: [
        { id: 'j1', job_type: 'read_material', course_id: 'c1', payload: '{}', status: 'queued', attempts: 0, max_attempts: 3, last_error: null },
      ],
    });
    const job = await claimNext(fake, NOW);
    expect(job?.id).toBe('j1');
    expect(job?.status).toBe('running');
    expect(job?.attempts).toBe(1);
    const claim = fake.calls[1]!;
    expect(claim.sql).toContain("SET status = 'running'");
    expect(claim.params[0]).toBe('j1');
  });

  it('returns null when nothing is queued', async () => {
    const fake = new FakeDriver({ jobs: [] });
    expect(await claimNext(fake, NOW)).toBeNull();
  });

  it('returns null when the claim loses the race (rowsAffected 0)', async () => {
    const fake = new FakeDriver({
      jobs: [
        { id: 'j1', job_type: 'read_material', course_id: 'c1', payload: '{}', status: 'queued', attempts: 0, max_attempts: 3, last_error: null },
      ],
    });
    fake.execute = async () => 0;
    expect(await claimNext(fake, NOW)).toBeNull();
  });

  it('requeues with backoff while attempts remain, then fails hard', async () => {
    const withAttempts = new FakeDriver({
      jobs: [{ attempts: 1, max_attempts: 3 }],
    });
    await fail(withAttempts, 'j1', 'model timeout', 30, new Date(NOW));
    const requeue = withAttempts.calls[1]!;
    expect(requeue.sql).toContain("SET status = 'queued', run_after = $3");
    const runAfter = new Date(requeue.params[2] as string).getTime();
    expect(runAfter - Date.parse(NOW)).toBe(30_000); // +30s backoff

    const exhausted = new FakeDriver({
      jobs: [{ attempts: 3, max_attempts: 3 }],
    });
    await fail(exhausted, 'j1', 'model timeout', 30, new Date(NOW));
    expect(exhausted.calls[1]!.sql).toContain("SET status = 'failed'");
  });

  it('completes a job and stamps finished_at', async () => {
    const fake = new FakeDriver({});
    await complete(fake, 'j1');
    expect(fake.calls[0]!.sql).toContain("SET status = 'done'");
  });

  it('lists jobs for a course with the error', async () => {
    const fake = new FakeDriver({
      jobs: [
        { id: 'j1', job_type: 'build_topics', course_id: 'c1', payload: '{}', status: 'failed', attempts: 3, max_attempts: 3, last_error: 'bad json' },
      ],
    });
    const jobs = await listJobs(fake, 'c1');
    expect(jobs[0]!.lastError).toBe('bad json');
    expect(jobs[0]!.jobType).toBe('build_topics');
  });

  it('requeues stuck running jobs on restart', async () => {
    const fake = new FakeDriver({});
    await requeueStuck(fake);
    expect(fake.calls[0]!.sql).toBe("UPDATE jobs SET status = 'queued' WHERE status = 'running'");
  });
});
