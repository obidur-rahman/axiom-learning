'use client';

import { useEffect, useState } from 'react';
import type { ExportResult } from '../lib/export';

/**
 * "Open" after a save. This is a plain link, not window.open after the async
 * save: a popup opened that late is usually blocked, while a link the learner
 * clicks keeps the click's permission to open a tab.
 */
export function OpenExportLink({ result }: { result: ExportResult }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(result.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [result]);

  if (url === null) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="btn btn-ghost btn-sm mt-1"
      title={`Open ${result.filename} in a tab`}
    >
      Open
    </a>
  );
}
