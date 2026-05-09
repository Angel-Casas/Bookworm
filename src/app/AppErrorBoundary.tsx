import { Component, type ErrorInfo, type ReactNode } from 'react';
import '@/features/library/library-boot-error.css';

type Props = { readonly children: ReactNode };
type State = { readonly error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary] caught render error', error, info);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <AppErrorFallback
        error={this.state.error}
        onReload={() => {
          window.location.reload();
        }}
      />
    );
  }
}

type FallbackProps = {
  readonly error: Error;
  readonly onReload: () => void;
};

function AppErrorFallback({ error, onReload }: FallbackProps) {
  return (
    <main className="library-boot-error" aria-labelledby="app-error-title">
      <div className="library-boot-error__plate">
        <p className="library-boot-error__eyebrow">Bookworm</p>
        <h1 id="app-error-title" className="library-boot-error__title">
          Something went wrong.
        </h1>
        <p className="library-boot-error__body">
          Bookworm crashed. Reloading usually clears this.
        </p>
        <details className="library-boot-error__details">
          <summary>Show details</summary>
          <pre className="library-boot-error__details-pre">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
        </details>
        <button className="library-boot-error__action" type="button" onClick={onReload}>
          Reload Bookworm
        </button>
      </div>
    </main>
  );
}
