import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '../components/theme-provider';
import { WorkerHost } from '../components/worker-host';
import { THEME_SCRIPT } from '../lib/prefs-storage';

export const metadata: Metadata = {
  title: 'Axiom Learning',
  description: 'Study only what you need, for your exam.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored light/dark/system choice before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider />
        <WorkerHost />
        {children}
      </body>
    </html>
  );
}
