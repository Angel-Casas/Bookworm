type Props = {
  readonly value: string;
  readonly onChange: (next: string) => void;
};

export function LibrarySearchField({ value, onChange }: Props) {
  return (
    <label className="library-search">
      <span className="library-search__icon" aria-hidden="true">
        ⌕
      </span>
      <input
        className="library-search__input"
        type="search"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        placeholder="Search"
        aria-label="Search your library"
      />
    </label>
  );
}
