import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DesktopRail, type RailTab } from './DesktopRail';

afterEach(cleanup);

function makeTabs(activeContent: string, otherContent = 'Other'): readonly RailTab[] {
  return [
    { key: 'contents', label: 'Contents', content: <div>{activeContent}</div> },
    { key: 'bookmarks', label: 'Bookmarks', badge: 3, content: <div>{otherContent}</div> },
  ];
}

describe('DesktopRail', () => {
  it('renders tabs and shows the active tab content', () => {
    render(
      <DesktopRail
        tabs={makeTabs('Active panel')}
        activeKey="contents"
        onTabChange={() => undefined}
      />,
    );
    expect(document.querySelector('aside.desktop-rail')).not.toBeNull();
    expect(screen.getByRole('tab', { name: /contents/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /bookmarks/i })).toBeDefined();
    expect(screen.getByText('Active panel')).toBeDefined();
  });

  it('shows the badge when > 0', () => {
    render(
      <DesktopRail
        tabs={makeTabs('x')}
        activeKey="contents"
        onTabChange={() => undefined}
      />,
    );
    expect(screen.getByText('3')).toBeDefined();
  });

  it('marks the active tab and fires onTabChange on click', () => {
    const onTabChange = vi.fn();
    render(
      <DesktopRail tabs={makeTabs('x')} activeKey="contents" onTabChange={onTabChange} />,
    );
    const contentsTab = screen.getByRole('tab', { name: /contents/i });
    expect(contentsTab.className).toContain('--active');
    fireEvent.click(screen.getByRole('tab', { name: /bookmarks/i }));
    expect(onTabChange).toHaveBeenCalledWith('bookmarks');
  });
});
