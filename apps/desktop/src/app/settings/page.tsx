import type { Metadata } from 'next';
import { AppShell } from '../../components/app-shell';
import { SettingsForm } from '../../components/settings-form';

export const metadata: Metadata = { title: 'Provider settings - Axiom Learning' };

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="max-w-xl">
        <h1 className="text-[32px] font-semibold leading-tight tracking-tight">Provider settings</h1>
        <p className="mt-1 text-sm text-text-muted">
          One OpenAI-compatible endpoint for the whole app: teacher setup, one time.
        </p>
        <div className="mt-6">
          <SettingsForm />
        </div>
      </div>
    </AppShell>
  );
}
