import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateKey } from './nanogptApi';

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('validateKey', () => {
  it('calls /v1/models with Authorization: Bearer …', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ data: [{ id: 'model-a' }] }),
    );
    await validateKey('sk-test');
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]! as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(call[0]).toMatch(/\/v1\/models$/);
    expect(call[1].headers.Authorization).toBe('Bearer sk-test');
  });

  it('200 with data array → ok:true with parsed models', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ data: [{ id: 'gpt-4' }, { id: 'gpt-3.5' }] }),
    );
    const r = await validateKey('sk-test');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.models).toEqual([{ id: 'gpt-4' }, { id: 'gpt-3.5' }]);
  });

  it('200 with malformed entries filters them out', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ data: [{ id: 'm-1' }, { name: 'no-id' }, null, 'string'] }),
    );
    const r = await validateKey('sk-test');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.models).toEqual([{ id: 'm-1' }]);
  });

  it('200 with no data array → ok:true with empty models', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchResponse({}));
    const r = await validateKey('sk-test');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.models).toEqual([]);
  });

  it('401 → ok:false reason invalid-key', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ error: 'unauthorized' }, 401),
    );
    const r = await validateKey('sk-bad');
    expect(r).toEqual({ ok: false, reason: 'invalid-key', status: 401 });
  });

  it('403 → ok:false reason invalid-key', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchResponse({}, 403));
    const r = await validateKey('sk-bad');
    expect(r).toEqual({ ok: false, reason: 'invalid-key', status: 403 });
  });

  it('500 → ok:false reason other', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockFetchResponse({}, 500));
    const r = await validateKey('sk-test');
    expect(r).toEqual({ ok: false, reason: 'other', status: 500 });
  });

  it('network failure → ok:false reason network', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError('failed to fetch'),
    );
    const r = await validateKey('sk-test');
    expect(r).toEqual({ ok: false, reason: 'network' });
  });

  it('malformed JSON body → ok:false reason other', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('bad json')),
    });
    const r = await validateKey('sk-test');
    expect(r).toEqual({ ok: false, reason: 'other' });
  });

  it('passes AbortSignal through to fetch', async () => {
    const ac = new AbortController();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockFetchResponse({ data: [] }),
    );
    await validateKey('sk-test', ac.signal);
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, RequestInit];
    expect(call[1].signal).toBe(ac.signal);
  });
});
