'use client';

import { useCallback, useEffect, useState, type ClipboardEvent } from 'react';
import { HOSTED_PROVIDERS, hostedProviderForKey, presetForBaseUrl } from '@axiom/ai';
import {
  capabilitySummary,
  autoDetect,
  fillHostedModels,
  loadForm,
  probeAndStore,
  saveForm,
  type ProviderForm,
} from '../lib/provider';
import { localModelInventory, type LocalModelInventory } from '../lib/model-manager';
import { isDesktopRuntime } from '../lib/db';
import { ModelLibrary } from './model-library';
import { Toggle } from './toggle-row';

interface Probe {
  loading: boolean;
  summary: string[] | null;
  error: string | null;
}

const EDGE_OPTIONS = [
  { value: 1024, label: 'Fast - 1024 px long edge' },
  { value: 1400, label: 'Balanced - 1400 px' },
  { value: 1600, label: 'Detailed - 1600 px' },
  { value: 2048, label: 'Maximum - 2048 px' },
];

/**
 * AI model settings. One endpoint, three roles: chat, OCR and embeddings each
 * get their own model. The local runtime section decides how those models are
 * kept in memory; the OCR section trades speed for fidelity.
 */
export function SettingsForm() {
  const [form, setForm] = useState<ProviderForm | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe>({ loading: false, summary: null, error: null });
  const [detecting, setDetecting] = useState(false);
  const [inventory, setInventory] = useState<LocalModelInventory | null>(null);
  const [hostedModels, setHostedModels] = useState<string[]>([]);
  const [filling, setFilling] = useState(false);

  const refreshInventory = useCallback(async (baseUrl?: string) => {
    if (!isDesktopRuntime()) return;
    try {
      setInventory(await localModelInventory(baseUrl));
    } catch {
      setInventory(null);
    }
  }, []);

  useEffect(() => {
    if (!isDesktopRuntime()) {
      setLoadError('The AI provider settings are stored in the desktop app. Run npm run tauri dev.');
      return;
    }
    void loadForm()
      .then((loaded) => {
        setForm(loaded);
        if (loaded.mode === 'local') void refreshInventory(loaded.baseUrl);
      })
      .catch((error: unknown) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      });
  }, [refreshInventory]);

  const update = useCallback((patch: Partial<ProviderForm>) => {
    setForm((current) => (current === null ? current : { ...current, ...patch }));
  }, []);

  /**
   * Ask a hosted endpoint for its model list and fill one model per role.
   * Shared by the provider picker, the key paste handler and the button.
   */
  const applyHostedFill = useCallback(
    async (baseUrl: string, apiKey: string) => {
      if (baseUrl.trim() === '') {
        setSaved('Set the base URL first, or pick a provider above.');
        return;
      }
      setFilling(true);
      setSaved(null);
      try {
        const fill = await fillHostedModels(baseUrl, apiKey);
        setHostedModels(fill.models);
        update({
          mode: 'hosted',
          baseUrl: fill.baseUrl,
          chatModel: fill.chatModel,
          ocrModel: fill.ocrModel,
          embedModel: fill.embedModel,
        });
        const roles = [
          fill.chatModel === '' ? null : `chat ${fill.chatModel}`,
          fill.ocrModel === '' ? null : `OCR ${fill.ocrModel}`,
          fill.embedModel === '' ? null : `embed ${fill.embedModel}`,
        ].filter((part): part is string => part !== null);
        const count = `${fill.models.length} model${fill.models.length === 1 ? '' : 's'}`;
        setSaved(
          `Found ${count} at ${fill.provider}. ` +
            (roles.length === 0 ? 'No usable names found; set them by hand.' : `Filled ${roles.join(' · ')}.`) +
            (fill.embedModel === '' ? ' No embedding model - search will use keywords.' : ''),
        );
      } catch (error) {
        setSaved(error instanceof Error ? error.message : String(error));
      } finally {
        setFilling(false);
      }
    },
    [update],
  );

  const handleProviderChange = useCallback(
    (id: string) => {
      const preset = HOSTED_PROVIDERS.find((entry) => entry.id === id) ?? null;
      if (preset === null) {
        update({ mode: 'hosted' });
        setSaved('Custom endpoint: paste the base URL and the model names.');
        return;
      }
      update({ mode: 'hosted', baseUrl: preset.baseUrl });
      setSaved(`${preset.label} selected.`);
      const key = (form?.apiKey ?? '').trim();
      if (key !== '') void applyHostedFill(preset.baseUrl, key);
    },
    [applyHostedFill, form, update],
  );

  /** A pasted key names its provider; fill the URL and models in one move. */
  const handleKeyPaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      const pasted = event.clipboardData.getData('text').trim();
      const preset = hostedProviderForKey(pasted);
      if (preset === null) return;
      update({ mode: 'hosted', apiKey: pasted, baseUrl: preset.baseUrl });
      void applyHostedFill(preset.baseUrl, pasted);
    },
    [applyHostedFill, update],
  );

  /** A typed key gets the base URL on blur, but only on a blank form. */
  const handleKeyBlur = useCallback(() => {
    if (form === null || form.baseUrl.trim() !== '') return;
    const preset = hostedProviderForKey(form.apiKey ?? '');
    if (preset === null) return;
    update({ mode: 'hosted', baseUrl: preset.baseUrl });
  }, [form, update]);

  const handleSave = useCallback(async () => {
    if (form === null) return;
    if (form.baseUrl.trim() === '' || form.chatModel.trim() === '') {
      setSaved('Base URL and chat model are required.');
      return;
    }
    await saveForm(form);
    await refreshInventory();
    setSaved('Saved. Probing capabilities...');
    setProbe({ loading: true, summary: null, error: null });
    try {
      const caps = await probeAndStore();
      setProbe({ loading: false, summary: capabilitySummary(caps), error: null });
      setSaved('Saved and probed.');
      await refreshInventory();
    } catch (error) {
      setProbe({
        loading: false,
        summary: null,
        error: error instanceof Error ? error.message : String(error),
      });
      setSaved('Saved. Probe failed - check the URL and model names.');
    }
  }, [form, refreshInventory]);

  const handleDetect = useCallback(async () => {
    setDetecting(true);
    try {
      const found = await autoDetect();
      if (found === null) {
        setSaved('No local model list answered on localhost ports 11434, 1234 or 8080. Check that the server is running and on one of those ports.');
      } else {
        update(found);
        setSaved(
          `Detected ${found.baseUrl}. Chat model: ${found.chatModel || 'none advertised'}; OCR model: ${found.ocrModel || 'none advertised'}. Save and probe to confirm it.`,
        );
        await refreshInventory(found.baseUrl);
      }
    } finally {
      setDetecting(false);
    }
  }, [update, refreshInventory]);

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

  const installed = inventory?.models.map((model) => model.name) ?? [];
  const loaded = inventory?.loaded.map((model) => model.name) ?? [];
  // Once a hosted endpoint is queried, its IDs drive the model field hints.
  const modelSuggestions = form.mode === 'hosted' ? hostedModels : installed;

  return (
    <div className="flex flex-col gap-5">
      <fieldset>
        <legend className="text-xs text-text-muted">Where the models run</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Provider mode">
          {[
            { value: 'local' as const, label: 'Local model', hint: 'Ollama, LM Studio, vLLM on this machine' },
            { value: 'hosted' as const, label: 'Hosted API', hint: 'Groq, OpenRouter, OpenAI, or any compatible endpoint' },
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

      {form.mode === 'hosted' && (
        <label className="field">
          Provider
          <select
            value={presetForBaseUrl(form.baseUrl)?.id ?? 'custom'}
            onChange={(event) => handleProviderChange(event.target.value)}
            className="input"
          >
            {HOSTED_PROVIDERS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
            <option value="custom">Custom / other</option>
          </select>
          <span className="text-[12px] text-text-muted">
            Picking a provider fills its base URL. Pasting its key also fills the model names.
          </span>
        </label>
      )}

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

      <datalist id="axiom-provider-models">
        {modelSuggestions.map((name) => <option key={name} value={name} />)}
      </datalist>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="field">
          Chat model
          <input
            value={form.chatModel}
            onChange={(event) => update({ chatModel: event.target.value })}
            placeholder={form.mode === 'local' ? 'qwen2.5:7b' : 'openai/gpt-oss-120b'}
            list="axiom-provider-models"
            className="input"
          />
          <span className="text-[11.5px] text-text-muted">Topics, lessons, tutor, questions.</span>
        </label>
        <label className="field">
          OCR / vision model
          <input
            value={form.ocrModel}
            onChange={(event) => update({ ocrModel: event.target.value })}
            placeholder={form.mode === 'local' ? 'qwen2.5vl:3b' : 'qwen/qwen3.8-27b'}
            list="axiom-provider-models"
            className="input"
          />
          <span className="text-[11.5px] text-text-muted">Page images. Empty uses the chat model.</span>
        </label>
        <label className="field">
          Embedding model
          <input
            value={form.embedModel}
            onChange={(event) => update({ embedModel: event.target.value })}
            placeholder={form.mode === 'local' ? 'nomic-embed-text' : 'text-embedding-3-small'}
            list="axiom-provider-models"
            className="input"
          />
          <span className="text-[11.5px] text-text-muted">Optional; improves page ranking.</span>
        </label>
      </div>

      <label className="field">
        API key
        <input
          type="password"
          value={form.apiKey ?? ''}
          onChange={(event) => update({ apiKey: event.target.value })}
          onPaste={handleKeyPaste}
          onBlur={handleKeyBlur}
          placeholder={form.mode === 'local' ? 'Usually not needed for local models' : 'Paste the provider key (fills the rest)'}
          className="input"
        />
        <span className="text-[12px] text-text-muted">
          Stored in the OS secure store (Windows Credential Manager), never in the database.
        </span>
      </label>

      <div className="rounded-[var(--radius)] border border-border bg-surface p-3">
        <p className="text-[13px] font-medium">OCR speed and fidelity</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-text-muted">
          A page image costs time in proportion to its pixels. Lower is much faster and is
          usually enough for printed text; raise it for dense tables or faint handwriting.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="field">
            Page image resolution
            <select
              value={form.ocrMaxEdge}
              onChange={(event) => update({ ocrMaxEdge: Number(event.target.value) })}
              className="input"
            >
              {EDGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Max transcription tokens
            <input
              type="number"
              min={128}
              max={8192}
              step={128}
              value={form.ocrMaxTokens}
              onChange={(event) =>
                update({ ocrMaxTokens: Math.min(8192, Math.max(128, Number(event.target.value) || 1024)) })
              }
              className="input"
            />
            <span className="text-[11.5px] text-text-muted">Stops a runaway page from stalling the read.</span>
          </label>
        </div>

        <div className="mt-1 border-t border-border">
          <Toggle
            id="pref-ocr-think"
            label="OCR model uses thinking"
            description="Off by default: the scratchpad eats the reply budget on a transcription task. Turn on only for a model that reads hard pages better when it reasons."
            checked={form.ocrThink}
            onCheckedChange={(ocrThink) => update({ ocrThink })}
          />
          <Toggle
            id="pref-chat-think"
            label="Chat model uses thinking"
            description="Thinking helps lessons and roadmap reasoning, but adds seconds to every request. Local thinking models only."
            checked={form.chatThink}
            onCheckedChange={(chatThink) => update({ chatThink })}
          />
        </div>
      </div>

      {form.mode === 'local' && (
        <div className="rounded-[var(--radius)] border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-medium">Local model handling</p>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => void refreshInventory(form.baseUrl)}
            >
              Refresh model list
            </button>
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-text-muted">
            The app switches between the OCR and chat models automatically, so only the model
            in use is loaded.
          </p>
          <Toggle
            id="pref-single-model"
            label="One model in memory at a time"
            description="Before each request, unload the other role models. Slower first token after a switch, far less RAM."
            checked={form.singleModelMode}
            onCheckedChange={(singleModelMode) => update({ singleModelMode })}
          />
          <Toggle
            id="pref-auto-unload"
            label="Unload models when a job finishes"
            description="After reading a file or building a lesson, free the model memory. The next job loads its own model."
            checked={form.autoUnload}
            onCheckedChange={(autoUnload) => update({ autoUnload })}
          />
        </div>
      )}

      {form.mode === 'local' && (
        <ModelLibrary
          installed={installed}
          loaded={loaded}
          ollama={inventory?.ollama === true}
          baseUrl={form.baseUrl}
          onChanged={() => void refreshInventory(form.baseUrl)}
          onPick={(role, model) =>
            update(
              role === 'chat'
                ? { chatModel: model }
                : role === 'ocr'
                  ? { ocrModel: model }
                  : { embedModel: model },
            )
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void handleSave()} className="btn btn-primary" disabled={probe.loading || filling}>
          {probe.loading ? 'Probing...' : 'Save and probe'}
        </button>
        {form.mode === 'local' ? (
          <button type="button" onClick={() => void handleDetect()} disabled={detecting} className="btn btn-ghost">
            {detecting ? 'Scanning ports...' : 'Try local ports'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void applyHostedFill(form.baseUrl, form.apiKey ?? '')}
            disabled={filling}
            className="btn btn-ghost"
          >
            {filling ? 'Fetching models...' : 'Auto-fill models'}
          </button>
        )}
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
