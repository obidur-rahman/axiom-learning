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
  listRoadmapVersions,
  loadLatestRoadmap,
  loadOverrideRows,
  loadRoadmapVersion,
  removeOverride,
  updateCourse,
  type Course,
} from '@axiom/data';
import type { Roadmap, RoadmapNode } from '@axiom/engine';
import { getDb } from '../lib/db';
import { onAppEvent } from '../lib/events';

const TYPE_COLORS: Record<string, string> = {
  core: 'var(--color-core)',
  bridge: 'var(--color-bridge)',
  skipped: 'var(--color-skipped)',
  known: 'var(--color-known)',
};

interface Detail {
  node: RoadmapNode;
  depthLabel: string;
}

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

/**
 * Roadmap screen (FR-017..FR-035): study order list plus the dependency
 * graph. Node status uses color AND a badge, never color alone (design
 * principle 4). Learner actions: skip/restore per node, change bridge
 * depth, rebuild.
 */
export function RoadmapPanel({ courseId }: { courseId: string }) {
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [edges, setEdges] = useState<CourseEdge[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const db = await getDb();
    const latest = await loadLatestRoadmap(db.driver, courseId);
    setRoadmap(latest === null ? null : latest.roadmap);
    setVersions(await listRoadmapVersions(db.driver, courseId));
    setViewVersion(null);
    setCourse(await getCourse(db.driver, courseId));
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
  const openVersion = useCallback(async (version: number | null) => {
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
  }, [courseId]);

  useEffect(() => {
    void load();
    return onAppEvent((event) => {
      if (event.kind === 'job-updated' && event.jobKind === 'build_roadmap' && event.courseId === courseId) {
        void load();
      }
    });
  }, [load, courseId]);

  const flow = useMemo(() => {
    if (roadmap === null) return null;
    const skippedOverride = new Set<string>();
    const byDepth = new Map<number, RoadmapNode[]>();
    for (const node of roadmap.nodes) {
      if (node.type === 'skipped') skippedOverride.add(node.id);
      const column = byDepth.get(node.depth) ?? [];
      column.push(node);
      byDepth.set(node.depth, column);
    }
    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    const columnX = depths.indexOf(0) === -1 ? 0 : 0;
    void columnX;
    const nodes: Node[] = [];
    depths.forEach((depth, columnIndex) => {
      (byDepth.get(depth) ?? []).forEach((node, rowIndex) => {
        nodes.push({
          id: node.id,
          position: { x: columnIndex * 230, y: rowIndex * 68 },
          data: { label: `${node.title}`, badge: node.type },
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
    const edges: Edge[] = [];
    depths.forEach((depth) => {
      for (const node of byDepth.get(depth) ?? []) {
        for (const needed of node.neededBy) {
          edges.push({
            id: `${needed}->${node.id}`,
            source: needed,
            target: node.id,
            style: { stroke: 'var(--color-border)' },
          });
        }
      }
    });
    return { nodes, edges };
  }, [roadmap]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (roadmap === null) return;
      const found = roadmap.nodes.find((entry) => entry.id === node.id);
      if (found === undefined) return;
      setDetail({
        node: found,
        depthLabel: found.type === 'core' ? 'core topic' : `bridge depth ${found.depth}`,
      });
    },
    [roadmap],
  );

  const mutate = useCallback(
    async (override: Parameters<typeof addOverride>[2]) => {
      if (viewVersion !== null) return; // history is read-only
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

  if (roadmap === null) {
    return (
      <p className="rounded-[var(--radius)] border border-border bg-surface p-4 text-sm text-text-muted">
        No roadmap yet. Check the Material tab and press Rebuild roadmap.
      </p>
    );
  }

  const coreCount = roadmap.nodes.filter((node) => node.type === 'core').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-text-muted">
          {viewVersion === null
            ? `Version ${roadmap.version}`
            : `History: version ${viewVersion} (read-only)`}
        </p>
        <div
          className="flex items-center gap-3 text-xs text-text-muted"
          aria-label="Node status legend"
        >
          {(['core', 'bridge', 'skipped', 'known'] as const).map((kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span aria-hidden className="size-2 rounded-full" style={{ background: TYPE_COLORS[kind] }} />
              {kind} {kind === 'core' ? `(${coreCount})` : ''}
            </span>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1 text-xs text-text-muted">
          Bridge depth
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
          >
            {[0, 1, 2, 3, 4].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="h-[420px] overflow-hidden rounded-[var(--radius)] border border-border bg-surface">
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

      <ol className="flex flex-col gap-2">
        {roadmap.nodes
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((node) => (
            <li
              key={node.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-surface px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {node.order + 1}. {node.title}
                </p>
                <p className="text-xs text-text-muted">
                  {node.type}
                  {node.type === 'bridge' && ` · depth ${node.depth}`}
                  {node.reason.startsWith('EXCLUDED') && ' · out of exam scope'}
                </p>
              </div>
              <div className="flex gap-1">
                {node.type === 'skipped' ? (
                  <button
                    onClick={() => void mutate({ action: 'restore', topicId: node.id })}
                    className="rounded-[var(--radius)] border border-known px-2 py-1 text-xs"
                  >
                    Restore
                  </button>
                ) : (
                  <button
                    onClick={() => void mutate({ action: 'mark_skip', topicId: node.id })}
                    className="rounded-[var(--radius)] border border-border px-2 py-1 text-xs hover:border-warning"
                  >
                    Skip
                  </button>
                )}
                <button
                  onClick={() => setDetail({ node, depthLabel: node.type === 'core' ? 'core topic' : `bridge depth ${node.depth}` })}
                  className="rounded-[var(--radius)] border border-border px-2 py-1 text-xs hover:border-accent"
                >
                  Details
                </button>
              </div>
            </li>
          ))}
      </ol>

      {detail !== null && (
        <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-surface p-3 text-sm">
          <div className="flex items-center justify-between">
            <p className="font-medium">{detail.node.title}</p>
            <button onClick={() => setDetail(null)} className="text-xs text-text-muted hover:text-text">
              Close
            </button>
          </div>
          <p className="text-xs text-text-muted">
            {detail.depthLabel} · reason {detail.node.reason} · weight{' '}
            {(detail.node.weight * 100).toFixed(0)}%
          </p>
          {detail.node.neededBy.length > 0 && (
            <p className="text-xs text-text-muted">
              Needed by: {detail.node.neededBy.join(', ')}
            </p>
          )}
          {(() => {
            const touching = edges.filter(
              (edge) => edge.from === detail.node.id || edge.to === detail.node.id,
            );
            if (touching.length === 0) {
              return (
                <p className="text-xs text-text-muted">
                  No prerequisite edges here yet. Drag from another node's handle
                  onto this one to record one.
                </p>
              );
            }
            return (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-text-muted">Prerequisite edges (before → this):</p>
                {touching.map((edge) => (
                  <div key={`${edge.from}-${edge.to}`} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-text-muted">
                      {edge.from} &rarr; {edge.to}
                      {' '}(src {edge.source}
                      {edge.confidence !== null ? `, ${Math.round(edge.confidence * 100)}%` : ''})
                    </span>
                    <button
                      onClick={() =>
                        void mutate({ action: 'delete_edge', from: edge.from, to: edge.to })
                      }
                      className="rounded-full border border-border px-2 py-0.5 hover:border-danger hover:text-danger"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {versions.length > 1 && (
        <section className="flex flex-wrap items-center gap-2" aria-label="Roadmap history">
          <p className="text-xs text-text-muted">History</p>
          {versions.slice(0, 8).map((entry) => (
            <button
              key={entry.version}
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
          {viewVersion !== null && (
            <button
              onClick={() => void openVersion(null)}
              className="text-xs text-accent underline-offset-4 hover:underline"
            >
              Back to latest
            </button>
          )}
        </section>
      )}

      {busy && <p className="text-xs text-text-muted" aria-live="polite">Applying change...</p>}
    </div>
  );
}
