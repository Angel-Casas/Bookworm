import { useState } from 'react';
import type { FormEvent } from 'react';
import './unlock-form.css';

type Props = {
  readonly onSubmit: (
    passphrase: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  readonly onRemove: () => void;
};

export function UnlockForm({ onSubmit, onRemove }: Props) {
  const [passphrase, setPassphrase] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (passphrase === '' || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const result = await onSubmit(passphrase);
    if (!result.ok) {
      setError(result.message);
      setIsSubmitting(false);
    }
  };

  return (
    <form className="unlock-form" onSubmit={(e) => void handleSubmit(e)}>
      <p className="unlock-form__intro">
        Your API key is saved on this device. Enter your passphrase to unlock it.
      </p>
      <div className="unlock-form__field">
        <label htmlFor="unlock-passphrase" className="unlock-form__label">
          Passphrase
        </label>
        <input
          id="unlock-passphrase"
          type="password"
          className="unlock-form__input"
          value={passphrase}
          onChange={(e) => {
            setPassphrase(e.target.value);
          }}
          autoComplete="current-password"
          disabled={isSubmitting}
        />
      </div>
      {error !== null ? (
        <p className="unlock-form__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="unlock-form__actions">
        <button
          type="button"
          className="unlock-form__remove"
          onClick={onRemove}
          disabled={isSubmitting}
        >
          Remove saved key
        </button>
        <button
          type="submit"
          className="unlock-form__submit"
          disabled={passphrase === '' || isSubmitting}
        >
          {isSubmitting ? 'Unlocking…' : 'Unlock'}
        </button>
      </div>
    </form>
  );
}
