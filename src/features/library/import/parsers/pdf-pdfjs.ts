import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// pdf.js parsing runs on the main thread only. From there, pdf.js spawns its
// own Web Worker for the heavy work via this URL — Vite resolves the asset at
// build time. We avoid running pdf.js inside our own worker (nested-worker
// brittleness in some browsers, and the GlobalWorkerOptions URL can't always
// be resolved from a worker context).
if (typeof window !== 'undefined') {
  void import('pdfjs-dist/build/pdf.worker.mjs?url').then((mod) => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = mod.default;
  });
}

export const pdfjs = pdfjsLib;
