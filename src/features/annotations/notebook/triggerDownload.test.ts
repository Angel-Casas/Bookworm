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
    if (blobArg instanceof Blob) {
      expect(blobArg.type).toBe('text/markdown;charset=utf-8');
    }
  });

  it('sets the download attribute on the synthesized anchor', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const createSpy = vi.spyOn(document, 'createElement');
    triggerDownload('# Test', 'my-export.md');
    let anchor: HTMLAnchorElement | null = null;
    for (let i = 0; i < createSpy.mock.calls.length; i += 1) {
      const result = createSpy.mock.results[i];
      if (
        createSpy.mock.calls[i]?.[0] === 'a' &&
        result?.type === 'return' &&
        result.value instanceof HTMLAnchorElement
      ) {
        anchor = result.value;
        break;
      }
    }
    if (anchor === null) throw new Error('expected createElement("a") to have been called');
    expect(anchor.getAttribute('download')).toBe('my-export.md');
    expect(anchor.getAttribute('href')).toBe('blob:fake');
  });

  it('cleans up: removes the anchor and revokes the URL', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const createSpy = vi.spyOn(document, 'createElement');
    triggerDownload('content', 'f.md');
    let anchor: HTMLAnchorElement | null = null;
    for (let i = 0; i < createSpy.mock.calls.length; i += 1) {
      const result = createSpy.mock.results[i];
      if (
        createSpy.mock.calls[i]?.[0] === 'a' &&
        result?.type === 'return' &&
        result.value instanceof HTMLAnchorElement
      ) {
        anchor = result.value;
        break;
      }
    }
    if (anchor === null) throw new Error('expected createElement("a") to have been called');
    expect(document.body.contains(anchor)).toBe(false);
    expect(revoke).toHaveBeenCalledWith('blob:fake');
  });
});
