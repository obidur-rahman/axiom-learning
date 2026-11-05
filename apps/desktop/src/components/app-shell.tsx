'use client';

/**
 * Axiom app shell: a full-height Catppuccin sidebar that belongs to the window
 * rather than floating over it. The rail carries navigation, live pipeline
 * activity, provider status, the local profile and the theme switch. It
 * collapses to a sticky top bar in a narrow window.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  getProviderSettings,
  listCourses,
} from '@axiom/data';
import { getDb, isDesktopRuntime } from '../lib/db';
import { initialsOf, savePrefs, usePrefs, type ThemeMode } from '../lib/prefs';
import { JobIndicator } from './job-indicator';
import { NotificationCenter } from './notification-center';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

interface NavEntry {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
  icon: React.ReactNode;
}

const iconProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const NAV: NavEntry[] = [
  {
    href: '/',
    label: 'Dashboard',
    match: (pathname) => pathname === '/',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/courses',
    label: 'Courses',
    match: (pathname) =>
      pathname.startsWith('/courses') ||
      pathname.startsWith('/course') ||
      pathname.startsWith('/preview'),
    icon: (
      <svg {...iconProps}>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z" />
        <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
        <path d="M9 7.5h6" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    match: (pathname) => pathname.startsWith('/settings'),
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z" />
      </svg>
    ),
  },
];

const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_LABEL: Record<ThemeMode, string> = { light: 'Light', dark: 'Dark', system: 'System' };

function RailTooltip({
  label,
  side = 'right',
  children,
}: {
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

function ThemeIcon({ mode }: { mode: ThemeMode }) {
  if (mode === 'light') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
      </svg>
    );
  }
  if (mode === 'dark') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function ThemeButton() {
  const prefs = usePrefs();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(prefs.theme) + 1) % THEME_ORDER.length] ?? 'system';
  return (
    <RailTooltip label={`Theme: ${THEME_LABEL[prefs.theme]} - switch to ${THEME_LABEL[next]}`} side="top">
      <button
        type="button"
        onClick={() => savePrefs({ theme: next })}
        className="flex size-9 items-center justify-center rounded-[var(--radius)] text-rail-icon transition-colors duration-150 hover:bg-rail-active hover:text-rail-text"
        aria-label={`Theme: ${THEME_LABEL[prefs.theme]}. Switch to ${THEME_LABEL[next]}`}
      >
        <ThemeIcon mode={prefs.theme} />
      </button>
    </RailTooltip>
  );
}

type ProviderState = 'checking' | 'ready' | 'missing' | 'browser';

function ProviderStatus() {
  const [state, setState] = useState<ProviderState>('checking');

  useEffect(() => {
    if (!isDesktopRuntime()) {
      setState('browser');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const db = await getDb();
        const settings = await getProviderSettings(db.driver);
        if (!cancelled) setState(settings === null ? 'missing' : 'ready');
      } catch {
        if (!cancelled) setState('missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dot =
    state === 'ready'
      ? 'var(--color-known)'
      : state === 'missing'
        ? 'var(--color-warning)'
        : state === 'browser'
          ? 'var(--color-skipped)'
          : 'var(--color-rail-icon)';
  const label =
    state === 'ready'
      ? 'AI provider ready'
      : state === 'missing'
        ? 'AI provider not set up'
        : state === 'browser'
          ? 'Desktop app only'
          : 'Checking AI provider';

  return (
    <Link
      href="/settings#provider"
      className="flex items-center gap-2 rounded-[var(--radius)] px-2.5 py-1.5 text-[11.5px] text-rail-icon no-underline transition-colors duration-150 hover:bg-rail-active hover:text-rail-text"
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: dot, boxShadow: state === 'ready' ? '0 0 8px var(--color-known)' : undefined }}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function SidebarBody() {
  const pathname = usePathname() ?? '/';
  const prefs = usePrefs();
  const name = prefs.displayName.trim();
  const [courseCount, setCourseCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void (async () => {
      try {
        const db = await getDb();
        const courses = await listCourses(db.driver);
        setCourseCount(courses.length);
      } catch {
        setCourseCount(null);
      }
    })();
  }, []);

  return (
    <>
      <Link href="/" className="flex items-center gap-3 px-1.5 no-underline">
        <span
          aria-hidden
          className="flex size-10 flex-none items-center justify-center rounded-[var(--radius)] border border-border text-accent"
          style={{
            background: 'linear-gradient(160deg, var(--color-accent-soft), transparent)',
            boxShadow: 'inset 0 1px 0 var(--glass-highlight)',
            borderColor: 'color-mix(in srgb, var(--color-accent) 35%, transparent)',
          }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold leading-tight text-rail-text">Axiom</span>
          <span className="block text-[10px] uppercase tracking-[0.2em] text-rail-icon">Learning</span>
        </span>
      </Link>

      {/* Profile, notifications and theme sit at the top of the rail. */}
      <div className="mt-5 rounded-[var(--radius)] border border-border bg-rail-soft p-1.5">
        <div className="flex items-center gap-1">
          <Link
            href="/settings#profile"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[calc(var(--radius)-2px)] px-1.5 py-1.5 no-underline transition-colors duration-150 hover:bg-rail-active"
            title="Edit your local profile"
          >
            <span
              aria-hidden
              className="flex size-8 flex-none items-center justify-center rounded-full border border-border bg-accent-soft text-[10.5px] font-semibold text-accent"
              style={{ borderColor: 'color-mix(in srgb, var(--color-accent) 40%, transparent)' }}
            >
              {initialsOf(name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium text-rail-text">
                {name === '' ? 'Local learner' : name}
              </span>
              <span className="block truncate text-[10.5px] text-rail-icon">On this device</span>
            </span>
          </Link>
          <NotificationCenter />
          <ThemeButton />
        </div>
      </div>

      <nav aria-label="Main" className="mt-6 flex flex-col gap-1">
        <p className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-rail-icon/75">
          Workspace
        </p>
        {NAV.map((entry) => {
          const active = entry.match(pathname);
          return (
            <Link
              key={entry.href}
              href={entry.href}
              aria-current={active ? 'page' : undefined}
              className={`nav-item ${active ? 'aria-current=page' : ''}`}
              style={active ? { background: 'var(--color-accent-soft)', color: 'var(--color-rail-text)' } : undefined}
            >
              {entry.icon}
              <span className="truncate">{entry.label}</span>
              {entry.href === '/courses' && courseCount !== null && courseCount > 0 && (
                <span className="ml-auto shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                  {courseCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2.5 pt-5">
        <JobIndicator />
        <ProviderStatus />
      </div>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';

  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="rail sticky top-0 hidden h-screen w-[258px] flex-none flex-col border-y-0 border-l-0 px-3.5 py-4 md:flex">
          <SidebarBody />
        </aside>

        <header className="rail sticky top-0 z-40 flex items-center gap-3 border-x-0 border-t-0 px-3 py-2.5 md:hidden">
          <Link href="/" className="flex items-center gap-2 text-rail-text no-underline">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" />
            </svg>
            <span className="text-[14px] font-semibold">Axiom</span>
          </Link>
          <nav aria-label="Main" className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map((entry) => (
              <Link
                key={entry.href}
                href={entry.href}
                aria-current={entry.match(pathname) ? 'page' : undefined}
                className="rounded-[var(--radius)] px-2.5 py-1.5 text-[12px] text-rail-icon no-underline"
                style={
                  entry.match(pathname)
                    ? { background: 'var(--color-accent-soft)', color: 'var(--color-rail-text)' }
                    : undefined
                }
              >
                {entry.label}
              </Link>
            ))}
          </nav>
          <JobIndicator />
          <NotificationCenter />
          <ThemeButton />
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-7 lg:py-6 2xl:px-9">
          {/* The content fills everything the sidebar leaves: no centred column. */}
          <div className="w-full">{children}</div>
        </main>
      </div>
    </TooltipProvider>
  );
}
