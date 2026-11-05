import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppShell } from '../../components/app-shell';
import { MaterialViewer } from '../../components/material-viewer';

export const metadata: Metadata = { title: 'Material review - Axiom Learning' };

export default function PreviewPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div className="card w-full p-8" aria-live="polite">
            <div className="skeleton h-6 w-56" />
            <div className="skeleton mt-3 h-3 w-32" />
          </div>
        }
      >
        <MaterialViewer />
      </Suspense>
    </AppShell>
  );
}
