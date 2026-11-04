'use client';

/**
 * App shell: a dark, labeled sidebar (brand, navigation, AI provider status,
 * profile) beside a light/dark content canvas. The sidebar collapses into a
 * top bar on narrow windows so the desktop window can still be resized small.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getProviderSettings } from '@axiom/data';
import { getDb, isDesktopRuntime } from '../lib/db';
import { initialsOf, savePrefs, usePrefs, type ThemeMode } from '../lib/prefs';

interface NavEntry {
  href: string;
  label: string;
  match: (pathname: string) => boolean;
  icon: React.ReactNode;
}

const NAV: NavEntry[] = [
  {
    href: '/',
    label: 'Dashboard',
    match: (pathname) => pathname === '/',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 8h6V4h-6z" />
      </svg>
    ),
  },
  {
    href: '/courses',
    label: 'Courses',
    match: (pathname) => pathname.startsWith('/courses') || pathname.startsWith('/course'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
        <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H19" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    match: (pathname) => pathname.startsWith('/settings'),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z" />
      </svg>
    ),
  },
];

const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

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
    <button
      type="button"
      onClick={() => savePrefs({ theme: next })}
      title={`Theme: ${THEME_LABEL[prefs.theme]} - switch to ${THEME_LABEL[next]}`}
      aria-label={`Theme: ${THEME_LABEL[prefs.theme]}. Switch to ${THEME_LABEL[next]}`}
      className="flex size-9 items-center justify-center rounded-full text-rail-icon transition-colors duration-200 hover:bg-rail-active hover:text-rail-text"
    >
      <ThemeIcon mode={prefs.theme} />
    </button>
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
    state === 'ready' ? 'bg-known' : state === 'missing' ? 'bg-warning' : state === 'browser' ? 'bg-skipped' : 'bg-rail-icon';
  const label =
    state === 'ready'
      ? 'AI provider ready'
      : state === 'missing'
        ? 'AI provider not set up'
        : state === 'browser'
          ? 'Desktop app only'
          : 'Checking AI provider...';

  return (
    <Link
      href="/settings#provider"
      className="flex items-center gap-2 rounded-xl px-2 py-2 text-[11px] text-rail-icon no-underline transition-colors duration-200 hover:bg-rail-active hover:text-rail-text"
      title={label}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function SidebarBody() {
  const pathname = usePathname() ?? '/';
  const prefs = usePrefs();
  const name = prefs.displayName.trim();

  return (
    <>
      <Link href="/" className="flex items-center gap-3 px-2 no-underline">
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-[13px] bg-rail-active text-rail-text"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold leading-tight text-rail-text">Axiom</span>
          <span className="block text-[10px] uppercase tracking-[0.18em] text-rail-icon">Learning</span>
        </span>
      </Link>

      <nav aria-label="Main" className="mt-7 flex flex-col gap-1">
        <p className="px-3 pb-1 text-[10px] uppercase tracking-[0.18em] text-rail-icon/70">Workspace</p>
        {NAV.map((entry) => {
          const active = entry.match(pathname);
          return (
            <Link
              key={entry.href}
              href={entry.href}
              aria-current={active ? 'page' : undefined}
              className="nav-item"
            >
              {entry.icon}
              <span className="truncate">{entry.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        <ProviderStatus />

        <div className="mt-1 flex items-center gap-2 rounded-2xl bg-rail-soft p-2">
          <Link
            href="/settings#profile"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1 no-underline transition-colors duration-200 hover:bg-rail-active"
            title="Edit your local profile"
          >
            <span
              aria-hidden
              className="flex size-8 flex-none items-center justify-center rounded-full bg-rail-active text-[11px] font-semibold text-rail-text"
            >
              {initialsOf(name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-medium text-rail-text">
                {name === '' ? 'Local learner' : name}
              </span>
              <span className="block truncate text-[10px] text-rail-icon">On this device</span>
            </span>
          </Link>
          <ThemeButton />
        </div>
      </div>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';

  return (
    <div className="flex min-h-screen flex-col bg-bg md:flex-row md:gap-4 md:p-4">
      <aside
        className="hidden flex-col rounded-[26px] bg-rail p-4 md:sticky md:top-4 md:flex md:h-[calc(100vh-32px)] md:w-[248px] md:shrink-0"
        style={{ boxShadow: 'var(--shadow-rail)' }}
      >
        <SidebarBody />
      </aside>

      {/* Narrow window: compact top bar instead of the sidebar. */}
      <header className="flex items-center gap-3 bg-rail px-4 py-3 md:hidden">
        <Link href="/" className="flex items-center gap-2 text-rail-text no-underline">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z" />
          </svg>
          <span className="text-sm font-semibold">Axiom</span>
        </Link>
        <nav aria-label="Main" className="flex flex-1 items-center gap-1 overflow-x-auto">
          {NAV.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              aria-current={entry.match(pathname) ? 'page' : undefined}
              className="rounded-full px-3 py-1.5 text-xs text-rail-icon no-underline"
              style={entry.match(pathname) ? { background: 'var(--color-rail-active)', color: 'var(--color-rail-text)' } : undefined}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
        <ThemeButton />
      </header>

      <main className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
