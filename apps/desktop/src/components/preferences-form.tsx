'use client';

/**
 * Settings sections about the app itself: appearance, behaviour, profile,
 * study defaults, material handling, data and account. Every switch is wired
 * to a real effect; nothing here is decorative.
 */
import { useCallback, useEffect, useState } from 'react';
import { exportCourse, listCourses } from '@axiom/data';
import { getDb, isDesktopRuntime } from '../lib/db';
import {
  initialsOf,
  savePrefs,
  usePrefs,
  type AccentName,
  type CourseTab,
  type LessonFormat,
  type PrefsLanguage,
  type StudyProfile,
  type StudyDepth,
  type ThemeMode,
} from '../lib/prefs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Slider } from './ui/slider';
import { Toggle } from './toggle-row';

const THEME_OPTIONS: { value: ThemeMode; label: string; hint: string }[] = [
  { value: 'light', label: 'Light', hint: 'Warm Latte canvas' },
  { value: 'dark', label: 'Dark', hint: 'Soft Mocha canvas' },
  { value: 'system', label: 'System', hint: 'Follows the OS' },
];

const ACCENT_OPTIONS: {
  value: AccentName;
  label: string;
  color: string;
  check: string;
}[] = [
  { value: 'blue', label: 'Blue', color: '#1e66f5', check: '#ffffff' },
  { value: 'mauve', label: 'Mauve', color: '#8839ef', check: '#ffffff' },
  { value: 'green', label: 'Green', color: '#40a02b', check: '#ffffff' },
  { value: 'teal', label: 'Teal', color: '#179299', check: '#ffffff' },
  { value: 'peach', label: 'Peach', color: '#fe640b', check: '#ffffff' },
  { value: 'red', label: 'Red', color: '#d20f39', check: '#ffffff' },
  { value: 'pink', label: 'Pink', color: '#ea76cb', check: '#ffffff' },
  { value: 'yellow', label: 'Yellow', color: '#df8e1d', check: '#11111b' },
  { value: 'sapphire', label: 'Sapphire', color: '#209fb5', check: '#ffffff' },
];

const LANGUAGE_OPTIONS: { value: PrefsLanguage; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'bn', label: 'Bangla' },
  { value: 'mixed', label: 'Bangla + English' },
];

const LESSON_DEPTH_OPTIONS: { value: StudyDepth; label: string }[] = [
  { value: 'core', label: 'Full lesson' },
  { value: 'bridge', label: 'Quick recap' },
];

const COURSE_TAB_OPTIONS: { value: CourseTab; label: string }[] = [
  { value: 'material', label: 'Material' },
  { value: 'study', label: 'Study' },
  { value: 'topics', label: 'Topics & scope' },
  { value: 'roadmap', label: 'Roadmap' },
  { value: 'lessons', label: 'Lessons' },
  { value: 'tutor', label: 'Tutor' },
  { value: 'practice', label: 'Practice' },
  { value: 'progress', label: 'Progress' },
];

const STUDY_PROFILE_OPTIONS: { value: StudyProfile; label: string }[] = [
  { value: 'past_first', label: 'Past questions first' },
  { value: 'notes_first', label: 'Notes first' },
  { value: 'adaptive', label: 'Adaptive mix' },
];

const LESSON_FORMAT_OPTIONS: { value: LessonFormat; label: string }[] = [
  { value: 'board', label: 'Guided board' },
  { value: 'slides', label: 'Slide deck' },
  { value: 'read', label: 'Read all' },
];

function PrefSelect<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: { value: T; label: string }[];
  ariaLabel: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next as T);
      }}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ThemeSwatch({ mode, accent }: { mode: ThemeMode; accent: string }) {
  if (mode === 'system') {
    return (
      <span
        aria-hidden
        className="theme-swatch"
        style={{ background: '#1e1e2e' }}
      >
        <span className="flex-1" style={{ background: '#e6e9ef' }} />
        <span className="flex-1" style={{ background: '#313244' }} />
        <span style={{ width: '14%', background: accent }} />
      </span>
    );
  }
  const dark = mode === 'dark';
  return (
    <span aria-hidden className="theme-swatch" style={{ background: dark ? '#1e1e2e' : '#eff1f5' }}>
      <span style={{ width: '22%', background: dark ? '#11111b' : '#e6e9ef' }} />
      <span className="flex-1" style={{ background: dark ? '#313244' : '#ffffff' }} />
      <span style={{ width: '16%', background: accent }} />
    </span>
  );
}

