// Schema versioning is explicit and reversible per project rules. Each
// migration moves persisted state from version N to N+1 (or N-1 on
// rollback). Phase 0 ships the v1 baseline only — actual migration runners
// land alongside the storage repositories in Phase 1.

export type SchemaVersion = number & { readonly __schemaVersion: never };
export const SchemaVersion = (n: number): SchemaVersion => n as SchemaVersion;

export const CURRENT_SCHEMA_VERSION: SchemaVersion = SchemaVersion(1);

export type MigrationDirection = 'up' | 'down';

export type MigrationStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly from: SchemaVersion; readonly to: SchemaVersion }
  | { readonly kind: 'complete'; readonly atVersion: SchemaVersion }
  | { readonly kind: 'failed'; readonly atVersion: SchemaVersion; readonly reason: string };
