/**
 * Local app preferences: theme, aero surface options, profile, study defaults
 * and the behaviour switches used across the app. Stored in localStorage so
 * they survive restarts and apply before the database is open. Nothing here
 * leaves the device.
 */
import { useSyncExternalStore } from 'react';
import { PREFS_STORAGE_KEY } from './prefs-storage';

export type ThemeMode = 'light' | 'dark' | 'system';
export type StudyDepth = 'core' | 'bridge';
export type PrefsLanguage = 'en' | 'bn' | 'mixed';
export type StudyProfile = 'past_first' | 'notes_first' | 'adaptive';
export type LessonFormat = 'board' | 'slides' | 'read';
export type CourseTab =
  | 'material'
  | 'study'
  | 'topics'
  | 'roadmap'
  | 'lessons'
  | 'tutor'
  | 'practice'
  | 'progress';
export type AccentName =
  | 'blue'
  | 'mauve'
  | 'green'
  | 'teal'
  | 'peach'
  | 'red'
  | 'pink'
  | 'yellow'
  | 'sapphire';

export const ACCENT_NAMES: AccentName[] = [
  'blue',
  'mauve',
  'green',
  'teal',
  'peach',
  'red',
  'pink',
  'yellow',
  'sapphire',
];

export interface Prefs {
  /* Appearance */
  theme: ThemeMode;
  accent: AccentName;
  glass: boolean;
  sharp: boolean;
  compact: boolean;
  reduceMotion: boolean;
  /* Profile */
  displayName: string;
  language: PrefsLanguage;
  /* Study defaults */
  defaultBridgeDepth: number;
  defaultLessonDepth: StudyDepth;
  defaultCourseTab: CourseTab;
  defaultStudyProfile: StudyProfile;
  defaultDailyMinutes: number;
  lessonFormat: LessonFormat;
  /* Behaviour */
  showPercent: boolean;
  showCountdown: boolean;
  confirmDelete: boolean;
  showCitationPages: boolean;
  showSkippedInPlan: boolean;
  tutorGuideDefault: boolean;
  autoKnownOnStrongScore: boolean;
  /* Setup */
  /** False until the first-run model setup has been completed or skipped. */
  onboarded: boolean;
  /* Materials */
  jobToasts: boolean;
  autoRebuildRoadmap: boolean;
  autoEmbedPages: boolean;
  flagLowConfidence: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  accent: 'mauve',
  glass: true,
  sharp: false,
  compact: false,
  reduceMotion: false,
  displayName: '',
  language: 'en',
  defaultBridgeDepth: 2,
  defaultLessonDepth: 'core',
  defaultCourseTab: 'material',
  defaultStudyProfile: 'adaptive',
  defaultDailyMinutes: 45,
  lessonFormat: 'board',
  showPercent: true,
  showCountdown: true,
  confirmDelete: true,
  showCitationPages: true,
  showSkippedInPlan: false,
  tutorGuideDefault: false,
  autoKnownOnStrongScore: false,
  onboarded: false,
  jobToasts: true,
  autoRebuildRoadmap: true,
  autoEmbedPages: true,
  flagLowConfidence: true,
};

