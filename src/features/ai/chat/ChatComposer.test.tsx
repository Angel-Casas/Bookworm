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
});
