import { useCallback, useEffect, useRef, useState } from 'react';
import type { FocusMode } from '@/domain/reader';

const HOVER_ZONE_PX = 40;
const HIDE_DELAY_MS = 1500;
const HINT_DURATION_MS = 4000;

type Options = {
  readonly initial: FocusMode;
  readonly onChange: (mode: FocusMode) => void;
  readonly hasShownFirstTimeHint: boolean;
  readonly onFirstTimeHintShown: () => void;
};

export type FocusModeState = {
  readonly mode: FocusMode;
  readonly shouldRenderChrome: boolean;
  readonly firstTimeHintVisible: boolean;
  toggle(): void;
};

function isInputElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  );
}

export function useFocusMode(opts: Options): FocusModeState {
  const [mode, setMode] = useState<FocusMode>(opts.initial);
  const [isChromeRevealed, setIsChromeRevealed] = useState(false);
  const [firstTimeHintVisible, setFirstTimeHintVisible] = useState(false);

  // Track hint state in a ref so toggle() doesn't re-fire the hint after
  // the parent flips hasShownFirstTimeHint asynchronously.
  const hintShownRef = useRef(opts.hasShownFirstTimeHint);
  useEffect(() => {
    if (opts.hasShownFirstTimeHint) hintShownRef.current = true;
  }, [opts.hasShownFirstTimeHint]);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next: FocusMode = current === 'focus' ? 'normal' : 'focus';
      opts.onChange(next);
      if (next === 'focus' && !hintShownRef.current) {
        hintShownRef.current = true;
        setFirstTimeHintVisible(true);
        opts.onFirstTimeHintShown();
        window.setTimeout(() => {
          setFirstTimeHintVisible(false);
        }, HINT_DURATION_MS);
      }
      if (next === 'normal') setIsChromeRevealed(false);
      return next;
    });
  }, [opts]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isInputElement(e.target)) return;
      if (e.key === 'F' && !e.metaKey && !e.ctrlKey) toggle();
      else if (e.key === 'Escape' && mode === 'focus') toggle();
      else if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [mode, toggle]);

  // Hover-reveal: only when in focus mode
  useEffect(() => {
    if (mode !== 'focus') return undefined;
    let hideTimer: number | undefined;
    const onMove = (e: MouseEvent): void => {
      const inHoverZone = e.clientY <= HOVER_ZONE_PX;
      if (inHoverZone) {
        setIsChromeRevealed(true);
        if (hideTimer !== undefined) {
          window.clearTimeout(hideTimer);
          hideTimer = undefined;
        }
      } else {
        if (hideTimer !== undefined) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          setIsChromeRevealed(false);
        }, HIDE_DELAY_MS);
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, [mode]);

  return {
    mode,
    shouldRenderChrome: mode === 'normal' || isChromeRevealed,
    firstTimeHintVisible,
    toggle,
  };
}
