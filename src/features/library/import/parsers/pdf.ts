import type { ParsedMetadata, ParseResponse } from '@/domain';
import { pdfjs } from './pdf-pdfjs';

export async function parsePdfMetadata(
  bytes: ArrayBuffer,
  fileName: string,
): Promise<ParseResponse> {
  try {
    const doc = await pdfjs.getDocument({
      data: bytes,
      useWorkerFetch: false,
      disableFontFace: true,
    }).promise;
    let title: string | undefined;
    let author: string | undefined;
    try {
      const info = (await doc.getMetadata()).info as { Title?: string; Author?: string };
      const t = info.Title?.trim();
      if (t) title = t;
      const a = info.Author?.trim();
      if (a) author = a;
    } catch {
      // some PDFs have no Info dict; fall through
    }
    const pageCount = doc.numPages;
    let cover: { bytes: ArrayBuffer; mimeType: string } | undefined;
    try {
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 0.6 });
      const canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(viewport.width, viewport.height)
          : null;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          await page.render({
            canvas: canvas as unknown as HTMLCanvasElement,
            canvasContext: ctx as unknown as CanvasRenderingContext2D,
            viewport,
          }).promise;
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          cover = { bytes: await blob.arrayBuffer(), mimeType: 'image/png' };
        }
      }
    } catch {
      // cover render is best-effort
    }
    await doc.destroy();
    const metadata: ParsedMetadata = {
      format: 'pdf',
      title: title ?? (fileName.replace(/\.[^.]+$/, '') || fileName),
      ...(author !== undefined && { author }),
      pageOrChapterCount: pageCount,
      ...(cover && { cover }),
    };
    return {
      kind: 'ok',
      metadata,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'PDF parse failed';
    return { kind: 'error', reason: `This PDF couldn’t be opened (${reason}).` };
  }
}
