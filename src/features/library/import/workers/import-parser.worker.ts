/// <reference lib="webworker" />
import type { ParseRequest, ParseResponse } from '@/domain';
import { detectFormat } from '../parsers/format';
import { parseEpubMetadata } from '../parsers/epub';

declare const self: DedicatedWorkerGlobalScope;

// PDFs are parsed on the main thread via pdf.js (which spawns its own worker).
// EPUB parsing runs here (fflate is light and fully self-contained).

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { bytes, originalName } = event.data;
  let response: ParseResponse;
  try {
    const format = detectFormat(bytes);
    if (format === 'epub') {
      response = await parseEpubMetadata(bytes, originalName);
    } else if (format === 'pdf') {
      response = { kind: 'error', reason: '__route_to_main__' };
    } else {
      response = { kind: 'error', reason: 'Not a supported format.' };
    }
  } catch (err) {
    response = {
      kind: 'error',
      reason: err instanceof Error ? `Unknown error — ${err.message}` : 'Unknown error.',
    };
  }
  self.postMessage(response);
};
