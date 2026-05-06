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

describe('HighlightToolbar — note button', () => {
  it('renders 📝 button in create mode when onNote provided', () => {
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={() => undefined}
        onNote={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /add note/i })).toBeInTheDocument();
  });

  it('renders 📝 button in edit mode when onNote provided', () => {
    render(
      <HighlightToolbar
        mode="edit"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={() => undefined}
        onDelete={() => undefined}
        onNote={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /add note/i })).toBeInTheDocument();
  });

  it('omits 📝 button when onNote is undefined', () => {
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: /note/i })).toBeNull();
  });

  it('hasNote=true in edit mode labels the button "Edit note" and applies active class', () => {
    render(
      <HighlightToolbar
        mode="edit"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={() => undefined}
        onDelete={() => undefined}
        onNote={() => undefined}
        hasNote
      />,
    );
    const btn = screen.getByRole('button', { name: /edit note/i });
    expect(btn.className).toContain('highlight-toolbar__note--active');
  });

  it('clicking 📝 calls onNote (does not call onDismiss)', () => {
    const onNote = vi.fn();
    const onDismiss = vi.fn();
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={onDismiss}
        onNote={onNote}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));
    expect(onNote).toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('HighlightToolbar — Ask AI button (Phase 4.4)', () => {
  it('renders Ask AI button in create mode when canAskAI=true and onAskAI is defined', () => {
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={() => undefined}
        onAskAI={() => undefined}
        canAskAI
      />,
    );
    expect(
      screen.getByRole('button', { name: /ask ai about this passage/i }),
    ).toBeInTheDocument();
  });

  it('renders Ask AI button in edit mode too', () => {
    render(
      <HighlightToolbar
        mode="edit"
        screenRect={RECT}
        currentColor="yellow"
        onPickColor={() => undefined}
        onDelete={() => undefined}
        onDismiss={() => undefined}
        onAskAI={() => undefined}
        canAskAI
      />,
    );
    expect(
      screen.getByRole('button', { name: /ask ai about this passage/i }),
    ).toBeInTheDocument();
  });

  it('hides Ask AI button when canAskAI=false', () => {
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={() => undefined}
        onAskAI={() => undefined}
        canAskAI={false}
      />,
    );
    expect(screen.queryByRole('button', { name: /ask ai/i })).toBeNull();
  });

  it('hides Ask AI button when onAskAI is undefined (even with canAskAI=true)', () => {
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={() => undefined}
        canAskAI
      />,
    );
    expect(screen.queryByRole('button', { name: /ask ai/i })).toBeNull();
  });

  it('clicking Ask AI calls onAskAI and onDismiss', () => {
    const onAskAI = vi.fn();
    const onDismiss = vi.fn();
    render(
      <HighlightToolbar
        mode="create"
        screenRect={RECT}
        onPickColor={() => undefined}
        onDismiss={onDismiss}
        onAskAI={onAskAI}
        canAskAI
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ask ai about this passage/i }));
    expect(onAskAI).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
