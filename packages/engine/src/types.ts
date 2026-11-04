import { z } from 'zod';

/** Reason codes per TRD 6.2 rule 5. */
export const NodeReasonSchema = z.enum([
  'EXAM_TOPIC',
  'NEEDED_BY',
  'EXCLUDED',
  'LOW_WEIGHT',
  'KNOWN',
]);
export type NodeReason = z.infer<typeof NodeReasonSchema>;

/**
 * Node type. `known` is a Bridge-or-Skipped topic the learner passed in a
 * Diagnostic (design brief 8.1 table); core topics that are also known stay
 * `core` and carry `isKnown: true`.
 */
export const NodeTypeSchema = z.enum(['core', 'bridge', 'skipped', 'known']);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const TopicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});
export type Topic = z.infer<typeof TopicSchema>;

export const EdgeSourceSchema = z.enum(['shared_table', 'model', 'manual']);
/**
 * An edge (from -> to) means `from` is a prerequisite of `to`.
 */
export const PrerequisiteEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.8),
  source: EdgeSourceSchema.default('model'),
});
export type PrerequisiteEdge = z.infer<typeof PrerequisiteEdgeSchema>;

export const OverrideSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mark_skip'), topicId: z.string().min(1) }),
  z.object({ action: z.literal('restore'), topicId: z.string().min(1) }),
  z.object({ action: z.literal('add_node'), topic: TopicSchema }),
  z.object({ action: z.literal('delete_node'), topicId: z.string().min(1) }),
  z.object({ action: z.literal('add_edge'), edge: PrerequisiteEdgeSchema }),
  z.object({
    action: z.literal('delete_edge'),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
]);
export type Override = z.infer<typeof OverrideSchema>;

const overrideActions = [
  'mark_skip',
  'restore',
  'add_node',
  'delete_node',
  'add_edge',
  'delete_edge',
] as const;

export type OverrideAction = (typeof overrideActions)[number];

export const RoadmapInputSchema = z.object({
  topics: z.array(TopicSchema).min(1),
  edges: z.array(PrerequisiteEdgeSchema),
  /** Topic id -> weight per TRD 5.4. A topic missing here has weight 0. */
  weights: z.record(z.string(), z.number().min(0)),
  /** Topics the learner marked "not coming in the exam" (X). */
  excluded: z.array(z.string()).default([]),
  /** Topics the learner passed in a Diagnostic (K). */
  known: z.array(z.string()).default([]),
  /** Bridge depth limit d. Default 2 per FR-044. */
  bridgeDepth: z.number().int().min(0).max(4).default(2),
});
export type RoadmapInput = z.infer<typeof RoadmapInputSchema>;

export const RoadmapNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: NodeTypeSchema,
  reason: NodeReasonSchema,
  /** Core topics that need this node ("NEEDED_BY" list). */
  neededBy: z.array(z.string()).default([]),
  /** Prerequisite hops below the nearest core topic. 0 for core nodes. */
  depth: z.number().int().min(0),
  /** Study order per TRD 6.2 rule 6, 0-based. */
  order: z.number().int().min(0),
  weight: z.number().min(0),
  isKnown: z.boolean().default(false),
});
export type RoadmapNode = z.infer<typeof RoadmapNodeSchema>;

export const RoadmapSchema = z.object({
  nodes: z.array(RoadmapNodeSchema),
  version: z.number().int().min(0),
});
export type Roadmap = z.infer<typeof RoadmapSchema>;

export const builtinOverrideActions = overrideActions;
