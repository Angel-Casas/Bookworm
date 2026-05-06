import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PrivacyPreview } from './PrivacyPreview';
import {
  assemblePassageChatPrompt,
  buildOpenModeSystemPrompt,
  buildPassageBlockForPreview,
} from './promptAssembly';

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

describe('PrivacyPreview — attached passage (Phase 4.4)', () => {
  const passage = {
    anchor: { kind: 'epub-cfi' as const, cfi: 'epubcfi(/6/4)' },
    text: 'a'.repeat(340),
    sectionTitle: 'Chapter 4',
    windowBefore: 'before context',
    windowAfter: 'after context',
  };

  it('summary excludes the passage line when attachedPassage is null', () => {
    render(
      <PrivacyPreview
        book={{ title: 'X' }}
        modelId="gpt-x"
        historyCount={0}
        attachedPassage={null}
      />,
    );
    expect(screen.getByRole('button').textContent).not.toMatch(/selected passage/i);
  });

  it('summary includes section + selected-passage chunk count when attached', () => {
    render(
      <PrivacyPreview
        book={{ title: 'X' }}
        modelId="gpt-x"
        historyCount={0}
        attachedPassage={passage}
      />,
    );
    const text = screen.getByRole('button').textContent;
    expect(text).toMatch(/chapter 4/i);
    expect(text).toMatch(/selected passage \(~340 chars\)/i);
  });

  it('expanded form includes an "Attached passage" section with the literal block', () => {
    const { container } = render(
      <PrivacyPreview
        book={{ title: 'Pride and Prejudice' }}
        modelId="gpt-x"
        historyCount={0}
        attachedPassage={passage}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Attached passage')).toBeInTheDocument();

    const expectedBlock = buildPassageBlockForPreview('Pride and Prejudice', {
      text: passage.text,
      sectionTitle: passage.sectionTitle,
      windowBefore: passage.windowBefore,
      windowAfter: passage.windowAfter,
    });
    // The expanded body has two <pre> elements (system prompt + attached passage).
    // The second contains our passage block.
    const pres = container.querySelectorAll('.privacy-preview__prompt');
    expect(pres).toHaveLength(2);
    expect(pres[1]?.textContent).toBe(expectedBlock);
  });

  // Spec §10.1: privacy preview must show character-for-character what the
  // assembly sends, locked by structural-equivalence so they cannot drift.
  it('the rendered passage block is byte-equal to what assemblePassageChatPrompt embeds', () => {
    const book = { title: 'Pride and Prejudice', author: 'Jane Austen', format: 'epub' as const };
    const assembled = assemblePassageChatPrompt({
      book,
      history: [],
      newUserText: 'Q',
      passage: {
        text: passage.text,
        sectionTitle: passage.sectionTitle,
        windowBefore: passage.windowBefore,
        windowAfter: passage.windowAfter,
      },
    });
    // The assembled user message is `passageBlock + "\n\n" + newUserText`.
    // Strip the "\n\nQ" suffix to get the block alone.
    const lastUser = assembled.messages[assembled.messages.length - 1]!;
    const expectedBlock = lastUser.content.slice(0, lastUser.content.length - '\n\nQ'.length);

    const { container } = render(
      <PrivacyPreview
        book={{ title: book.title, author: book.author }}
        modelId="gpt-x"
        historyCount={0}
        attachedPassage={passage}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    const pres = container.querySelectorAll('.privacy-preview__prompt');
    expect(pres[1]?.textContent).toBe(expectedBlock);
  });
});