export function AppearanceSettings() {
  const prefs = usePrefs();
  const accentColor = ACCENT_OPTIONS.find((option) => option.value === prefs.accent)?.color ?? '#8839ef';
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[13px] font-medium">Theme</p>
        <div role="group" aria-label="Theme" className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={prefs.theme === option.value}
              onClick={() => savePrefs({ theme: option.value })}
              className="theme-option"
            >
              <ThemeSwatch mode={option.value} accent={accentColor} />
              <span>
                <span className="block text-[13px] font-medium">{option.label}</span>
                <span className="block text-[12px] text-text-muted">{option.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[13.5px] font-medium">Accent color</p>
        <p className="mt-0.5 text-[12px] text-text-muted">
          Drives primary actions, selection and focus across the whole app.
        </p>
        <div className="accent-grid mt-3" role="radiogroup" aria-label="Accent color">
          {ACCENT_OPTIONS.map((option) => {
            const selected = prefs.accent === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={option.label}
                onClick={() => savePrefs({ accent: option.value })}
                className="accent-option"
                style={
                  {
                    '--accent-sample': option.color,
                    '--accent-check': option.check,
                  } as React.CSSProperties
                }
              >
                <span className="accent-dot" aria-hidden />
                <span className="accent-name">{option.label}</span>
                {selected && (
                  <span className="accent-check" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Toggle
          id="pref-glass"
          label="Translucent surfaces"
          description="Translucent panels and the rail blur the ambient canvas behind them. Turn off for flat, opaque surfaces."
          checked={prefs.glass}
          onCheckedChange={(glass) => savePrefs({ glass })}
        />
        <Toggle
          id="pref-sharp"
          label="Sharp corners"
          description="Square, technical edges. Off uses the soft Catppuccin radii."
          checked={prefs.sharp}
          onCheckedChange={(sharp) => savePrefs({ sharp })}
        />
        <Toggle
          id="pref-compact"
          label="Compact density"
          description="Tighter card padding and smaller page titles, for small windows."
          checked={prefs.compact}
          onCheckedChange={(compact) => savePrefs({ compact })}
        />
        <Toggle
          id="pref-motion"
          label="Reduce motion"
          description="Collapses hover, switch, shimmer and progress animations."
          checked={prefs.reduceMotion}
          onCheckedChange={(reduceMotion) => savePrefs({ reduceMotion })}
        />
      </div>
    </div>
  );
}

export function BehaviorSettings() {
  const prefs = usePrefs();
  return (
    <div className="flex flex-col gap-1">
      <div className="field pb-4">
        <span>Default course tab</span>
        <PrefSelect
          value={prefs.defaultCourseTab}
          onValueChange={(value) => savePrefs({ defaultCourseTab: value })}
          options={COURSE_TAB_OPTIONS}
          ariaLabel="Default course tab"
        />
        <span className="text-[12px] text-text-muted">
          Where &quot;Open course&quot; lands when no tab is in the link.
        </span>
      </div>

      <Toggle
        id="pref-percent"
        label="Show percentages"
        description="Show numeric progress next to the dashboard and library bars."
        checked={prefs.showPercent}
        onCheckedChange={(showPercent) => savePrefs({ showPercent })}
      />
      <Toggle
        id="pref-countdown"
        label="Exam countdown"
        description="Show days until the exam. Off shows the calendar date instead."
        checked={prefs.showCountdown}
        onCheckedChange={(showCountdown) => savePrefs({ showCountdown })}
      />
      <Toggle
        id="pref-citations"
        label="Show citation pages"
        description="Print page numbers under tutor answers and lesson sources."
        checked={prefs.showCitationPages}
        onCheckedChange={(showCitationPages) => savePrefs({ showCitationPages })}
      />
      <Toggle
        id="pref-skipped"
        label="Show skipped topics in the study plan"
        description="List roadmap topics you skipped in the Progress tab, below the plan."
        checked={prefs.showSkippedInPlan}
        onCheckedChange={(showSkippedInPlan) => savePrefs({ showSkippedInPlan })}
      />
      <Toggle
        id="pref-confirm"
        label="Confirm before deleting a course"
        description="Asks first, naming the material, roadmap and progress that will be lost."
        checked={prefs.confirmDelete}
        onCheckedChange={(confirmDelete) => savePrefs({ confirmDelete })}
      />
      <Toggle
        id="pref-toasts"
        label="Build notifications"
        description="Toasts when topic extraction, roadmap rebuilds or lessons finish or fail."
        checked={prefs.jobToasts}
        onCheckedChange={(jobToasts) => savePrefs({ jobToasts })}
      />
    </div>
  );
}

export function ProfileSettings() {
  const prefs = usePrefs();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-[var(--radius)] border border-border bg-surface p-3">
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-[2px] border border-border-strong bg-gradient-to-b from-accent to-accent/70 text-xs font-semibold text-accent-contrast"
        >
          {initialsOf(prefs.displayName)}
        </span>
        <div>
          <p className="text-[13px] font-medium">{prefs.displayName.trim() === '' ? 'Local learner' : prefs.displayName}</p>
          <p className="text-[12px] text-text-muted">Stored only on this device</p>
        </div>
      </div>

      <label className="field">
        Display name
        <input
          value={prefs.displayName}
          onChange={(event) => savePrefs({ displayName: event.target.value.slice(0, 60) })}
          placeholder="What should the dashboard call you?"
          className="input"
        />
      </label>

      <div className="field">
        <span>Preferred language</span>
        <PrefSelect
          value={prefs.language}
          onValueChange={(value) => savePrefs({ language: value })}
          options={LANGUAGE_OPTIONS}
          ariaLabel="Preferred language"
        />
        <span className="text-[12px] text-text-muted">Default language for new courses and their lessons.</span>
      </div>
    </div>
  );
}

export function StudySettings() {
  const prefs = usePrefs();
  return (
    <div className="flex flex-col gap-1">
      <div className="field py-3">
        <span>Default study profile</span>
        <PrefSelect
          value={prefs.defaultStudyProfile}
          onValueChange={(value) => savePrefs({ defaultStudyProfile: value })}
          options={STUDY_PROFILE_OPTIONS}
          ariaLabel="Default study profile"
        />
        <span className="text-[12px] text-text-muted">
          New courses start here. Each course can choose its own style in the Study tab.
        </span>
      </div>

      <div className="field py-3">
        <span>Default daily study time</span>
        <input
          type="number"
          min={15}
          max={240}
          step={5}
          value={prefs.defaultDailyMinutes}
          onChange={(event) => savePrefs({ defaultDailyMinutes: Number(event.target.value) })}
          className="input"
        />
        <span className="text-[12px] text-text-muted">Used to size the daily plan for new courses.</span>
      </div>

      <div className="field py-3">
        <span>Lesson format</span>
        <PrefSelect
          value={prefs.lessonFormat}
          onValueChange={(value) => savePrefs({ lessonFormat: value })}
          options={LESSON_FORMAT_OPTIONS}
          ariaLabel="Lesson format"
        />
        <span className="text-[12px] text-text-muted">
          Guided board teaches beat by beat. Slide deck and Read all are the simpler fallbacks.
        </span>
      </div>

      <div className="field py-3">
        <span>Default lesson depth</span>
        <PrefSelect
          value={prefs.defaultLessonDepth}
          onValueChange={(value) => savePrefs({ defaultLessonDepth: value })}
          options={LESSON_DEPTH_OPTIONS}
          ariaLabel="Default lesson depth"
        />
        <span className="text-[12px] text-text-muted">The Lessons tab opens with this depth; switch per lesson any time.</span>
      </div>

      <div className="py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] font-medium">Bridge depth for new courses</p>
          <span className="num text-[12px] text-text-muted">{prefs.defaultBridgeDepth}</span>
        </div>
        <Slider
          value={[prefs.defaultBridgeDepth]}
          onValueChange={(next) => {
            const depth = Array.isArray(next) ? next[0] : next;
            if (typeof depth === 'number') savePrefs({ defaultBridgeDepth: depth });
          }}
          min={0}
          max={4}
          step={1}
          aria-label="Bridge depth for new courses"
          className="mt-3"
        />
        <p className="mt-2 text-[12px] leading-relaxed text-text-muted">
          How far back the roadmap fills in missing prerequisites. Existing
          courses keep their own setting on the Roadmap tab.
        </p>
      </div>

      <Toggle
        id="pref-guide"
        label="Tutor starts in Guide me"
        description="The tutor asks a guiding question back before giving the answer."
        checked={prefs.tutorGuideDefault}
        onCheckedChange={(tutorGuideDefault) => savePrefs({ tutorGuideDefault })}
      />
      <Toggle
        id="pref-autoknown"
        label="Auto-mark strong practice results"
        description="A written score of 5/6 or better marks the topic known automatically."
        checked={prefs.autoKnownOnStrongScore}
        onCheckedChange={(autoKnownOnStrongScore) => savePrefs({ autoKnownOnStrongScore })}
      />
    </div>
  );
}

export function MaterialSettings() {
  const prefs = usePrefs();
  return (
    <div className="flex flex-col gap-1">
      <Toggle
        id="pref-autorebuild"
        label="Rebuild the roadmap after upload"
        description="Queues a roadmap rebuild once new material has been read."
        checked={prefs.autoRebuildRoadmap}
        onCheckedChange={(autoRebuildRoadmap) => savePrefs({ autoRebuildRoadmap })}
      />
      <Toggle
        id="pref-autoembed"
        label="Store page embeddings"
        description="Embeds pages when the provider has an embedding model, upgrading search to cosine similarity."
        checked={prefs.autoEmbedPages}
        onCheckedChange={(autoEmbedPages) => savePrefs({ autoEmbedPages })}
      />
      <Toggle
        id="pref-flag"
        label="Flag low-confidence pages"
        description="Shows scanned pages the OCR was unsure about, with vision re-read and paste actions."
        checked={prefs.flagLowConfidence}
        onCheckedChange={(flagLowConfidence) => savePrefs({ flagLowConfidence })}
      />
    </div>
  );
}

export function DataSettings() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [courseCount, setCourseCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void (async () => {
      try {
        const db = await getDb();
        setCourseCount((await listCourses(db.driver)).length);
      } catch {
        setCourseCount(null);
      }
    })();
  }, []);

  const handleExport = useCallback(async () => {
    setBusy(true);
    setNote('');
    try {
      const db = await getDb();
      const courses = await listCourses(db.driver);
      const snapshots = await Promise.all(courses.map((course) => exportCourse(db.driver, course.id)));
      const json = JSON.stringify(
        { format: 'axiom-export/1', exportedAt: new Date().toISOString(), courses: snapshots },
        null,
        2,
      );
      await navigator.clipboard.writeText(json);
      setNote(`Copied ${courses.length} course${courses.length === 1 ? '' : 's'} (${Math.round(json.length / 1024)} KB) to the clipboard.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-2.5 sm:grid-cols-3">
        <div className="rounded-[var(--radius)] border border-border bg-surface p-3">
          <dt className="text-[9.5px] uppercase tracking-wide text-text-muted">Storage</dt>
          <dd className="mt-1 text-[12.5px] font-medium">Local SQLite</dd>
        </div>
        <div className="rounded-[var(--radius)] border border-border bg-surface p-3">
          <dt className="text-[9.5px] uppercase tracking-wide text-text-muted">Courses</dt>
          <dd className="mt-1 text-[12.5px] font-medium">{courseCount ?? '—'}</dd>
        </div>
        <div className="rounded-[var(--radius)] border border-border bg-surface p-3">
          <dt className="text-[9.5px] uppercase tracking-wide text-text-muted">Cloud sync</dt>
          <dd className="mt-1 text-[12.5px] font-medium">Off</dd>
        </div>
      </dl>

      <p className="text-[12.5px] leading-relaxed text-text-muted">
        Courses, material text, roadmaps, lessons and progress are stored in a
        local SQLite database inside this app&apos;s data folder. Nothing is
        uploaded unless you configure a hosted model provider, which only
        receives the prompts needed for a step.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleExport()} disabled={busy}>
          {busy ? 'Collecting...' : 'Export all data as JSON'}
        </button>
        <span className="text-[12px] text-text-muted">Full snapshot, including page text and lessons.</span>
      </div>
      {note !== '' && <p className="text-[12px] text-text-muted" aria-live="polite">{note}</p>}
    </div>
  );
}

export function AccountSettings() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[var(--radius)] border border-border bg-surface p-4">
        <p className="text-[13px] font-medium">Local account</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">
          Axiom needs no sign-in for your own material. Your profile, courses and
          progress belong to this device only, and the app works offline.
        </p>
        <ul className="mt-3 grid gap-1.5 text-[12px] text-text-muted sm:grid-cols-2">
          {['No email required', 'No password to remember', 'Works without internet', 'Delete a course any time'].map((line) => (
            <li key={line} className="flex items-center gap-2">
              <span aria-hidden className="size-1.5 rounded-[1px]" style={{ background: 'var(--color-known)' }} />
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-[var(--radius)] border border-dashed border-border-strong p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-medium">Optional cloud account</p>
          <span className="chip">Not in this build</span>
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">
          An account would only be for premade roadmaps and sharing a roadmap by
          link. It is never needed to study your own material. This desktop build
          runs fully local, so sign-in is disabled.
        </p>
        <button type="button" className="btn btn-ghost btn-sm mt-3" disabled>
          Sign in
        </button>
      </div>
    </div>
  );
}

export function AboutSettings() {
  return (
    <dl className="grid gap-2.5 text-[12.5px] sm:grid-cols-2">
      {[
        ['App', 'Axiom Learning 0.1.0'],
        ['Runtime', 'Desktop - Tauri 2 + Next.js'],
        ['UI layer', 'shadcn/ui + Base UI + Catppuccin tokens'],
        ['Roadmap engine', 'Deterministic pruning'],
        ['Data', 'Local only - no account, no sync'],
        ['Interface', 'Latte / Mocha / System, 9 accents'],
      ].map(([label, value]) => (
        <div key={label} className="rounded-[var(--radius)] border border-border bg-surface p-3">
          <dt className="text-[11px] uppercase tracking-wide text-text-muted">{label}</dt>
          <dd className="mt-1">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
