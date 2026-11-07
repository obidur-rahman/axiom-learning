import {
  applyOverrides,
  buildRoadmap,
  type Override,
  type PrerequisiteEdge,
  type Roadmap,
  type RoadmapInput,
  type Topic,
} from '@axiom/engine';
import type { DbDriver } from './driver';
import type { Course } from './types';

/** Bumped when the build rules change; saved with each roadmap version. */
export const ENGINE_VERSION = 'engine@0.1.0';

interface TopicDbRow extends Record<string, unknown> {
  id: string;
  title: string;
  parent_id: string | null;
  syllabus_order: number | null;
}

function uuid(): string {
  return crypto.randomUUID();
}

const EDGE_SOURCE_MAP = {
  model: 'model',
  shared: 'shared_table',
  user: 'manual',
} as const;

const EDGE_SOURCE_TO_DB = {
  model: 'model',
  shared_table: 'shared',
  manual: 'user',
} as const;

/** The course that owns a topic id, or undefined when the id is free. */
async function topicOwner(db: DbDriver, id: string): Promise<string | undefined> {
  const rows = await db.select<{ course_id: string }>(
    'SELECT course_id FROM topics WHERE id = $1',
    [id],
  );
  return rows[0]?.course_id;
}

/**
 * Save or update the topic list (pipeline step 2 output or manual edits).
 *
 * Topic ids are a global primary key, but every pipeline step provides ids
 * relative to one course. Earlier builds minted `T1..Tn` for every course, so
 * building course B updated course A's `T1` row and gave B no topic of its own.
 * Ids now live in a per-course namespace (`<courseId>:T1`), and a request for
 * an id another course owns is redirected instead of overwriting that row.
 * The first rebuild after the fix adopts this course's legacy `T1` rows, which
 * keeps their progress, questions and lessons attached.
 */
export async function upsertTopics(
  db: DbDriver,
  courseId: string,
  topics: Topic[],
  source: 'syllabus' | 'notes' | 'user' | 'premade' = 'user',
): Promise<Topic[]> {
  const prefix = `${courseId}:`;
  const saved: Topic[] = [];
  let order = 0;
  for (const topic of topics) {
    order += 1;
    let id = topic.id;
    let owner = await topicOwner(db, id);
    if (owner !== undefined && owner !== courseId) {
      // The id belongs to another course: never touch that row. Mint a new id
      // in this course's own namespace instead.
      id = `${prefix}${topic.id}`;
      owner = await topicOwner(db, id);
      if (owner !== undefined && owner !== courseId) {
        id = `${prefix}${uuid()}`;
        owner = undefined;
      }
    } else if (owner === undefined && id.startsWith(prefix)) {
      // A build before ids were scoped made this course's rows `T1..Tn`.
      // Reuse that row so a rebuild does not leave a duplicate behind.
      const legacyId = id.slice(prefix.length);
      if ((await topicOwner(db, legacyId)) === courseId) {
        id = legacyId;
        owner = courseId;
      }
    }
    if (owner === courseId) {
      await db.execute(
        `UPDATE topics SET title = $1, syllabus_order = $2, source = $3
         WHERE id = $4 AND course_id = $5`,
        [topic.title, order, source, id, courseId],
      );
    } else {
      await db.execute(
        `INSERT INTO topics (id, course_id, parent_id, title, description, syllabus_order, source, shared_concept_id)
         VALUES ($1, $2, NULL, $3, NULL, $4, $5, NULL)`,
        [id, courseId, topic.title, order, source],
      );
    }
    saved.push({ ...topic, id });
  }
  return saved;
}

/** Replace the prerequisite edges of a course (base graph only). */
export async function replaceEdges(
  db: DbDriver,
  courseId: string,
  edges: PrerequisiteEdge[],
): Promise<void> {
  await db.execute('DELETE FROM topic_edges WHERE course_id = $1', [courseId]);
  for (const edge of edges) {
    await db.execute(
      `INSERT INTO topic_edges (id, course_id, prerequisite_id, topic_id, confidence, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        uuid(),
        courseId,
        edge.from,
        edge.to,
        edge.confidence,
        EDGE_SOURCE_TO_DB[edge.source] ?? 'model',
      ],
    );
  }
}

/** Replace the computed weights of a course (TRD 5.4 step of the pipeline). */
export async function upsertWeights(
  db: DbDriver,
  courseId: string,
  weights: Record<string, number>,
  meta: { pastQuestionCounts?: Record<string, number>; suggested?: Iterable<string>; inSyllabus?: Iterable<string> } = {},
): Promise<void> {
  const suggested = new Set(meta.suggested ?? []);
  const syllabus = new Set(meta.inSyllabus ?? []);
  const counts = meta.pastQuestionCounts ?? {};
  for (const [topicId, weight] of Object.entries(weights)) {
    await db.execute(
      `REPLACE INTO topic_weights (topic_id, course_id, past_question_count, past_question_share,
         suggested, in_syllabus, weight, computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        topicId,
        courseId,
        counts[topicId] ?? 0,
        0,
        suggested.has(topicId) ? 1 : 0,
        syllabus.has(topicId) ? 1 : 0,
        weight,
        new Date().toISOString(),
      ],
    );
  }
}

