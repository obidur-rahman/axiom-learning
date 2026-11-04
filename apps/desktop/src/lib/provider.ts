/**
 * Provider configuration screen logic (pivot plan task 8): auto-detect local
 * ports, store the API key in the OS secure store, probe capabilities, and
 * expose feature gates for the rest of the UI.
 */
import {
  LOCAL_PORTS,
  detectLocalProvider,
  normalizeBaseUrl,
  probeCapabilities,
  type Capabilities,
  type ProviderConfig,
} from '@axiom/ai';
import {
  DEFAULT_CAPABILITIES,
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

export interface ProviderForm {
  baseUrl: string;
  chatModel: string;
  embedModel: string;
  apiKey?: string;
  mode: 'local' | 'hosted';
}

export async function loadForm(): Promise<ProviderForm> {
  const db = await getDb();
  const settings = await getProviderSettings(db.driver);
  const apiKey = (await getSecret(ACCOUNT_DEFAULT)) ?? '';
  if (settings === null) {
    return { baseUrl: '', chatModel: '', embedModel: '', apiKey, mode: 'local' };
  }
  return {
    baseUrl: settings.baseUrl,
    chatModel: settings.chatModel,
    embedModel: settings.embedModel ?? '',
    apiKey,
    mode: settings.mode,
  };
}

export async function saveForm(form: ProviderForm): Promise<void> {
  const db = await getDb();
  await saveProviderSettings(
    db.driver,
    {
      baseUrl: normalizeBaseUrl(form.baseUrl),
      chatModel: form.chatModel,
      embedModel: form.embedModel.trim() === '' ? null : form.embedModel.trim(),
      mode: form.mode,
    },
    false,
  );
  await setSecret(ACCOUNT_DEFAULT, form.apiKey ?? '');
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
  const config = await loadConfig();
  if (config === null) {
    capabilityCache = { ...DEFAULT_CAPABILITIES };
    return capabilityCache;
  }
  const caps: Capabilities = await probeCapabilities(config);
  capabilityCache = capabilitiesToStored(caps);
  return capabilityCache;
}

export function currentCapabilities(): StoredCapabilities {
  return capabilityCache ?? { ...DEFAULT_CAPABILITIES };
}

/** Auto-detect (FR-062): try the known local ports, offer the first that answers. */
export async function autoDetect(): Promise<ProviderForm | null> {
  const baseUrl = await detectLocalProvider({ ports: LOCAL_PORTS });
  if (baseUrl === null) return null;
  return {
    baseUrl,
    chatModel: DEFAULT_CHAT_MODEL,
    embedModel: DEFAULT_EMBED_MODEL,
    mode: 'local',
  };
}

/** Feature gates shown to the user after a probe. */
export function capabilitySummary(caps: StoredCapabilities): string[] {
  const lines: string[] = [];
  lines.push(caps.chat ? 'Lessons, tutor and practice' : 'No chat model - lessons limited');
  lines.push(caps.jsonMode ? 'Topic extraction and roadmap building' : 'No JSON mode - topic extraction may be rough');
  lines.push(caps.embeddings ? 'Suggested notes (embedding search)' : 'No embeddings - suggestions off');
  lines.push(caps.vision ? 'Vision read for scanned pages' : 'No vision - scans need OCR or paste');
  return lines;
}

export const DESKTOP_ONLY = isDesktopRuntime;
