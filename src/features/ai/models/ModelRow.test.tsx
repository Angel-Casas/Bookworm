import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ModelRow } from './ModelRow';

afterEach(cleanup);

describe('ModelRow', () => {
  it('renders the model id', () => {
    render(<ModelRow model={{ id: 'gpt-4o' }} isSelected={false} onClick={() => undefined} />);
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
  });

  it('aria-pressed reflects isSelected', () => {
    render(<ModelRow model={{ id: 'gpt-4o' }} isSelected onClick={() => undefined} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking calls onClick with the model', () => {
    const onClick = vi.fn();
    render(<ModelRow model={{ id: 'gpt-4o' }} isSelected={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith({ id: 'gpt-4o' });
  });
});
