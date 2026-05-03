import { useEffect, type ReactNode } from 'react';
import './mobile-sheet.css';

type Props = {
  readonly onDismiss: () => void;
  readonly children: ReactNode;
};

export function MobileSheet({ onDismiss, children }: Props) {
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
      <div className="mobile-sheet__scrim" onClick={onDismiss} aria-hidden="true" />
      <div className="mobile-sheet" role="dialog" aria-modal="true">
        <div className="mobile-sheet__handle" aria-hidden="true" />
        <div className="mobile-sheet__body">{children}</div>
      </div>
    </>
  );
}
