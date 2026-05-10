import { useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '@/shared/a11y/useFocusTrap';
import './mobile-sheet.css';

type Props = {
  readonly onDismiss: () => void;
  readonly children: ReactNode;
};

export function MobileSheet({ onDismiss, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onDismiss]);

  return (
    <>
      <div
        className="mobile-sheet__scrim motion-scrim-in"
        onClick={onDismiss}
        aria-hidden="true"
      />
      <div
        className="mobile-sheet motion-sheet-in"
        role="dialog"
        aria-modal="true"
        ref={ref}
      >
        <div className="mobile-sheet__handle" aria-hidden="true" />
        <div className="mobile-sheet__body">{children}</div>
      </div>
    </>
  );
}
