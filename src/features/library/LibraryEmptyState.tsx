import { useRef } from 'react';
import { SettingsIcon } from '@/shared/icons';
import './library-empty-state.css';

type Props = {
  readonly onFilesPicked: (files: readonly File[]) => void;
  readonly onOpenSettings: () => void;
};

export function LibraryEmptyState({ onFilesPicked, onOpenSettings }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="library-empty" aria-labelledby="library-empty-title">
      <div className="library-empty__atmosphere" aria-hidden="true" />
      <button
        type="button"
        className="library-empty__settings"
        aria-label="Open settings"
        title="Settings"
        onClick={onOpenSettings}
      >
        <SettingsIcon />
      </button>
      <div className="library-empty__column">
        <svg
          className="library-empty__mark motion-rise"
          viewBox="0 0 64 64"
          role="img"
          aria-label="Bookworm bookmark"
          style={{ animationDelay: 'calc(var(--duration-fast) * 0)' }}
        >
          <path d="M22 14 H42 V50 L32 44 L22 50 Z" fill="var(--color-accent)" />
        </svg>

        <h1
          id="library-empty-title"
          className="library-empty__wordmark motion-rise"
          style={{ animationDelay: 'calc(var(--duration-fast) * 1)' }}
        >
          Bookworm
        </h1>

        <p
          className="library-empty__tagline motion-rise"
          style={{ animationDelay: 'calc(var(--duration-fast) * 2)' }}
        >
          A quiet place to read books and think with&nbsp;them.
        </p>

        <span
          className="library-empty__rule motion-rule-grow"
          aria-hidden="true"
          style={{ animationDelay: 'calc(var(--duration-fast) * 3)' }}
        />

        <button
          type="button"
          className="library-empty__cta motion-rise"
          style={{ animationDelay: 'calc(var(--duration-fast) * 4)' }}
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

        <p
          className="library-empty__privacy motion-fade-in"
          style={{ animationDelay: 'calc(var(--duration-fast) * 5)' }}
        >
          Your books stay on this device. Nothing leaves until you ask.
        </p>
      </div>
    </section>
  );
}
