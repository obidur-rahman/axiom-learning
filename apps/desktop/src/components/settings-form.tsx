'use client';

import { useCallback, useEffect, useState } from 'react';
import { capabilitySummary, autoDetect, loadForm, probeAndStore, saveForm, type ProviderForm } from '../lib/provider';

interface Probe {
  loading: boolean;
  summary: string[] | null;
  error: string | null;
}

/**
 * Provider settings screen (task 8): the single entry where the local model
 * is configured. One primary action (Save + probe); auto-detect is a
 * secondary "Try local ports" button (FR-062).
 */
export function SettingsForm() {
  const [form, setForm] = useState<ProviderForm | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe>({ loading: false, summary: null, error: null });
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    void loadForm().then(setForm);
  }, []);

  const update = useCallback((patch: Partial<ProviderForm>) => {
    setForm((current) => (current === null ? current : { ...current, ...patch }));
  }, []);

  const handleSave = useCallback(async () => {
    if (form === null || form.baseUrl.trim() === '' || form.chatModel.trim() === '') {
      setSaved('Base URL and chat model are required.');
      return;
    }
    await saveForm(form);
    setSaved('Saved. Probing...');
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
        setSaved('No local model found on ports 11434/1234/8080.');
      } else {
        update(found);
        setSaved(`Detected ${found.baseUrl} - save to probe capabilities.`);
      }
    } finally {
      setDetecting(false);
    }
  }, [update]);

  if (form === null) {
    return <p className="text-sm text-text-muted">Loading settings...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Base URL
        <input
          value={form.baseUrl}
          onChange={(event) => update({ baseUrl: event.target.value })}
          placeholder="http://localhost:11434"
          className="rounded-[10px] border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Chat model
          <input
            value={form.chatModel}
            onChange={(event) => update({ chatModel: event.target.value })}
            placeholder="qwen2.5:7b"
            className="rounded-[10px] border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Embedding model (optional)
          <input
            value={form.embedModel}
            onChange={(event) => update({ embedModel: event.target.value })}
            placeholder="nomic-embed-text"
            className="rounded-[10px] border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        API key (stored in the OS secure store)
        <input
          type="password"
          value={form.apiKey ?? ''}
          onChange={(event) => update({ apiKey: event.target.value })}
          placeholder="Usually not needed for local models"
          className="rounded-[10px] border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void handleSave()}
          className="rounded-[10px] bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:opacity-90"
        >
          Save and probe
        </button>
        <button
          onClick={() => void handleDetect()}
          disabled={detecting}
          className="rounded-[10px] border border-border px-4 py-2 text-sm hover:border-accent disabled:opacity-50"
        >
          {detecting ? 'Scanning ports...' : 'Try local ports'}
        </button>
        <a href="/" className="text-xs tracking-wide text-text-muted uppercase no-underline hover:text-text">
          Back to courses
        </a>
      </div>

      {saved !== null && <p className="text-sm text-text-muted">{saved}</p>}
      {probe.error !== null && (
        <p className="rounded-[10px] border border-danger/40 bg-surface px-3 py-2 text-sm text-danger">
          {probe.error}
        </p>
      )}
      {probe.summary !== null && (
        <ul className="flex flex-col gap-1 rounded-[10px] border border-border bg-surface px-3 py-2 text-sm">
          {probe.summary.map((line) => (
            <li key={line} className="flex items-center gap-2">
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
              {line}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-text-muted">
        Needs an OpenAI-compatible endpoint. The API key is stored in the OS secure store and is
        sent only to your provider.
      </p>
    </div>
  );
}
