import type { SectionId, TextChunk } from '@/domain';

export type ProfileSamplingSection = {
  readonly sectionId: SectionId;
  readonly chunks: readonly TextChunk[];
};

export type ProfileSamplingOptions = {
  readonly budgetTokens: number;
  readonly samplesPerSection?: number;
};

const APPROX_TOKENS_PER_CHUNK = 400;

export function sampleChunksForProfile(
  sections: readonly ProfileSamplingSection[],
  options: ProfileSamplingOptions,
): readonly TextChunk[] {
  if (sections.length === 0) return [];
  const samplesPerSection = options.samplesPerSection ?? 1;
  const desiredSamples = Math.max(
    1,
    Math.floor(options.budgetTokens / APPROX_TOKENS_PER_CHUNK),
  );
  const stride = Math.max(1, Math.ceil(sections.length / desiredSamples));

  const out: TextChunk[] = [];
  let totalTokens = 0;
  for (let i = 0; i < sections.length; i += stride) {
    const section = sections[i];
    if (section === undefined) continue;
    const head = section.chunks.slice(0, samplesPerSection);
    for (const c of head) {
      const wouldBe = totalTokens + c.tokenEstimate;
      if (wouldBe > options.budgetTokens) return out;
      out.push(c);
      totalTokens = wouldBe;
    }
  }
  return out;
}
