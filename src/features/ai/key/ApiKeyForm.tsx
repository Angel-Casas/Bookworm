import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import { EyeIcon, EyeOffIcon } from '@/shared/icons';
import './api-key-form.css';

export type Mode = 'session' | 'save';

export type SubmitInput =
  | { readonly mode: 'session'; readonly key: string }
  | { readonly mode: 'save'; readonly key: string; readonly passphrase: string };

export type SubmitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

type Props = {
  readonly onSubmit: (input: SubmitInput) => Promise<SubmitResult>;
  readonly onCancel?: () => void;
  readonly initialMode?: Mode;
  readonly initialKey?: string;
  readonly hideKeyField?: boolean;
};

export function ApiKeyForm({
  onSubmit,
  onCancel,
  initialMode = 'session',
  initialKey = '',
  hideKeyField = false,
}: Props) {
  const [key, setKey] = useState(initialKey);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [passphrase, setPassphrase] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedKey = (hideKeyField ? initialKey : key).trim();
  const submitDisabled = isSubmitting || trimmedKey === '' || (mode === 'save' && passphrase === '');

  const submitLabel = mode === 'session' ? 'Use this session' : 'Save key';

  const handleSubmit = async (e: SyntheticEvent): Promise<void> => {
    e.preventDefault();
    if (submitDisabled) return;
    setIsSubmitting(true);
    setError(null);
    const input: SubmitInput =
      mode === 'session'
        ? { mode: 'session', key: trimmedKey }
        : { mode: 'save', key: trimmedKey, passphrase };
    const result = await onSubmit(input);
    if (!result.ok) {
      setError(result.message);
      setIsSubmitting(false);
    }
  };

  return (
    <form className="api-key-form" onSubmit={(e) => void handleSubmit(e)}>
      {!hideKeyField ? (
        <div className="api-key-form__field">
          <label htmlFor="api-key-input" className="api-key-form__label">
            NanoGPT API key
          </label>
          <div className="api-key-form__input-row">
            <input
              id="api-key-input"
              type={showKey ? 'text' : 'password'}
              className="api-key-form__input"
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
            />
            <button
              type="button"
              className="api-key-form__show-toggle"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              onClick={() => {
                setShowKey((v) => !v);
              }}
              disabled={isSubmitting}
            >
              {showKey ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </div>
      ) : null}

      <div className="api-key-form__field">
        <span className="api-key-form__label">Where to keep it</span>
        <div className="api-key-form__mode-toggle" role="group" aria-label="Storage mode">
          <button
            type="button"
            className={
              mode === 'session'
                ? 'api-key-form__mode api-key-form__mode--active'
                : 'api-key-form__mode'
            }
            aria-pressed={mode === 'session'}
            onClick={() => {
              setMode('session');
            }}
            disabled={isSubmitting}
          >
            Use this session
          </button>
          <button
            type="button"
            className={
              mode === 'save'
                ? 'api-key-form__mode api-key-form__mode--active'
                : 'api-key-form__mode'
            }
            aria-pressed={mode === 'save'}
            onClick={() => {
              setMode('save');
            }}
            disabled={isSubmitting}
          >
            Save on this device
          </button>
        </div>
        <p className="api-key-form__privacy">
          Your key stays on this device. <strong>Use this session</strong> keeps it in memory only —
          closing the tab forgets it. <strong>Save on this device</strong> encrypts it on disk with
          your passphrase, which we never store.
        </p>
      </div>

      {mode === 'save' ? (
        <div className="api-key-form__field">
          <label htmlFor="api-key-passphrase" className="api-key-form__label">
            Passphrase
          </label>
          <input
            id="api-key-passphrase"
            type="password"
            className="api-key-form__input"
            value={passphrase}
            onChange={(e) => {
              setPassphrase(e.target.value);
            }}
            autoComplete="new-password"
            disabled={isSubmitting}
          />
          <p className="api-key-form__hint">
            Used to encrypt your key. We never store it — you'll re-enter it after each reload.
          </p>
        </div>
      ) : null}

      {error !== null ? (
        <p className="api-key-form__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="api-key-form__actions">
        {onCancel !== undefined ? (
          <button
            type="button"
            className="api-key-form__cancel"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
        ) : null}
        <button type="submit" className="api-key-form__submit" disabled={submitDisabled}>
          {isSubmitting ? 'Validating…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
