/**
 * Local app preferences: theme (light / dark / follow system), profile and
 * study defaults. Stored in localStorage so they survive restarts and apply
 * before the database is open; nothing here leaves the device.
 */
import { useSyncExternalStore } from 'react';
import { PREFS_STORAGE_KEY } from './prefs-storage';

export type ThemeMode = 'light' | 'dark' | 'system';
export type StudyDepth = 'core' | 'bridge';
export type PrefsLanguage = 'en' | 'bn' | 'mixed';

export interface Prefs {
  theme: ThemeMode;
  displayName: string;
  language: PrefsLanguage;
  defaultBridgeDepth: number;
  defaultLessonDepth: StudyDepth;
  reduceMotion: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  displayName: '',
  language: 'en',
  defaultBridgeDepth: 2,
  defaultLessonDepth: 'core',
  reduceMotion: false,
};

let cache: Prefs | null = null;
const listeners = new Set<() => void>();

function sanitize(raw: unknown): Prefs {
  const value = (raw ?? {}) as Partial<Prefs>;
  const theme: ThemeMode =
    value.theme === 'light' || value.theme === 'dark' || value.theme === 'system'
      ? value.theme
      : DEFAULT_PREFS.theme;
  const language: PrefsLanguage =
    value.language === 'bn' || value.language === 'mixed' || value.language === 'en'
      ? value.language
      : DEFAULT_PREFS.language;
  const depth = Number(value.defaultBridgeDepth);
  return {
    theme,
    displayName: typeof value.displayName === 'string' ? value.displayName : '',
    language,
    defaultBridgeDepth: Number.isFinite(depth) ? Math.min(4, Math.max(0, Math.round(depth))) : 2,
    defaultLessonDepth: value.defaultLessonDepth === 'bridge' ? 'bridge' : 'core',
    reduceMotion: value.reduceMotion === true,
  };
}

export function loadPrefs(): Prefs {
  if (cache !== null) return cache;
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    cache = sanitize(raw === null ? {} : JSON.parse(raw));
  } catch {
    cache = { ...DEFAULT_PREFS };
  }
  return cache;
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyPrefs(prefs: Prefs): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(prefs.theme);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.reduceMotion = String(prefs.reduceMotion);
  root.style.colorScheme = resolved;
}

export function savePrefs(patch: Partial<Prefs>): Prefs {
  const next = sanitize({ ...loadPrefs(), ...patch });
  cache = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode or a full disk: keep the in-memory value for this session.
    }
  }
  applyPrefs(next);
  for (const listener of listeners) listener();
  return next;
}

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Prefs {
  return loadPrefs();
}

function getServerSnapshot(): Prefs {
  return DEFAULT_PREFS;
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribePrefs, getSnapshot, getServerSnapshot);
}

/** Re-applies the theme when the OS switches light/dark in System mode. */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (loadPrefs().theme === 'system') applyPrefs(loadPrefs());
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') return 'AL';
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
