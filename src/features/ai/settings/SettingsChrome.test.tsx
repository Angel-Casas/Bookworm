import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SettingsChrome } from './SettingsChrome';

afterEach(cleanup);

describe('SettingsChrome', () => {
  it('renders back button + Settings title', () => {
    render(<SettingsChrome onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: /back to library/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /settings/i, level: 1 })).toBeInTheDocument();
  });

  it('calls onClose when back is clicked', () => {
    const onClose = vi.fn();
    render(<SettingsChrome onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /back to library/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
