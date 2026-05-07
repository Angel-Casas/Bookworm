import {
  IsoTimestamp,
  type BookId,
  type BookProfile,
  type BookProfileRecord,
  type BookStructure,
  type SuggestedPrompt,
  type SuggestedPromptCategory,
} from '@/domain';

const VALID_STRUCTURES: ReadonlySet<string> = new Set([
  'fiction',
  'nonfiction',
  'textbook',
  'reference',
]);

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'comprehension',
  'analysis',
  'structure',
  'creative',
  'study',
]);

const MAX_PROMPTS = 8;
const MIN_PROMPTS = 4;
const MIN_THEMES = 1;

function isStringArray(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function fail(reason: string): never {
  throw new Error(`validateProfile: ${reason}`);
}

function parseProfile(value: unknown): BookProfile {
  if (typeof value !== 'object' || value === null) fail('profile is not an object');
  const p = value as Record<string, unknown>;
  if (typeof p.summary !== 'string') fail('profile.summary missing or not a string');
  if (typeof p.genre !== 'string') fail('profile.genre missing or not a string');
  if (typeof p.structure !== 'string' || !VALID_STRUCTURES.has(p.structure)) {
    fail('profile.structure missing or not in enum');
  }
  if (!isStringArray(p.themes)) fail('profile.themes is not a string array');
  if (p.themes.length < MIN_THEMES) fail('profile.themes is empty');
  if (typeof p.keyEntities !== 'object' || p.keyEntities === null) {
    fail('profile.keyEntities is not an object');
  }
  const ke = p.keyEntities as Record<string, unknown>;
  if (!isStringArray(ke.characters)) fail('profile.keyEntities.characters not a string array');
  if (!isStringArray(ke.concepts)) fail('profile.keyEntities.concepts not a string array');
  if (!isStringArray(ke.places)) fail('profile.keyEntities.places not a string array');
  return {
    summary: p.summary,
    genre: p.genre,
    structure: p.structure as BookStructure,
    themes: p.themes,
    keyEntities: {
      characters: ke.characters,
      concepts: ke.concepts,
      places: ke.places,
    },
  };
}

function parsePrompt(value: unknown, index: number): SuggestedPrompt {
  if (typeof value !== 'object' || value === null) fail(`prompts[${String(index)}] not an object`);
  const p = value as Record<string, unknown>;
  if (typeof p.text !== 'string' || p.text === '') fail(`prompts[${String(index)}].text missing`);
  if (typeof p.category !== 'string' || !VALID_CATEGORIES.has(p.category)) {
    fail(`prompts[${String(index)}].category not in enum`);
  }
  return { text: p.text, category: p.category as SuggestedPromptCategory };
}

export function validateProfile(
  raw: unknown,
  bookId: BookId,
  schemaVersion: number,
): BookProfileRecord {
  if (typeof raw !== 'object' || raw === null) fail('input is not an object');
  const r = raw as Record<string, unknown>;
  if (!('profile' in r)) fail('top-level profile missing');
  if (!('prompts' in r)) fail('top-level prompts missing');
  if (!Array.isArray(r.prompts)) fail('prompts is not an array');
  if (r.prompts.length < MIN_PROMPTS) fail(`prompts has < ${String(MIN_PROMPTS)} entries`);

  const profile = parseProfile(r.profile);
  const prompts = r.prompts
    .slice(0, MAX_PROMPTS)
    .map((p, i) => parsePrompt(p, i));

  return {
    bookId,
    profile,
    prompts,
    profileSchemaVersion: schemaVersion,
    generatedAt: IsoTimestamp(new Date().toISOString()),
  };
}
