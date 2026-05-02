import { useRef } from 'react';

type Props = {
  readonly onFilesPicked: (files: readonly File[]) => void;
};

export function ImportButton({ onFilesPicked }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="library-import-button"
        onClick={() => inputRef.current?.click()}
      >
        + Import
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFilesPicked(files);
          e.target.value = '';
        }}
      />
    </>
  );
}
