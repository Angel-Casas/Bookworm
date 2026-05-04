import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { UnlockForm } from './UnlockForm';

afterEach(cleanup);

describe('UnlockForm', () => {
  it('renders passphrase input + unlock + remove buttons', () => {
    render(
      <UnlockForm onSubmit={() => Promise.resolve({ ok: true as const })} onRemove={() => undefined} />,
    );
    expect(screen.getByLabelText(/passphrase/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^unlock$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove saved key/i })).toBeInTheDocument();
  });

  it('submit calls onSubmit with the passphrase', async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true as const }));
    render(<UnlockForm onSubmit={onSubmit} onRemove={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: 'pp' } });
    fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('pp');
    });
  });

  it('error renders on ok:false', async () => {
    const onSubmit = vi.fn(() =>
      Promise.resolve({ ok: false as const, message: 'Wrong passphrase' }),
    );
    render(<UnlockForm onSubmit={onSubmit} onRemove={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /^unlock$/i }));
    await waitFor(() => {
      expect(screen.getByText(/wrong passphrase/i)).toBeInTheDocument();
    });
  });

  it('Remove triggers onRemove', () => {
    const onRemove = vi.fn();
    render(<UnlockForm onSubmit={() => Promise.resolve({ ok: true as const })} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /remove saved key/i }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('submit disabled when passphrase is empty', () => {
    render(
      <UnlockForm onSubmit={() => Promise.resolve({ ok: true as const })} onRemove={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: /^unlock$/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: 'p' } });
    expect(screen.getByRole('button', { name: /^unlock$/i })).not.toBeDisabled();
  });
});
