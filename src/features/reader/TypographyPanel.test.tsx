import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TypographyPanel } from './TypographyPanel';
import { DEFAULT_READER_PREFERENCES } from '@/domain/reader';

afterEach(cleanup);

describe('TypographyPanel', () => {
  it('changes font family', () => {
    const onChange = vi.fn();
    render(<TypographyPanel preferences={DEFAULT_READER_PREFERENCES} onChange={onChange} />);
    const select = screen.getByText(/font/i).closest('label')!.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'inter' } });
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_READER_PREFERENCES,
      typography: { ...DEFAULT_READER_PREFERENCES.typography, fontFamily: 'inter' },
    });
  });

  it('changes theme', () => {
    const onChange = vi.fn();
    render(<TypographyPanel preferences={DEFAULT_READER_PREFERENCES} onChange={onChange} />);
    const dark = screen.getByRole('radio', { name: /dark/i });
    fireEvent.click(dark);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_READER_PREFERENCES, theme: 'dark' });
  });

  it('changes mode (scroll/paginated)', () => {
    const onChange = vi.fn();
    render(<TypographyPanel preferences={DEFAULT_READER_PREFERENCES} onChange={onChange} />);
    const scroll = screen.getByRole('radio', { name: /scroll/i });
    fireEvent.click(scroll);
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_READER_PREFERENCES,
      modeByFormat: { epub: 'scroll' },
    });
  });

  it('increments font size step on +', () => {
    const onChange = vi.fn();
    render(<TypographyPanel preferences={DEFAULT_READER_PREFERENCES} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /increase font size/i }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_READER_PREFERENCES,
      typography: { ...DEFAULT_READER_PREFERENCES.typography, fontSizeStep: 3 },
    });
  });

  it('disables decrement at min', () => {
    const onChange = vi.fn();
    render(
      <TypographyPanel
        preferences={{
          ...DEFAULT_READER_PREFERENCES,
          typography: { ...DEFAULT_READER_PREFERENCES.typography, fontSizeStep: 0 },
        }}
        onChange={onChange}
      />,
    );
    const dec = screen.getByRole('button', { name: /decrease font size/i });
    expect(dec).toHaveProperty('disabled', true);
  });

  it('toggles line height steps via aria-pressed buttons', () => {
    const onChange = vi.fn();
    render(<TypographyPanel preferences={DEFAULT_READER_PREFERENCES} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /loose/i }));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_READER_PREFERENCES,
      typography: { ...DEFAULT_READER_PREFERENCES.typography, lineHeightStep: 2 },
    });
  });
});
