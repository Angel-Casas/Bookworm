import { useRef } from 'react';
import './library-empty-state.css';

type Props = {
  readonly onFilesPicked: (files: readonly File[]) => void;
};

export function LibraryEmptyState({ onFilesPicked }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="library-empty" aria-labelledby="library-empty-title">
      <div className="library-empty__atmosphere" aria-hidden="true" />
      <div className="library-empty__column">
        <svg
          className="library-empty__mark"
          viewBox="0 0 64 64"
          role="img"
          aria-label="Bookworm bookmark"
          style={{ animationDelay: '80ms' }}
        >
          <path d="M22 14 H42 V50 L32 44 L22 50 Z" fill="var(--color-accent)" />
        </svg>

        <h1
          id="library-empty-title"
          className="library-empty__wordmark"
          style={{ animationDelay: '240ms' }}
        >
          Bookworm
        </h1>

        <p className="library-empty__tagline" style={{ animationDelay: '400ms' }}>
          A quiet place to read books and think with&nbsp;them.
        </p>

        <span
          className="library-empty__rule"
          aria-hidden="true"
          style={{ animationDelay: '560ms' }}
        />

        <button
          type="button"
          className="library-empty__cta"
          style={{ animationDelay: '660ms' }}
          onClick={() => inputRef.current?.click()}
        >
          Import a book to begin.
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

        <p className="library-empty__privacy" style={{ animationDelay: '820ms' }}>
          Your books stay on this device. Nothing leaves until you ask.
        </p>
      </div>
    </section>
  );
}
