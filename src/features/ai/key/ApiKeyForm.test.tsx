import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ApiKeyForm } from './ApiKeyForm';

afterEach(cleanup);

function setup(overrides: Partial<ComponentProps<typeof ApiKeyForm>> = {}) {
  const onSubmit = vi.fn(() => Promise.resolve({ ok: true as const }));
  const onCancel = vi.fn();
  const props = {
    onSubmit: overrides.onSubmit ?? onSubmit,
    onCancel: overrides.onCancel ?? onCancel,
    ...(overrides.initialMode !== undefined && { initialMode: overrides.initialMode }),
    ...(overrides.initialKey !== undefined && { initialKey: overrides.initialKey }),
    ...(overrides.hideKeyField !== undefined && { hideKeyField: overrides.hideKeyField }),
  };
  return { ...props, ...render(<ApiKeyForm {...props} />) };
}

function submitButton(): HTMLButtonElement {
  const btn = screen
    .getAllByRole('button')
    .find((b) => b.getAttribute('type') === 'submit') as HTMLButtonElement | undefined;
  if (!btn) throw new Error('submit button not found');
  return btn;
}

describe('ApiKeyForm', () => {
  it('renders masked key input + show toggle', () => {
    setup();
    const input = screen.getByLabelText(/NanoGPT API key/i);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: /show api key/i })).toBeInTheDocument();
  });

  it('show toggle flips input type to text', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /show api key/i }));
    const input = screen.getByLabelText(/NanoGPT API key/i);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /hide api key/i })).toBeInTheDocument();
  });

  it('mode segmented control toggles between session and save', () => {
    setup();
    expect(screen.queryByLabelText(/Passphrase/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Save on this device/i }));
    expect(screen.getByLabelText(/Passphrase/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Use this session/i }));
    expect(screen.queryByLabelText(/Passphrase/i)).toBeNull();
  });

  it('submit disabled until key is non-empty (session mode)', () => {
    setup();
    expect(submitButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), { target: { value: 'sk-x' } });
    expect(submitButton()).not.toBeDisabled();
  });

  it('submit disabled until passphrase is non-empty (save mode)', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Save on this device/i }));
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), { target: { value: 'sk-x' } });
    expect(submitButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Passphrase/i), { target: { value: 'pp' } });
    expect(submitButton()).not.toBeDisabled();
  });

  it('submit calls onSubmit with the right shape (session, trimmed)', async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true as const }));
    setup({ onSubmit });
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), {
      target: { value: '  sk-test  ' },
    });
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ mode: 'session', key: 'sk-test' });
    });
  });

  it('submit calls onSubmit with the right shape (save mode)', async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true as const }));
    setup({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: /Save on this device/i }));
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), { target: { value: 'sk-test' } });
    fireEvent.change(screen.getByLabelText(/Passphrase/i), { target: { value: 'my-pp' } });
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        mode: 'save',
        key: 'sk-test',
        passphrase: 'my-pp',
      });
    });
  });

  it('error message renders when onSubmit returns ok:false', async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ ok: false as const, message: 'bad key' }));
    setup({ onSubmit });
    fireEvent.change(screen.getByLabelText(/NanoGPT API key/i), { target: { value: 'sk-bad' } });
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(screen.getByText(/bad key/i)).toBeInTheDocument();
    });
  });

  it('hideKeyField renders without the key input (session→save upgrade path)', () => {
    setup({ hideKeyField: true, initialKey: 'sk-prefilled', initialMode: 'save' });
    expect(screen.queryByLabelText(/NanoGPT API key/i)).toBeNull();
    expect(screen.getByLabelText(/Passphrase/i)).toBeInTheDocument();
  });

  it('cancel triggers onCancel', () => {
    const onCancel = vi.fn();
    setup({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
