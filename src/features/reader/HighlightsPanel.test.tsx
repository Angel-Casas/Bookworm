import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { HighlightsPanel } from './HighlightsPanel';
import { BookId, HighlightId, IsoTimestamp, NoteId } from '@/domain';
import type { Highlight, Note } from '@/domain/annotations/types';

afterEach(cleanup);

const NOW = new Date('2026-05-03T12:00:00.000Z').getTime();

function h(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: HighlightId(crypto.randomUUID()),
    bookId: BookId('b1'),
    anchor: { kind: 'epub-cfi', cfi: 'epubcfi(/6/4!/4/2/16,/1:0,/1:24)' },
    selectedText: 'A passage of selected text',
    sectionTitle: 'Chapter 1',
    color: 'yellow',
    tags: [],
    createdAt: IsoTimestamp(new Date(NOW).toISOString()),
    ...overrides,
  };
}

function makeNote(highlightId: HighlightId, content: string): Note {
  return {
    id: NoteId(`n-${highlightId}`),
    bookId: BookId('b1'),
    anchorRef: { kind: 'highlight', highlightId },
    content,
    createdAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
    updatedAt: IsoTimestamp('2026-05-04T12:00:00.000Z'),
  };
}

const EMPTY_NOTES: ReadonlyMap<HighlightId, Note> = new Map();

describe('HighlightsPanel', () => {
  it('renders rows with section + selected text + relative time + colored bar', () => {
    const { container } = render(
      <HighlightsPanel
        highlights={[h({ sectionTitle: 'Chapter 1' })]}
        notesByHighlightId={EMPTY_NOTES}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
        onSaveNote={() => undefined}
        nowMs={NOW}
      />,
    );
    expect(screen.getByText('Chapter 1')).toBeDefined();
    expect(screen.getByText('A passage of selected text')).toBeDefined();
    expect(screen.getByText('just now')).toBeDefined();
    expect(container.querySelector('.highlights-panel__bar[data-color="yellow"]')).not.toBeNull();
  });

  it('shows empty state when no highlights', () => {
    render(
      <HighlightsPanel
        highlights={[]}
        notesByHighlightId={EMPTY_NOTES}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
        onSaveNote={() => undefined}
      />,
    );
    expect(screen.getByText(/No highlights yet/i)).toBeDefined();
  });

  it('calls onSelect when the row is clicked', () => {
    const onSelect = vi.fn();
    const target = h();
    render(
      <HighlightsPanel
        highlights={[target]}
        notesByHighlightId={EMPTY_NOTES}
        onSelect={onSelect}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
        onSaveNote={() => undefined}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /chapter 1/i }));
    expect(onSelect).toHaveBeenCalledWith(target);
  });

  it('calls onDelete when × is clicked', () => {
    const onDelete = vi.fn();
    const target = h();
    render(
      <HighlightsPanel
        highlights={[target]}
        notesByHighlightId={EMPTY_NOTES}
        onSelect={() => undefined}
        onDelete={onDelete}
        onChangeColor={() => undefined}
        onSaveNote={() => undefined}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByLabelText(/remove highlight/i));
    expect(onDelete).toHaveBeenCalledWith(target);
  });

  it('calls onChangeColor when a color pip is clicked', () => {
    const onChangeColor = vi.fn();
    const target = h({ color: 'yellow' });
    render(
      <HighlightsPanel
        highlights={[target]}
        notesByHighlightId={EMPTY_NOTES}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={onChangeColor}
        onSaveNote={() => undefined}
        nowMs={NOW}
      />,
    );
    fireEvent.click(screen.getByLabelText(/set color to green/i));
    expect(onChangeColor).toHaveBeenCalledWith(target, 'green');
  });

  it('renders highlights in the order provided (caller sorts)', () => {
    const a = h({ sectionTitle: 'Alpha' });
    const b = h({ sectionTitle: 'Beta' });
    const c = h({ sectionTitle: 'Gamma' });
    render(
      <HighlightsPanel
        highlights={[c, a, b]}
        notesByHighlightId={EMPTY_NOTES}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
        onSaveNote={() => undefined}
        nowMs={NOW}
      />,
    );
    const titles = Array.from(document.querySelectorAll('.highlights-panel__section')).map(
      (el) => el.textContent,
    );
    expect(titles).toEqual(['Gamma', 'Alpha', 'Beta']);
  });
});

describe('HighlightsPanel — notes', () => {
  function renderPanel(props: Partial<React.ComponentProps<typeof HighlightsPanel>> = {}) {
    const defaultH = h({ id: HighlightId('h-1') });
    return render(
      <HighlightsPanel
        highlights={props.highlights ?? [defaultH]}
        notesByHighlightId={props.notesByHighlightId ?? EMPTY_NOTES}
        onSelect={props.onSelect ?? (() => undefined)}
        onDelete={props.onDelete ?? (() => undefined)}
        onChangeColor={props.onChangeColor ?? (() => undefined)}
        onSaveNote={props.onSaveNote ?? (() => undefined)}
        nowMs={NOW}
      />,
    );
  }

  it('row without a note has no note line', () => {
    renderPanel();
    expect(screen.queryByTestId('note-line')).toBeNull();
  });

  it('row with a note shows note line with content', () => {
    const target = h({ id: HighlightId('h-1') });
    const notes = new Map([[target.id, makeNote(target.id, 'Bingley represents the new gentry.')]]);
    renderPanel({ highlights: [target], notesByHighlightId: notes });
    expect(screen.getByText(/Bingley represents the new gentry/)).toBeInTheDocument();
  });

  it('clicking 📝 enters edit mode (renders NoteEditor)', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('clicking the note line enters edit mode', () => {
    const target = h({ id: HighlightId('h-1') });
    const notes = new Map([[target.id, makeNote(target.id, 'an old note')]]);
    renderPanel({ highlights: [target], notesByHighlightId: notes });
    fireEvent.click(screen.getByText('an old note'));
    const ta = screen.getByRole('textbox');
    expect(ta).toHaveValue('an old note');
  });

  it('color pips and × are hidden during edit mode', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));
    expect(screen.queryByRole('button', { name: /set color to/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove highlight/i })).toBeNull();
  });

  it('saving content calls onSaveNote(h, content)', () => {
    const onSaveNote = vi.fn();
    const target = h({ id: HighlightId('h-1') });
    renderPanel({ highlights: [target], onSaveNote });
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'new thought' } });
    fireEvent.blur(ta);
    expect(onSaveNote).toHaveBeenCalledWith(target, 'new thought');
  });

  it('saving empty content calls onSaveNote(h, "")', () => {
    const onSaveNote = vi.fn();
    const target = h({ id: HighlightId('h-1') });
    const notes = new Map([[target.id, makeNote(target.id, 'old text')]]);
    renderPanel({ highlights: [target], notesByHighlightId: notes, onSaveNote });
    fireEvent.click(screen.getByText('old text'));
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '' } });
    fireEvent.blur(ta);
    expect(onSaveNote).toHaveBeenCalledWith(target, '');
  });

  it('Esc cancels edit mode and restores read-only line', () => {
    const target = h({ id: HighlightId('h-1') });
    const notes = new Map([[target.id, makeNote(target.id, 'old text')]]);
    renderPanel({ highlights: [target], notesByHighlightId: notes });
    fireEvent.click(screen.getByText('old text'));
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: 'changed' } });
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('old text')).toBeInTheDocument();
  });

  it('clicking 📝 again on the same row toggles out of edit mode', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /add note/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    // In edit mode the button is labelled "Cancel note".
    fireEvent.click(screen.getByRole('button', { name: /cancel note/i }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
