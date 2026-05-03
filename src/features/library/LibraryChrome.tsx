import type { SortKey } from '@/domain';
import { LibrarySearchField } from './LibrarySearchField';
import { LibrarySortDropdown } from './LibrarySortDropdown';
import { ImportButton } from './ImportButton';
import './library-chrome.css';

type Props = {
  readonly search: string;
  readonly onSearchChange: (next: string) => void;
  readonly sort: SortKey;
  readonly onSortChange: (next: SortKey) => void;
  readonly onFilesPicked: (files: readonly File[]) => void;
};

export function LibraryChrome(props: Props) {
  return (
    <header className="library-chrome">
      <div className="library-chrome__wordmark">Bookworm</div>
      <div className="library-chrome__search">
        <LibrarySearchField value={props.search} onChange={props.onSearchChange} />
      </div>
      <div className="library-chrome__actions">
        <LibrarySortDropdown value={props.sort} onChange={props.onSortChange} />
        <ImportButton onFilesPicked={props.onFilesPicked} />
      </div>
    </header>
  );
}
