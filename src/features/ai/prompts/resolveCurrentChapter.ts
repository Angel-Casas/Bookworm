import { SectionId, type TextChunk, type TocEntry } from '@/domain';

export type ResolvedChapter = {
  readonly sectionId: SectionId;
  readonly sectionTitle: string;
  readonly chunks: readonly TextChunk[];
};

/**
 * Maps a reader `currentEntryId` (TOC href, e.g. `OEBPS/foo.html#chapter-7`)
 * to the chunks that belong to it. Strips URI fragment, prefixes `spine:`
 * (matching `EpubChunkExtractor.listSections`'s id format), filters chunks
 * by sectionId equality. Returns null when no chunks match.
 *
 * The chapter title preference is:
 *   1. The matching TOC entry's `title` (handles multi-chapter HTML where
 *      a single spine entry is split across multiple TOC anchors)
 *   2. The first chunk's `sectionTitle` (extractor-time fallback)
 *   3. The raw spine path (degenerate case)
 */
export function resolveCurrentChapter(
  currentEntryId: string | undefined,
  allChunks: readonly TextChunk[],
  toc: readonly TocEntry[],
): ResolvedChapter | null {
  if (currentEntryId === undefined || currentEntryId.length === 0) return null;

  const fragmentIndex = currentEntryId.indexOf('#');
  const spinePath =
    fragmentIndex >= 0 ? currentEntryId.slice(0, fragmentIndex) : currentEntryId;
  const targetSectionId = SectionId('spine:' + spinePath);

  const chunks = allChunks.filter((c) => c.sectionId === targetSectionId);
  if (chunks.length === 0) return null;

  const tocMatch = toc.find((entry) => entry.id === currentEntryId);
  const sectionTitle =
    tocMatch?.title ?? chunks[0]?.sectionTitle ?? spinePath;

  return {
    sectionId: targetSectionId,
    sectionTitle,
    chunks,
  };
}
