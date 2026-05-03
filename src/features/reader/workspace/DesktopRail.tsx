import type { TocEntry } from '@/domain';
import { TocPanel } from '@/features/reader/TocPanel';
import './desktop-rail.css';

type Props = {
  readonly toc: readonly TocEntry[];
  readonly currentEntryId?: string;
  readonly onSelect: (entry: TocEntry) => void;
};

export function DesktopRail({ toc, currentEntryId, onSelect }: Props) {
  return (
    <aside className="desktop-rail">
      <TocPanel
        toc={toc}
        {...(currentEntryId !== undefined && { currentEntryId })}
        onSelect={onSelect}
      />
    </aside>
  );
}
