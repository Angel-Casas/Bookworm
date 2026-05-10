import type { TextChunk } from '@/domain';

type Props = {
  readonly chunk: TextChunk;
  readonly index: number;
  readonly total: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
};

const PREVIEW_CAP = 80;

function preview(text: string): string {
  if (text.length <= PREVIEW_CAP) return text;
  return text.slice(0, PREVIEW_CAP).trimEnd() + '…';
}

export function IndexInspectorChunkRow({
  chunk,
  index,
  total,
  expanded,
  onToggle,
}: Props) {
  const panelId = `chunk-${chunk.id}-full`;
  return (
    <button
      type="button"
      className={
        expanded
          ? 'index-inspector__chunk-row index-inspector__chunk-row--expanded motion-fade-in'
          : 'index-inspector__chunk-row motion-fade-in'
      }
      aria-expanded={expanded}
      aria-controls={panelId}
      onClick={onToggle}
    >
      <span className="index-inspector__chunk-meta">
        #{index + 1} of {total} · {chunk.sectionTitle} · ~{chunk.tokenEstimate} tk
      </span>
      {expanded ? (
        <pre id={panelId} className="index-inspector__chunk-full">
          {chunk.normalizedText}
        </pre>
      ) : (
        <span id={panelId} className="index-inspector__chunk-preview">
          {preview(chunk.normalizedText)}
        </span>
      )}
    </button>
  );
}
