import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RightRail } from './RightRail';

afterEach(cleanup);

describe('RightRail', () => {
  it('renders title and body content', () => {
    render(<RightRail title="Chat" onCollapse={() => undefined}>panel-body</RightRail>);
    expect(screen.getByText('Chat')).toBeDefined();
    expect(screen.getByText('panel-body')).toBeDefined();
  });

  it('calls onCollapse when collapse button clicked', () => {
    const onCollapse = vi.fn();
    render(<RightRail onCollapse={onCollapse}>x</RightRail>);
    fireEvent.click(screen.getByLabelText('Collapse chat panel'));
    expect(onCollapse).toHaveBeenCalled();
  });
});
