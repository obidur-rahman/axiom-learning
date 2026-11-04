import type { DbDriver } from './driver';
import { listCourses } from './courses';
import type { Course, MaterialKind, MaterialStatus } from './types';

/**
 * Read-only aggregates for the Dashboard and the course library. The UI must
 * never guess at study state, so every number here comes from the same local
 * tables the rest of the app writes to.
 */
export interface CourseSummary {
  course: Course;
  /** Materials attached to the course. */
  materials: number;
  /** Pages with readable text (the ones the tutor and lessons can cite). */
  pages: number;
  /** Topics extracted or added by hand. */
  topics: number;
  /** Core + Bridge nodes in the latest roadmap. */
  planned: number;
  /** Planned nodes marked done or known. */
  finished: number;
  /** Planned nodes marked known. */
  known: number;
  nextTopicId: string | null;
  nextTopicTitle: string | null;
}

export interface RecentMaterial {
  id: string;
  courseId: string;
  courseTitle: string;
  kind: MaterialKind;
  status: MaterialStatus;
  pageCount: number | null;
  createdAt: string;
}

interface CountRow {
  course_id: string;
  total: number;
}

function toCountMap(rows: CountRow[]): Map<string, number> {
  return new Map(rows.map((row) => [String(row.course_id), Number(row.total)]));
}

export async function courseSummaries(db: DbDriver): Promise<CourseSummary[]> {
  const courses = await listCourses(db);
  if (courses.length === 0) return [];

  const [materialRows, pageRows, topicRows, planRows, nextRows] = await Promise.all([
    db.select<CountRow>('SELECT course_id, COUNT(*) AS total FROM materials GROUP BY course_id'),
    db.select<CountRow>(
      `SELECT m.course_id AS course_id, COUNT(*) AS total
       FROM material_pages p JOIN materials m ON m.id = p.material_id
       WHERE p.text IS NOT NULL GROUP BY m.course_id`,
    ),
    db.select<CountRow>('SELECT course_id, COUNT(*) AS total FROM topics GROUP BY course_id'),
    db.select<{
      course_id: string;
      planned: number;
      finished: number;
      known: number;
    }>(
      `SELECT r.course_id AS course_id,
              COUNT(*) AS planned,
              SUM(CASE WHEN COALESCE(u.status, 'not_started') IN ('done','known') THEN 1 ELSE 0 END) AS finished,
              SUM(CASE WHEN COALESCE(u.status, 'not_started') = 'known' THEN 1 ELSE 0 END) AS known
       FROM roadmap_nodes n
       JOIN roadmap_versions r ON r.id = n.roadmap_version_id
       LEFT JOIN user_progress u
         ON u.course_id = r.course_id AND u.topic_id = n.topic_id
       WHERE n.node_type IN ('core','bridge')
         AND r.version = (SELECT MAX(version) FROM roadmap_versions WHERE course_id = r.course_id)
       GROUP BY r.course_id`,
    ),
    db.select<{ course_id: string; topic_id: string; title: string }>(
      `SELECT r.course_id AS course_id, n.topic_id AS topic_id,
              COALESCE(t.title, n.topic_id) AS title
       FROM roadmap_nodes n
       JOIN roadmap_versions r ON r.id = n.roadmap_version_id
       LEFT JOIN topics t ON t.id = n.topic_id
       LEFT JOIN user_progress u
         ON u.course_id = r.course_id AND u.topic_id = n.topic_id
       WHERE n.node_type IN ('core','bridge')
         AND r.version = (SELECT MAX(version) FROM roadmap_versions WHERE course_id = r.course_id)
         AND COALESCE(u.status, 'not_started') IN ('not_started','in_progress')
       ORDER BY COALESCE(n.order_index, 999999)`,
    ),
  ]);

  const materials = toCountMap(materialRows);
  const pages = toCountMap(pageRows);
  const topics = toCountMap(topicRows);
  const plans = new Map(planRows.map((row) => [String(row.course_id), row]));
  const next = new Map<string, { id: string; title: string }>();
  for (const row of nextRows) {
    const courseId = String(row.course_id);
    if (!next.has(courseId)) {
      next.set(courseId, { id: String(row.topic_id), title: String(row.title) });
    }
  }

  return courses.map((course) => {
    const plan = plans.get(course.id);
    const upcoming = next.get(course.id);
    return {
      course,
      materials: materials.get(course.id) ?? 0,
      pages: pages.get(course.id) ?? 0,
      topics: topics.get(course.id) ?? 0,
      planned: Number(plan?.planned ?? 0),
      finished: Number(plan?.finished ?? 0),
      known: Number(plan?.known ?? 0),
      nextTopicId: upcoming?.id ?? null,
      nextTopicTitle: upcoming?.title ?? null,
    };
  });
}

/** Latest uploaded material across all courses, for the dashboard activity list. */
export async function recentMaterials(db: DbDriver, limit = 6): Promise<RecentMaterial[]> {
  const rows = await db.select<{
    id: string;
    course_id: string;
    course_title: string;
    kind: string;
    status: string;
    page_count: number | null;
    created_at: string;
  }>(
    `SELECT m.id, m.course_id, c.title AS course_title, m.kind, m.status,
            m.page_count, m.created_at
     FROM materials m JOIN courses c ON c.id = m.course_id
     ORDER BY m.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: String(row.id),
    courseId: String(row.course_id),
    courseTitle: String(row.course_title),
    kind: row.kind as MaterialKind,
    status: row.status as MaterialStatus,
    pageCount: row.page_count === null ? null : Number(row.page_count),
    createdAt: String(row.created_at),
  }));
}
