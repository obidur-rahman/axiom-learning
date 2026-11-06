'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  addOverride,
  enqueue,
  getCourse,
  getKnownTopicIds,
  listRoadmapVersions,
  loadLatestRoadmap,
  loadOverrideRows,
  loadRoadmapVersion,
  removeOverride,
  setProgress,
  updateCourse,
  type Course,
} from '@axiom/data';
import {
  buildStudyPath,
  type Roadmap,
  type RoadmapNode,
  type StudyPathStep,
} from '@axiom/engine';
import { getDb } from '../lib/db';
import { onAppEvent } from '../lib/events';
import { ProgressBar } from './progress-bar';

const TYPE_COLORS: Record<string, string> = {
  core: 'var(--color-core)',
  bridge: 'var(--color-bridge)',
  skipped: 'var(--color-skipped)',
  known: 'var(--color-known)',
};

interface CourseEdge {
  from: string;
  to: string;
  confidence: number | null;
  source: string;
}

interface VersionRow {
  version: number;
  engineVersion: string;
  createdAt: string;
}

function reasonLabel(node: RoadmapNode): string {
  switch (node.reason) {
    case 'EXAM_TOPIC':
      return 'In the exam scope';
    case 'NEEDED_BY':
      return 'Prerequisite for a core topic';
    case 'EXCLUDED':
      return 'Out of the exam scope, but a core topic needs it';
    case 'LOW_WEIGHT':
      return 'Not in the exam scope';
    case 'KNOWN':
      return 'You marked this known';
    default:
      return node.reason;
  }
}

/**
 * Roadmap screen, rebuilt as a study path rather than a graph dump. The screen
 * answers four questions in order: what do I do next, what can I do now, what
 * is blocked and by what, and what is out of scope. The dependency map and the
 * version history are still there, one level down, for the learner who wants
 * to inspect or edit the graph.
 */
