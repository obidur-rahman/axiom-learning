/**
 * Copies the pdf.js worker into public/ so the app can load it as a static
 * asset (offline-first: no CDN fetch). Runs before `dev` and `build`.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, '..');
const outDir = join(desktopRoot, 'public');
mkdirSync(outDir, { recursive: true });

const workerSrc = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs');
copyFileSync(workerSrc, join(outDir, 'pdf.worker.min.mjs'));
console.log('copied pdf.worker.min.mjs -> public/');
