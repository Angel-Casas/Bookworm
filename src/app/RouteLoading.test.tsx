import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RouteLoading } from './RouteLoading';

afterEach(cleanup);

describe('RouteLoading', () => {
  it('renders with role="main", aria-busy="true", and "Loading…" copy', () => {
    render(<RouteLoading />);
    const main = screen.getByRole('main');
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect(main.textContent).toMatch(/Loading/);
  });
});
