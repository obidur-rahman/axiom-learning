'use client';

/**
 * First-run model setup. A fresh install has no provider, and a local model
 * server with nothing downloaded is a dead end unless the app names the models
 * and can fetch them. This dialog suggests one model per role, downloads them
 * from Ollama, and saves the routing.
 */
import { useCallback, useEffect, useState } from 'react';
import { getProviderSettings } from '@axiom/data';
import { getDb, isDesktopRuntime } from '../lib/db';
import {
  localModelInventory,
  type LocalModelInventory,
} from '../lib/model-manager';
import { autoDetect, probeAndStore, saveForm, type ProviderForm } from '../lib/provider';
import { savePrefs, usePrefs } from '../lib/prefs';
import { ModelLibrary } from './model-library';
import { Toggle } from './toggle-row';

const DEFAULT_FORM: ProviderForm = {
  baseUrl: 'http://localhost:11434',
  chatModel: 'qwen2.5:7b',
  ocrModel: 'qwen2.5vl:3b',
  embedModel: 'nomic-embed-text',
  mode: 'local',
  ocrThink: false,
  chatThink: false,
  ocrMaxEdge: 1400,
  ocrMaxTokens: 1024,
  singleModelMode: true,
  autoUnload: true,
};

const HOSTED_FORM: ProviderForm = {
  ...DEFAULT_FORM,
  baseUrl: 'https://openrouter.ai/api',
  chatModel: '',
  ocrModel: '',
  embedModel: '',
  mode: 'hosted',
  singleModelMode: false,
  autoUnload: false,
};

type Step = 'welcome' | 'configure';

/**
 * Shows the setup once, on a desktop install with no provider configured.
 * Existing installs (or an explicitly finished setup) never see it.
 */
export function OnboardingGate() {
  const prefs = usePrefs();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isDesktopRuntime() || prefs.onboarded) {
      setShow(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const db = await getDb();
        const settings = await getProviderSettings(db.driver);
        if (!cancelled) setShow(settings === null);
      } catch {
        if (!cancelled) setShow(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prefs.onboarded]);

  if (!show) return null;
  return <OnboardingDialog onDone={() => setShow(false)} />;
}

