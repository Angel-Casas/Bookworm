import { ChunkId, type BookId, type SectionId, type LocationAnchor } from '@/domain';
import type { TextChunk } from '@/domain';
import { normalizeChunkText, tokenEstimate } from './normalize';

const MAX_CHUNK_TOKENS = 400;

export type ExtractedParagraph = {
  readonly text: string;
  readonly locationAnchor: LocationAnchor;
};

export type ParagraphsToChunksInput = {
  readonly paragraphs: AsyncIterable<ExtractedParagraph>;
  readonly bookId: BookId;
  readonly sectionId: SectionId;
  readonly sectionTitle: string;
  readonly chunkerVersion: number;
};

// Web Crypto sha256 → hex string. Used for chunk checksum (existing TextChunk
// field, finally populated). Deterministic for a given normalizedText.
async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function splitOversizedParagraph(text: string): string[] {
  // Sentence boundary split: lookbehind for terminal punctuation followed by
  // whitespace and an uppercase start. Handles most prose; documented
  // limitation for run-on or non-Latin scripts.
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const result: string[] = [];
  let buf = '';
  for (const sent of sentences) {
    const candidate = buf.length === 0 ? sent : `${buf} ${sent}`;
    if (tokenEstimate(candidate) > MAX_CHUNK_TOKENS && buf.length > 0) {
      result.push(buf);
      buf = sent;
    } else if (tokenEstimate(candidate) > MAX_CHUNK_TOKENS) {
      // Single sentence alone exceeds the cap — split at the cap as a last
      // resort. Documented limitation in spec §5.6.
      const charCap = MAX_CHUNK_TOKENS * 4;
      for (let i = 0; i < sent.length; i += charCap) {
        result.push(sent.slice(i, i + charCap));
      }
      buf = '';
    } else {
      buf = candidate;
    }
  }
  if (buf.length > 0) result.push(buf);
  return result;
}

export async function paragraphsToChunks(
  input: ParagraphsToChunksInput,
): Promise<readonly TextChunk[]> {
  const buffer: ExtractedParagraph[] = [];
  for await (const p of input.paragraphs) {
    if (normalizeChunkText(p.text).length > 0) buffer.push(p);
  }

  const chunks: TextChunk[] = [];
  let pending: ExtractedParagraph[] = [];
  let pendingTokens = 0;

  const flushPending = async (): Promise<void> => {
    const first = pending[0];
    if (first === undefined) return;
    const joinedRaw = pending.map((p) => p.text).join('\n\n');
    const normalizedText = normalizeChunkText(joinedRaw);
    if (normalizedText.length === 0) {
      pending = [];
      pendingTokens = 0;
      return;
    }
    const idx = chunks.length;
    chunks.push({
      id: ChunkId(`chunk-${input.bookId}-${input.sectionId}-${String(idx)}`),
      bookId: input.bookId,
      sectionId: input.sectionId,
      sectionTitle: input.sectionTitle,
      text: joinedRaw,
      normalizedText,
      tokenEstimate: tokenEstimate(normalizedText),
      locationAnchor: first.locationAnchor,
      checksum: await sha256Hex(normalizedText),
      chunkerVersion: input.chunkerVersion,
    });
    pending = [];
    pendingTokens = 0;
  };

  for (const para of buffer) {
    const paraTokens = tokenEstimate(normalizeChunkText(para.text));

    if (paraTokens > MAX_CHUNK_TOKENS) {
      // Single paragraph exceeds cap — flush whatever's pending, then split
      // this paragraph at sentence boundaries and emit each piece as its own
      // chunk.
      await flushPending();
      const pieces = splitOversizedParagraph(para.text);
      for (const piece of pieces) {
        pending = [{ text: piece, locationAnchor: para.locationAnchor }];
        pendingTokens = tokenEstimate(normalizeChunkText(piece));
        await flushPending();
      }
      continue;
    }

    if (pendingTokens + paraTokens > MAX_CHUNK_TOKENS && pending.length > 0) {
      await flushPending();
    }
    pending.push(para);
    pendingTokens += paraTokens;
  }

  await flushPending();
  return chunks;
}
