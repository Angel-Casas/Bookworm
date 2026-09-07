/**
 * Shared lazy loader for pdf.js. Uses the LEGACY build: the modern build
 * relies on bleeding-edge JS features (e.g. Map.getOrInsertComputed) that are
 * missing from many current browsers (see Docs/LESSONS.md, 2026-09-01).
 */
export type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let modulePromise: Promise<PdfjsModule> | null = null

export function loadPdfjs(): Promise<PdfjsModule> {
  modulePromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    return pdfjs
  })()
  return modulePromise
}
