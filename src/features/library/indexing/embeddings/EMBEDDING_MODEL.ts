export const EMBEDDING_MODEL_VERSION = 1;

export const EMBEDDING_MODEL_IDS: Readonly<Record<number, string>> = {
  1: 'text-embedding-3-small',
};

const currentId = EMBEDDING_MODEL_IDS[EMBEDDING_MODEL_VERSION];
if (currentId === undefined) {
  throw new Error(
    `EMBEDDING_MODEL_IDS missing entry for version ${String(EMBEDDING_MODEL_VERSION)}`,
  );
}
export const CURRENT_EMBEDDING_MODEL_ID: string = currentId;

export const EMBEDDING_DIMS = 1536;
