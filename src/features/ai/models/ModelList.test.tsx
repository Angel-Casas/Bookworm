import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ModelList } from './ModelList';

afterEach(cleanup);

describe('ModelList', () => {
  const models = [{ id: 'b-model' }, { id: 'a-model' }, { id: 'c-model' }];

  it('renders one row per model, sorted alphabetically by id', () => {
    render(<ModelList models={models} selectedId={null} onSelect={() => undefined} />);
    const rows = screen.getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual(['a-model', 'b-model', 'c-model']);
  });

  it('marks the selected row', () => {
    render(<ModelList models={models} selectedId="b-model" onSelect={() => undefined} />);
    const rows = screen.getAllByRole('button');
    const selected = rows.find((r) => r.getAttribute('aria-pressed') === 'true');
    expect(selected?.textContent).toBe('b-model');
  });

  it('clicking a row calls onSelect with that model', () => {
    const onSelect = vi.fn();
    render(<ModelList models={models} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'b-model' }));
    expect(onSelect).toHaveBeenCalledWith({ id: 'b-model' });
  });
});
