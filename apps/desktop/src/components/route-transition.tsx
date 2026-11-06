'use client';

/**
 * Route progress. The App Router keeps the previous screen painted while the
 * next route loads, so a slow navigation otherwise looks like a dead click:
 * nothing moves until the new page appears. This paints a slim accent bar at
 * the top of the window the moment an in-app link is followed, lets it creep
 * while the route is pending, and retracts it once the route lands.
 *
 * Purely decorative: the bar is behind a live region that already announces
 * page changes, so it is hidden from assistive tech.
 */
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** The bar never flashes for less than this, so a fast route still reads as a step. */
const MIN_VISIBLE_MS = 360;
/** A navigation that never completes must not leave the bar stuck on screen. */
const SAFETY_MS = 8000;
/** Finishing hand-off: jump to full, then fade the track out. */
const FADE_OUT_MS = 260;

function clearAll(timers: number[]) {
  for (const timer of timers) window.clearTimeout(timer);
  timers.length = 0;
}

function schedule(timers: number[], fn: () => void, ms: number) {
  timers.push(window.setTimeout(fn, ms));
}

export function RouteTransition() {
  const pathname = usePathname() ?? '/';
  const [percent, setPercent] = useState(0);
  const [active, setActive] = useState(false);
  const timers = useRef<number[]>([]);
  const startedAt = useRef(0);
  const navigating = useRef(false);

  useEffect(() => {
    if (navigating.current) return;
    const start = () => {
      if (navigating.current) return;
      navigating.current = true;
      startedAt.current = Date.now();
      clearAll(timers.current);
      setActive(true);
      setPercent(8);
      // Creep instead of filling: the bar keeps moving while the route is pending.
      schedule(timers.current, () => setPercent((p) => Math.max(p, 48)), 200);
      schedule(timers.current, () => setPercent((p) => Math.max(p, 74)), 900);
      schedule(timers.current, () => setPercent((p) => Math.max(p, 88)), 2300);
      schedule(timers.current, () => {
        navigating.current = false;
        setActive(false);
        setPercent(0);
      }, SAFETY_MS);
    };

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target !== '' && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Same page (in-page anchors, query-only links) is not a route change.
      if (url.pathname === window.location.pathname) return;
      start();
    }

    document.addEventListener('click', onClick, true);
    window.addEventListener('popstate', start);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', start);
      clearAll(timers.current);
    };
  }, []);

  // The route changed: finish the bar, then reset after the fade.
  useEffect(() => {
    if (!navigating.current) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt.current));
    const done = window.setTimeout(() => {
      setPercent(100);
      const reset = window.setTimeout(() => {
        setActive(false);
        setPercent(0);
        navigating.current = false;
      }, FADE_OUT_MS);
      timers.current.push(reset);
    }, wait);
    return () => window.clearTimeout(done);
  }, [pathname]);

  return (
    <div className="route-progress" data-active={active ? 'true' : undefined} aria-hidden>
      <span className="route-progress-bar" style={{ transform: `scaleX(${percent / 100})` }} />
    </div>
  );
}