/** Replace the base-level exclusions (FR-032 checkboxes). */
export async function setExcludedTopics(
  db: DbDriver,
  courseId: string,
  topicIds: string[],
): Promise<void> {
  await db.execute(
    "DELETE FROM exam_scope_rules WHERE course_id = $1 AND rule_type = 'exclude'",
    [courseId],
  );
  for (const topicId of topicIds) {
    await db.execute(
      `INSERT INTO exam_scope_rules (id, course_id, topic_id, rule_type, source_text)
       VALUES ($1, $2, $3, 'exclude', NULL)`,
      [uuid(), courseId, topicId],
    );
  }
}

/** Rebuild the base graph input from the tables. */
export async function getBaseInput(db: DbDriver, course: Course): Promise<RoadmapInput> {
  const topicRows = await db.select<TopicDbRow>(
    'SELECT id, title, parent_id, syllabus_order FROM topics WHERE course_id = $1 ORDER BY COALESCE(syllabus_order, 999999), created_at',
    [course.id],
  );
  const edgeRows = await db.select<{ prerequisite_id: string; topic_id: string; confidence: number | null; source: string }>(
    'SELECT prerequisite_id, topic_id, confidence, source FROM topic_edges WHERE course_id = $1',
    [course.id],
  );
  const weightRows = await db.select<{ topic_id: string; weight: number }>(
    'SELECT topic_id, weight FROM topic_weights WHERE course_id = $1',
    [course.id],
  );
  const excludedRows = await db.select<{ topic_id: string }>(
    "SELECT topic_id FROM exam_scope_rules WHERE course_id = $1 AND rule_type = 'exclude'",
    [course.id],
  );
  const knownRows = await db.select<{ topic_id: string }>(
    "SELECT topic_id FROM user_progress WHERE course_id = $1 AND status = 'known'",
    [course.id],
  );

  const weights: Record<string, number> = {};
  for (const row of weightRows) weights[row.topic_id] = row.weight;

  return {
    topics: topicRows.map((row) => ({ id: row.id, title: row.title })),
    edges: edgeRows
      .filter((row) => row.prerequisite_id !== row.topic_id)
      .map((row) => ({
        from: row.prerequisite_id,
        to: row.topic_id,
        confidence: row.confidence ?? 0.8,
        source: EDGE_SOURCE_MAP[row.source as keyof typeof EDGE_SOURCE_MAP] ?? 'model',
      })),
    weights,
    excluded: excludedRows.map((row) => row.topic_id),
    known: knownRows.map((row) => row.topic_id),
    bridgeDepth: course.bridgeDepth,
  };
}

