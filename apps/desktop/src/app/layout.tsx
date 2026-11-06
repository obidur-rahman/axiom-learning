import type { Metadata } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';
import { ProviderHttpHost } from '../components/provider-http-host';
import { ThemeProvider } from '../components/theme-provider';
import { ToastHost } from '../components/toast-host';
import { WorkerHost } from '../components/worker-host';
import { THEME_SCRIPT } from '../lib/prefs-storage';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'Axiom Learning',
  description: 'Study only what you need, for your exam.',
  // Same pair as the logo: the saturated mark for a light browser chrome, the
  // pale one for a dark one.
  icons: {
    icon: [
      { url: '/icon-dark.png', type: 'image/png', media: '(prefers-color-scheme: light)' },
      { url: '/icon-light.png', type: 'image/png', media: '(prefers-color-scheme: dark)' },
    ],
    apple: '/icon-dark.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <head>
        {/* Applies the stored light/dark/system choice before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <ThemeProvider />
        <ProviderHttpHost />
        <WorkerHost />
        <ToastHost />
        {children}
      </body>
    </html>
  );
}