export function RoadmapPanel({ courseId }: { courseId: string }) {
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [detail, setDetail] = useState<RoadmapNode | null>(null);
  const [edges, setEdges] = useState<CourseEdge[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [knownIds, setKnownIds] = useState<string[]>([]);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const db = await getDb();
    const latest = await loadLatestRoadmap(db.driver, courseId);
    setRoadmap(latest === null ? null : latest.roadmap);
    setVersions(await listRoadmapVersions(db.driver, courseId));
    setViewVersion(null);
    setCourse(await getCourse(db.driver, courseId));
    setKnownIds(await getKnownTopicIds(db.driver, courseId));
    const edgeRows = await db.driver.select<Record<string, unknown>>(
      'SELECT prerequisite_id, topic_id, confidence, source FROM topic_edges WHERE course_id = $1',
      [courseId],
    );
    setEdges(
      edgeRows.map((row) => ({
        from: String(row['prerequisite_id']),
        to: String(row['topic_id']),
        confidence: row['confidence'] === null ? null : Number(row['confidence']),
        source: String(row['source'] ?? 'model'),
      })),
    );
  }, [courseId]);

  /** History list: show any saved version read-only. */
  const openVersion = useCallback(
    async (version: number | null) => {
      const db = await getDb();
      if (version === null) {
        setViewVersion(null);
        const latest = await loadLatestRoadmap(db.driver, courseId);
        setRoadmap(latest === null ? null : latest.roadmap);
        return;
      }
      const saved = await loadRoadmapVersion(db.driver, courseId, version);
      if (saved !== null) {
        setRoadmap(saved.roadmap);
        setViewVersion(version);
      }
    },
    [courseId],
  );

  useEffect(() => {
    void load();
    return onAppEvent((event) => {
      if (event.kind === 'job-updated' && event.jobKind === 'build_roadmap' && event.courseId === courseId) {
        void load();
      }
    });
  }, [load, courseId]);

  const path = useMemo(
    () =>
      roadmap === null
        ? null
        : buildStudyPath(
            roadmap,
            edges.map((edge) => ({ from: edge.from, to: edge.to })),
            knownIds,
          ),
    [roadmap, edges, knownIds],
  );

  const flow = useMemo(() => {
    if (roadmap === null) return null;
    const byDepth = new Map<number, RoadmapNode[]>();
    for (const node of roadmap.nodes) {
      const column = byDepth.get(node.depth) ?? [];
      column.push(node);
      byDepth.set(node.depth, column);
    }
    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    const nodes: Node[] = [];
    depths.forEach((depth, columnIndex) => {
      (byDepth.get(depth) ?? []).forEach((node, rowIndex) => {
        nodes.push({
          id: node.id,
          position: { x: columnIndex * 230, y: rowIndex * 68 },
          data: { label: node.title, badge: node.type },
          style: {
            background: 'var(--color-surface)',
            border: `1px solid ${TYPE_COLORS[node.type] ?? 'var(--color-border)'}`,
            color: 'var(--color-text)',
            borderRadius: 10,
            fontSize: 12,
            padding: '4px 8px',
            width: 200,
          },
        });
      });
    });
    const flowEdges: Edge[] = [];
    for (const node of roadmap.nodes) {
      for (const needed of node.neededBy) {
        flowEdges.push({
          id: `${needed}->${node.id}`,
          source: needed,
          target: node.id,
          style: { stroke: 'var(--color-border)' },
        });
      }
    }
    return { nodes, edges: flowEdges };
  }, [roadmap]);

  const markKnown = useCallback(
    async (topicId: string, known: boolean) => {
      if (viewVersion !== null) return;
      setBusy(true);
      try {
        const db = await getDb();
        await setProgress(db.driver, courseId, topicId, known ? 'known' : 'not_started');
        setKnownIds((current) =>
          known ? [...new Set([...current, topicId])] : current.filter((id) => id !== topicId),
        );
        // The saved roadmap encodes known topics, so rebuild it in the worker.
        await enqueue(db.driver, 'build_roadmap', { courseId });
      } finally {
        setBusy(false);
      }
    },
    [courseId, viewVersion],
  );

  const mutate = useCallback(
    async (override: Parameters<typeof addOverride>[2]) => {
      if (viewVersion !== null) return;
      setBusy(true);
      try {
        const db = await getDb();
        if (override.action === 'restore') {
          const rows = await loadOverrideRows(db.driver, courseId);
          const row = rows.find(
            (entry) => entry.override.action === 'mark_skip' && entry.override.topicId === override.topicId,
          );
          if (row !== undefined) await removeOverride(db.driver, courseId, row.seq);
        } else {
          await addOverride(db.driver, courseId, override);
        }
        await enqueue(db.driver, 'build_roadmap', { courseId });
      } finally {
        setBusy(false);
      }
    },
    [courseId, viewVersion],
  );

  const rebuild = useCallback(async () => {
    setBusy(true);
    try {
      const db = await getDb();
      await enqueue(db.driver, 'build_roadmap', { courseId });
    } finally {
      setBusy(false);
    }
  }, [courseId]);

  /** Drag from one node's handle to another records a prerequisite edge. */
  const handleConnect = useCallback(
    (connection: Connection) => {
      const { source, target } = connection;
      if (
        source === null ||
        target === null ||
        source === target ||
        viewVersion !== null ||
        roadmap === null ||
        !roadmap.nodes.some((node) => node.id === source) ||
        !roadmap.nodes.some((node) => node.id === target)
      ) {
        return;
      }
      void mutate({
        action: 'add_edge',
        edge: { from: source, to: target, confidence: 0.8, source: 'manual' },
      });
    },
    [roadmap, viewVersion, mutate],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const found = roadmap?.nodes.find((entry) => entry.id === node.id);
      if (found !== undefined) setDetail(found);
    },
    [roadmap],
  );

  if (roadmap === null || path === null) {
    return <RoadmapEmpty courseId={courseId} />;
  }

  const ready = path.steps.filter((step) => step.phase === 'ready' && !step.isNext);
  const waiting = path.steps.filter((step) => step.phase === 'waiting');
  const known = path.steps.filter((step) => step.phase === 'known');
  const skipped = roadmap.nodes.filter((node) => node.type === 'skipped');

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Study path</p>
            <h2 className="mt-1 text-[19px] font-semibold tracking-[-0.02em]">
              {path.knownInPath} of {path.totalInPath} topics known
            </h2>
            <p className="mt-1 text-[12.5px] text-text-muted">
              {path.counts.core} core · {path.counts.bridge} prerequisites filled in ·{' '}
              {path.counts.skipped} out of scope · version {roadmap.version}
              {viewVersion === null ? '' : ` (showing v${viewVersion}, read-only)`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-text-muted">
              Fill gaps
              <select
                value={course?.bridgeDepth ?? 2}
                onChange={(event) => {
                  void (async () => {
                    const db = await getDb();
                    await updateCourse(db.driver, courseId, { bridgeDepth: Number(event.target.value) });
                    await enqueue(db.driver, 'build_roadmap', { courseId });
                  })();
                }}
                className="rounded-[var(--radius)] border border-border bg-surface px-2 py-1 text-xs text-text"
                title="How many prerequisite levels to pull in below each core topic"
              >
                {[0, 1, 2, 3, 4].map((value) => (
                  <option key={value} value={value}>
                    {value === 0 ? 'off' : `${value} level${value === 1 ? '' : 's'}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void rebuild()}
              disabled={busy || viewVersion !== null}
              className="btn btn-ghost btn-sm"
              title="Rebuild the path from the current topics, scope and progress"
            >
              {busy ? 'Working...' : 'Rebuild'}
            </button>
            {viewVersion !== null && (
              <button
                type="button"
                onClick={() => void openVersion(null)}
                className="btn btn-primary btn-sm"
              >
                Back to latest
              </button>
            )}
          </div>
        </div>
        <ProgressBar label="Topics known" value={path.percentKnown} />
      </header>

      {path.next === null ? (
        <section className="rounded-[var(--radius-card)] border border-known/40 bg-surface p-4">
          <p className="text-[14px] font-medium">Everything in the path is known.</p>
          <p className="mt-1 text-[13px] text-text-muted">
            Add material, change the exam scope in Topics, or mark a topic not known to
            bring it back into the path.
          </p>
        </section>
      ) : (
        <section
          className="rounded-[var(--radius-card)] border border-accent/40 bg-accent-soft/50 p-4"
          aria-label="Next topic"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Next up</p>
              <h3 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">
                {path.next.node.title}
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-text-muted">
                <span className="chip">{path.next.node.type}</span>
                <span className="num">weight {Math.round(path.next.node.weight * 100)}%</span>
                {path.next.unlocks.length > 0 && (
                  <span>
                    unlocks {path.next.unlocks.length} topic
                    {path.next.unlocks.length === 1 ? '' : 's'}
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <a
                href={`/course?id=${courseId}&tab=lessons&topic=${path.next.node.id}`}
                className="btn btn-primary btn-sm"
              >
                Teach me this
              </a>
              <a
                href={`/course?id=${courseId}&tab=practice&topic=${path.next.node.id}`}
                className="btn btn-ghost btn-sm"
              >
                Practice
              </a>
              <button
                type="button"
                onClick={() => void markKnown(path.next!.node.id, true)}
                disabled={busy}
                className="btn btn-ghost btn-sm"
              >
                I know this
              </button>
            </div>
          </div>
          {path.next.unlocks.length > 0 && (
            <p className="mt-2 text-[12px] text-text-muted">
              Finishing this makes {path.next.unlocks.map((entry) => entry.title).join(', ')}{' '}
              ready.
            </p>
          )}
        </section>
      )}

      <StepGroup
        title="Ready now"
        hint="No unfinished prerequisite. Start anywhere here; top to bottom is the planned order."
        steps={ready}
        courseId={courseId}
        busy={busy}
        onKnown={markKnown}
        onDetail={setDetail}
      />

      <StepGroup
        title="Waiting on prerequisites"
        hint="Finish the topics named under each one to make it ready."
        steps={waiting}
        courseId={courseId}
        busy={busy}
        onKnown={markKnown}
        onDetail={setDetail}
      />

      {known.length > 0 && (
        <details className="rounded-[var(--radius)] border border-border bg-surface p-3">
          <summary className="cursor-pointer text-[13px] font-medium">
            Known topics ({known.length})
          </summary>
          <ul className="mt-2">
            {known.map((step) => (
              <PathRow
                key={step.node.id}
                step={step}
                courseId={courseId}
                busy={busy}
                onKnown={markKnown}
                onDetail={setDetail}
              />
            ))}
          </ul>
        </details>
      )}

      {skipped.length > 0 && (
        <details className="rounded-[var(--radius)] border border-border bg-surface p-3">
          <summary className="cursor-pointer text-[13px] font-medium">
            Out of scope ({skipped.length})
          </summary>
          <ul className="mt-2">
            {skipped.map((node) => (
              <li
                key={node.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 first:border-t-0 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-[13px] text-text-muted">{node.title}</p>
                  <p className="text-[11.5px] text-text-muted">{reasonLabel(node)}</p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => void mutate({ action: 'mark_skip', topicId: node.id })}
                    disabled={busy || viewVersion !== null}
                    className="btn btn-ghost btn-sm"
                    title="Bring this topic back into the path"
                  >
                    Include
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetail(node)}
                    className="btn btn-quiet btn-sm"
                  >
                    Details
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {detail !== null && (
        <section className="rounded-[var(--radius)] border border-border bg-surface p-3 text-sm" aria-label="Topic details">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{detail.title}</p>
              <p className="mt-0.5 text-[12px] text-text-muted">
                {reasonLabel(detail)} · weight {(detail.weight * 100).toFixed(0)}% ·{' '}
                {detail.type === 'bridge' ? `gap depth ${detail.depth}` : detail.type}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="text-xs text-text-muted hover:text-text"
            >
              Close
            </button>
          </div>

          {(() => {
            const step = path.steps.find((entry) => entry.node.id === detail.id);
            if (step === undefined) return null;
            return (
              <div className="mt-2 flex flex-col gap-1.5 text-[12px]">
                {step.blockedBy.length > 0 && (
                  <p className="text-warning">
                    Needs first: {step.blockedBy.map((entry) => entry.title).join(', ')}
                  </p>
                )}
                {step.unlocks.length > 0 && (
                  <p className="text-text-muted">
                    Finishing this unlocks: {step.unlocks.map((entry) => entry.title).join(', ')}
                  </p>
                )}
              </div>
            );
          })()}

          <div className="mt-3 flex flex-col gap-1.5">
            {edges.filter((edge) => edge.from === detail.id || edge.to === detail.id).length === 0 ? (
              <p className="text-[12px] text-text-muted">
                No prerequisite edges here yet. Use the dependency map below to record one.
              </p>
            ) : (
              edges
                .filter((edge) => edge.from === detail.id || edge.to === detail.id)
                .map((edge) => (
                  <div key={`${edge.from}-${edge.to}`} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-text-muted">
                      {edge.from} → {edge.to}
                      {edge.confidence !== null ? ` · ${Math.round(edge.confidence * 100)}%` : ''}
                      {' '}· {edge.source}
                    </span>
                    <button
                      type="button"
                      onClick={() => void mutate({ action: 'delete_edge', from: edge.from, to: edge.to })}
                      disabled={busy || viewVersion !== null}
                      className="rounded-full border border-border px-2 py-0.5 text-[11px] hover:border-danger hover:text-danger"
                    >
                      Remove
                    </button>
                  </div>
                ))
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {detail.type === 'skipped' ? (
              <button
                type="button"
                onClick={() => void mutate({ action: 'restore', topicId: detail.id })}
                disabled={busy || viewVersion !== null}
                className="btn btn-ghost btn-sm"
              >
                Include in the path
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void mutate({ action: 'mark_skip', topicId: detail.id })}
                disabled={busy || viewVersion !== null}
                className="btn btn-ghost btn-sm"
                title="Leave this topic out of the path without changing the exam scope"
              >
                Skip this topic
              </button>
            )}
          </div>
        </section>
      )}

      <details className="rounded-[var(--radius)] border border-border bg-surface p-3">
        <summary className="cursor-pointer text-[13px] font-medium">Dependency map</summary>
        <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
          Columns are prerequisite depth. Drag from a node's handle onto another to record
          a prerequisite, or select a node to inspect or edit its edges.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
          {(['core', 'bridge', 'skipped', 'known'] as const).map((kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span aria-hidden className="size-2 rounded-full" style={{ background: TYPE_COLORS[kind] }} />
              {kind}
            </span>
          ))}
        </div>
        <div className="mt-2 h-[380px] overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
          {flow !== null && (
            <ReactFlow
              nodes={flow.nodes}
              edges={flow.edges}
              fitView
              nodesDraggable={false}
              nodesConnectable
              onConnect={handleConnect}
              onNodeClick={handleNodeClick}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="var(--color-border)" gap={18} />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>
      </details>

      {versions.length > 1 && (
        <details className="rounded-[var(--radius)] border border-border bg-surface p-3">
          <summary className="cursor-pointer text-[13px] font-medium">
            Version history ({versions.length})
          </summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {versions.slice(0, 8).map((entry) => (
              <button
                key={entry.version}
                type="button"
                onClick={() => void openVersion(viewVersion === entry.version ? null : entry.version)}
                className={
                  viewVersion === entry.version
                    ? 'rounded-full bg-accent px-3 py-1 text-xs text-accent-contrast'
                    : 'chip hover:text-text'
                }
              >
                v{entry.version}
              </button>
            ))}
          </div>
        </details>
      )}

      {busy && (
        <p className="flex items-center gap-2 text-xs text-text-muted" aria-live="polite">
          <span aria-hidden className="spinner" />
          Applying the change and rebuilding the path...
        </p>
      )}
    </div>
  );
}

function StepGroup({
  title,
  hint,
  steps,
  courseId,
  busy,
  onKnown,
  onDetail,
}: {
  title: string;
  hint: string;
  steps: StudyPathStep[];
  courseId: string;
  busy: boolean;
  onKnown: (topicId: string, known: boolean) => Promise<void>;
  onDetail: (node: RoadmapNode) => void;
}) {
  if (steps.length === 0) return null;
  return (
    <section aria-label={title}>
      <p className="section-title">{title}</p>
      <p className="mt-0.5 text-[12px] text-text-muted">{hint}</p>
      <ul className="mt-2">
        {steps.map((step) => (
          <PathRow
            key={step.node.id}
            step={step}
            courseId={courseId}
            busy={busy}
            onKnown={onKnown}
            onDetail={onDetail}
          />
        ))}
      </ul>
    </section>
  );
}

function PathRow({
  step,
  courseId,
  busy,
  onKnown,
  onDetail,
}: {
  step: StudyPathStep;
  courseId: string;
  busy: boolean;
  onKnown: (topicId: string, known: boolean) => Promise<void>;
  onDetail: (node: RoadmapNode) => void;
}) {
  const { node } = step;
  const isKnown = step.phase === 'known';
  return (
    <li className="flex flex-col gap-2 border-t border-border py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium">
            {node.order + 1}. {node.title}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-text-muted">
            <span className="chip">{node.type}</span>
            <span className="num">weight {Math.round(node.weight * 100)}%</span>
            {step.unlocks.length > 0 && (
              <span>
                unlocks {step.unlocks.length}
              </span>
            )}
            {step.blockedBy.length > 0 && (
              <span className="text-warning">
                needs {step.blockedBy.map((entry) => entry.title).join(', ')}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {!isKnown && (
            <>
              <a
                href={`/course?id=${courseId}&tab=lessons&topic=${node.id}`}
                className="btn btn-ghost btn-sm"
              >
                Teach
              </a>
              <a
                href={`/course?id=${courseId}&tab=practice&topic=${node.id}`}
                className="btn btn-ghost btn-sm"
              >
                Practice
              </a>
            </>
          )}
          <button
            type="button"
            onClick={() => void onKnown(node.id, !isKnown)}
            disabled={busy}
            className="btn btn-quiet btn-sm"
          >
            {isKnown ? 'Not known' : 'Known'}
          </button>
          <button type="button" onClick={() => onDetail(node)} className="btn btn-quiet btn-sm">
            Details
          </button>
        </div>
      </div>
    </li>
  );
}

interface Diagnosis {
  materials: number;
  failedMaterials: number;
  pages: number;
  topics: number;
  error: string | null;
  errorJob: string | null;
}

/**
 * No roadmap is a dead end without the reason. This shows how far the pipeline
 * actually got (material stored, pages read, topics extracted) and the exact
 * error of the last background step that gave up.
 */
function RoadmapEmpty({ courseId }: { courseId: string }) {
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const db = await getDb();
    const rows = await db.driver.select<Record<string, unknown>>(
      `SELECT
         (SELECT COUNT(*) FROM materials WHERE course_id = $1) AS materials,
         (SELECT COUNT(*) FROM materials WHERE course_id = $1 AND status = 'failed') AS failed_materials,
         (SELECT COUNT(*) FROM material_pages p
            JOIN materials m ON m.id = p.material_id
           WHERE m.course_id = $1 AND p.text IS NOT NULL) AS pages,
         (SELECT COUNT(*) FROM topics WHERE course_id = $1) AS topics`,
      [courseId],
    );
    const failure = await db.driver.select<{ job_type: string; last_error: string | null }>(
      `SELECT job_type, last_error FROM jobs
        WHERE course_id = $1 AND status = 'failed' AND last_error IS NOT NULL
          AND job_type IN ('build_topics', 'find_prerequisites', 'build_roadmap')
        ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 1`,
      [courseId],
    );
    const row = rows[0] ?? {};
    setDiagnosis({
      materials: Number(row.materials ?? 0),
      failedMaterials: Number(row.failed_materials ?? 0),
      pages: Number(row.pages ?? 0),
      topics: Number(row.topics ?? 0),
      error: failure[0]?.last_error ?? null,
      errorJob: failure[0]?.job_type ?? null,
    });
  }, [courseId]);

  useEffect(() => {
    void load();
    return onAppEvent((event) => {
      if (event.kind === 'job-updated' && event.courseId === courseId) void load();
    });
  }, [load, courseId]);

  const retry = useCallback(async () => {
    setBusy(true);
    try {
      const db = await getDb();
      await enqueue(db.driver, 'build_topics', { courseId });
      await enqueue(db.driver, 'build_roadmap', { courseId });
    } finally {
      setBusy(false);
    }
  }, [courseId]);

  const steps = [
    {
      done: (diagnosis?.materials ?? 0) > 0,
      label:
        diagnosis === null
          ? 'Checking the material...'
          : `${diagnosis.materials} material file${diagnosis.materials === 1 ? '' : 's'} uploaded`,
      hint: 'Add a syllabus or notes on the Material tab.',
    },
    {
      done: (diagnosis?.pages ?? 0) > 0,
      label:
        diagnosis === null
          ? 'Checking the read pages...'
          : `${diagnosis.pages} page${diagnosis.pages === 1 ? '' : 's'} with readable text`,
      hint:
        diagnosis !== null && diagnosis.failedMaterials > 0
          ? 'A file was stored but no page produced text. Scanned or handwritten pages need OCR or a vision model.'
          : 'Open Material and check what the read step found.',
    },
    {
      done: (diagnosis?.topics ?? 0) > 0,
      label:
        diagnosis === null
          ? 'Checking the topics...'
          : `${diagnosis.topics} topic${diagnosis.topics === 1 ? '' : 's'} extracted`,
      hint: 'Topic extraction runs in the background after an upload.',
    },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius)] border border-border bg-surface p-4">
      <p className="text-sm font-medium">No study path yet</p>
      <ul className="flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.label} className="flex items-start gap-2 text-[13px]">
            <span
              aria-hidden
              className="mt-0.5 flex size-4 flex-none items-center justify-center rounded-full border text-[9px]"
              style={{
                borderColor: step.done ? 'var(--color-known)' : 'var(--color-border-strong)',
                color: step.done ? 'var(--color-known)' : 'var(--color-text-muted)',
              }}
            >
              {step.done ? '✓' : '•'}
            </span>
            <span className="min-w-0">
              <span className="block">{step.label}</span>
              {!step.done && <span className="block text-[12px] text-text-muted">{step.hint}</span>}
            </span>
          </li>
        ))}
      </ul>

      {diagnosis !== null && diagnosis.error !== null && (
        <div className="rounded-[var(--radius)] border border-danger/40 bg-surface p-3">
          <p className="text-[12px] font-medium text-danger">
            The last background step failed ({diagnosis.errorJob ?? 'build'}):
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-danger" style={{ overflowWrap: 'anywhere' }}>
            {diagnosis.error}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void retry()}
        disabled={busy}
        aria-busy={busy}
        className="btn btn-primary btn-sm self-start"
      >
        {busy ? 'Queueing...' : 'Rebuild from the material'}
      </button>
    </section>
  );
}
