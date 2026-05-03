import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HighlightToolbar } from './HighlightToolbar';

afterEach(cleanup);

const RECT = { x: 100, y: 200, width: 80, height: 20 };

describe('HighlightToolbar', () => {
  it('renders 4 color buttons in create mode + no delete', () => {
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getAllByRole('button', { name: /(yellow|green|blue|pink)/i })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /delete highlight/i })).toBeNull();
  });

  it('renders 4 color buttons + delete in edit mode', () => {
    render(
      <HighlightToolbar
        mode="edit"
        screenRect={RECT}
        currentColor="green"
        onPickColor={() => undefined}
        onDelete={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getAllByRole('button', { name: /(yellow|green|blue|pink)/i })).toHaveLength(4);
    expect(screen.getByRole('button', { name: /delete highlight/i })).toBeDefined();
  });

  it('marks the currentColor button as pressed in edit mode', () => {
    render(
      <HighlightToolbar
        mode="edit"
        screenRect={RECT}
        currentColor="blue"
        onPickColor={() => undefined}
        onDelete={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /blue/i }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /yellow/i }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('calls onPickColor with the right color when a swatch is clicked', () => {
    const onPickColor = vi.fn();
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={onPickColor}
        onDismiss={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /pink/i }));
    expect(onPickColor).toHaveBeenCalledWith('pink');
  });

  it('calls onDelete when delete is clicked (edit mode)', () => {
    const onDelete = vi.fn();
    render(
      <HighlightToolbar
        mode="edit"
        screenRect={RECT}
        currentColor="yellow"
        onPickColor={() => undefined}
        onDelete={onDelete}
        onDismiss={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /delete highlight/i }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('calls onDismiss on Escape', () => {
    const onDismiss = vi.fn();
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalled();
  });
});
