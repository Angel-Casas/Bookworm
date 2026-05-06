export const BOOK_PROFILE_SCHEMA = {
  name: 'book_profile_with_prompts',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['profile', 'prompts'],
    properties: {
      profile: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'genre', 'structure', 'themes', 'keyEntities'],
        properties: {
          summary: { type: 'string' },
          genre: { type: 'string' },
          structure: {
            type: 'string',
            enum: ['fiction', 'nonfiction', 'textbook', 'reference'],
          },
          themes: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 8,
          },
          keyEntities: {
            type: 'object',
            additionalProperties: false,
            required: ['characters', 'concepts', 'places'],
            properties: {
              characters: { type: 'array', items: { type: 'string' } },
              concepts: { type: 'array', items: { type: 'string' } },
              places: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      prompts: {
        type: 'array',
        minItems: 4,
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'category'],
          properties: {
            text: { type: 'string' },
            category: {
              type: 'string',
              enum: ['comprehension', 'analysis', 'structure', 'creative', 'study'],
            },
          },
        },
      },
    },
  },
} as const;
