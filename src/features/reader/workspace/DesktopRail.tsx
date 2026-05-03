import type { ReactNode } from 'react';
import './desktop-rail.css';

export type RailTab = {
  readonly key: string;
  readonly label: string;
  readonly badge?: number;
  readonly content: ReactNode;
};

type Props = {
  readonly tabs: readonly RailTab[];
  readonly activeKey: string;
  readonly onTabChange: (key: string) => void;
};

export function DesktopRail({ tabs, activeKey, onTabChange }: Props) {
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0];
  return (
    <aside className="desktop-rail">
      <div className="desktop-rail__tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === active?.key}
            className={
              tab.key === active?.key
                ? 'desktop-rail__tab desktop-rail__tab--active'
                : 'desktop-rail__tab'
            }
            onClick={() => {
              onTabChange(tab.key);
            }}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 ? (
              <span className="desktop-rail__badge">{tab.badge}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div className="desktop-rail__panel">{active?.content}</div>
    </aside>
  );
}
