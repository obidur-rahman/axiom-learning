'use client';

import { useCallback, useEffect, useState } from 'react';
import { capabilitySummary, autoDetect, loadForm, probeAndStore, saveForm, type ProviderForm } from '../lib/provider';
import { isDesktopRuntime } from '../lib/db';

interface Probe {
  loading: boolean;
  summary: string[] | null;
  error: string | null;
}

/**
 * AI provider settings (task 8): the single entry where the model is
 * configured. One primary action (Save and probe); "Try local ports" is the
 * secondary auto-detect. The API key goes to the OS secure store, never to
 * the database.
 */
export function SettingsForm() {
  const [form, setForm] = useState<ProviderForm | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe>({ loading: false, summary: null, error: null });
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    if (!isDesktopRuntime()) {
      setLoadError('The AI provider settings are stored in the desktop app. Run npm run tauri dev.');
      return;
    }
    void loadForm()
      .then(setForm)
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  const update = useCallback((patch: Partial<ProviderForm>) => {
    setForm((current) => (current === null ? current : { ...current, ...patch }));
  }, []);

  const handleSave = useCallback(async () => {
    if (form === null) return;
    if (form.baseUrl.trim() === '' || form.chatModel.trim() === '') {
      setSaved('Base URL and chat model are required.');
      return;
    }
    await saveForm(form);
    setSaved('Saved. Probing capabilities...');
    setProbe({ loading: true, summary: null, error: null });
    try {
      const caps = await probeAndStore();
      setProbe({ loading: false, summary: capabilitySummary(caps), error: null });
      setSaved('Saved and probed.');
    } catch (error) {
      setProbe({
        loading: false,
        summary: null,
        error: error instanceof Error ? error.message : String(error),
      });
      setSaved('Saved. Probe failed - check the URL and model names.');
    }
  }, [form]);

  const handleDetect = useCallback(async () => {
    setDetecting(true);
    try {
      const found = await autoDetect();
      if (found === null) {
        setSaved('No local model list answered on localhost ports 11434, 1234 or 8080. Check that the server is running and on one of those ports.');
      } else {
        update(found);
        setSaved(
          `Detected ${found.baseUrl}. Chat model: ${found.chatModel || 'none advertised'}. Save and probe to confirm it.`,
        );
      }
    } finally {
      setDetecting(false);
    }
  }, [update]);

  if (loadError !== '') {
    return <p className="rounded-xl border border-border bg-surface p-4 text-sm text-text-muted">{loadError}</p>;
  }

  if (form === null) {
    return (
      <div className="flex flex-col gap-2" aria-live="polite">
        <div className="skeleton h-9 w-full" />
        <div className="skeleton h-9 w-full" />
        <div className="skeleton h-9 w-2/3" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="text-xs text-text-muted">Where the model runs</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Provider mode">
          {[
            { value: 'local' as const, label: 'Local model', hint: 'Ollama, LM Studio, vLLM on this machine' },
            { value: 'hosted' as const, label: 'Hosted API', hint: 'OpenRouter, OpenAI, or any compatible endpoint' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={form.mode === option.value}
              onClick={() => update({ mode: option.value })}
              className={
                form.mode === option.value
                  ? 'rounded-2xl border border-accent bg-surface p-3 text-left'
                  : 'rounded-2xl border border-border bg-panel-raised p-3 text-left transition-colors duration-200 hover:border-border-strong'
              }
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-1 block text-[12px] text-text-muted">{option.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <label className="field">
        Base URL
        <input
          value={form.baseUrl}
          onChange={(event) => update({ baseUrl: event.target.value })}
          placeholder={form.mode === 'local' ? 'http://localhost:11434' : 'https://openrouter.ai/api'}
          className="input"
        />
        <span className="text-[12px] text-text-muted">
          The OpenAI-compatible root; Axiom appends /chat/completions and /embeddings.
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">
          Chat model
          <input
            value={form.chatModel}
            onChange={(event) => update({ chatModel: event.target.value })}
            placeholder="qwen2.5:7b"
            className="input"
          />
        </label>
        <label className="field">
          Embedding model (optional)
          <input
            value={form.embedModel}
            onChange={(event) => update({ embedModel: event.target.value })}
            placeholder="nomic-embed-text"
            className="input"
          />
        </label>
      </div>

      <label className="field">
        API key
        <input
          type="password"
          value={form.apiKey ?? ''}
          onChange={(event) => update({ apiKey: event.target.value })}
          placeholder={form.mode === 'local' ? 'Usually not needed for local models' : 'Paste the provider key'}
          className="input"
        />
        <span className="text-[12px] text-text-muted">
          Stored in the OS secure store (Windows Credential Manager), never in the database.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void handleSave()} className="btn btn-primary" disabled={probe.loading}>
          {probe.loading ? 'Probing...' : 'Save and probe'}
        </button>
        <button type="button" onClick={() => void handleDetect()} disabled={detecting} className="btn btn-ghost">
          {detecting ? 'Scanning ports...' : 'Try local ports'}
        </button>
      </div>

      {saved !== null && <p className="text-sm text-text-muted" aria-live="polite">{saved}</p>}
      {probe.error !== null && (
        <p className="rounded-xl border border-danger/40 bg-surface px-3 py-2 text-sm text-danger">{probe.error}</p>
      )}
      {probe.summary !== null && (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface px-3 py-3 text-sm">
          {probe.summary.map((line) => (
            <li key={line} className="flex items-center gap-2">
              <span aria-hidden className="size-1.5 rounded-full bg-known" />
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
