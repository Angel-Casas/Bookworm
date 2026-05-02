/// <reference lib="webworker" />
import type { ParseRequest, ParseResponse } from '@/domain';
import { detectFormat } from '../parsers/format';
import { parseEpubMetadata } from '../parsers/epub';
import { parsePdfMetadata } from '../parsers/pdf';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  const { bytes, originalName } = event.data;
  let response: ParseResponse;
  try {
    const format = detectFormat(bytes);
    if (format === 'epub') {
      response = await parseEpubMetadata(bytes, originalName);
    } else if (format === 'pdf') {
      response = await parsePdfMetadata(bytes, originalName);
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
