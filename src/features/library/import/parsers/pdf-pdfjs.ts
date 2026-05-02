import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

if (typeof window !== 'undefined') {
  // In production we ship the worker via Vite's `?worker` import.
  // This module imports a URL-resolved worker only on the browser.
  // The dynamic import keeps Node + tests happy.
  void import('pdfjs-dist/build/pdf.worker.mjs?url').then((mod) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = mod.default;
  });
}

export const pdfjs = pdfjsLib;
