import type { Model } from '@/domain';
import type { SettingsRepository } from '@/storage';
import type { ModelsFetchResult } from '@/features/ai/key/nanogptApi';
import {
  useModelCatalogStore,
  useCatalogState,
  useSelectedModelId,
  useStaleNotice,
  useLastRefreshError,
} from './modelCatalogStore';
import { ModelList } from './ModelList';
import { refreshCatalog } from './refreshCatalog';
import { messageForCatalogError } from './messages';
import './models-section.css';

type Props = {
  readonly settingsRepo: SettingsRepository;
  readonly fetchCatalog: (apiKey: string) => Promise<ModelsFetchResult>;
  readonly getApiKey: () => string | null;
};

function relativeTime(fetchedAt: number, now: number): string {
  const mins = Math.round((now - fetchedAt) / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${String(mins)} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${String(hours)} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${String(days)} days ago`;
}

export function ModelsSection({ settingsRepo, fetchCatalog, getApiKey }: Props) {
  const state = useCatalogState();
  const selectedId = useSelectedModelId();
  const staleNotice = useStaleNotice();
  const lastRefreshError = useLastRefreshError();

  const onRefresh = (): void => {
    const apiKey = getApiKey();
    if (apiKey === null) return;
    void refreshCatalog({
      apiKey,
      fetchCatalog,
      putModelCatalog: (snap) => settingsRepo.putModelCatalog(snap),
      deleteSelectedModelId: () => settingsRepo.deleteSelectedModelId(),
    });
  };

  const onSelect = async (model: Model): Promise<void> => {
    useModelCatalogStore.getState().setSelectedId(model.id);
    useModelCatalogStore.getState().setStaleNotice(null);
    try {
      await settingsRepo.putSelectedModelId(model.id);
    } catch (err) {
      console.error('[models] putSelectedModelId failed', err);
    }
  };

  const refreshDisabled = state.kind === 'loading';

  return (
    <section className="models-section">
      <header className="models-section__header">
        <h2 className="models-section__title">Models</h2>
        <button
          type="button"
          className="models-section__refresh"
          onClick={onRefresh}
          disabled={refreshDisabled}
        >
          {state.kind === 'loading' ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      {state.kind === 'ready' ? (
        <p className="models-section__updated">
          Updated {relativeTime(state.fetchedAt, Date.now())}
        </p>
      ) : null}

      {staleNotice !== null ? (
        <div className="models-section__stale-notice" role="status">
          <span>
            Your previous selection <code>{staleNotice}</code> is no longer available. Pick another
            model below.
          </span>
          <button
            type="button"
            className="models-section__stale-dismiss"
            aria-label="Dismiss"
            onClick={() => {
              useModelCatalogStore.getState().setStaleNotice(null);
            }}
          >
            ×
          </button>
        </div>
      ) : null}

      {state.kind === 'ready' && lastRefreshError !== null ? (
        <p className="models-section__inline-error" role="alert">
          {messageForCatalogError(lastRefreshError, {
            hasCache: true,
            fetchedAt: state.fetchedAt,
            now: Date.now(),
          })}
        </p>
      ) : null}

      {state.kind === 'idle' ? (
        <p className="models-section__hint">Refresh to load available models.</p>
      ) : null}

      {state.kind === 'loading' ? (
        <p className="models-section__hint">Loading models…</p>
      ) : null}

      {state.kind === 'ready' && state.models.length > 0 ? (
        <ModelList models={state.models} selectedId={selectedId} onSelect={onSelect} />
      ) : null}

      {state.kind === 'ready' && state.models.length === 0 ? (
        <p className="models-section__hint">
          NanoGPT returned no models. Check your account or refresh later.
        </p>
      ) : null}

      {state.kind === 'error' ? (
        <p className="models-section__error" role="alert">
          {messageForCatalogError(state.reason, { hasCache: false, now: Date.now() })}
        </p>
      ) : null}
    </section>
  );
}
