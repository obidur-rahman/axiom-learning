'use client';

import { isDesktopRuntime } from './db';

/**
 * Whole-screen mode. Inside the desktop app this asks the native window, so the
 * title bar and taskbar step aside for the PDF or the lesson slide. In a plain
 * browser it falls back to the DOM Fullscreen API. A refusal is not fatal: the
 * caller still has the in-app full-window layout.
 */
export async function setWindowFullscreen(enabled: boolean): Promise<void> {
  if (isDesktopRuntime()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setFullscreen(enabled);
      return;
    } catch {
      // Permission or platform refusal: try the web API below.
    }
  }
  try {
    if (enabled) {
      if (document.fullscreenElement === null) await document.documentElement.requestFullscreen();
    } else if (document.fullscreenElement !== null) {
      await document.exitFullscreen();
    }
  } catch {
    // The in-app overlay still presents the document without the title bar.
  }
}
