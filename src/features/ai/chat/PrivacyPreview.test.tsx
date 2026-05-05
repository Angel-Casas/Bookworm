import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PrivacyPreview } from './PrivacyPreview';
import { buildOpenModeSystemPrompt } from './promptAssembly';

afterEach(cleanup);

describe('PrivacyPreview', () => {
  it('renders the verbatim system prompt when expanded', () => {
    render(<PrivacyPreview book={{ title: 'X', author: 'Y' }} modelId="gpt-x" historyCount={3} />);
    fireEvent.click(screen.getByRole('button'));
    const expected = buildOpenModeSystemPrompt({ title: 'X', author: 'Y' });
    expect(screen.getByText(expected)).toBeDefined();
  });

  it('summary line includes title and model', () => {
    render(<PrivacyPreview book={{ title: 'X' }} modelId="gpt-x" historyCount={0} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('X');
    expect(btn.textContent).toContain('gpt-x');
  });

  it('starts collapsed (no body content visible)', () => {
    render(<PrivacyPreview book={{ title: 'X' }} modelId="gpt-x" historyCount={0} />);
    expect(screen.queryByText('System prompt')).toBeNull();
  });
});
