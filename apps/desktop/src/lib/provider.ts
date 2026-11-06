/**
 * Provider configuration screen logic (pivot plan task 8): auto-detect local
 * ports, store the API key in the OS secure store, probe capabilities, and
 * expose feature gates for the rest of the UI.
 *
 * One endpoint, several roles. Chat, OCR and embeddings each get their own
 * model name, and the local runtime switches between them on demand.
 */
import {
  LOCAL_PORTS,
  detectLocalProvider,
  normalizeBaseUrl,
  pickLocalModels,
  pickOcrModel,
  probeCapabilities,
  type Capabilities,
  type ProviderConfig,
} from '@axiom/ai';
import { installModelManager, invalidateModelCaches, withoutModelSwitching } from './model-manager';
import { installProviderFetch } from './provider-http';
import {
  DEFAULT_CAPABILITIES,
  OCR_DEFAULT_MAX_EDGE,
  OCR_DEFAULT_MAX_TOKENS,
  capabilitiesToStored,
  getProviderSettings,
  saveProviderSettings,
  settingsToProviderConfig,
  type StoredCapabilities,
} from '@axiom/data';
import { getDb } from './db';
import { getSecret, isDesktopRuntime, setSecret } from './tauri';

export const DEFAULT_CHAT_MODEL = 'qwen2.5:7b';
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
export const ACCOUNT_DEFAULT = 'default';

/** The model roles the app routes requests through. */
export type ModelRole = 'chat' | 'ocr' | 'embed';

export interface ProviderForm {
  baseUrl: string;
  chatModel: string;
  ocrModel: string;
  embedModel: string;
  apiKey?: string;
  mode: 'local' | 'hosted';
  ocrThink: boolean;
  chatThink: boolean;
  ocrMaxEdge: number;
  ocrMaxTokens: number;
  singleModelMode: boolean;
  autoUnload: boolean;
}

function emptyForm(apiKey: string): ProviderForm {
  return {
    baseUrl: '',
    chatModel: '',
    ocrModel: '',
    embedModel: '',
    apiKey,
    mode: 'local',
    ocrThink: false,
    chatThink: false,
    ocrMaxEdge: OCR_DEFAULT_MAX_EDGE,
    ocrMaxTokens: OCR_DEFAULT_MAX_TOKENS,
    singleModelMode: true,
    autoUnload: true,
  };
}

export async function loadForm(): Promise<ProviderForm> {
  const db = await getDb();
  const settings = await getProviderSettings(db.driver);
  const apiKey = (await getSecret(ACCOUNT_DEFAULT)) ?? '';
  if (settings === null) return emptyForm(apiKey);
  return {
    baseUrl: settings.baseUrl,
    chatModel: settings.chatModel,
    ocrModel: settings.ocrModel ?? '',
    embedModel: settings.embedModel ?? '',
    apiKey,
    mode: settings.mode,
    ocrThink: settings.ocrThink,
    chatThink: settings.chatThink,
    ocrMaxEdge: settings.ocrMaxEdge,
    ocrMaxTokens: settings.ocrMaxTokens,
    singleModelMode: settings.singleModelMode,
    autoUnload: settings.autoUnload,
  };
}

export async function saveForm(form: ProviderForm): Promise<void> {
  const db = await getDb();
  const ocrModel = form.ocrModel.trim();
  const embedModel = form.embedModel.trim();
  await saveProviderSettings(
    db.driver,
    {
      baseUrl: normalizeBaseUrl(form.baseUrl.trim()),
      chatModel: form.chatModel.trim(),
      ocrModel: ocrModel === '' ? null : ocrModel,
      embedModel: embedModel === '' ? null : embedModel,
      mode: form.mode,
      ocrThink: form.ocrThink,
      chatThink: form.chatThink,
      ocrMaxEdge: form.ocrMaxEdge,
      ocrMaxTokens: form.ocrMaxTokens,
      singleModelMode: form.singleModelMode,
      autoUnload: form.autoUnload,
    },
    false,
  );
  await setSecret(ACCOUNT_DEFAULT, form.apiKey ?? '');
  // The endpoint or the model names may have changed: drop cached state so
  // the next request probes the new runtime.
  invalidateModelCaches();
}

export async function loadConfig(): Promise<ProviderConfig | null> {
  const db = await getDb();
  const settings = await getProviderSettings(db.driver);
  if (settings === null) return null;
  const apiKey = (await getSecret(ACCOUNT_DEFAULT)) ?? undefined;
  return settingsToProviderConfig(settings, apiKey);
}

/** Doubles as one capability cache per webview session. */
let capabilityCache: StoredCapabilities | null = null;

export async function probeAndStore(): Promise<StoredCapabilities> {
  await installProviderFetch();
  installModelManager();
  const config = await loadConfig();
  if (config === null) {
    capabilityCache = { ...DEFAULT_CAPABILITIES };
    return capabilityCache;
  }
  const caps: Capabilities = await withoutModelSwitching(() => probeCapabilities(config));
  capabilityCache = capabilitiesToStored(caps);
  return capabilityCache;
}

export function currentCapabilities(): StoredCapabilities {
  return capabilityCache ?? { ...DEFAULT_CAPABILITIES };
}

/** Auto-detect (FR-062): try the known local ports, offer the first that answers. */
export async function autoDetect(): Promise<ProviderForm | null> {
  await installProviderFetch();
  const detected = await detectLocalProvider({ ports: LOCAL_PORTS });
  if (detected === null) return null;
  const { chatModel, embedModel } = pickLocalModels(detected.models);
  return {
    ...emptyForm(''),
    baseUrl: detected.baseUrl,
    chatModel,
    ocrModel: pickOcrModel(detected.models),
    embedModel,
    mode: 'local',
  };
}

/** Feature gates shown to the user after a probe. */
export function capabilitySummary(caps: StoredCapabilities): string[] {
  const lines: string[] = [];
  lines.push(caps.chat ? 'Lessons, tutor and practice' : 'No chat model - lessons limited');
  lines.push(caps.jsonMode ? 'Topic extraction and roadmap building' : 'No JSON mode - topic extraction may be rough');
  lines.push(caps.embeddings ? 'Suggested notes (embedding search)' : 'No embeddings - suggestions off');
  lines.push(caps.vision ? 'OCR model reads scanned pages' : 'No vision model - scans fall back to built-in OCR');
  return lines;
}

export const DESKTOP_ONLY = isDesktopRuntime;
