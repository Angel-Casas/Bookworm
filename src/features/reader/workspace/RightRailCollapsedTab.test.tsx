import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RightRailCollapsedTab } from './RightRailCollapsedTab';

afterEach(cleanup);

describe('RightRailCollapsedTab', () => {
  it('shows unread dot when flagged', () => {
    const { container } = render(
      <RightRailCollapsedTab onExpand={() => undefined} hasUnread />,
    );
    expect(container.querySelector('.right-rail__edge-dot')).not.toBeNull();
  });

  it('omits unread dot when not flagged', () => {
    const { container } = render(<RightRailCollapsedTab onExpand={() => undefined} />);
    expect(container.querySelector('.right-rail__edge-dot')).toBeNull();
  });

  it('calls onExpand when clicked', () => {
    const onExpand = vi.fn();
    render(<RightRailCollapsedTab onExpand={onExpand} />);
    fireEvent.click(screen.getByLabelText('Expand chat panel'));
    expect(onExpand).toHaveBeenCalled();
  });
});
