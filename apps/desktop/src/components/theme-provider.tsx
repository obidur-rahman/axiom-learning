'use client';

import { useEffect } from 'react';
import { applyPrefs, loadPrefs, watchSystemTheme } from '../lib/prefs';

/**
 * Applies the stored theme after hydration and follows the OS when the mode
 * is "system". The pre-paint part lives in the layout's inline script.
 */
export function ThemeProvider() {
  useEffect(() => {
    applyPrefs(loadPrefs());
    return watchSystemTheme();
  }, []);
  return null;
}
