import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  NotebookIcon,
  NoteIcon,
  ArrowLeftIcon,
  SettingsIcon,
  EyeIcon,
  EyeOffIcon,
} from './index';

afterEach(cleanup);

describe('icons', () => {
  it('NotebookIcon renders a 16px svg with .icon class and aria-hidden', () => {
    const { container } = render(<NotebookIcon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('height')).toBe('16');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.classList.contains('icon')).toBe(true);
  });

  it('NoteIcon renders an svg', () => {
    const { container } = render(<NoteIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('ArrowLeftIcon renders an svg', () => {
    const { container } = render(<ArrowLeftIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('NotebookIcon accepts a custom size', () => {
    const { container } = render(<NotebookIcon size={24} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('NotebookIcon merges custom className with .icon', () => {
    const { container } = render(<NotebookIcon className="extra" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('icon')).toBe(true);
    expect(svg?.classList.contains('extra')).toBe(true);
  });

  it('SettingsIcon renders an svg', () => {
    const { container } = render(<SettingsIcon />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains('icon')).toBe(true);
  });

  it('EyeIcon renders an svg', () => {
    const { container } = render(<EyeIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('EyeOffIcon renders an svg', () => {
    const { container } = render(<EyeOffIcon />);
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
