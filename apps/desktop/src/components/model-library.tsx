'use client';

/**
 * Suggested local models by role, with one-click download when the endpoint is
 * Ollama. Different experts for different work: a vision model for page
 * images, a text model for lessons, an embedding model for search.
 */
import { useCallback, useMemo, useState } from 'react';
import { ProgressBar } from './progress-bar';
import {
  canonicalModelName,
  downloadModel,
  type PullProgress,
} from '../lib/model-manager';

export interface ModelSuggestion {
  role: 'chat' | 'ocr' | 'embed';
  model: string;
  label: string;
  size: string;
  note: string;
}

export const MODEL_SUGGESTIONS: ModelSuggestion[] = [
  {
    role: 'ocr',
    model: 'qwen2.5vl:3b',
    label: 'Qwen2.5-VL 3B',
    size: '~3.2 GB',
    note: 'Fast page and handwriting reader. The best first OCR model.',
  },
  {
    role: 'ocr',
    model: 'qwen2.5vl:7b',
    label: 'Qwen2.5-VL 7B',
    size: '~6 GB',
    note: 'More accurate on messy scans; slower per page.',
  },
  {
    role: 'chat',
    model: 'qwen2.5:7b',
    label: 'Qwen2.5 7B',
    size: '~4.7 GB',
    note: 'Balanced text model for lessons, roadmap and the tutor.',
  },
  {
    role: 'chat',
    model: 'qwen3:4b',
    label: 'Qwen3 4B',
    size: '~2.6 GB',
    note: 'Smaller and quicker; good on a low-RAM machine.',
  },
  {
    role: 'embed',
    model: 'nomic-embed-text',
    label: 'Nomic Embed Text',
    size: '~275 MB',
    note: 'Optional page ranking for tutor citations.',
  },
];

const ROLE_LABEL: Record<ModelSuggestion['role'], string> = {
  chat: 'Chat',
  ocr: 'OCR',
  embed: 'Embedding',
};

interface PullState {
  percent: number | null;
  status: string;
  failed: boolean;
}

export function ModelLibrary({
  installed,
  loaded = [],
  ollama,
  baseUrl,
  onChanged,
  onPick,
}: {
  installed: string[];
  loaded?: string[];
  ollama: boolean;
  /** Used before the form is saved (onboarding); otherwise the stored URL. */
  baseUrl?: string;
  onChanged?: () => void;
  onPick?: (role: ModelSuggestion['role'], model: string) => void;
}) {
  const [pulls, setPulls] = useState<Record<string, PullState>>({});
  const installedSet = useMemo(
    () => new Set(installed.map(canonicalModelName)),
    [installed],
  );
  const loadedSet = useMemo(() => new Set(loaded.map(canonicalModelName)), [loaded]);

  const handleDownload = useCallback(
    async (model: string) => {
      setPulls((current) => ({ ...current, [model]: { percent: null, status: 'Starting', failed: false } }));
      try {
        await downloadModel(
          model,
          (progress: PullProgress) =>
            setPulls((current) => ({
              ...current,
              [model]: {
                percent: progress.percent,
                status: progress.status,
                failed: false,
              },
            })),
          baseUrl,
        );
        setPulls((current) => {
          const next = { ...current };
          delete next[model];
          return next;
        });
        onChanged?.();
      } catch (error) {
        setPulls((current) => ({
          ...current,
          [model]: {
            percent: null,
            status: error instanceof Error ? error.message : String(error),
            failed: true,
          },
        }));
      }
    },
    [baseUrl, onChanged],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium">Suggested models</p>
        {!ollama && (
          <p className="text-[11.5px] text-text-muted">
            Downloads need a running Ollama endpoint.
          </p>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-[var(--radius)] border border-border bg-surface">
        {MODEL_SUGGESTIONS.map((suggestion) => {
          const installedHere = installedSet.has(canonicalModelName(suggestion.model));
          const isLoaded = loadedSet.has(canonicalModelName(suggestion.model));
          const pull = pulls[suggestion.model];
          return (
            <li key={suggestion.model} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                  {suggestion.label}
                  <span className="chip">{ROLE_LABEL[suggestion.role]}</span>
                  {installedHere && <span className="chip text-known">Installed</span>}
                  {isLoaded && (
                    <span className="chip text-accent" title="Held in memory right now">In memory</span>
                  )}
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-text-muted">
                  {suggestion.note} <span className="num">{suggestion.size}</span>
                </p>
                <p className="num mt-0.5 text-[11px] text-text-muted">{suggestion.model}</p>
                {pull !== undefined && (
                  <div className="mt-1.5">
                    <ProgressBar
                      value={pull.percent ?? 0}
                      indeterminate={pull.percent === null && !pull.failed}
                      label={`Downloading ${suggestion.label}`}
                    />
                    <p className={pull.failed ? 'mt-1 text-[11.5px] text-danger' : 'mt-1 text-[11.5px] text-text-muted'}>
                      {pull.status}
                      {pull.percent !== null && ` · ${pull.percent}%`}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex flex-none items-center gap-1.5">
                {installedHere ? (
                  onPick !== undefined && (
                    <button
                      type="button"
                      onClick={() => onPick(suggestion.role, suggestion.model)}
                      className="btn btn-ghost btn-sm"
                    >
                      Use
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleDownload(suggestion.model)}
                    disabled={!ollama || pull !== undefined}
                    className="btn btn-ghost btn-sm"
                    title={ollama ? `Download ${suggestion.model}` : 'Start Ollama first'}
                  >
                    {pull === undefined ? 'Download' : 'Downloading'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {installed.length > 0 && (
        <details className="rounded-[var(--radius)] border border-border bg-surface px-3 py-2">
          <summary className="cursor-pointer text-[12.5px] text-text-muted">
            {installed.length} model{installed.length === 1 ? '' : 's'} on this machine
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {installed.map((name) => (
              <li key={name} className="chip num">
                {name}
                {loadedSet.has(canonicalModelName(name)) && (
                  <span aria-hidden className="ml-1 inline-block size-1.5 rounded-full bg-accent" />
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
