import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatComposer } from './ChatComposer';

afterEach(cleanup);

describe('ChatComposer', () => {
  it('renders textarea with the placeholder as label', () => {
    render(
      <ChatComposer
        streaming={false}
        placeholder="Ask about Moby-Dick"
        onSend={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(screen.getByLabelText('Ask about Moby-Dick')).toBeDefined();
  });

  it('Send button is disabled when textarea is empty', () => {
    render(
      <ChatComposer
        streaming={false}
        placeholder="x"
        onSend={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const btn = screen.getByLabelText('Send');
    expect(btn).toHaveProperty('disabled', true);
  });

  it('typing + clicking Send calls onSend and clears textarea', () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        streaming={false}
        placeholder="x"
        onSend={onSend}
        onCancel={() => undefined}
      />,
    );
    const ta = screen.getByLabelText('x');
    fireEvent.change(ta, { target: { value: '  hello  ' } });
    fireEvent.click(screen.getByLabelText('Send'));
    expect(onSend).toHaveBeenCalledWith('hello');
    expect((ta as HTMLTextAreaElement).value).toBe('');
  });

  it('Cmd+Enter triggers send', () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        streaming={false}
        placeholder="x"
        onSend={onSend}
        onCancel={() => undefined}
      />,
    );
    const ta = screen.getByLabelText('x');
    fireEvent.change(ta, { target: { value: 'hi' } });
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true, ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith('hi');
  });

  it('plain Enter does not send', () => {
    const onSend = vi.fn();
    render(
      <ChatComposer
        streaming={false}
        placeholder="x"
        onSend={onSend}
        onCancel={() => undefined}
      />,
    );
    const ta = screen.getByLabelText('x');
    fireEvent.change(ta, { target: { value: 'hi' } });
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('while streaming, Send becomes Stop and click cancels', () => {
    const onCancel = vi.fn();
    render(
      <ChatComposer
        streaming={true}
        placeholder="x"
        onSend={() => undefined}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByLabelText('Stop')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Stop'));
    expect(onCancel).toHaveBeenCalled();
  });

  describe('chapter-mode toggle', () => {
    it('hides the chapter button when onToggleChapter is undefined', () => {
      const { container } = render(
        <ChatComposer
          streaming={false}
          placeholder="Ask"
          onSend={() => undefined}
          onCancel={() => undefined}
        />,
      );
      expect(container.querySelector('.chat-composer__chapter-toggle')).toBeNull();
    });

    it('shows the button when onToggleChapter is provided; default disabled=false', () => {
      const { container } = render(
        <ChatComposer
          streaming={false}
          placeholder="Ask"
          onSend={() => undefined}
          onCancel={() => undefined}
          onToggleChapter={() => undefined}
        />,
      );
      const btn = container.querySelector('.chat-composer__chapter-toggle');
      expect(btn).not.toBeNull();
      expect((btn as HTMLButtonElement).disabled).toBe(false);
    });

    it('disables the button when chapterAttachable is false', () => {
      const { container } = render(
        <ChatComposer
          streaming={false}
          placeholder="Ask"
          onSend={() => undefined}
          onCancel={() => undefined}
          onToggleChapter={() => undefined}
          chapterAttachable={false}
        />,
      );
      const btn = container.querySelector<HTMLButtonElement>('.chat-composer__chapter-toggle')!;
      expect(btn.disabled).toBe(true);
    });

    it('aria-pressed reflects chapterAttached', () => {
      const { container, rerender } = render(
        <ChatComposer
          streaming={false}
          placeholder="Ask"
          onSend={() => undefined}
          onCancel={() => undefined}
          onToggleChapter={() => undefined}
          chapterAttached={false}
        />,
      );
      let btn = container.querySelector<HTMLButtonElement>('.chat-composer__chapter-toggle')!;
      expect(btn.getAttribute('aria-pressed')).toBe('false');

      rerender(
        <ChatComposer
          streaming={false}
          placeholder="Ask"
          onSend={() => undefined}
          onCancel={() => undefined}
          onToggleChapter={() => undefined}
          chapterAttached={true}
        />,
      );
      btn = container.querySelector<HTMLButtonElement>('.chat-composer__chapter-toggle')!;
      expect(btn.getAttribute('aria-pressed')).toBe('true');
    });

    it('clicking the button fires onToggleChapter', () => {
      const onToggleChapter = vi.fn();
      const { container } = render(
        <ChatComposer
          streaming={false}
          placeholder="Ask"
          onSend={() => undefined}
          onCancel={() => undefined}
          onToggleChapter={onToggleChapter}
        />,
      );
      const btn = container.querySelector<HTMLButtonElement>('.chat-composer__chapter-toggle')!;
      fireEvent.click(btn);
      expect(onToggleChapter).toHaveBeenCalledOnce();
    });
  });
});
