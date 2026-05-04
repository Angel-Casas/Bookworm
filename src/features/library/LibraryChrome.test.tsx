import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LibraryChrome } from './LibraryChrome';

afterEach(cleanup);

describe('LibraryChrome — settings button', () => {
  it('renders a Settings button (gear icon)', () => {
    render(
      <LibraryChrome
        search=""
        onSearchChange={() => undefined}
        sort="recently-opened"
        onSortChange={() => undefined}
        onFilesPicked={() => undefined}
        onOpenSettings={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /open settings/i })).toBeInTheDocument();
  });

  it('clicking the button calls onOpenSettings', () => {
    const onOpenSettings = vi.fn();
    render(
      <LibraryChrome
        search=""
        onSearchChange={() => undefined}
        sort="recently-opened"
        onSortChange={() => undefined}
        onFilesPicked={() => undefined}
        onOpenSettings={onOpenSettings}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
