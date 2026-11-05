'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  exportCourse,
  listProgress,
  setProgress,
  updateCourse,
  type DbDriver,
  type ProgressStatus,
} from '@axiom/data';
import { onAppEvent } from '../lib/events';
import { getDb } from '../lib/db';
import { usePrefs } from '../lib/prefs';

interface PlanRow {
  id: string;
  title: string;
  status: ProgressStatus;
  inOrder: boolean;
}

const STATUSES: { value: ProgressStatus; label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'Learning' },
  { value: 'done', label: 'Done' },
  { value: 'known', label: 'Known' },
];

async function loadPlan(db: DbDriver, courseId: string, includeSkipped: boolean): Promise<PlanRow[]> {
  const nodes = await db.select<Record<string, unknown>>(
    `SELECT n.topic_id, n.node_type, n.order_index, COALESCE(t.title, n.topic_id) AS title
     FROM roadmap_nodes n
     JOIN roadmap_versions r ON r.id = n.roadmap_version_id
     LEFT JOIN topics t ON t.id = n.topic_id
     WHERE r.course_id = $1
       AND r.version = (SELECT MAX(version) FROM roadmap_versions WHERE course_id = $1)
     ORDER BY COALESCE(n.order_index, 999999)`,
    [courseId],
  );
  const progress = new Map((await listProgress(db, courseId)).map((row) => [row.topicId, row.status]));
  const seen = new Set<string>();
  const rows: PlanRow[] = [];
  for (const node of nodes) {
    const id = String(node['topic_id']);
    if (seen.has(id)) continue;
    seen.add(id);
    const nodeType = String(node['node_type'] ?? 'core');
    const status = progress.get(id) ?? 'not_started';
    if (nodeType === 'skipped' && status === 'not_started' && !includeSkipped) continue;
    rows.push({
      id,
      title: String(node['title'] ?? id),
      status,
      inOrder: nodeType === 'core' || nodeType === 'bridge',
    });
  }
  return rows;
}

/**
 * Progress + plan screen (FR-070..FR-074): the study plan in order, with the
 * next topic at the top, per-topic status that feeds the roadmap weights,
 * and the course exam date. Offline-first: everything here runs on the
 * local database, with no network.
 */
export function ProgressPanel({ courseId }: { courseId: string }) {
  const prefs = usePrefs();
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [examDate, setExamDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportNote, setExportNote] = useState('');

  /** Offline export: JSON snapshot in the clipboard; always present even
   * without an embedding model or file system access. */
  const handleExport = useCallback(async () => {
    const db = await getDb();
    const snapshot = await exportCourse(db.driver, courseId);
    const json = JSON.stringify(snapshot, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setExportNote(`Copied ${Math.round(json.length / 1024)} KB of course JSON to the clipboard.`);
    } catch {
      setExportNote('Clipboard blocked; nothing was copied.');
    }
  }, [courseId]);

  const load = useCallback(async () => {
    const db = await getDb();
    setPlan(await loadPlan(db.driver, courseId, prefs.showSkippedInPlan));
    const rows = await db.driver.select<{ exam_date: string | null }>(
      'SELECT exam_date FROM courses WHERE id = $1',
      [courseId],
    );
    setExamDate((rows[0]?.exam_date ?? '').slice(0, 10));
  }, [courseId, prefs.showSkippedInPlan]);

  useEffect(() => {
    void load();
    return onAppEvent((event) => {
      if (event.kind === 'job-updated' && event.courseId === courseId) void load();
    });
  }, [load, courseId]);

  const setStatus = useCallback(
    async (topicId: string, status: ProgressStatus) => {
      setBusy(true);
      try {
        const db = await getDb();
        await setProgress(db.driver, courseId, topicId, status);
        await db.driver.execute('UPDATE user_progress SET updated_at = $2 WHERE course_id = $1 AND topic_id = $3', [courseId, new Date().toISOString(), topicId]);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [courseId, load],
  );

  const saveExam = useCallback(async () => {
    const db = await getDb();
    await updateCourse(db.driver, courseId, { examDate: examDate === '' ? null : examDate });
    await load();
  }, [courseId, examDate, load]);

  const done = plan.filter((row) => row.status === 'done' || row.status === 'known').length;
  const inOrder = plan.filter((row) => row.inOrder);
  const skippedRows = plan.filter((row) => !row.inOrder);
  const next = inOrder.find((row) => row.status === 'not_started' || row.status === 'in_progress');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          {done}/{plan.length} topics finished
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-text-muted">
            Exam date
            <input
              type="date"
              value={examDate}
              onChange={(event) => setExamDate(event.target.value)}
              onBlur={() => void saveExam()}
              className="rounded-[var(--radius)] border border-border bg-surface px-2 py-1 text-sm text-text"
            />
          </label>
          <button
            onClick={() => void handleExport()}
            className="rounded-full border border-border px-3 py-1.5 text-xs hover:border-text-muted"
          >
            Export data (JSON)
          </button>
        </div>
      </div>

      {exportNote !== '' && <p className="text-xs text-text-muted" aria-live="polite">{exportNote}</p>}

      {next !== undefined && (
        <div className="rounded-[var(--radius)] border border-accent bg-surface p-3">
          <p className="text-xs text-text-muted">Next up</p>
          <p className="text-sm font-medium">{next.title}</p>
          <a
            href={`/course?id=${courseId}&tab=lessons`}
            className="mt-1 inline-block text-xs text-accent underline-offset-4 hover:underline"
          >
            Open its lesson
          </a>
        </div>
      )}

      <ol className="flex flex-col gap-2">
        {inOrder.map((row, index) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-surface px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm">
                {index + 1}. {row.title}
              </p>
              <p className="text-xs text-text-muted">{row.status.replace('_', ' ')}</p>
            </div>
            <select
              value={row.status}
              disabled={busy}
              onChange={(event) => void setStatus(row.id, event.target.value as ProgressStatus)}
              className="rounded-[var(--radius)] border border-border bg-surface px-2 py-1 text-xs text-text"
            >
              {STATUSES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </li>
        ))}
        {inOrder.length === 0 && (
          <li className="rounded-[var(--radius)] border border-border bg-surface p-4 text-sm text-text-muted">
            Build the roadmap first; the study plan follows it.
          </li>
        )}
      </ol>

      {prefs.showSkippedInPlan && skippedRows.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Skipped topics">
          <p className="text-xs font-medium text-text-muted">Skipped in the roadmap</p>
          <ul>
            {skippedRows.map((row) => (
              <li key={row.id} className="row flex items-center justify-between gap-2">
                <p className="truncate text-[12.5px] text-text-muted">{row.title}</p>
                <span className="chip">skipped</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-text-muted">
        Progress is stored locally and survives offline use; the plan and
        lessons need no internet while your local model runs.
      </p>
    </div>
  );
}
