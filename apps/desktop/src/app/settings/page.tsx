import type { Metadata } from 'next';
import { AppShell } from '../../components/app-shell';
import { SettingsForm } from '../../components/settings-form';
import {
  AboutSettings,
  AccountSettings,
  AppearanceSettings,
  BehaviorSettings,
  DataSettings,
  MaterialSettings,
  ProfileSettings,
  StudySettings,
} from '../../components/preferences-form';

export const metadata: Metadata = { title: 'Settings - Axiom Learning' };

const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'behavior', label: 'Behaviour' },
  { id: 'profile', label: 'Profile' },
  { id: 'study', label: 'Study' },
  { id: 'materials', label: 'Materials' },
  { id: 'provider', label: 'AI provider' },
  { id: 'data', label: 'Data' },
  { id: 'account', label: 'Account' },
  { id: 'about', label: 'About' },
];

function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card anchor-target p-5" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="text-[16.5px] font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-text-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <header>
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Tune the app to your machine and your study habit. Everything stays on this device.</p>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[168px_1fr]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-6 flex flex-col gap-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block rounded-[var(--radius)] border border-transparent px-3 py-2 text-[13px] text-text-muted no-underline transition-colors duration-150 hover:border-border hover:bg-surface hover:text-text"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <SettingsSection
            id="appearance"
            title="Appearance"
            description="Theme, glass, corners, density and motion. Changes apply immediately."
          >
            <AppearanceSettings />
          </SettingsSection>

          <SettingsSection
            id="behavior"
            title="Behaviour"
            description="How the workspace reports progress and asks for confirmation."
          >
            <BehaviorSettings />
          </SettingsSection>

          <SettingsSection
            id="profile"
            title="Profile"
            description="Your local identity in the app. No account, no email."
          >
            <ProfileSettings />
          </SettingsSection>

          <SettingsSection
            id="study"
            title="Study defaults"
            description="How new courses, lessons and the tutor start out."
          >
            <StudySettings />
          </SettingsSection>

          <SettingsSection
            id="materials"
            title="Materials"
            description="What happens after a file is read."
          >
            <MaterialSettings />
          </SettingsSection>

          <SettingsSection
            id="provider"
            title="AI provider"
            description="One OpenAI-compatible endpoint powers lessons, the tutor, practice and topic extraction."
          >
            <SettingsForm />
          </SettingsSection>

          <SettingsSection
            id="data"
            title="Data"
            description="What is stored, and how to take it with you."
          >
            <DataSettings />
          </SettingsSection>

          <SettingsSection
            id="account"
            title="Account"
            description="Axiom is local-first: no sign-in is needed to study."
          >
            <AccountSettings />
          </SettingsSection>

          <SettingsSection id="about" title="About" description="Build details.">
            <AboutSettings />
          </SettingsSection>
        </div>
      </div>
    </AppShell>
  );
}
