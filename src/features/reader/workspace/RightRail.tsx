import type { ReactNode } from 'react';
import './right-rail.css';

type Props = {
  readonly title?: string;
  readonly onCollapse: () => void;
  readonly children?: ReactNode;
};

export function RightRail({ title = 'Chat', onCollapse, children }: Props) {
  return (
    <aside className="right-rail" aria-label={title}>
      <header className="right-rail__header">
        <span className="right-rail__title">{title}</span>
        <button
          type="button"
          className="right-rail__collapse"
          aria-expanded={true}
          aria-label="Collapse chat panel"
          onClick={onCollapse}
        >
          ›
        </button>
      </header>
      <div className="right-rail__body">{children}</div>
    </aside>
  );
}
