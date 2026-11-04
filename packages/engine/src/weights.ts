/**
 * Topic weight per TRD 5.4:
 *   weight = 0.5 * past_question_share + 0.3 * suggested + 0.2 * in_syllabus
 * The values 0.5, 0.3, 0.2 are first values; tune later.
 */

export const WEIGHT_PAST_QUESTION = 0.5;
export const WEIGHT_SUGGESTED = 0.3;
export const WEIGHT_SYLLABUS = 0.2;

export interface WeightInputs {
  /** Topic id -> number of past questions linked to it (TRD 5.4 step 1). */
  pastQuestionCounts: Record<string, number>;
  /** Topic ids that a suggestion names. */
  suggested: Iterable<string>;
  /** Topic ids that the syllabus lists. */
  inSyllabus: Iterable<string>;
  /** Topics with an exclusion. Weight is forced to 0. */
  excluded?: Iterable<string>;
}

export function computeWeights(topics: { id: string }[], inputs: WeightInputs): Record<string, number> {
  const counts = inputs.pastQuestionCounts;
  let maxCount = 0;
  for (const id of Object.keys(counts)) {
    const c = counts[id] ?? 0;
    if (c > maxCount) maxCount = c;
  }
  const suggestedIds = new Set(inputs.suggested);
  const syllabusIds = new Set(inputs.inSyllabus);
  const excludedIds = new Set(inputs.excluded ?? []);

  const weights: Record<string, number> = {};
  for (const t of topics) {
    if (excludedIds.has(t.id)) {
      weights[t.id] = 0;
      continue;
    }
    const share = maxCount > 0 ? (counts[t.id] ?? 0) / maxCount : 0;
    weights[t.id] =
      WEIGHT_PAST_QUESTION * share +
      WEIGHT_SUGGESTED * (suggestedIds.has(t.id) ? 1 : 0) +
      WEIGHT_SYLLABUS * (syllabusIds.has(t.id) ? 1 : 0);
  }
  return weights;
}