export async function addOverride(db: DbDriver, courseId: string, override: Override): Promise<void> {
  const seqRows = await db.select<{ seq: number }>(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM node_overrides WHERE course_id = $1',
    [courseId],
  );
  const seq = seqRows[0]!.seq;
  const payload = JSON.stringify(override);
  const topicId =
    'topicId' in override ? override.topicId : 'topic' in override ? undefined : null;
  await db.execute(
    `INSERT INTO node_overrides (id, course_id, seq, action, topic_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [uuid(), courseId, seq, override.action, (topicId as string | null) ?? null, payload],
  );
}

/** Override rows with their sequence numbers (the UI restore action needs them). */
export async function loadOverrideRows(
  db: DbDriver,
  courseId: string,
): Promise<{ seq: number; override: Override }[]> {
  const rows = await db.select<{ seq: number; payload: string }>(
    'SELECT seq, payload FROM node_overrides WHERE course_id = $1 ORDER BY seq',
    [courseId],
  );
  return rows.map((row) => ({ seq: row.seq, override: JSON.parse(row.payload) as Override }));
}

export async function loadOverrides(db: DbDriver, courseId: string): Promise<Override[]> {
  return (await loadOverrideRows(db, courseId)).map((row) => row.override);
}

export async function removeOverride(db: DbDriver, courseId: string, seq: number): Promise<void> {
  await db.execute(
    'DELETE FROM node_overrides WHERE course_id = $1 AND seq >= $2',
    [courseId, seq],
  );
  // Re-sequence so the order stays dense and chronological.
  await db.execute(
    `UPDATE node_overrides SET seq = seq - 1 WHERE course_id = $1 AND seq > $2`,
    [courseId, seq + 1],
  );
}

async function nextVersion(db: DbDriver, courseId: string): Promise<number> {
  const rows = await db.select<{ v: number }>(
    'SELECT COALESCE(MAX(version), 0) + 1 AS v FROM roadmap_versions WHERE course_id = $1',
    [courseId],
  );
  return rows[0]!.v;
}

/** Persist a built roadmap as a new version (TRD 6.4: rebuilds keep overrides). */
export async function saveRoadmapVersion(
  db: DbDriver,
  course: Course,
  roadmap: Roadmap,
): Promise<number> {
  const version = await nextVersion(db, course.id);
  const versionId = uuid();
  await db.execute(
    `INSERT INTO roadmap_versions (id, course_id, version, params, engine_version)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      versionId,
      course.id,
      version,
      JSON.stringify({ bridgeDepth: course.bridgeDepth }),
      ENGINE_VERSION,
    ],
  );
  for (const node of roadmap.nodes) {
    await db.execute(
      `INSERT INTO roadmap_nodes (id, roadmap_version_id, topic_id, node_type, reason_code,
         needed_by, depth, order_index, weight)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        uuid(),
        versionId,
        node.id,
        node.type,
        node.reason,
        JSON.stringify(node.neededBy),
        node.depth,
        node.order,
        node.weight,
      ],
    );
  }
  return version;
}

/**
 * Full service: rebuild from base + overrides, save as a new version.
 * The engine's own build is deterministic, so the saved version matches
 * what the UI recomputes (DEC-6: pruning in code, not in the model).
 */
export async function buildAndSaveRoadmap(
  db: DbDriver,
  course: Course,
): Promise<{ version: number; roadmap: Roadmap }> {
  const base = await getBaseInput(db, course);
  const overrides = await loadOverrides(db, course.id);
  const roadmap = buildRoadmap(applyOverrides(base, overrides));
  const version = await saveRoadmapVersion(db, course, roadmap);
  return { version, roadmap };
}

/** Saved versions, newest first (for the history list). */
export async function listRoadmapVersions(
  db: DbDriver,
  courseId: string,
): Promise<{ version: number; engineVersion: string; createdAt: string }[]> {
  const rows = await db.select<Record<string, unknown>>(
    'SELECT version, engine_version, created_at FROM roadmap_versions WHERE course_id = $1 ORDER BY version DESC',
    [courseId],
  );
  return rows.map((row) => ({
    version: Number(row['version']),
    engineVersion: String(row['engine_version'] ?? ''),
    createdAt: String(row['created_at'] ?? ''),
  }));
}

export async function loadLatestRoadmap(
  db: DbDriver,
  courseId: string,
): Promise<{ version: number; roadmap: Roadmap } | null> {
  const versionRows = await db.select<{ version: number }>(
    'SELECT MAX(version) AS version FROM roadmap_versions WHERE course_id = $1',
    [courseId],
  );
  const version = versionRows[0]?.version ?? null;
  return version === null ? null : loadRoadmapVersion(db, courseId, version);
}

/** Assembles any saved version (the history view reads older ones). */
export async function loadRoadmapVersion(
  db: DbDriver,
  courseId: string,
  version: number,
): Promise<{ version: number; roadmap: Roadmap } | null> {
  const rows = await db.select<{
    topic_id: string; title: string | null; node_type: string; reason_code: string; needed_by: string | null;
    depth: number | null; order_index: number | null; weight: number | null; version: number;
  }>(
    `SELECT n.*, r.version, COALESCE(t.title, '') AS title
     FROM roadmap_nodes n
     JOIN roadmap_versions r ON r.id = n.roadmap_version_id
     LEFT JOIN topics t ON t.id = n.topic_id
     WHERE r.course_id = $1 ORDER BY order_index`,
    [courseId],
  );
  const versionPath = rows.filter((row) => row.version === version);
  if (versionPath.length === 0) return null;
  const roadmap: Roadmap = {
    version,
    nodes: versionPath.map((row) => ({
      id: row.topic_id,
      title: row.title ?? '',
      type: row.node_type as Roadmap['nodes'][number]['type'],
      reason: row.reason_code as Roadmap['nodes'][number]['reason'],
      neededBy: row.needed_by ? (JSON.parse(row.needed_by) as string[]) : [],
      depth: row.depth ?? 0,
      order: row.order_index ?? 0,
      weight: row.weight ?? 0,
      isKnown: row.node_type === 'known',
    })),
  };
  return { version, roadmap };
}
