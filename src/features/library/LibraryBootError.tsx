import './library-boot-error.css';

type Props = {
  readonly reason: string;
};

export function LibraryBootError({ reason }: Props) {
  return (
    <main className="library-boot-error" aria-labelledby="boot-error-title">
      <div className="library-boot-error__plate">
        <p className="library-boot-error__eyebrow">Bookworm</p>
        <h1 id="boot-error-title" className="library-boot-error__title">
          We couldn’t open your library.
        </h1>
        <p className="library-boot-error__body">{reason}</p>
        <p className="library-boot-error__hint">
          Reloading usually clears this. If it keeps happening, your storage may need attention.
        </p>
        <button
          className="library-boot-error__action"
          type="button"
          onClick={() => {
            window.location.reload();
          }}
        >
          Reload
        </button>
      </div>
    </main>
  );
}
