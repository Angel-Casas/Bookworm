import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useRef, useState, type ReactNode } from 'react';
import { useFocusTrap } from './useFocusTrap';

afterEach(cleanup);

function Harness({
  buttonLabels,
  trapActive,
}: {
  buttonLabels: readonly string[];
  trapActive: boolean;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, trapActive);
  return (
    <div ref={ref} data-testid="trap-root" tabIndex={-1}>
      {buttonLabels.map((l) => (
        <button key={l} type="button">
          {l}
        </button>
      ))}
    </div>
  );
}

describe('useFocusTrap', () => {
  it('focuses the first focusable inside the ref on mount', () => {
    render(<Harness buttonLabels={['one', 'two']} trapActive={true} />);
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('one');
  });

  it('is a no-op when isActive is false', () => {
    const triggerOutside = document.createElement('button');
    triggerOutside.textContent = 'outside';
    document.body.appendChild(triggerOutside);
    triggerOutside.focus();
    try {
      expect(document.activeElement).toBe(triggerOutside);
      render(<Harness buttonLabels={['one']} trapActive={false} />);
      expect(document.activeElement).toBe(triggerOutside);
    } finally {
      document.body.removeChild(triggerOutside);
    }
  });

  it('Tab on a non-last focusable allows native browser behavior', () => {
    render(<Harness buttonLabels={['one', 'two', 'three']} trapActive={true} />);
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('Tab on the last focusable wraps to the first', () => {
    render(<Harness buttonLabels={['one', 'two', 'three']} trapActive={true} />);
    const buttons = Array.from(document.querySelectorAll('button'));
    const last = buttons.at(-1);
    if (!last) throw new Error('expected at least one button');
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('one');
  });

  it('Shift+Tab on the first focusable wraps to the last', () => {
    render(<Harness buttonLabels={['one', 'two', 'three']} trapActive={true} />);
    const buttons = Array.from(document.querySelectorAll('button'));
    const first = buttons[0];
    if (!first) throw new Error('expected at least one button');
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('three');
  });

  it('restores focus to the trigger when the trap unmounts', () => {
    function Wrapper(): ReactNode {
      const [show, setShow] = useState(false);
      return (
        <>
          <button
            type="button"
            data-testid="trigger"
            onClick={() => {
              setShow(true);
            }}
          >
            open
          </button>
          {show ? (
            <button
              type="button"
              data-testid="closer"
              onClick={() => {
                setShow(false);
              }}
            >
              close
            </button>
          ) : null}
          {show ? <Harness buttonLabels={['inside']} trapActive={true} /> : null}
        </>
      );
    }
    const { getByTestId } = render(<Wrapper />);
    const trigger = getByTestId('trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('inside');
    fireEvent.click(getByTestId('closer'));
    expect(document.activeElement).toBe(trigger);
  });

  it('falls back to document.body when restoreTarget is gone at unmount time', () => {
    function Wrapper(): ReactNode {
      const [showAll, setShowAll] = useState(true);
      return (
        <>
          {showAll ? (
            <button
              type="button"
              data-testid="trigger"
              onClick={() => {
                setShowAll(false);
              }}
            >
              open-and-vanish
            </button>
          ) : null}
          {showAll ? <Harness buttonLabels={['inside']} trapActive={true} /> : null}
        </>
      );
    }
    const { getByTestId } = render(<Wrapper />);
    const trigger = getByTestId('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(document.body);
  });

  it('with zero focusable children, no element is auto-focused but Tab is preventDefault', () => {
    function Empty(): ReactNode {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref, true);
      return <div ref={ref} data-testid="empty-root" tabIndex={-1} />;
    }
    const triggerOutside = document.createElement('button');
    triggerOutside.textContent = 'outside';
    document.body.appendChild(triggerOutside);
    triggerOutside.focus();
    try {
      render(<Empty />);
      expect(document.activeElement).toBe(triggerOutside);
      const root = document.querySelector('[data-testid="empty-root"]');
      if (!(root instanceof HTMLElement)) throw new Error('empty-root not found');
      const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      root.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    } finally {
      document.body.removeChild(triggerOutside);
    }
  });
});
