import { useEffect, useState } from 'react';
import type {
  ChatMessage,
  ChatMessageId,
  ChunkId,
  ContextRef,
  LocationAnchor,
} from '@/domain';
import type { HighlightAnchor } from '@/domain/annotations/types';
import { SaveAnswerIcon } from '@/shared/icons';
import './message-bubble.css';

type Props = {
  readonly message: ChatMessage;
  readonly onSave?: (id: ChatMessageId) => void;
  // Phase 4.4 / 5.2: source-footer click-to-jump. Phase 4.4 only emitted
  // HighlightAnchor (passage refs); Phase 5.2 also accepts LocationAnchor
  // for chunk refs (resolved async via resolveChunkAnchor).
  readonly onJumpToSource?: (anchor: HighlightAnchor | LocationAnchor) => void;
  readonly resolveChunkAnchor?: (chunkId: ChunkId) => Promise<LocationAnchor | null>;
};

const SOURCE_SNIPPET_CAP = 40;

function snippetForFooter(text: string): string {
  if (text.length <= SOURCE_SNIPPET_CAP) return text;
  return text.slice(0, SOURCE_SNIPPET_CAP).trimEnd() + '…';
}

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ago`;
  return new Date(iso).toLocaleDateString();
}

type SourceRef =
  | (Extract<ContextRef, { kind: 'passage' }> & { citationTag: number })
  | (Extract<ContextRef, { kind: 'chunk' }> & { citationTag: number });

function SingleSourceFooter({
  passageRef,
  onJumpToSource,
}: {
  readonly passageRef: Extract<ContextRef, { kind: 'passage' }>;
  readonly onJumpToSource: (anchor: HighlightAnchor) => void;
}) {
  return (
    <button
      type="button"
      className="message-bubble__source-footer"
      aria-label={
        passageRef.sectionTitle !== undefined
          ? `Jump to passage from ${passageRef.sectionTitle}`
          : 'Jump to source'
      }
      onClick={() => {
        onJumpToSource(passageRef.anchor);
      }}
    >
      <span aria-hidden="true">📎</span>
      <span>Source: &ldquo;{snippetForFooter(passageRef.text)}&rdquo;</span>
      <span aria-hidden="true">→</span>
    </button>
  );
}

function MultiSourceFooter({
  refs,
  onJumpToSource,
  resolveChunkAnchor,
}: {
  readonly refs: readonly SourceRef[];
  readonly onJumpToSource: (anchor: LocationAnchor | HighlightAnchor) => void;
  readonly resolveChunkAnchor?: (chunkId: ChunkId) => Promise<LocationAnchor | null>;
}) {
  const [resolved, setResolved] = useState<Map<ChunkId, LocationAnchor>>(new Map());
  useEffect(() => {
    if (resolveChunkAnchor === undefined) return;
    let cancelled = false;
    void (async () => {
      const next = new Map<ChunkId, LocationAnchor>();
      for (const r of refs) {
        if (r.kind !== 'chunk') continue;
        const a = await resolveChunkAnchor(r.chunkId);
        if (a !== null) next.set(r.chunkId, a);
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (cancelled) return;
      setResolved(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [refs, resolveChunkAnchor]);

  return (
    <span className="message-bubble__multi-source">
      <span aria-hidden="true">📎</span>
      <span>Sources:</span>
      {refs.map((r) => {
        const tag = `[${String(r.citationTag)}]`;
        const onClick = (): void => {
          if (r.kind === 'passage') onJumpToSource(r.anchor);
          else {
            const anchor = resolved.get(r.chunkId);
            if (anchor !== undefined) onJumpToSource(anchor);
          }
        };
        const key = r.kind === 'chunk' ? r.chunkId : `passage-${String(r.citationTag)}`;
        return (
          <button
            key={key}
            type="button"
            className="message-bubble__citation"
            aria-label={`Jump to source ${String(r.citationTag)}`}
            onClick={onClick}
          >
            {tag}
          </button>
        );
      })}
    </span>
  );
}

export function MessageBubble({ message, onSave, onJumpToSource, resolveChunkAnchor }: Props) {
  if (message.role === 'user') {
    return (
      <div className="message-bubble message-bubble--user" role="article">
        <p className="message-bubble__content">{message.content}</p>
      </div>
    );
  }
  const isStreaming = message.streaming === true;
  const isTruncated = message.truncated === true;

  const sourceRefs: SourceRef[] =
    onJumpToSource !== undefined
      ? message.contextRefs
          .filter(
            (r): r is Extract<ContextRef, { kind: 'passage' | 'chunk' }> =>
              r.kind === 'passage' || r.kind === 'chunk',
          )
          .map((r, i) => ({ ...r, citationTag: i + 1 }))
      : [];

  return (
    <div
      className="message-bubble message-bubble--assistant"
      role="article"
      aria-busy={isStreaming || undefined}
    >
      <p className="message-bubble__content">
        {message.content}
        {isStreaming ? (
          <span
            className="message-bubble__caret motion-breath"
            aria-hidden="true"
          />
        ) : null}
      </p>
      <div className="message-bubble__footer">
        {isTruncated ? <em className="message-bubble__truncated">(stopped)</em> : null}
        <span className="message-bubble__badge" aria-label="AI generated">
          AI
        </span>
        <span className="message-bubble__time">{relativeTime(message.createdAt)}</span>
        {sourceRefs.length === 1 && sourceRefs[0]?.kind === 'passage' && onJumpToSource ? (
          <SingleSourceFooter
            passageRef={sourceRefs[0]}
            onJumpToSource={onJumpToSource}
          />
        ) : sourceRefs.length >= 1 && onJumpToSource ? (
          <MultiSourceFooter
            refs={sourceRefs}
            onJumpToSource={onJumpToSource}
            {...(resolveChunkAnchor !== undefined && { resolveChunkAnchor })}
          />
        ) : null}
        {!isStreaming && onSave ? (
          <button
            type="button"
            className="message-bubble__save"
            aria-label="Save answer"
            onClick={() => {
              onSave(message.id);
            }}
          >
            <SaveAnswerIcon size={14} />
            <span>Save</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
