import { useState } from 'react';
import type { SettingsRepository } from '@/storage';
import { ApiKeyForm, type SubmitInput, type SubmitResult } from '../key/ApiKeyForm';
import { UnlockForm } from '../key/UnlockForm';
import { encryptKey, decryptKey } from '../key/apiKeyCrypto';
import { validateKey, fetchCatalog, type ValidateKeyResult } from '../key/nanogptApi';
import { useApiKeyStore, useApiKeyState } from '../key/apiKeyStore';
import { ModelsSection } from '../models/ModelsSection';
import { useModelCatalogStore } from '../models/modelCatalogStore';
import { refreshCatalog } from '../models/refreshCatalog';
import { SettingsChrome } from './SettingsChrome';
import './settings-view.css';

type Props = {
  readonly settingsRepo: SettingsRepository;
  readonly onClose: () => void;
};

function messageFor(result: ValidateKeyResult): string {
  if (result.ok) return '';
  switch (result.reason) {
    case 'invalid-key':
      return `That key was rejected by NanoGPT (${String(
        result.status ?? '',
      )}). Double-check it on your NanoGPT dashboard.`;
    case 'network':
      return "Couldn't reach NanoGPT. Check your connection and try again.";
    case 'other':
      return result.status !== undefined
        ? `NanoGPT returned an unexpected error (status ${String(result.status)}). Try again in a moment.`
        : 'Unexpected response from NanoGPT. Try again in a moment.';
  }
}

export function SettingsView({ settingsRepo, onClose }: Props) {
  const state = useApiKeyState();
  const { setSession, setUnlocked, clear } = useApiKeyStore.getState();
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);

  const scheduleCatalogRefresh = (apiKey: string): void => {
    void refreshCatalog({
      apiKey,
      fetchCatalog,
      putModelCatalog: (snap) => settingsRepo.putModelCatalog(snap),
      deleteSelectedModelId: () => settingsRepo.deleteSelectedModelId(),
    }).catch((err: unknown) => {
      console.error('[settings] refreshCatalog failed', err);
    });
  };

  const handleEntrySubmit = async (input: SubmitInput): Promise<SubmitResult> => {
    if (input.mode === 'save' && state.kind === 'session' && input.key === state.key) {
      try {
        const blob = await encryptKey(state.key, input.passphrase);
        await settingsRepo.putApiKeyBlob(blob);
        setUnlocked(state.key);
        setShowUpgradeForm(false);
        scheduleCatalogRefresh(state.key);
        return { ok: true };
      } catch (err) {
        console.error('[settings] save upgrade failed', err);
        return { ok: false, message: "Couldn't save your key. Reload and try again." };
      }
    }

    const result = await validateKey(input.key);
    if (!result.ok) return { ok: false, message: messageFor(result) };

    if (input.mode === 'session') {
      setSession(input.key);
      scheduleCatalogRefresh(input.key);
      return { ok: true };
    }

    try {
      const blob = await encryptKey(input.key, input.passphrase);
      await settingsRepo.putApiKeyBlob(blob);
      setUnlocked(input.key);
      scheduleCatalogRefresh(input.key);
      return { ok: true };
    } catch (err) {
      console.error('[settings] save failed', err);
      return { ok: false, message: "Couldn't save your key. Reload and try again." };
    }
  };

  const handleUnlockSubmit = async (
    passphrase: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> => {
    const blob = await settingsRepo.getApiKeyBlob();
    if (!blob) {
      clear();
      return { ok: false, message: 'No saved key found.' };
    }
    try {
      const key = await decryptKey(blob, passphrase);
      setUnlocked(key);
      scheduleCatalogRefresh(key);
      return { ok: true };
    } catch {
      return { ok: false, message: 'Wrong passphrase.' };
    }
  };

  const handleRemove = async (): Promise<void> => {
    if (!window.confirm("Remove API key from this device? You'll need to re-enter it next time.")) {
      return;
    }
    if (state.kind === 'unlocked' || state.kind === 'locked') {
      await settingsRepo.deleteApiKeyBlob();
    }
    await Promise.all([
      settingsRepo.deleteModelCatalog(),
      settingsRepo.deleteSelectedModelId(),
    ]);
    useModelCatalogStore.getState().reset();
    clear();
    setShowUpgradeForm(false);
  };

  return (
    <div className="settings-view">
      <SettingsChrome onClose={onClose} />
      <main className="settings-view__main">
        <section className="settings-view__section">
          <h2 className="settings-view__section-title">API key</h2>
          {state.kind === 'none' ? <ApiKeyForm onSubmit={handleEntrySubmit} /> : null}
          {state.kind === 'locked' ? (
            <UnlockForm
              onSubmit={handleUnlockSubmit}
              onRemove={() => {
                void handleRemove();
              }}
            />
          ) : null}
          {state.kind === 'session' && !showUpgradeForm ? (
            <ApiKeyStatusCard
              label="Using API key for this session"
              hint="Closing the tab will forget it."
              secondaryActionLabel="Save on this device"
              onSecondaryAction={() => {
                setShowUpgradeForm(true);
              }}
              onRemove={() => {
                void handleRemove();
              }}
            />
          ) : null}
          {state.kind === 'session' && showUpgradeForm ? (
            <ApiKeyForm
              initialMode="save"
              initialKey={state.key}
              hideKeyField
              onSubmit={handleEntrySubmit}
              onCancel={() => {
                setShowUpgradeForm(false);
              }}
            />
          ) : null}
          {state.kind === 'unlocked' ? (
            <ApiKeyStatusCard
              label="API key unlocked"
              hint="Encrypted on this device. We'll ask for your passphrase next time you reload."
              onRemove={() => {
                void handleRemove();
              }}
            />
          ) : null}
        </section>
        {state.kind === 'session' || state.kind === 'unlocked' ? (
          <ModelsSection
            settingsRepo={settingsRepo}
            fetchCatalog={fetchCatalog}
            getApiKey={() => {
              const s = useApiKeyStore.getState().state;
              if (s.kind === 'session' || s.kind === 'unlocked') return s.key;
              return null;
            }}
          />
        ) : null}
      </main>
    </div>
  );
}

type ApiKeyStatusCardProps = {
  readonly label: string;
  readonly hint: string;
  readonly secondaryActionLabel?: string;
  readonly onSecondaryAction?: () => void;
  readonly onRemove: () => void;
};

function ApiKeyStatusCard({
  label,
  hint,
  secondaryActionLabel,
  onSecondaryAction,
  onRemove,
}: ApiKeyStatusCardProps) {
  return (
    <div className="api-key-status-card">
      <div className="api-key-status-card__main">
        <p className="api-key-status-card__label">{label}</p>
        <p className="api-key-status-card__hint">{hint}</p>
      </div>
      <div className="api-key-status-card__actions">
        {secondaryActionLabel !== undefined && onSecondaryAction !== undefined ? (
          <button
            type="button"
            className="api-key-status-card__secondary"
            onClick={onSecondaryAction}
          >
            {secondaryActionLabel}
          </button>
        ) : null}
        <button type="button" className="api-key-status-card__remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
