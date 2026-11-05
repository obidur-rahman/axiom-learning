'use client';

import type { DbDriver } from '@axiom/data';

export interface TopicOption {
  id: string;
  title: string;
  nodeType: string;
}

/** Topics in roadmap order, minus the ones the learner skipped. */
export async function listTopicOptions(db: DbDriver, courseId: string): Promise<TopicOption[]> {
  const rows = await db.select<Record<string, unknown>>(
    `SELECT t.id, t.title, COALESCE(n.node_type, 'core') AS node_type
     FROM topics t
     LEFT JOIN roadmap_nodes n
       ON n.topic_id = t.id
       AND n.roadmap_version_id = (SELECT id FROM roadmap_versions WHERE course_id = $1 ORDER BY version DESC LIMIT 1)
     WHERE t.course_id = $1 AND COALESCE(n.node_type, 'core') <> 'skipped'
     ORDER BY COALESCE(n.order_index, 999999), t.created_at`,
    [courseId],
  );
  return rows.map((row) => ({
    id: String(row['id']),
    title: String(row['title']),
    nodeType: String(row['node_type']),
  }));
}
