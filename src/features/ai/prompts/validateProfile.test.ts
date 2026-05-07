import { describe, expect, it } from 'vitest';
import { validateProfile } from './validateProfile';
import { BookId } from '@/domain';

const validRaw = {
  profile: {
    summary: 'A short novel.',
    genre: 'classic',
    structure: 'fiction',
    themes: ['marriage'],
    keyEntities: {
      characters: ['Elizabeth'],
      concepts: ['pride'],
      places: ['Pemberley'],
    },
  },
  prompts: [
    { text: 'Track motives.', category: 'analysis' },
    { text: 'Map relations.', category: 'structure' },
    { text: 'Foreshadowing scenes.', category: 'analysis' },
    { text: 'Title meaning.', category: 'comprehension' },
  ],
};

describe('validateProfile', () => {
  it('happy path returns BookProfileRecord with bookId, schemaVersion, generatedAt', () => {
    const r = validateProfile(validRaw, BookId('b1'), 1);
    expect(r.bookId).toBe(BookId('b1'));
    expect(r.profileSchemaVersion).toBe(1);
    expect(r.generatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(r.profile.structure).toBe('fiction');
    expect(r.prompts).toHaveLength(4);
  });

  it('rejects missing top-level profile', () => {
    expect(() => validateProfile({ prompts: validRaw.prompts }, BookId('b1'), 1)).toThrow();
  });

  it('rejects missing top-level prompts', () => {
    expect(() => validateProfile({ profile: validRaw.profile }, BookId('b1'), 1)).toThrow();
  });

  it('rejects fewer than 4 prompts', () => {
    expect(() =>
      validateProfile(
        { ...validRaw, prompts: validRaw.prompts.slice(0, 3) },
        BookId('b1'),
        1,
      ),
    ).toThrow();
  });

  it('trims prompts to at most 8', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      text: `Q${String(i)}`,
      category: 'analysis' as const,
    }));
    const r = validateProfile({ ...validRaw, prompts: many }, BookId('b1'), 1);
    expect(r.prompts).toHaveLength(8);
  });

  it('rejects invalid structure enum', () => {
    expect(() =>
      validateProfile(
        { ...validRaw, profile: { ...validRaw.profile, structure: 'novel' } },
        BookId('b1'),
        1,
      ),
    ).toThrow();
  });

  it('rejects invalid prompt category enum', () => {
    expect(() =>
      validateProfile(
        {
          ...validRaw,
          prompts: [{ text: 'x', category: 'fun' }, ...validRaw.prompts.slice(0, 3)],
        },
        BookId('b1'),
        1,
      ),
    ).toThrow();
  });

  it('rejects empty themes array', () => {
    expect(() =>
      validateProfile(
        { ...validRaw, profile: { ...validRaw.profile, themes: [] } },
        BookId('b1'),
        1,
      ),
    ).toThrow();
  });

  it('rejects non-object input', () => {
    expect(() => validateProfile(null, BookId('b1'), 1)).toThrow();
    expect(() => validateProfile('string', BookId('b1'), 1)).toThrow();
  });
});
