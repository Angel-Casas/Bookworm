import type { Book, BookProfileRecord, SectionId, TextChunk } from '@/domain';
import type { BookChunksRepository, BookProfilesRepository } from '@/storage';
import {
  StructuredError,
  type StructuredClient,
  type StructuredFailure,
} from '@/features/ai/chat/nanogptStructured';
import { BOOK_PROFILE_SCHEMA } from './bookProfileSchema';
import { PROFILE_SCHEMA_VERSION } from './PROFILE_SCHEMA_VERSION';
import { sampleChunksForProfile } from './sampleChunksForProfile';
import { assembleProfilePrompt } from './assembleProfilePrompt';
import { validateProfile } from './validateProfile';

const PROFILE_BUDGET_TOKENS = 3000;

export type ProfileGenerationDeps = {
  readonly chunksRepo: BookChunksRepository;
  readonly profilesRepo: BookProfilesRepository;
  readonly structuredClient: StructuredClient;
};

export type ProfileGenerationInput = {
  readonly book: Pick<Book, 'id' | 'title' | 'author' | 'toc'>;
  readonly modelId: string;
  readonly deps: ProfileGenerationDeps;
  readonly signal?: AbortSignal;
};

export type ProfileGenerationResult =
  | { readonly kind: 'ok'; readonly record: BookProfileRecord }
  | { readonly kind: 'no-chunks' }
  | { readonly kind: 'failed'; readonly reason: StructuredFailure['reason'] }
  | { readonly kind: 'aborted' };

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

function groupBySection(
  chunks: readonly TextChunk[],
): { sectionId: SectionId; chunks: readonly TextChunk[] }[] {
  const order: SectionId[] = [];
  const map = new Map<SectionId, TextChunk[]>();
  for (const c of chunks) {
    const list = map.get(c.sectionId);
    if (list === undefined) {
      map.set(c.sectionId, [c]);
      order.push(c.sectionId);
    } else {
      list.push(c);
    }
  }
  return order.map((sectionId) => ({
    sectionId,
    chunks: map.get(sectionId) ?? [],
  }));
}

export async function runProfileGeneration(
  input: ProfileGenerationInput,
): Promise<ProfileGenerationResult> {
  const { book, modelId, deps, signal } = input;
  if (isAborted(signal)) return { kind: 'aborted' };

  const chunks = await deps.chunksRepo.listByBook(book.id);
  if (chunks.length === 0) return { kind: 'no-chunks' };

  if (isAborted(signal)) return { kind: 'aborted' };

  const sections = groupBySection(chunks);
  const sampled = sampleChunksForProfile(sections, {
    budgetTokens: PROFILE_BUDGET_TOKENS,
  });
  const messages = assembleProfilePrompt(book, sampled);

  let raw: unknown;
  try {
    const result = await deps.structuredClient.complete<unknown>({
      modelId,
      messages,
      schema: BOOK_PROFILE_SCHEMA,
      ...(signal !== undefined ? { signal } : {}),
    });
    raw = result.value;
  } catch (err) {
    if (err instanceof StructuredError) {
      if (err.failure.reason === 'aborted') return { kind: 'aborted' };
      return { kind: 'failed', reason: err.failure.reason };
    }
    return { kind: 'failed', reason: 'network' };
  }

  if (isAborted(signal)) return { kind: 'aborted' };

  let record: BookProfileRecord;
  try {
    record = validateProfile(raw, book.id, PROFILE_SCHEMA_VERSION);
  } catch {
    return { kind: 'failed', reason: 'schema-violation' };
  }

  await deps.profilesRepo.put(record);
  return { kind: 'ok', record };
}
