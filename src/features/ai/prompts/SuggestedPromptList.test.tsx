import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SuggestedPromptList } from './SuggestedPromptList';

afterEach(() => {
  cleanup();
});

describe('SuggestedPromptList', () => {
  it('renders one item per prompt', () => {
    const { container } = render(
      <SuggestedPromptList
        prompts={[
          { text: 'q1', category: 'analysis' },
          { text: 'q2', category: 'analysis' },
          { text: 'q3', category: 'comprehension' },
        ]}
        onSelect={() => undefined}
        onEdit={() => undefined}
      />,
    );
    expect(container.querySelectorAll('.suggested-prompts__item')).toHaveLength(3);
  });

  it('container has role=region with aria-label', () => {
    const { container } = render(
      <SuggestedPromptList
        prompts={[{ text: 'q1', category: 'analysis' }]}
        onSelect={() => undefined}
        onEdit={() => undefined}
      />,
    );
    const region = container.querySelector('.suggested-prompts');
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.getAttribute('aria-label')).toBe('Suggested questions');
  });

  it('clicking the second item fires onSelect with that prompt text', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SuggestedPromptList
        prompts={[
          { text: 'first', category: 'analysis' },
          { text: 'second', category: 'analysis' },
        ]}
        onSelect={onSelect}
        onEdit={() => undefined}
      />,
    );
    const items = container.querySelectorAll('.suggested-prompts__item');
    fireEvent.click(items[1]!);
    expect(onSelect).toHaveBeenCalledWith('second');
  });
});