function OnboardingDialog({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [form, setForm] = useState<ProviderForm>(DEFAULT_FORM);
  const [inventory, setInventory] = useState<LocalModelInventory | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const finish = useCallback(() => {
    savePrefs({ onboarded: true });
    onDone();
  }, [onDone]);

  const refreshInventory = useCallback(async (baseUrl?: string) => {
    try {
      setInventory(await localModelInventory(baseUrl));
    } catch {
      setInventory(null);
    }
  }, []);

  useEffect(() => {
    if (step !== 'configure' || form.mode !== 'local') return;
    void refreshInventory(form.baseUrl);
    // Only on entering the step / switching mode: typing a URL must not fire
    // a probe per keystroke. "Find Ollama" and saving refresh it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, form.mode, refreshInventory]);

  const update = useCallback((patch: Partial<ProviderForm>) => {
    setForm((current) => ({ ...current, ...patch }));
  }, []);

  const handleDetect = useCallback(async () => {
    setDetecting(true);
    setNote('');
    try {
      const found = await autoDetect();
      if (found === null) {
        setNote('No local server answered on ports 11434, 1234 or 8080. Start Ollama, then try again.');
      } else {
        setForm((current) => ({ ...current, ...found }));
        setNote(`Found ${found.baseUrl}.`);
      }
    } finally {
      setDetecting(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (form.chatModel.trim() === '' || form.baseUrl.trim() === '') {
      setNote('A base URL and a chat model are required. The OCR model can be filled in later.');
      return;
    }
    setSaving(true);
    setNote('Saving and checking the models...');
    try {
      await saveForm(form);
      await refreshInventory(form.baseUrl);
      try {
        await probeAndStore();
        setNote('Saved. The models answered.');
      } catch {
        setNote('Saved. The check did not answer yet; the app will report per-step errors.');
      }
      finish();
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [form, finish, refreshInventory]);

  const installed = inventory?.models.map((model) => model.name) ?? [];
  const loaded = inventory?.loaded.map((model) => model.name) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="card max-h-[92vh] w-full max-w-3xl overflow-y-auto p-5 sm:p-6"
      >
        {step === 'welcome' ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="chip w-fit">First run</p>
              <h1 id="onboarding-title" className="page-title mt-2">Set up your models</h1>
              <p className="page-sub mt-1">
                Axiom uses a different model for different work: a vision model reads page
                images, a text model writes lessons and answers, an embedding model ranks
                pages. They all stay on this device.
              </p>
            </div>

            <ul className="grid gap-2 sm:grid-cols-3">
              {[
                { title: 'OCR model', body: 'Reads scans and handwriting, page by page.' },
                { title: 'Chat model', body: 'Writes topics, roadmaps, lessons and tutor answers.' },
                { title: 'Embedding model', body: 'Optional; improves which pages get cited.' },
              ].map((entry) => (
                <li key={entry.title} className="rounded-[var(--radius)] border border-border bg-surface p-3">
                  <p className="text-[13px] font-medium">{entry.title}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-text-muted">{entry.body}</p>
                </li>
              ))}
            </ul>

            <p className="rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-text-muted">
              Local models need <span className="text-text">Ollama</span> (or LM Studio) on this
              machine. Remote OpenAI-compatible endpoints work too; the API key is kept in the OS
              secure store.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary" onClick={() => setStep('configure')}>
                Choose models
              </button>
              <button type="button" className="btn btn-ghost" onClick={finish}>
                Skip for now
              </button>
              <span className="text-[12px] text-text-muted">Everything here is also in Settings.</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className="chip w-fit">Step 2 of 2</p>
              <h1 id="onboarding-title" className="page-title mt-2">Pick one model per role</h1>
              <p className="page-sub mt-1">
                Suggested models are pre-filled. Download what is missing, then finish; the app
                switches between them automatically.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Where the models run">
              {[
                { value: 'local' as const, label: 'Local (Ollama)', hint: 'Free, offline, private' },
                { value: 'hosted' as const, label: 'Hosted API', hint: 'OpenRouter, OpenAI, or compatible' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={form.mode === option.value}
                  onClick={() => update(option.value === 'local' ? DEFAULT_FORM : HOSTED_FORM)}
                  className={
                    form.mode === option.value
                      ? 'rounded-2xl border border-accent bg-surface p-3 text-left'
                      : 'rounded-2xl border border-border bg-panel-raised p-3 text-left hover:border-border-strong'
                  }
                >
                  <span className="block text-[13px] font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-[12px] text-text-muted">{option.hint}</span>
                </button>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="field">
                Endpoint URL
                <input
                  className="input"
                  value={form.baseUrl}
                  onChange={(event) => update({ baseUrl: event.target.value })}
                  placeholder={form.mode === 'local' ? 'http://localhost:11434' : 'https://openrouter.ai/api'}
                />
              </label>
              {form.mode === 'local' && (
                <button
                  type="button"
                  className="btn btn-ghost self-end"
                  onClick={() => void handleDetect()}
                  disabled={detecting}
                >
                  {detecting ? 'Scanning...' : 'Find Ollama'}
                </button>
              )}
            </div>

            {form.mode === 'hosted' && (
              <label className="field">
                API key
                <input
                  type="password"
                  className="input"
                  value={form.apiKey ?? ''}
                  onChange={(event) => update({ apiKey: event.target.value })}
                  placeholder="Paste the provider key"
                />
              </label>
            )}

            <datalist id="onboarding-models">
              {installed.map((name) => <option key={name} value={name} />)}
            </datalist>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="field">
                Chat model
                <input
                  className="input"
                  list="onboarding-models"
                  value={form.chatModel}
                  onChange={(event) => update({ chatModel: event.target.value })}
                  placeholder="qwen2.5:7b"
                />
              </label>
              <label className="field">
                OCR / vision model
                <input
                  className="input"
                  list="onboarding-models"
                  value={form.ocrModel}
                  onChange={(event) => update({ ocrModel: event.target.value })}
                  placeholder="qwen2.5vl:3b"
                />
              </label>
              <label className="field">
                Embedding model
                <input
                  className="input"
                  list="onboarding-models"
                  value={form.embedModel}
                  onChange={(event) => update({ embedModel: event.target.value })}
                  placeholder="nomic-embed-text"
                />
              </label>
            </div>

            {form.mode === 'local' && (
              <>
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
                <div className="rounded-[var(--radius)] border border-border bg-surface px-3">
                  <Toggle
                    id="onboarding-single-model"
                    label="Keep one model in memory at a time"
                    description="Unloads the other role models before each request, so a small machine is not holding two large models."
                    checked={form.singleModelMode}
                    onCheckedChange={(singleModelMode) => update({ singleModelMode })}
                  />
                  <Toggle
                    id="onboarding-auto-unload"
                    label="Unload models when a job finishes"
                    description="Frees RAM after reading or building; the next step loads its own model."
                    checked={form.autoUnload}
                    onCheckedChange={(autoUnload) => update({ autoUnload })}
                  />
                </div>
              </>
            )}

            {note !== '' && (
              <p className="rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-[12.5px] text-text-muted" aria-live="polite">
                {note}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSave()}
                disabled={saving}
                aria-busy={saving}
              >
                {saving ? 'Saving...' : 'Save and finish'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setStep('welcome')}>
                Back
              </button>
              <button type="button" className="btn btn-quiet" onClick={finish}>
                Skip for now
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
