import './library-empty-state.css';

export function LibraryEmptyState() {
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

        <p className="library-empty__privacy" style={{ animationDelay: '720ms' }}>
          Your books stay on this device. Nothing leaves until you ask.
        </p>
      </div>
    </section>
  );
}
