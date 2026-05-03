import { useCallback, useState } from 'react';
import type { BookFormat, LocationAnchor } from '@/domain';
import type { BookReader, FocusMode, ReaderPreferences } from '@/domain/reader';
import { ReaderChrome } from '@/features/reader/ReaderChrome';
import { ReaderView, type ReaderViewExposedState } from '@/features/reader/ReaderView';
import { TocPanel } from '@/features/reader/TocPanel';
import { TypographyPanel } from '@/features/reader/TypographyPanel';
import { DesktopRail } from './DesktopRail';
import { MobileSheet } from './MobileSheet';
import { useFocusMode } from './useFocusMode';
import { useViewport } from './useViewport';
import './workspace.css';

type Props = {
  readonly bookId: string;
  readonly bookTitle: string;
  readonly bookSubtitle?: string;
  readonly bookFormat: BookFormat;
  readonly onBack: () => void;
  readonly loadBookForReader: (bookId: string) => Promise<{
    blob: Blob;
    preferences: ReaderPreferences;
    initialAnchor?: LocationAnchor;
  }>;
  readonly createAdapter: (mountInto: HTMLElement, format: BookFormat) => BookReader;
  readonly onAnchorChange: (bookId: string, anchor: LocationAnchor) => void;
  readonly onPreferencesChange: (prefs: ReaderPreferences) => void;
  readonly initialFocusMode: FocusMode;
  readonly hasShownFirstTimeHint: boolean;
  readonly onFocusModeChange: (mode: FocusMode) => Promise<void>;
  readonly onFirstTimeHintShown: () => void;
};

const FOCUS_HINT_TEXT =
  'Move the cursor to the top to bring the menu back · F or Esc to exit';

export function ReaderWorkspace(props: Props) {
  const viewport = useViewport();
  const focus = useFocusMode({
    initial: props.initialFocusMode,
    onChange: (mode) => {
      void props.onFocusModeChange(mode);
    },
    hasShownFirstTimeHint: props.hasShownFirstTimeHint,
    onFirstTimeHintShown: props.onFirstTimeHintShown,
  });

  const [activeSheet, setActiveSheet] = useState<'toc' | 'typography' | null>(null);
  const [readerState, setReaderState] = useState<ReaderViewExposedState | null>(null);

  const handleStateChange = useCallback((s: ReaderViewExposedState) => {
    setReaderState(s);
  }, []);

  const isDesktop = viewport === 'desktop';
  const railToc =
    isDesktop && focus.mode === 'normal' ? (readerState?.toc ?? null) : null;

  return (
    <div className="reader-workspace" data-mode={focus.mode} data-viewport={viewport}>
      {focus.shouldRenderChrome ? (
        <ReaderChrome
          title={props.bookTitle}
          {...(props.bookSubtitle !== undefined && { subtitle: props.bookSubtitle })}
          onBack={props.onBack}
          onOpenToc={() => {
            setActiveSheet('toc');
          }}
          onOpenTypography={() => {
            setActiveSheet('typography');
          }}
          onToggleFocus={() => {
            focus.toggle();
          }}
          showTocButton={!isDesktop}
          showFocusToggle={isDesktop}
          focusMode={focus.mode}
          onAddBookmark={() => undefined}
        />
      ) : null}

      <div className="reader-workspace__body">
        {railToc && readerState ? (
          <DesktopRail
            toc={railToc}
            {...(readerState.currentEntryId !== undefined && {
              currentEntryId: readerState.currentEntryId,
            })}
            onSelect={(entry) => {
              readerState.goToAnchor(entry.anchor);
            }}
          />
        ) : null}
        <div className="reader-workspace__reader-host">
          <ReaderView
            bookId={props.bookId}
            bookTitle={props.bookTitle}
            bookFormat={props.bookFormat}
            {...(props.bookSubtitle !== undefined && { bookSubtitle: props.bookSubtitle })}
            onBack={props.onBack}
            loadBookForReader={props.loadBookForReader}
            createAdapter={props.createAdapter}
            onAnchorChange={props.onAnchorChange}
            onPreferencesChange={props.onPreferencesChange}
            onStateChange={handleStateChange}
          />
        </div>
      </div>

      {!isDesktop && activeSheet === 'toc' && readerState?.toc ? (
        <MobileSheet
          onDismiss={() => {
            setActiveSheet(null);
          }}
        >
          <TocPanel
            toc={readerState.toc}
            {...(readerState.currentEntryId !== undefined && {
              currentEntryId: readerState.currentEntryId,
            })}
            onSelect={(entry) => {
              readerState.goToAnchor(entry.anchor);
              setActiveSheet(null);
            }}
          />
        </MobileSheet>
      ) : null}

      {activeSheet === 'typography' && readerState?.prefs ? (
        <MobileSheet
          onDismiss={() => {
            setActiveSheet(null);
          }}
        >
          <TypographyPanel
            preferences={readerState.prefs}
            bookFormat={props.bookFormat}
            onChange={readerState.applyPreferences}
          />
        </MobileSheet>
      ) : null}

      {focus.firstTimeHintVisible ? (
        <div className="reader-workspace__hint" role="status">
          {FOCUS_HINT_TEXT}
        </div>
      ) : null}
    </div>
  );
}
