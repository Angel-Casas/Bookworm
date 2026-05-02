import { ALL_SORT_KEYS, SORT_LABELS, type SortKey } from '@/domain';

type Props = {
  readonly value: SortKey;
  readonly onChange: (next: SortKey) => void;
};

export function LibrarySortDropdown({ value, onChange }: Props) {
  return (
    <label className="library-sort">
      <span className="library-sort__label">Sort</span>
      <select
        className="library-sort__select"
        value={value}
        onChange={(e) => {
          onChange(e.target.value as SortKey);
        }}
      >
        {ALL_SORT_KEYS.map((key) => (
          <option key={key} value={key}>
            {SORT_LABELS[key]}
          </option>
        ))}
      </select>
    </label>
  );
}
