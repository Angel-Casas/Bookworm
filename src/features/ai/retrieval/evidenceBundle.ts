import type { ChunkId, SectionId, TextChunk } from '@/domain';

export type EvidenceBundleOptions = {
  readonly budgetTokens: number;
  readonly minChunks: number;
  readonly maxChunks: number;
};

export type EvidenceBundleSection = {
  readonly sectionId: SectionId;
  readonly sectionTitle: string;
  readonly chunks: readonly { readonly chunk: TextChunk; readonly citationTag: number }[];
};

export type EvidenceBundle = {
  readonly sectionGroups: readonly EvidenceBundleSection[];
  readonly includedChunkIds: readonly ChunkId[];
  readonly totalTokens: number;
};

function chunkIndexInSection(chunkId: ChunkId): number {
  // Phase 5.1 format: chunk-{bookId}-{sectionId}-{N}
  const m = /-(\d+)$/.exec(chunkId);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = Number.parseInt(m[1] ?? '', 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export function assembleEvidenceBundle(
  rankedChunkIds: readonly ChunkId[],
  chunks: readonly TextChunk[],
  options: EvidenceBundleOptions,
): EvidenceBundle {
  const byId = new Map<ChunkId, TextChunk>();
  for (const c of chunks) byId.set(c.id, c);

  const included: TextChunk[] = [];
  let totalTokens = 0;
  for (const id of rankedChunkIds) {
    const c = byId.get(id);
    if (c === undefined) continue;
    if (included.length >= options.maxChunks) break;
    const wouldBe = totalTokens + c.tokenEstimate;
    const underBudget = wouldBe <= options.budgetTokens;
    const belowMin = included.length < options.minChunks;
    if (!underBudget && !belowMin) continue;
    included.push(c);
    totalTokens = wouldBe;
  }

  const tagById = new Map<ChunkId, number>();
  included.forEach((c, i) => {
    tagById.set(c.id, i + 1);
  });
  const includedChunkIds = included.map((c) => c.id);

  const groupsBySection = new Map<SectionId, TextChunk[]>();
  const sectionOrder: SectionId[] = [];
  const sectionTitle = new Map<SectionId, string>();
  for (const c of included) {
    const existing = groupsBySection.get(c.sectionId);
    if (existing === undefined) {
      groupsBySection.set(c.sectionId, [c]);
      sectionOrder.push(c.sectionId);
      sectionTitle.set(c.sectionId, c.sectionTitle);
    } else {
      existing.push(c);
    }
  }
  const sectionGroups: EvidenceBundleSection[] = sectionOrder.map((sid) => {
    const list = groupsBySection.get(sid) ?? [];
    list.sort((a, b) => chunkIndexInSection(a.id) - chunkIndexInSection(b.id));
    return {
      sectionId: sid,
      sectionTitle: sectionTitle.get(sid) ?? '',
      chunks: list.map((c) => ({ chunk: c, citationTag: tagById.get(c.id) ?? 0 })),
    };
  });

  return { sectionGroups, includedChunkIds, totalTokens };
}

export function buildEvidenceBundleForPreview(bundle: EvidenceBundle): string {
  const lines: string[] = [];
  for (const group of bundle.sectionGroups) {
    lines.push(`### ${group.sectionTitle}`);
    for (const { chunk, citationTag } of group.chunks) {
      lines.push(`[${String(citationTag)}] ${chunk.text}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
