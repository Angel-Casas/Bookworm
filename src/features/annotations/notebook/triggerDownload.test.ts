import { describe, it, expect, afterEach, vi } from 'vitest';
import { triggerDownload } from './triggerDownload';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('triggerDownload', () => {
  it('creates a Blob with text/markdown MIME type', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    triggerDownload('# Test', 'test.md');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0]?.[0];
    expect(blobArg).toBeInstanceOf(Blob);
    expect((blobArg as Blob).type).toBe('text/markdown;charset=utf-8');
  });

  it('sets the download attribute on the synthesized anchor', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let capturedAnchor: HTMLAnchorElement | null = null;
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') capturedAnchor = el as HTMLAnchorElement;
      return el;
    });
    triggerDownload('# Test', 'my-export.md');
    expect(capturedAnchor).not.toBeNull();
    expect(capturedAnchor?.getAttribute('download')).toBe('my-export.md');
    expect(capturedAnchor?.getAttribute('href')).toBe('blob:fake');
  });

  it('cleans up: removes the anchor and revokes the URL', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let capturedAnchor: HTMLAnchorElement | null = null;
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === 'a') capturedAnchor = el as HTMLAnchorElement;
      return el;
    });
    triggerDownload('content', 'f.md');
    expect(capturedAnchor).not.toBeNull();
    if (capturedAnchor !== null) {
      expect(document.body.contains(capturedAnchor)).toBe(false);
    }
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });
});
