/**
 * Model role and lifecycle management for the local runtime.
 *
 * One endpoint can hold several models, but a small machine should keep only
 * the model a step needs: OCR runs its vision model, then the text jobs run
 * the chat model. Before every model request the hook below unloads the other
 * loaded models (single-model mode) and warms the requested one; the worker
 * unloads everything when the job finishes. All of it is best effort: a swap
 * failure never turns into a failed model request.
 */
import {
  listLoadedOllamaModels,
  listOllamaModels,
  loadOllamaModel,
  ollamaRoot,
  ollamaVersion,
  pullOllamaModel,
  setBeforeModelCall,
  unloadOllamaModel,
  type OllamaLoadedModel,
  type OllamaModel,
  type PullProgress,
} from '@axiom/ai';
import { getProviderSettings, type ProviderSettings } from '@axiom/data';
import { getDb } from './db';

export type { OllamaLoadedModel, OllamaModel, PullProgress };

/** How long a warmed model may sit idle before Ollama drops it itself. */
const KEEP_ALIVE = '10m';
const LOADED_TTL_MS = 2_000;
const OLLAMA_PROBE_TTL_MS = 30_000;

let installed = false;
/** While probing capabilities, swapping models per check is pure overhead. */
let suspended = 0;
let queue: Promise<unknown> = Promise.resolve();
let loadedCache: { root: string; at: number; models: OllamaLoadedModel[] } | null = null;
let probeCache: { root: string; at: number; version: string | null } | null = null;

/** Runs model swaps one at a time, so two callers cannot fight over memory. */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

export function canonicalModelName(name: string): string {
  return name.includes(':') ? name : `${name}:latest`;
}

function sameModel(a: string, b: string): boolean {
  return canonicalModelName(a) === canonicalModelName(b);
}

async function readSettings(): Promise<ProviderSettings | null> {
  try {
    const db = await getDb();
    return await getProviderSettings(db.driver);
  } catch {
    return null;
  }
}

/** A URL that answers /api/version, or null when it is not Ollama. */
async function ollamaRootForUrl(baseUrl: string): Promise<string | null> {
  const root = ollamaRoot(baseUrl);
  const now = Date.now();
  if (probeCache !== null && probeCache.root === root && now - probeCache.at < OLLAMA_PROBE_TTL_MS) {
    return probeCache.version === null ? null : root;
  }
  const version = await ollamaVersion(root);
  probeCache = { root, at: now, version };
  return version === null ? null : root;
}

/** A local endpoint is the only place model swapping applies. */
async function ollamaFor(settings: ProviderSettings): Promise<string | null> {
  if (settings.mode !== 'local') return null;
  return ollamaRootForUrl(settings.baseUrl);
}

async function refreshLoaded(root: string): Promise<OllamaLoadedModel[]> {
  const now = Date.now();
  if (loadedCache !== null && loadedCache.root === root && now - loadedCache.at < LOADED_TTL_MS) {
    return loadedCache.models;
  }
  try {
    const models = await listLoadedOllamaModels(root);
    loadedCache = { root, at: now, models };
    return models;
  } catch {
    return loadedCache?.root === root ? loadedCache.models : [];
  }
}

function remember(root: string, models: OllamaLoadedModel[]): void {
  loadedCache = { root, at: Date.now(), models };
}

/**
 * Makes `model` the loaded model when the endpoint is local Ollama. Other
 * loaded models are dropped first in single-model mode.
 */
