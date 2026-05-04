import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NoteEditor } from './NoteEditor';

afterEach(cleanup);

function setup(props: Partial<React.ComponentProps<typeof NoteEditor>> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <NoteEditor
      initialContent={props.initialContent ?? ''}
      onSave={props.onSave ?? onSave}
      onCancel={props.onCancel ?? onCancel}
      {...(props.autoFocus !== undefined ? { autoFocus: props.autoFocus } : {})}
      {...(props.placeholder !== undefined ? { placeholder: props.placeholder } : {})}
    />,
  );
  return { onSave, onCancel };
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox');
}

describe('NoteEditor', () => {
  it('renders textarea with initialContent', () => {
    setup({ initialContent: 'hello' });
    expect(getTextarea().value).toBe('hello');
  });

  it('renders placeholder when empty', () => {
    setup({ placeholder: 'Add a note…' });
    expect(screen.getByPlaceholderText('Add a note…')).toBeInTheDocument();
  });

  it('autoFocus focuses textarea on mount', () => {
    setup({ autoFocus: true });
    expect(document.activeElement).toBe(getTextarea());
  });

  it('onChange does NOT call onSave (typing-only)', () => {
    const { onSave } = setup({ autoFocus: true });
    fireEvent.change(getTextarea(), { target: { value: 'hi' } });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('onBlur calls onSave with trimmed content when changed', () => {
    const onSave = vi.fn();
    setup({ initialContent: '', onSave, autoFocus: true });
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '  hello  ' } });
    fireEvent.blur(ta);
    expect(onSave).toHaveBeenCalledWith('hello');
  });

  it('onBlur calls onCancel when content unchanged (always closes)', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    setup({ initialContent: 'same', onSave, onCancel });
    fireEvent.blur(getTextarea());
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('Esc calls onCancel and does NOT save', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    setup({ initialContent: '', onSave, onCancel, autoFocus: true });
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: 'changed' } });
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Cmd/Ctrl+Enter triggers save with trimmed content', () => {
    const onSave = vi.fn();
    setup({ initialContent: '', onSave, autoFocus: true });
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '  a thought  ' } });
    fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith('a thought');
  });

  it('Shift+Enter triggers save with trimmed content', () => {
    const onSave = vi.fn();
    setup({ initialContent: '', onSave, autoFocus: true });
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: '  a thought  ' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(onSave).toHaveBeenCalledWith('a thought');
  });

  it('Shift+Enter cancels when content unchanged', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    setup({ initialContent: 'unchanged', onSave, onCancel, autoFocus: true });
    fireEvent.keyDown(getTextarea(), { key: 'Enter', shiftKey: true });
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('plain Enter does NOT submit (newline behavior is up to the textarea)', () => {
    const onSave = vi.fn();
    setup({ initialContent: '', onSave, autoFocus: true });
    const ta = getTextarea();
    fireEvent.change(ta, { target: { value: 'one\ntwo' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('counter hidden below 1600 chars', () => {
    setup({ initialContent: 'a'.repeat(1500) });
    expect(screen.queryByText(/1500\s*\/\s*2000/)).toBeNull();
  });

  it('counter visible at 1601 chars', () => {
    setup({ initialContent: 'a'.repeat(1601) });
    expect(screen.getByText(/1601\s*\/\s*2000/)).toBeInTheDocument();
  });

  it('counter has --over class above 2000 chars', () => {
    setup({ initialContent: 'a'.repeat(2001) });
    const counter = screen.getByText(/2001\s*\/\s*2000/);
    expect(counter.className).toContain('note-editor__counter--over');
  });

  it('hint always renders and explains save + discard paths', () => {
    setup();
    expect(screen.getByText(/Shift\+Enter or click outside to save/i)).toBeInTheDocument();
    expect(screen.getByText(/Esc to discard/i)).toBeInTheDocument();
  });

  it('outside mousedown calls onSave with trimmed value when content changed', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    setup({ initialContent: '', onSave, onCancel, autoFocus: true });
    fireEvent.change(getTextarea(), { target: { value: '  changed  ' } });
    fireEvent.mouseDown(document.body);
    expect(onSave).toHaveBeenCalledWith('changed');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('outside mousedown calls onCancel when content unchanged', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    setup({ initialContent: 'same', onSave, onCancel, autoFocus: true });
    fireEvent.mouseDown(document.body);
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it('mousedown inside the editor does NOT close', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    setup({ initialContent: '', onSave, onCancel, autoFocus: true });
    fireEvent.mouseDown(getTextarea());
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
