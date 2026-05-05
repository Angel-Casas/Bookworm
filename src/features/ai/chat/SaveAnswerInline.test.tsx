import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SaveAnswerInline } from './SaveAnswerInline';

afterEach(cleanup);

describe('SaveAnswerInline', () => {
  it('renders textarea + Save + Cancel by default', () => {
    render(
      <SaveAnswerInline
        onSave={() => Promise.resolve()}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByLabelText(/add a note/i)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('Save calls onSave with trimmed note and shows confirmation', async () => {
    const onSave = vi.fn(() => Promise.resolve());
    render(<SaveAnswerInline onSave={onSave} onCancel={() => undefined} />);
    const ta = screen.getByLabelText(/add a note/i);
    fireEvent.change(ta, { target: { value: '  important  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('important');
    });
    await waitFor(() => {
      expect(screen.getByText(/Saved → notebook/)).toBeDefined();
    });
  });

  it('Cancel calls onCancel', () => {
    const onCancel = vi.fn();
    render(<SaveAnswerInline onSave={() => Promise.resolve()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
