'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addOverride,
  enqueue,
  loadOverrideRows,
  removeOverride,
  setExcludedTopics,
  type DbDriver,
} from '@axiom/data';
import type { Override } from '@axiom/engine';
import { getDb } from '../lib/db';

interface TopicRow {
  id: string;
  title: string;
  weight: number;
  excluded: boolean;
}

interface OverrideRow {
  seq: number;
  override: Override;
}

function loadTopics(db: DbDriver, courseId: string): Promise<TopicRow[]> {
  return (async () => {
    const rows = await db.select<Record<string, unknown>>(
      `SELECT t.id, t.title, COALESCE(w.weight, 0) AS weight
       FROM topics t LEFT JOIN topic_weights w
         ON w.course_id = t.course_id AND w.topic_id = t.id
       WHERE t.course_id = $1 ORDER BY COALESCE(t.syllabus_order, 999999), t.created_at`,
      [courseId],
    );
    const excluded = await db.select<{ topic_id: string }>(
      "SELECT topic_id FROM exam_scope_rules WHERE course_id = $1 AND rule_type = 'exclude'",
      [courseId],
    );
    const out = new Set(excluded.map((row) => row.topic_id));
    return rows.map((row) => ({
      id: String(row['id']),
      title: String(row['title']),
      weight: Number(row['weight']),
      excluded: out.has(String(row['id'])),
    }));
  })();
}

/**
 * Topics & exam scope screen (FR-012..FR-016, FR-032): the learner decides
 * per topic with three levers - include/exclude from the exam scope (the
 * base rule), mark_skip for this roadmap only, and manual topic entries.
 * Every change immediately affects the next rebuild.
 */
export function TopicsPanel({ courseId }: { courseId: string }) {
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const db = await getDb();
    setTopics(await loadTopics(db.driver, courseId));
    setOverrides(await loadOverrideRows(db.driver, courseId));
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const db = await getDb();
      await enqueue(db.driver, 'build_topics', { courseId });
      await enqueue(db.driver, 'build_roadmap', { courseId });
      await load();
    } finally {
      setBusy(false);
    }
  }, [courseId, load]);

  const toggleScope = useCallback(
    async (topic: TopicRow, inScope: boolean) => {
      const db = await getDb();
      const excludedIds = topics
        .filter((entry) => (entry.id === topic.id ? !inScope : entry.excluded))
        .map((entry) => entry.id);
      await setExcludedTopics(db.driver, courseId, excludedIds);
      await load();
    },
    [topics, courseId, load],
  );

  const markSkip = useCallback(
    async (topicId: string) => {
      const db = await getDb();
      const already = overrides.some(
        (entry) => entry.override.action === 'mark_skip' && entry.override.topicId === topicId,
      );
      if (already) {
        const row = overrides.find(
          (entry) => entry.override.action === 'mark_skip' && entry.override.topicId === topicId,
        );
        if (row !== undefined) await removeOverride(db.driver, courseId, row.seq);
      } else {
        await addOverride(db.driver, courseId, { action: 'mark_skip', topicId });
      }
      await load();
    },
    [overrides, courseId, load],
  );

  const addTopic = useCallback(async () => {
    if (newTitle.trim() === '') return;
    const db = await getDb();
    await addOverride(db.driver, courseId, {
      action: 'add_node',
      topic: { id: `user-${crypto.randomUUID().slice(0, 8)}`, title: newTitle.trim() },
    });
    setNewTitle('');
    await load();
  }, [newTitle, courseId, load]);

  const deleteTopic = useCallback(
    async (topicId: string) => {
      const db = await getDb();
      // The base row goes away, and any add_node override for it is removed.
      await db.driver.execute('DELETE FROM topics WHERE id = $1 AND course_id = $2', [topicId, courseId]);
      for (const entry of overrides) {
        if (entry.override.action === 'add_node' && entry.override.topic.id === topicId) {
          await removeOverride(db.driver, courseId, entry.seq);
        }
      }
      await load();
    },
    [overrides, courseId, load],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void addTopic();
          }}
          placeholder="Add a topic manually"
          className="flex-1 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={() => void addTopic()}
          disabled={newTitle.trim() === ''}
          className="rounded-[var(--radius)] border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-40"
        >
          Add
        </button>
        <button
          onClick={() => void refresh()}
          disabled={busy}
          className="rounded-[var(--radius)] bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Applying...' : 'Apply to roadmap'}
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {topics.map((topic) => {
          const skipped = overrides.some(
            (entry) => entry.override.action === 'mark_skip' && entry.override.topicId === topic.id,
          );
          return (
            <li
              key={topic.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-surface p-3"
            >
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${topic.excluded ? 'text-text-muted line-through' : ''}`}>
                  {topic.title}
                </p>
                <p className="text-xs text-text-muted">
                  weight {(topic.weight * 100).toFixed(0)}%
                  {skipped && ' · skipped in this roadmap'}
                  {topic.excluded && ' · out of exam scope'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <label className="flex items-center gap-1 text-xs text-text-muted">
                  <input
                    type="checkbox"
                    checked={!topic.excluded}
                    onChange={(event) => void toggleScope(topic, event.target.checked)}
                    className="accent-[var(--color-accent)]"
                  />
                  In scope
                </label>
                <button
                  onClick={() => void markSkip(topic.id)}
                  className={`rounded-[var(--radius)] border px-2 py-1 text-xs ${
                    skipped ? 'border-known' : 'border-border hover:border-warning'
                  }`}
                >
                  {skipped ? 'Restore' : 'Skip'}
                </button>
                <button
                  onClick={() => void deleteTopic(topic.id)}
                  className="rounded-[var(--radius)] border border-border px-2 py-1 text-xs hover:border-danger hover:text-danger"
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
        {topics.length === 0 && (
          <li className="rounded-[var(--radius)] border border-border bg-surface p-4 text-sm text-text-muted">
            No topics yet. Read material first, or add topics manually above.
          </li>
        )}
      </ul>
    </div>
  );
}
