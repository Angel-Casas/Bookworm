import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ChapterChip } from './ChapterChip';

afterEach(() => {
  cleanup();
});

describe('ChapterChip', () => {
  it('renders the chapter title and counts', () => {
    const { container } = render(
      <ChapterChip
        sectionTitle="Chapter VII"
        chunkCount={12}
        highlightCount={3}
        noteCount={1}
        onDismiss={() => undefined}
      />,
    );
    expect(container.textContent).toContain('Chapter VII');
    expect(container.textContent).toContain('12 chunks');
    expect(container.textContent).toContain('3 highlights');
    expect(container.textContent).toContain('1 note');
  });

  it('uses singular labels when count is 1', () => {
    const { container } = render(
      <ChapterChip
        sectionTitle="Chapter I"
        chunkCount={1}
        highlightCount={1}
        noteCount={1}
        onDismiss={() => undefined}
      />,
    );
    expect(container.textContent).toContain('1 chunk');
    expect(container.textContent).not.toContain('1 chunks');
    expect(container.textContent).toContain('1 highlight');
    expect(container.textContent).toContain('1 note');
  });

  it('omits the highlight/note counts when zero', () => {
    const { container } = render(
      <ChapterChip
        sectionTitle="Chapter VII"
        chunkCount={12}
        highlightCount={0}
        noteCount={0}
        onDismiss={() => undefined}
      />,
    );
    expect(container.textContent).toContain('12 chunks');
    expect(container.textContent).not.toContain('highlights');
    expect(container.textContent).not.toContain('notes');
  });

  it('clicking × fires onDismiss', () => {
    const onDismiss = vi.fn();
    const { getByRole } = render(
      <ChapterChip
        sectionTitle="Chapter VII"
        chunkCount={12}
        highlightCount={3}
        noteCount={1}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(getByRole('button', { name: /clear chapter/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('aria-label on dismiss button includes the chapter title', () => {
    const { getByRole } = render(
      <ChapterChip
        sectionTitle="Chapter VII"
        chunkCount={12}
        highlightCount={3}
        noteCount={1}
        onDismiss={() => undefined}
      />,
    );
    const dismissBtn = getByRole('button', { name: /clear chapter/i });
    expect(dismissBtn.getAttribute('aria-label')).toContain('Chapter VII');
  });
});
