import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SuggestedPromptItem } from './SuggestedPromptItem';

afterEach(() => {
  cleanup();
});

describe('SuggestedPromptItem', () => {
  it('renders prompt text and category badge', () => {
    const { container } = render(
      <SuggestedPromptItem
        prompt={{ text: 'Track motives.', category: 'analysis' }}
        onSelect={() => undefined}
        onEdit={() => undefined}
      />,
    );
    expect(container.textContent).toContain('Track motives.');
    expect(container.textContent.toLowerCase()).toContain('analysis');
  });

  it('clicking the row fires onSelect with the prompt text', () => {
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    const { container } = render(
      <SuggestedPromptItem
        prompt={{ text: 'Track motives.', category: 'analysis' }}
        onSelect={onSelect}
        onEdit={onEdit}
      />,
    );
    const row = container.querySelector('.suggested-prompts__item');
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(onSelect).toHaveBeenCalledWith('Track motives.');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('clicking the edit icon fires onEdit and not onSelect (event isolation)', () => {
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    const { container } = render(
      <SuggestedPromptItem
        prompt={{ text: 'Track motives.', category: 'analysis' }}
        onSelect={onSelect}
        onEdit={onEdit}
      />,
    );
    const editBtn = container.querySelector('.suggested-prompts__edit');
    expect(editBtn).not.toBeNull();
    fireEvent.click(editBtn!);
    expect(onEdit).toHaveBeenCalledWith('Track motives.');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('row aria-label is "Ask: {text}"', () => {
    const { container } = render(
      <SuggestedPromptItem
        prompt={{ text: 'Track motives.', category: 'analysis' }}
        onSelect={() => undefined}
        onEdit={() => undefined}
      />,
    );
    const row = container.querySelector('.suggested-prompts__item');
    expect(row?.getAttribute('aria-label')).toBe('Ask: Track motives.');
  });

  it('edit-button aria-label is "Edit before asking: {text}"', () => {
    const { container } = render(
      <SuggestedPromptItem
        prompt={{ text: 'Track motives.', category: 'analysis' }}
        onSelect={() => undefined}
        onEdit={() => undefined}
      />,
    );
    const editBtn = container.querySelector('.suggested-prompts__edit');
    expect(editBtn?.getAttribute('aria-label')).toBe(
      'Edit before asking: Track motives.',
    );
  });
});