let cache: Prefs | null = null;
const listeners = new Set<() => void>();

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitize(raw: unknown): Prefs {
  const value = (raw ?? {}) as Partial<Prefs>;
  const theme: ThemeMode =
    value.theme === 'light' || value.theme === 'dark' || value.theme === 'system'
      ? value.theme
      : DEFAULT_PREFS.theme;
  const accent: AccentName = ACCENT_NAMES.includes(value.accent as AccentName)
    ? (value.accent as AccentName)
    : DEFAULT_PREFS.accent;
  const language: PrefsLanguage =
    value.language === 'bn' || value.language === 'mixed' || value.language === 'en'
      ? value.language
      : DEFAULT_PREFS.language;
  const depth = Number(value.defaultBridgeDepth);
  const tab =
    value.defaultCourseTab === 'study' ||
    value.defaultCourseTab === 'topics' ||
    value.defaultCourseTab === 'roadmap' ||
    value.defaultCourseTab === 'lessons' ||
    value.defaultCourseTab === 'tutor' ||
    value.defaultCourseTab === 'practice' ||
    value.defaultCourseTab === 'progress' ||
    value.defaultCourseTab === 'material'
      ? value.defaultCourseTab
      : DEFAULT_PREFS.defaultCourseTab;
  const studyProfile: StudyProfile =
    value.defaultStudyProfile === 'past_first' ||
    value.defaultStudyProfile === 'notes_first' ||
    value.defaultStudyProfile === 'adaptive'
      ? value.defaultStudyProfile
      : DEFAULT_PREFS.defaultStudyProfile;
  const daily = Number(value.defaultDailyMinutes);
  const lessonFormat: LessonFormat =
    value.lessonFormat === 'board' || value.lessonFormat === 'slides' || value.lessonFormat === 'read'
      ? value.lessonFormat
      : DEFAULT_PREFS.lessonFormat;
  return {
    theme,
    accent,
    glass: bool(value.glass, DEFAULT_PREFS.glass),
    sharp: bool(value.sharp, DEFAULT_PREFS.sharp),
    compact: bool(value.compact, DEFAULT_PREFS.compact),
    reduceMotion: bool(value.reduceMotion, DEFAULT_PREFS.reduceMotion),
    displayName: typeof value.displayName === 'string' ? value.displayName : '',
    language,
    defaultBridgeDepth: Number.isFinite(depth) ? Math.min(4, Math.max(0, Math.round(depth))) : 2,
    defaultLessonDepth: value.defaultLessonDepth === 'bridge' ? 'bridge' : 'core',
    defaultCourseTab: tab,
    defaultStudyProfile: studyProfile,
    defaultDailyMinutes: Number.isFinite(daily) ? Math.min(240, Math.max(15, Math.round(daily))) : 45,
    lessonFormat,
    showPercent: bool(value.showPercent, DEFAULT_PREFS.showPercent),
    showCountdown: bool(value.showCountdown, DEFAULT_PREFS.showCountdown),
    confirmDelete: bool(value.confirmDelete, DEFAULT_PREFS.confirmDelete),
    showCitationPages: bool(value.showCitationPages, DEFAULT_PREFS.showCitationPages),
    showSkippedInPlan: bool(value.showSkippedInPlan, DEFAULT_PREFS.showSkippedInPlan),
    tutorGuideDefault: bool(value.tutorGuideDefault, DEFAULT_PREFS.tutorGuideDefault),
    autoKnownOnStrongScore: bool(value.autoKnownOnStrongScore, DEFAULT_PREFS.autoKnownOnStrongScore),
    onboarded: bool(value.onboarded, DEFAULT_PREFS.onboarded),
    jobToasts: bool(value.jobToasts, DEFAULT_PREFS.jobToasts),
    autoRebuildRoadmap: bool(value.autoRebuildRoadmap, DEFAULT_PREFS.autoRebuildRoadmap),
    autoEmbedPages: bool(value.autoEmbedPages, DEFAULT_PREFS.autoEmbedPages),
    flagLowConfidence: bool(value.flagLowConfidence, DEFAULT_PREFS.flagLowConfidence),
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
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.accent = prefs.accent;
  root.dataset.reduceMotion = String(prefs.reduceMotion);
  root.dataset.glass = prefs.glass ? 'on' : 'off';
  root.dataset.corners = prefs.sharp ? 'sharp' : 'round';
  root.dataset.density = prefs.compact ? 'compact' : 'comfortable';
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

export function languageLabel(language: string): string {
  return language === 'mixed' ? 'Bangla + English' : language === 'bn' ? 'Bangla' : 'English';
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