async function ensureLoaded(model: string): Promise<void> {
  if (model.trim() === '') return;
  const settings = await readSettings();
  if (settings === null) return;
  const root = await ollamaFor(settings);
  if (root === null) return;

  await serial(async () => {
    const loaded = await refreshLoaded(root);
    if (settings.singleModelMode) {
      for (const entry of loaded) {
        if (sameModel(entry.name, model)) continue;
        try {
          await unloadOllamaModel(root, entry.name);
        } catch {
          // Already gone, or the server refused: never block the request.
        }
      }
      if (loaded.some((entry) => sameModel(entry.name, model))) {
        remember(root, loaded.filter((entry) => sameModel(entry.name, model)));
        return;
      }
    } else if (loaded.some((entry) => sameModel(entry.name, model))) {
      return;
    }
    try {
      await loadOllamaModel(root, model, { keepAlive: KEEP_ALIVE });
    } catch {
      // Ollama loads the model on the request itself if this warm-up fails.
    }
    const current = await refreshLoaded(root).catch(() => []);
    remember(
      root,
      current.some((entry) => sameModel(entry.name, model))
        ? current
        : [...current, { name: model, sizeBytes: null, expiresAt: null }],
    );
  });
}

/** Unloads every local model that is in memory. */
export async function releaseAllLocalModels(): Promise<void> {
  const settings = await readSettings();
  if (settings === null) return;
  const root = await ollamaFor(settings);
  if (root === null) return;
  await serial(async () => {
    const loaded = await refreshLoaded(root);
    for (const entry of loaded) {
      try {
        await unloadOllamaModel(root, entry.name);
      } catch {
        // Nothing to unload.
      }
    }
    remember(root, []);
  });
}

/** Called by the worker after a job: free memory when the setting asks. */
export async function releaseModelsAfterJob(): Promise<void> {
  const settings = await readSettings();
  if (settings === null || !settings.autoUnload) return;
  await releaseAllLocalModels();
}

/** Registers the request hook once. Safe to call from several hosts. */
export function installModelManager(): void {
  if (installed) return;
  installed = true;
  setBeforeModelCall(async (model) => {
    if (suspended > 0) return;
    await ensureLoaded(model);
  });
}

/**
 * Runs a capability probe without swapping models between checks: the probe
 * touches every role in a row, and the real requests swap as they need.
 */
export async function withoutModelSwitching<T>(work: () => Promise<T>): Promise<T> {
  suspended += 1;
  try {
    return await work();
  } finally {
    suspended -= 1;
  }
}

export interface LocalModelInventory {
  ollama: boolean;
  models: OllamaModel[];
  loaded: OllamaLoadedModel[];
}

/**
 * What the machine has and what is in memory; used by settings/onboarding.
 * An explicit base URL lets onboarding inspect a server before it is saved.
 */
export async function localModelInventory(baseUrlOverride?: string): Promise<LocalModelInventory> {
  let root: string | null;
  if (baseUrlOverride !== undefined && baseUrlOverride.trim() !== '') {
    root = await ollamaRootForUrl(baseUrlOverride);
  } else {
    const settings = await readSettings();
    if (settings === null || settings.mode !== 'local') {
      return { ollama: false, models: [], loaded: [] };
    }
    root = await ollamaFor(settings);
  }
  if (root === null) return { ollama: false, models: [], loaded: [] };
  const [models, loaded] = await Promise.all([
    listOllamaModels(root).catch(() => []),
    refreshLoaded(root),
  ]);
  return { ollama: true, models, loaded };
}

/** Streams a model download; the caller owns the progress UI. */
export async function downloadModel(
  model: string,
  onProgress?: (progress: PullProgress) => void,
  baseUrlOverride?: string,
): Promise<void> {
  let root: string | null;
  if (baseUrlOverride !== undefined && baseUrlOverride.trim() !== '') {
    root = await ollamaRootForUrl(baseUrlOverride);
  } else {
    const settings = await readSettings();
    if (settings === null) throw new Error('Set the provider URL first.');
    root = await ollamaFor(settings);
  }
  if (root === null) throw new Error('Downloads need a running Ollama endpoint.');
  await pullOllamaModel(root, model, { onProgress });
  loadedCache = null;
}

/** Forgets the loaded-model cache, e.g. after a manual refresh in settings. */
export function invalidateModelCaches(): void {
  loadedCache = null;
  probeCache = null;
}
